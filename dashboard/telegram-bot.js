#!/usr/bin/env node
// Jarvis Telegram-Bot — mobiles Interface in dasselbe Brain.
// Pure Node-Stdlib (kein npm). Long-Polling (getUpdates) → pro Turn `claude -p` (stream-json)
// im Jarvis-ROOT, persistente Session (kein Kaltstart), Antwort zurück nach Telegram.
//
// Start:  node dashboard/telegram-bot.js
// Stop:   Ctrl-C
//
// Sicherheit: nur die in .env hinterlegte Chat-ID darf den Bot bedienen (Whitelist).
// Beim ersten Kontakt loggt der Bot deine Chat-ID → trag sie als TELEGRAM_ALLOWED_CHAT_ID ein.

const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn, execSync, execFileSync } = require("child_process");
const { writeJsonAtomic } = require("./atomic-write");

const ROOT = path.resolve(__dirname, "..");
const HOME = process.env.HOME || require("os").homedir();

// ---- .env laden (kein dotenv) ----
(function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].replace(/^["']|["']$/g, "");
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {}
})();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED = (process.env.TELEGRAM_ALLOWED_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN fehlt in .env. Hol dir einen Token bei @BotFather und trag ihn ein.");
  process.exit(1);
}
const API = `https://api.telegram.org/bot${TOKEN}`;

// ---- Telegram-API (Promise über https) ----
function tg(method, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload || {});
    const req = https.request(
      `${API}/${method}`,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, timeout: 65000 },
      (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve({ ok: false }); } }); }
    );
    req.on("error", (e) => { console.error("[tg] " + method + " err", e.message); resolve({ ok: false }); });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
    req.end(data);
  });
}
// Buttons: Jarvis schreibt `@@buttons:Senden|Ändern|Verwerfen@@` in die Antwort → wird hier zum Inline-Keyboard.
// Klick kommt als normale Nachricht ("Senden") zurück in den Turn-Queue = Human-in-the-Loop ohne Tipparbeit.
// callback_data ist auf 64 Byte begrenzt → wir schicken nur eine ID + Index und halten die Labels hier im Speicher.
const BUTTON_RE = /@@buttons:([^@]+)@@/i;
// Labels liegen auf der Platte, nicht nur im RAM: der Nutzer schaut nicht sofort aufs Handy, ein Button
// muss auch Stunden später und nach einem Bot-Neustart noch klickbar sein (sonst "Button abgelaufen").
const BUTTONS_FILE = path.join(ROOT, "dashboard", "data", "pending-buttons.json");
const BUTTONS_KEEP = 500;
const pendingButtons = new Map(); // id -> { labels: string[] }
let buttonSeq = 0;
try {
  const saved = JSON.parse(fs.readFileSync(BUTTONS_FILE, "utf8"));
  for (const [id, entry] of Object.entries(saved.buttons || {})) pendingButtons.set(id, entry);
  buttonSeq = Number(saved.seq) || 0;
} catch { /* erste Ausführung oder Datei kaputt → leer starten */ }
function saveButtons() {
  try { writeJsonAtomic(BUTTONS_FILE, { seq: buttonSeq, buttons: Object.fromEntries(pendingButtons) }); }
  catch (e) { console.error("[buttons] save", e.message); }
}
function extractButtons(text) {
  const m = String(text || "").match(BUTTON_RE);
  if (!m) return { text, markup: null };
  const labels = m[1].split("|").map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const clean = String(text).replace(BUTTON_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!labels.length) return { text: clean, markup: null };
  const id = String(++buttonSeq);
  pendingButtons.set(id, { labels });
  while (pendingButtons.size > BUTTONS_KEEP) pendingButtons.delete(pendingButtons.keys().next().value);
  saveButtons();
  // Ein Button pro Zeile (untereinander) — nebeneinander schneidet Telegram lange Labels auf dem Handy ab.
  return { text: clean, markup: { inline_keyboard: labels.map((l, i) => [{ text: l, callback_data: `b:${id}:${i}` }]) } };
}
const sendChunked = async (chat, text) => {
  const { text: t0, markup } = extractButtons(text);
  const t = String(t0 || "").trim() || "…";
  for (let i = 0; i < t.length; i += 3800) {
    const last = i + 3800 >= t.length;
    await tg("sendMessage", { chat_id: chat, text: t.slice(i, i + 3800), disable_web_page_preview: true, ...(last && markup ? { reply_markup: markup } : {}) });
  }
};
const typing = (chat) => tg("sendChatAction", { chat_id: chat, action: "typing" });

