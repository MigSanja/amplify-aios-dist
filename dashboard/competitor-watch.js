// competitor-watch.js — Auto-Research für den Ideen-Feed der Content-Pipeline.
// Scrapt via Apify die letzten Instagram-Posts der US-Accounts aus der Beobachtungsliste
// (data/competitor-watch.json), findet Outlier (Posts, die deutlich besser laufen als der
// Account-Schnitt), lässt Claude (Subscription/CLI) daraus deutsche Post-Ideen in des Nutzers
// Positionierung machen und legt sie mit Thumbnail/Link/Viralität/Datum über die Server-API
// als quelle "research" in die Content-Pipeline. Regel 17.07.: NUR USA, Trends ins Deutsche.
// Läuft täglich via launchd (com.jarvis.competitor-watch) oder manuell: node dashboard/competitor-watch.js

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { spawn } = require("child_process");

const ROOT = path.join(os.homedir(), "AIOS");
const WATCH_FILE = path.join(ROOT, "dashboard/data/competitor-watch.json");
const THUMB_DIR = path.join(ROOT, "dashboard/public/cw");
const CLAUDE_BIN_SH = path.join(ROOT, "dashboard/claude-bin.sh");
const LOG_FILE = path.join(ROOT, "dashboard/competitor-watch.log");