// ---- Telegram-Datei (Foto/Doc/beliebige Datei) herunterladen → lokaler Pfad, den claude via Read sieht ----
const MEDIA_DIR = path.join(ROOT, "dashboard", "data", "telegram-media");
// nameHint = Original-Dateiname (bei Dokumenten). Dann bleibt Name + Endung erhalten (Skill-/Zip-Name),
// sonst fileId + Endung aus dem Remote-Pfad (Fotos/Videos: Telegram liefert korrekte Endung, Fallback .jpg).
function tgDownload(fileId, nameHint) {
  return new Promise(async (resolve) => {
    const r = await tg("getFile", { file_id: fileId });
    if (!r || !r.ok || !r.result || !r.result.file_path) return resolve(null);
    const remote = r.result.file_path;                       // z.B. "photos/file_123.jpg"
    const url = `https://api.telegram.org/file/bot${TOKEN}/${remote}`;
    try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch {}
    let name;
    if (nameHint) {
      const safe = String(nameHint).replace(/[^\w.\-]+/g, "_").replace(/^[._]+/, "").slice(0, 120) || "datei";
      name = `${fileId}-${safe}`;                             // fileId-Präfix = kollisionsfrei, Name/Endung bleibt lesbar
    } else {
      name = `${fileId}${path.extname(remote) || ".jpg"}`;
    }
    const local = path.join(MEDIA_DIR, name);
    const file = fs.createWriteStream(local);
    https.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve(local)));
    }).on("error", () => { try { fs.unlinkSync(local); } catch {}; resolve(null); });
  });
}