function log(msg) {
  const line = `[${new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" })}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

// Telegram nur für harte Blocker + echte Funde (sparsam, Regel: nie still überspringen)
function ping(title, text) {
  try {
    const child = spawn("node", [path.join(ROOT, "dashboard/notify.js"), "--title", title, text], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {}
}

function envToken() {
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = env.match(/^APIFY_TOKEN=(.+)$/m);
    return m ? m[1].trim() : "";
  } catch { return ""; }
}

function fetchJson(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: body ? "POST" : "GET",
        headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} },
      (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          if (r.statusCode >= 200 && r.statusCode < 300) {
            try { resolve(JSON.parse(d)); } catch (e) { reject(new Error("JSON-Parse: " + e.message)); }
          } else reject(new Error(`HTTP ${r.statusCode}: ${d.slice(0, 300)}`));
        });
      }
    );
    req.setTimeout(timeoutMs || 300000, () => req.destroy(new Error("Timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Thumbnail lokal sichern — die Instagram-CDN-URLs laufen nach Tagen ab, ein lokales JPG nicht.
function downloadThumb(url, file) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const doGet = (u, hops) => {
      if (hops > 3) return resolve(false);
      https.get(u, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return doGet(r.headers.location, hops + 1); }
        if (r.statusCode !== 200) { r.resume(); return resolve(false); }
        const out = fs.createWriteStream(file);
        r.pipe(out);
        out.on("finish", () => out.close(() => resolve(true)));
        out.on("error", () => resolve(false));
      }).on("error", () => resolve(false)).setTimeout(30000, function () { this.destroy(); resolve(false); });
    };
    doGet(url, 0);
  });
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.ANTHROPIC_API_KEY; // Subscription erzwingen (gleiches Muster wie sales-copilot/notetaker.js)
    const p = spawn("/bin/bash", ["-c", `unset ANTHROPIC_API_KEY; source "${CLAUDE_BIN_SH}" && exec "$CLAUDE_BIN" -p`], { stdio: ["pipe", "pipe", "pipe"], env: cleanEnv });
    let out = "", err = "";
    const to = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("Claude-CLI Timeout (240s)")); }, 240000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(to); reject(e); });
    p.on("close", (code) => { clearTimeout(to); if (code === 0 && out.trim()) resolve(out.trim()); else reject(new Error(`Claude-CLI Exit ${code}: ${(err || out).slice(0, 200)}`)); });
    p.stdin.write(prompt);
    p.stdin.end();
  });
}

function postIdea(idea) {
  return new Promise((resolve) => {
    const body = JSON.stringify(idea);
    const req = require("http").request(
      { host: "127.0.0.1", port: 4321, path: "/api/content-idea-add", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: 10000 },
      (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false }); } }); }
    );
    req.on("error", () => resolve({ ok: false, error: "Server nicht erreichbar" }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "Timeout" }); });
    req.write(body);
    req.end();
  });
}

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  log("=== Competitor-Watch start ===");
  const token = envToken();
  if (!token) { log("FEHLER: kein APIFY_TOKEN in .env"); ping("🔍 Competitor-Watch", "Abbruch: kein APIFY_TOKEN in der Root-.env."); process.exit(1); }

  const watch = JSON.parse(fs.readFileSync(WATCH_FILE, "utf8"));
  const st = watch.settings || {};
  const active = (watch.accounts || []).filter((a) => a.aktiv && a.platform === "instagram" && (!st.nurUSA || a.land === "US"));
  if (!active.length) { log("Keine aktiven US-Instagram-Accounts in der Liste."); return; }
  log(`Scrape ${active.length} Accounts: ${active.map((a) => "@" + a.account).join(", ")}`);

  // Apify Instagram-Scraper: ein Lauf für alle Accounts (run-sync liefert die Dataset-Items direkt)
  const input = {
    directUrls: active.map((a) => `https://www.instagram.com/${a.account}/`),
    resultsType: "posts",
    resultsLimit: st.postsProAccount || 8,
    addParentData: false,
  };
  const items = await fetchJson(`https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=240`, input, 280000);
  if (!Array.isArray(items)) throw new Error("Apify: unerwartete Antwort");
  log(`Apify lieferte ${items.length} Posts`);

  const maxAgeMs = (st.maxAlterTage || 21) * 864e5;
  const seen = new Set(watch.gesehen || []);
  const byAccount = {};
  const posts = [];
  for (const it of items) {
    if (!it || !it.shortCode) continue;
    const ts = it.timestamp ? new Date(it.timestamp).getTime() : 0;
    const p = {
      sc: it.shortCode,
      account: it.ownerUsername || "",
      name: it.ownerFullName || "",
      url: it.url || `https://www.instagram.com/p/${it.shortCode}/`,
      caption: String(it.caption || "").slice(0, 800),
      likes: +it.likesCount || 0,
      comments: +it.commentsCount || 0,
      views: +it.videoViewCount || +it.videoPlayCount || 0,
      thumb: it.displayUrl || "",
      ts,
      typ: it.type === "Video" ? "reel" : it.type === "Sidecar" ? "carousel" : "post",
    };
    (byAccount[p.account] = byAccount[p.account] || []).push(p);
    if (ts && Date.now() - ts <= maxAgeMs && !seen.has(p.sc)) posts.push(p);
  }

  // Outlier-Faktor: Engagement des Posts vs. Median des eigenen Accounts (Views bevorzugt, sonst Likes).
  for (const p of posts) {
    const peers = byAccount[p.account] || [];
    const base = p.views ? median(peers.map((x) => x.views).filter(Boolean)) : median(peers.map((x) => x.likes).filter(Boolean));
    const val = p.views || p.likes;
    p.outlier = base > 0 ? +(val / base).toFixed(2) : 1;
  }
  posts.sort((a, b) => (b.outlier || 0) - (a.outlier || 0));
  const picks = posts.slice(0, st.maxIdeenProLauf || 3);
  log(`Kandidaten nach Alter/De-Dupe: ${posts.length}, ausgewählt: ${picks.length}`);
  if (!picks.length) {
    // Alles Gesehene festhalten, sonst prüft der nächste Lauf dieselben Posts erneut
    markSeen(watch, posts, []);
    log("Nichts Neues. Fertig.");
    return;
  }

  // Claude: US-Post → deutsche Post-Idee in des Nutzers Positionierung (KI-Systeme statt mehr Personal)
  const prompt = `Du bist des Nutzers Content-Stratege (dein Business: KI-Systeme/"KI-Mitarbeiter" für Agenturen, Coaches, Makler im DACH-Raum; Positionierung: klein bleiben, mit KI skalieren statt mit Personal). Unten ${picks.length} aktuell gut laufende US-Instagram-Posts von beobachteten Creators. Mach aus JEDEM eine DEUTSCHE Post-Idee für des Nutzers Kanäle: US-Trend übernehmen, aber Struktur/Hook adaptiert auf seine Zielgruppe, NICHT übersetzen und NICHT 1:1 kopieren.

Antworte NUR mit einem JSON-Array, ein Objekt pro Post, exakt diese Felder:
[{"sc":"<shortCode>","titel":"<deutscher Arbeitstitel, max 100 Zeichen>","hook":"<deutscher Hook-Satz>","typ":"<reel|carousel|post>","score":<1-10 wie gut es zu des Nutzers Positionierung passt>,"scoreGrund":"<1 Satz warum>","notiz":"<2-4 Sätze: was der US-Post macht, warum er läuft, wie die deutsche Version konkret aussieht>"}]

Posts:
${picks.map((p) => JSON.stringify({ sc: p.sc, account: p.account, typ: p.typ, outlierFaktor: p.outlier, views: p.views, likes: p.likes, comments: p.comments, caption: p.caption })).join("\n")}`;

  let ideas = [];
  try {
    const out = await runClaude(prompt);
    const jsonText = (out.match(/\[[\s\S]*\]/) || [out])[0];
    ideas = JSON.parse(jsonText);
  } catch (e) {
    log("FEHLER Claude-Auswertung: " + e.message);
    ping("🔍 Competitor-Watch", `Scrape ok (${picks.length} Kandidaten), aber die Claude-Auswertung schlug fehl: ${String(e.message).slice(0, 120)}`);
    process.exit(1);
  }

  fs.mkdirSync(THUMB_DIR, { recursive: true });
  const added = [];
  for (const idea of ideas) {
    const p = picks.find((x) => x.sc === idea.sc);
    if (!p) continue;
    const thumbFile = path.join(THUMB_DIR, `${p.sc}.jpg`);
    const gotThumb = await downloadThumb(p.thumb, thumbFile);
    const res = await postIdea({
      titel: idea.titel, hook: idea.hook, kanal: "Instagram", quelle: "research",
      typ: idea.typ || p.typ, score: idea.score, scoreGrund: idea.scoreGrund,
      outlier: p.outlier,
      notiz: (idea.notiz || "") + `\n\nOutlier-Faktor: ${p.outlier}x vs. Account-Schnitt.`,
      url: p.url, thumb: gotThumb ? `/cw/${p.sc}.jpg` : "",
      postDatum: new Date(p.ts).toISOString().slice(0, 10),
      viral: { views: p.views || undefined, likes: p.likes, comments: p.comments },
      quelleAccount: p.account, quelleName: p.name,
    });
    if (res.ok && !res.dupe) added.push(`@${p.account}: ${idea.titel} (${p.outlier}x)`);
    else if (!res.ok) log(`FEHLER Idee-Anlegen (${p.sc}): ${res.error || "?"}`);
  }

  markSeen(watch, posts, picks);
  log(`Fertig: ${added.length} neue Research-Ideen im Feed.`);
  if (added.length) ping("🔍 Competitor-Watch", `${added.length} neue US-Trend-Idee(n) im Ideen-Feed (Tab Auto-Research):\n` + added.join("\n"));
}

// Posts als gesehen markieren: ausgewählte immer; nicht ausgewählte erst ab 3 Tagen Alter,
// damit junge Posts beim nächsten Lauf mit gereiften Zahlen noch mal antreten dürfen.
function markSeen(watch, posts, picks) {
  const seen = new Set(watch.gesehen || []);
  for (const p of picks) seen.add(p.sc);
  for (const p of posts) if (Date.now() - p.ts > 3 * 864e5) seen.add(p.sc);
  watch.gesehen = [...seen].slice(-500);
  watch.lastRun = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" });
  const tmp = WATCH_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(watch, null, 2));
  fs.renameSync(tmp, WATCH_FILE);
}

main().catch((e) => {
  log("FEHLER: " + (e && e.message));
  ping("🔍 Competitor-Watch", "Lauf abgebrochen: " + String(e && e.message).slice(0, 150));
  process.exit(1);
});