// ---- claude finden (gleiche Logik wie server.js) ----
function findClaude() {
  const c = [process.env.CLAUDE_BIN, path.join(HOME, ".claude/local/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude", path.join(HOME, ".npm-global/bin/claude")].filter(Boolean);
  for (const p of c) { try { if (p && fs.existsSync(p)) return p; } catch {} }
  try {
    const ccDir = path.join(HOME, "Library/Application Support/Claude/claude-code");
    if (fs.existsSync(ccDir)) { const vers = fs.readdirSync(ccDir).sort().reverse(); for (const v of vers) { const p = path.join(ccDir, v, "claude.app/Contents/MacOS/claude"); if (fs.existsSync(p)) return p; } }
  } catch {}
  try { return execSync("command -v claude", { shell: "/bin/zsh" }).toString().trim() || null; } catch { return null; }
}

// ---- Rollierender Verlauf (kein Dauer-Prozess; frischer claude-Lauf pro Turn) ----
const MODEL = "claude-opus-4-8";
const MAX_MSGS = 60;          // Verlauf behalten bis /neu; N = harte Obergrenze (Schutz vor Runaway-Kosten)
const TURN_TIMEOUT = 240000;  // 4 Min/Turn (normaler Chat)
const VIDEO_TIMEOUT = 1800000; // 30 Min für Video-Turns (watch-Skill: Download + Frames + Transkript, 30-Min-Video braucht 5–15 Min)
// Erkennt Turns, die das watch-Skill auslösen (Video-Link oder gedropptes Video) → langer Timeout.
const VIDEO_URL_RE = /(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|loom\.com|vimeo\.com|(^|\W)x\.com|twitter\.com|\.mp4\b|\.mov\b|\.webm\b)/i;
const HIST_FILE = path.join(ROOT, "dashboard", "data", "telegram-history.json");

const WARN_AT = 46;           // ab so vielen Einträgen proaktiv auf /neu hinweisen (kurz vor der Obergrenze)
let warned = false;           // pro Thema nur einmal warnen (bei /neu zurückgesetzt)
let history = [];             // [{ role: "der Nutzer"|"Jarvis", text }]
try { history = JSON.parse(fs.readFileSync(HIST_FILE, "utf8")) || []; } catch {}
function saveHist() { try { writeJsonAtomic(HIST_FILE, history.slice(-MAX_MSGS)); } catch {} }
function pushHist(role, text) { history.push({ role, text }); if (history.length > MAX_MSGS) history = history.slice(-MAX_MSGS); saveHist(); }

function brief() {
  return [
    "Du bist Jarvis, des Nutzers persönlicher Business-Partner & CEO-Agent — über sein HANDY (Telegram).",
    "Dein volles Briefing: CLAUDE.md + brain/01_Identity/identity.md (lies gezielt bei Bedarf). Du arbeitest im Jarvis-Ordner mit vollem Zugriff aufs Brain (Notizen anlegen/aktualisieren = Auto-Capture) und auf Google (Kalender/Gmail via mcp__google).",
    "KUNDEN & LEADS (wichtig — hier hast du früher Kunden übersehen): Bei JEDER Frage über einen Kunden, Lead oder Kontakt ZUERST `dashboard/data/kunden-index.md` lesen (ein Read, alle 471 Kontakte nach Name findbar + heiße Pipeline + Kundenprojekte). Reicht das nicht: `dashboard/data/leads.json` (volles CRM, per grep nach Name), `brain/02_People/`, `brain/03_Projects/<kunde>.md`. LESEN aus dashboard/data/ ist ausdrücklich erlaubt — die 'Goldene Regel' regelt nur, wohin GESCHRIEBEN wird. Nie 'weiß ich nicht' sagen, ohne vorher den Index geöffnet zu haben.",
    "MOBIL-STIL (hart): SEHR kurz, direkt, Deutsch. Kein Markdown-Schnickschnack, keine langen Blöcke — Handy-Bildschirm. Eine Sache pro Antwort.",
    "BUTTONS (Human-in-the-Loop): Wenn du eine Freigabe brauchst (Mail rausschicken, Termin anlegen, Notiz speichern, Nachricht senden), zeig den Entwurf und häng ans ENDE deiner Antwort `@@buttons:✅ Senden|✏️ Ändern|❌ Verwerfen@@` (max. 6 Labels, mit | getrennt). Der Bot macht daraus echte Klick-Buttons; des Nutzers Klick kommt als normale Nachricht mit dem Label zurück. Labels frei wählbar und zur Situation passend (z.B. `@@buttons:Ja, ins Brain|Nein@@`). Nur bei echten Ja/Nein-Entscheidungen, nicht bei jeder Antwort. Der Token selbst ist unsichtbar, schreib ihn nie im Fließtext.",
    "Bei Brain-Dumps/Ideen/Leads/Tasks: sofort strukturieren + im richtigen Bucket ablegen, in EINER Zeile sagen wo.",
    "POSTING-IDEEN (feste Regel): Alle Post-/Content-Ideen landen ZENTRAL in der Content-Pipeline (Dashboard-Modul 'projekte'/Content-Pipeline, Daten in dashboard/data/content-pipeline.json), nichts verstreut. Riecht was nach Post-Idee, FRAG erst ('Soll das als Posting-Idee rein?') — bei Ja als Idee anlegen (getaggt LinkedIn vs. Instagram, Quelle Eigen vs. Scrape), NICHT ausschreiben. Anlegen IMMER über POST http://localhost:4321/api/content-idea-add und bei eingeworfenen Creator-Posts/Reels die Feed-Felder MITGEBEN, soweit ermittelbar: url (Instagram-/Post-Link), thumb (öffentliche Bild-URL, z.B. og:image der Post-Seite), postDatum (YYYY-MM-DD des Original-Posts), viral ({views, likes, comments} falls sichtbar/genannt), quelleAccount + quelleName. Der Ideen-Feed zeigt Miniaturbild, Viralität und Alter — ohne diese Felder bleibt die Idee dort blind. Erst wenn der Nutzer 'ab in die Pipeline / mach nen Post draus' sagt → ausschreiben. Regel-Detail: brain/03_Projects/content-engine.md.",
    "VIDEO-LINKS (YouTube, Instagram, TikTok, X, Loom, …): Nutze den 'watch'-Skill (~/.claude/skills/watch, scripts/watch.py) — er lädt das Video, zieht Frames + Transkript, du SCHAUST es wirklich (Bild + Ton). Ablauf: (1) anschauen, (2) kurz die Essenz/Key-Takeaways geben und mit der Nutzer BESPRECHEN — NICHT sofort wegspeichern, (3) erst wenn er sagt 'speichern/ins Brain' → verlinkte Notiz in brain/08_Video-Learnings/ anlegen (NICHT 05_Knowledge — das ist eigenes Wissen). Vorlage: brain/_templates/video-learning.md. Frontmatter type: video-learning. Tags: Plattform (#youtube/#instagram) + Art (#bildidee/#contentidee/#fuer-produkt/#fuer-marketing/#abschauen/#inspiration/#cool). Verlinke zu passenden Ideen/Projekten/Areas und trag die Notiz in brain/08_Video-Learnings/_README.md unter 'Inhalt' ein. NOTION nur wenn er es ausdrücklich sagt (Notion = seine hübsche Vitrine; Brain = Standard, für die KI).",
    "Der folgende Verlauf ist ein ROLLIERENDES Fenster (nur die letzten Nachrichten) — älteres ist bewusst weg, frag nach wenn dir Kontext fehlt.",
  ].join(" ");
}

// System-Pings der letzten 12h (Heartbeat/Nachtwerker/Outreach) aus notifications-log.jsonl.
// Diese Pings gehen via notify.js direkt an des Nutzers Telegram, laufen also an meinem Gesprächsfaden
// vorbei. Ich lade sie hier mit rein, damit ich weiß, was der Nutzer gerade gesehen hat und worauf er
// sich bezieht, wenn er auf einen Ping antwortet.
function recentPings() {
  try {
    const logFile = path.join(ROOT, "dashboard", "data", "notifications-log.jsonl");
    const cutoff = Date.now() - 12 * 3600 * 1000;
    const lines = fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);
    const recent = lines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.ts && new Date(e.ts).getTime() >= cutoff)
      .slice(-20);
    if (!recent.length) return "";
    const fmt = recent.map((e) => {
      const t = new Date(e.ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      return `[${t}] ${e.prefix}: ${e.body}`;
    }).join("\n");
    return "\n\n=== System-Pings an der Nutzer (letzte 12h, gingen an sein Telegram, NICHT Teil des Chat-Verlaufs) ===\n" + fmt;
  } catch { return ""; }
}

function buildPrompt(text) {
  const convo = history.map((m) => `${m.role}: ${m.text}`).join("\n");
  return brief() + recentPings() + "\n\n=== Verlauf (rollierend) ===\n" + (convo || "(noch leer)") + "\n\n=== Neue Nachricht ===\nder Nutzer: " + text;
}

let queue = [], busy = false;
function run(chat, userText, isVideoTurn) {
  const claude = findClaude();
  if (!claude) return sendChunked(chat, "⚠️ claude CLI nicht gefunden. Bot auf dem Mac neu starten.");
  // bypassPermissions: headless Agent, kein Mensch der "Erlauben" klickt → Bash (yt-dlp/ffmpeg fürs watch-Skill),
  // Datei-Downloads, MCP-Calls müssen autonom laufen. Sonst hängt jeder Tool-Call an einer Freigabe.
  const args = ["-p", buildPrompt(userText), "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--permission-mode", "bypassPermissions", "--model", MODEL];
  const gmcp = path.join(ROOT, "dashboard", "google-mcp.json");
  if (fs.existsSync(gmcp)) args.push("--mcp-config", gmcp, "--allowedTools", "mcp__google");
  // Frage SOFORT in den Verlauf (nicht erst bei der Antwort) → ein gekillter/abgebrochener Turn geht nicht verloren.
  pushHist("der Nutzer", userText);

  // PATH härten: launchd kennt /usr/local/bin & /opt/homebrew/bin nicht — dort liegen yt-dlp/ffmpeg (watch-Skill).
  const env = { ...process.env, PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin"}` };
  const p = spawn(claude, args, { cwd: ROOT, env });
  let buf = "", text = "", done = false, usage = null;
  const keepTyping = setInterval(() => typing(chat), 5000);
  typing(chat);
  const finish = async (out) => {
    if (done) return; done = true;
    clearInterval(keepTyping); clearTimeout(timer);
    const reply = (out || "").trim() || "⏳ (keine Antwort — frag nochmal)";
    pushHist("Jarvis", reply); // Frage wurde schon beim Start gespeichert (Footer NICHT in History → Kontext bleibt sauber)
    let outMsg = reply;
    if (usage) {
      const tot = (usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
      console.error(`[tokens] total=${tot} in=${usage.input_tokens || 0} out=${usage.output_tokens || 0} cache_r=${usage.cache_read_input_tokens || 0} cache_w=${usage.cache_creation_input_tokens || 0}`);
      outMsg += `\n\n🔢 ~${tot.toLocaleString("de-DE")} Tok`;
    }
    await sendChunked(chat, outMsg);
    if (history.length >= WARN_AT && !warned) { warned = true; await sendChunked(chat, "💡 Der Verlauf wird lang — wenn das nächste was Neues ist, schreib /neu (sonst rutscht Älteres raus)."); }
    busy = false; pump();
  };
  const timer = setTimeout(() => { try { p.kill(); } catch {}; finish(text || (isVideoTurn ? "⏳ Timeout nach 30 Min — das Video war zu groß. Versuch's mit einem Ausschnitt (z.B. 'nur Minute 0–15')." : "⏳ Timeout — das Thema war zu groß. Frag enger nochmal.")); }, isVideoTurn ? VIDEO_TIMEOUT : TURN_TIMEOUT);

  p.stdout.on("data", (d) => {
    buf += d; let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === "stream_event" && o.event && o.event.type === "content_block_delta" && o.event.delta && o.event.delta.type === "text_delta") text += o.event.delta.text;
      else if (o.type === "result") { if (o.usage) usage = o.usage; finish(text || o.result || ""); }
    }
  });
  p.stderr.on("data", (d) => console.error("[claude-stderr] " + String(d).slice(0, 300)));
  p.on("close", () => finish(text));
  p.on("error", (e) => { console.error("[run] error", e && e.message); finish(text || "Fehler beim Start."); });
}
function pump() { if (busy || !queue.length) return; busy = true; const j = queue.shift(); console.error("[turn] " + (j.video ? "🎬 " : "") + String(j.text).slice(0, 60)); run(j.chat, j.text, j.video); }
const ask = (chat, text, video) => { queue.push({ chat, text, video: !!video }); pump(); };

// ---- Medien-Gruppen (mehrere Bilder auf einmal) ----
// Telegram schickt ein Album als EINZELNE Nachrichten mit gleicher media_group_id.
// Wir puffern sie kurz (Debounce) und machen daraus EINEN Turn statt N.
const mediaGroups = new Map(); // media_group_id -> { chat, items, caption, timer }
const MEDIA_GROUP_WAIT = 1800;  // ms warten, ob noch Bilder aus derselben Gruppe kommen
function bufferMediaGroup(gid, chat, item, caption) {
  let g = mediaGroups.get(gid);
  if (!g) { g = { chat, items: [], caption: "", timer: null }; mediaGroups.set(gid, g); }
  if (item) g.items.push(item);
  if (caption && !g.caption) g.caption = caption; // Caption hängt meist nur an einem Bild
  if (g.timer) clearTimeout(g.timer);
  g.timer = setTimeout(() => { mediaGroups.delete(gid); flushMediaGroup(g).catch((e) => console.error("[mediaGroup]", e)); }, MEDIA_GROUP_WAIT);
}
async function flushMediaGroup(g) {
  typing(g.chat);
  const media = [];
  for (const it of g.items) { const local = await tgDownload(it.fileId); if (local) media.push({ type: it.type, local }); }
  if (!media.length) return sendChunked(g.chat, "⚠️ Die Bilder konnte ich nicht laden — schick sie nochmal.");
  const hasVideo = media.some((m) => m.type === "video");
  const list = media.map((m) => `- ${m.local}${m.type === "video" ? " (Video)" : ""}`).join("\n");
  let text;
  if (hasVideo) {
    text = `[der Nutzer hat mehrere Medien zusammen geschickt — schau dir ALLE an (Bilder mit dem Read-Tool, Videos mit dem 'watch'-Skill) und geh in EINER Antwort gesammelt darauf ein:\n${list}]`;
  } else {
    text = `[der Nutzer hat ${media.length} Bilder zusammen geschickt — schau dir ALLE mit dem Read-Tool an und geh in EINER Antwort gesammelt darauf ein:\n${list}]`;
  }
  if (g.caption) text += `\n${g.caption}`;
  ask(g.chat, text, hasVideo);
}

// ---- Nachricht verarbeiten ----
async function onMessage(msg) {
  const chat = String(msg.chat && msg.chat.id);
  let text = (msg.text || "").trim();
  const caption = (msg.caption || "").trim();

  // Bild dabei? Größtes Foto oder als Bild geschicktes Dokument (image/*).
  let photoId = null;
  if (Array.isArray(msg.photo) && msg.photo.length) photoId = msg.photo[msg.photo.length - 1].file_id;
  else if (msg.document && /^image\//.test(msg.document.mime_type || "")) photoId = msg.document.file_id;

  // Video dabei? Als Video oder Dokument (video/*) — wird mit dem watch-Skill wirklich geschaut.
  let videoId = null;
  if (msg.video && msg.video.file_id) videoId = msg.video.file_id;
  else if (msg.document && /^video\//.test(msg.document.mime_type || "")) videoId = msg.document.file_id;

  // Sonstige Datei (Skill-Zip, .md, .txt, PDF, JSON, …) — jede angehängte Datei, die kein Bild/Video ist.
  let docId = null, docName = "";
  if (msg.document && !photoId && !videoId) { docId = msg.document.file_id; docName = msg.document.file_name || ""; }

  if (!text && !photoId && !videoId && !docId) return;

  // Whitelist: keine ID konfiguriert → ID loggen + Hinweis, sonst fremde Chats abweisen.
  if (!ALLOWED.length) {
    console.error(`\n🔑 Deine Chat-ID: ${chat}  → trag sie in .env ein: TELEGRAM_ALLOWED_CHAT_ID=${chat}\n`);
    return sendChunked(chat, `Hi! Deine Chat-ID ist ${chat}.\nTrag sie auf dem Mac in .env ein (TELEGRAM_ALLOWED_CHAT_ID=${chat}) und starte den Bot neu — dann bin ich scharf.`);
  }
  if (!ALLOWED.includes(chat)) { console.error("[abgewiesen] Chat " + chat); return sendChunked(chat, "⛔️ Dieser Bot ist privat."); }

  if (text === "/start") return sendChunked(chat, "Jarvis online. 🤖 Schreib mir einfach — Brain-Dumps, Fragen, Tasks, YouTube-Links, Fotos. /neu = frisches Thema, /ping = Test.");
  if (text === "/ping") return sendChunked(chat, "pong ✅");
  if (text === "/neu") { history = []; warned = false; saveHist(); return sendChunked(chat, "🧹 Verlauf geleert — frisches Thema. Worum geht's?"); }

  // Album (mehrere Bilder/Medien auf einmal)? Sammeln statt jedes einzeln verarbeiten → EINE Antwort.
  if (msg.media_group_id && (photoId || videoId)) {
    const item = photoId ? { type: "image", fileId: photoId } : { type: "video", fileId: videoId };
    return bufferMediaGroup(String(msg.media_group_id), chat, item, caption || text);
  }

  // Foto → runterladen, Pfad in den Prompt, claude schaut es via Read-Tool an.
  if (photoId) {
    typing(chat);
    const local = await tgDownload(photoId);
    if (!local) return sendChunked(chat, "⚠️ Bild konnte ich nicht laden — schick's nochmal.");
    const cap = caption || text;
    text = `[der Nutzer hat ein Bild geschickt: ${local} — schau es dir mit dem Read-Tool an und geh darauf ein.]` + (cap ? `\n${cap}` : "");
  }

  // Video → runterladen, mit dem watch-Skill wirklich anschauen (Frames + Transkript).
  if (videoId) {
    typing(chat);
    const local = await tgDownload(videoId);
    if (!local) return sendChunked(chat, "⚠️ Video konnte ich nicht laden (Telegram-Limit ~20 MB) — schick's als Link oder kleiner.");
    const cap = caption || text;
    text = `[der Nutzer hat ein Video geschickt: ${local} — schau es dir mit dem 'watch'-Skill (~/.claude/skills/watch/scripts/watch.py über Bash) WIRKLICH an (Frames + Transkript = Bild & Ton), dann besprich kurz die Essenz. NICHT sofort speichern; erst auf Ansage → verlinkte Notiz in brain/08_Video-Learnings/.]` + (cap ? `\n${cap}` : "");
  }

  // Beliebige Datei → runterladen, Pfad in den Prompt, bei ZIP entpacken → claude liest sie mit dem Read-Tool.
  if (docId) {
    typing(chat);
    const local = await tgDownload(docId, docName);
    if (!local) return sendChunked(chat, "⚠️ Die Datei konnte ich nicht laden — schick sie nochmal.");
    const cap = caption || text;
    let extra = "";
    if (/\.zip$/i.test(local)) {
      try {
        const dir = local.replace(/\.zip$/i, "") + "-entpackt";
        fs.mkdirSync(dir, { recursive: true });
        execFileSync("unzip", ["-o", local, "-d", dir], { timeout: 30000 });
        extra = ` — es ist ein ZIP, entpackt nach ${dir}. Schau in den Ordner (z.B. per Bash 'ls -R' + Read-Tool auf die Dateien, bei Skills v.a. SKILL.md)`;
      } catch (e) { console.error("[unzip]", e && e.message); extra = " — ZIP konnte ich nicht entpacken, sag der Nutzer Bescheid"; }
    }
    text = `[der Nutzer hat eine Datei geschickt: ${local}${extra}. Öffne den Inhalt mit dem Read-Tool und geh inhaltlich konkret darauf ein.]` + (cap ? `\n${cap}` : "");
  }

  const isVideoTurn = !!videoId || VIDEO_URL_RE.test(text) || VIDEO_URL_RE.test(caption);
  if (isVideoTurn) sendChunked(chat, "🎬 Schaue das Video — bei längeren Videos dauert das ein paar Minuten, ich melde mich.");
  ask(chat, text, isVideoTurn);
}

// ---- Button-Klick verarbeiten ----
// Klick = Antwort. Wir bestätigen ihn Telegram gegenüber, nehmen das Keyboard weg (kein Doppelklick),
// hängen die Wahl sichtbar an die Nachricht und schicken das Label als normalen Turn rein.
async function onCallback(cq) {
  const chat = String(cq.message && cq.message.chat && cq.message.chat.id);
  await tg("answerCallbackQuery", { callback_query_id: cq.id });
  if (!ALLOWED.includes(chat)) return;

  // Qualitätsmanager-Freigabe: 'al:<rec-id|alle>:<ja|nein>'. Die Aktion steckt komplett in der
  // callback_data (nicht im Speicher wie bei 'b:'), darum überlebt der Klick einen Bot-Neustart.
  const al = String(cq.data || "").match(/^al:([\w-]+):(ja|nein)$/);
  if (al) {
    let out = "";
    try { out = execFileSync("node", [path.join(ROOT, "dashboard", "agent-lab-decide.js"), al[1], al[2]], { timeout: 20000 }).toString().trim(); }
    catch (e) { console.error("[agent-lab-decide]", e && e.message); out = "FEHLER: " + (e && e.message); }
    const ok = out.startsWith("OK:");
    const wahl = al[2] === "ja" ? "✅ Freigegeben — der Nacht-Werker führt es aus." : "❌ Abgelehnt — kommt nicht wieder.";
    await tg("editMessageText", {
      chat_id: chat, message_id: cq.message.message_id,
      text: String(cq.message.text || "") + "\n\n" + (ok ? wahl : "⚠️ " + out), disable_web_page_preview: true,
    });
    return;
  }

  const m = String(cq.data || "").match(/^b:(\d+):(\d+)$/);
  const entry = m && pendingButtons.get(m[1]);
  const label = entry && entry.labels[Number(m[2])];
  if (!label) return sendChunked(chat, "⚠️ Der Button ist abgelaufen — schreib's mir kurz.");
  pendingButtons.delete(m[1]);
  saveButtons();
  await tg("editMessageText", {
    chat_id: chat, message_id: cq.message.message_id,
    text: String(cq.message.text || "") + `\n\n👉 ${label}`, disable_web_page_preview: true,
  });
  ask(chat, label);
}

// ---- Long-Polling ----
let offset = 0;
async function poll() {
  while (true) {
    const r = await tg("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
    if (r && r.ok && Array.isArray(r.result)) {
      for (const u of r.result) {
        offset = u.update_id + 1;
        if (u.message) onMessage(u.message).catch((e) => console.error("[onMessage]", e));
        else if (u.callback_query) onCallback(u.callback_query).catch((e) => console.error("[onCallback]", e));
      }
    } else {
      await new Promise((res) => setTimeout(res, 3000)); // Backoff bei Fehler
    }
  }
}

(async () => {
  const me = await tg("getMe", {});
  if (!me || !me.ok) { console.error("❌ Token ungültig? getMe fehlgeschlagen."); process.exit(1); }
  console.error(`✅ Jarvis-Bot läuft als @${me.result.username}. Whitelist: ${ALLOWED.length ? ALLOWED.join(",") : "(noch keine — erste Nachricht zeigt deine Chat-ID)"}`);
  await tg("deleteWebhook", { drop_pending_updates: false }); // Polling statt Webhook sicherstellen
  poll();
})();
