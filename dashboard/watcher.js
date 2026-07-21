#!/usr/bin/env node
// Jarvis — Mail- & Kalender-Watcher. launchd, alle 10 Minuten (com.jarvis.watcher).
// Spricht die Google-APIs DIREKT mit dem workspace-mcp-OAuth-Token (config/.gcreds) —
// kein Claude-Lauf fürs Polling. Claude (via $CLAUDE_BIN) nur zur Wichtig-Triage,
// wenn wirklich neue Mails da sind. Prinzip: sparsam — max. EIN Telegram-Ping pro Lauf
// für Mails + Termin-Erinnerungen ~30 Min vorher. Regeln in data/watcher-rules.json.
// Modi:  node watcher.js            (normaler Lauf)
//        node watcher.js --today    (druckt heutige Termine, für den 08:30-Ping)

const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { writeJsonAtomic } = require("./atomic-write");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA, "watcher-state.json");
const RULES_FILE = path.join(DATA, "watcher-rules.json");
const CREDS_FILE = path.join(ROOT, "config", ".gcreds", (process.env.GOOGLE_CREDS_FILE || "credentials.json"));
const TZ = "Europe/Berlin";

const DEFAULT_RULES = {
  // Absender, die nie pingen (Substring-Match auf From)
  muteSenders: ["mailer-daemon@", "calendar-notification@google.com"],
  // Absender+Betreff-Kombis, die nie pingen
  muteRules: [],
  // Absender, die IMMER pingen (ohne Claude-Triage)
  vipSenders: [],
  // Kalender-Einträge, die nie pingen (Substring-Match auf Titel)
  muteEventTitles: ["Habits", "Master Tasks"],
};

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function saveJson(file, obj) { writeJsonAtomic(file, obj, 2); }

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => {
        if (r.statusCode >= 200 && r.statusCode < 300) {
          try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(new Error("JSON-Parse: " + e.message)); }
        } else reject(new Error(`HTTP ${r.statusCode} ${opts.path}: ${d.slice(0, 300)}`));
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function accessToken() {
  const c = JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
  const body = new URLSearchParams({
    client_id: c.client_id, client_secret: c.client_secret,
    refresh_token: c.refresh_token, grant_type: "refresh_token",
  }).toString();
  const u = new URL(c.token_uri || "https://oauth2.googleapis.com/token");
  // Retry bei transienten Fehlern (Google 5xx / Netz), damit ein einmaliger
  // "internal_failure" nicht sofort als "kaputt" gepingt wird. 4xx = echter
  // Auth-Fehler → sofort werfen (kein Retry).
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await request({
        hostname: u.hostname, path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
      }, body);
      if (!res.access_token) throw new Error("kein access_token");
      return res.access_token;
    } catch (e) {
      lastErr = e;
      const transient = /HTTP 5\d\d/.test(e.message) || /ECONN|ETIMEDOUT|ENOTFOUND|socket|network/i.test(e.message);
      if (!transient || attempt === 3) throw e;
      console.log(`watcher: Token-Refresh Versuch ${attempt} fehlgeschlagen (${e.message.slice(0, 80)}), retry…`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw lastErr;
}

function gapi(tok, host, p) {
  return request({ hostname: host, path: p, method: "GET", headers: { Authorization: `Bearer ${tok}` } });
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

// Action-Inbox im Dashboard (⚡ Zu erledigen): Item über die Server-API anlegen — Server bleibt einziger Schreiber
// von aktionen.json (kein Write-Race). Server aus → still überspringen (Telegram-Ping geht ja trotzdem raus).
function addAktion(titel, detail, quelle, link) {
  return fetch("http://127.0.0.1:4321/api/aktion-add", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ titel, detail, quelle, link }),
  }).catch(() => {});
}
function notify(title, text) {
  const r = spawnSync("node", [path.join(__dirname, "notify.js"), "--title", title, text], { encoding: "utf8", timeout: 30000 });
  console.log((r.stdout || "").trim(), (r.stderr || "").trim());
}

// ---- Kalender ----
async function fetchEvents(tok, timeMinIso, timeMaxIso) {
  const q = new URLSearchParams({
    timeMin: timeMinIso, timeMax: timeMaxIso, singleEvents: "true", orderBy: "startTime", maxResults: "30",
  }).toString();
  const res = await gapi(tok, "www.googleapis.com", `/calendar/v3/calendars/primary/events?${q}`);
  return (res.items || []).filter((e) => e.status !== "cancelled" && e.start && e.start.dateTime);
}
function eventMuted(ev, rules) {
  const s = ev.summary || "";
  return rules.muteEventTitles.some((t) => s.includes(t));
}
function eventLink(ev) {
  if (ev.hangoutLink) return ev.hangoutLink;
  if (ev.conferenceData && ev.conferenceData.entryPoints) {
    const v = ev.conferenceData.entryPoints.find((p) => p.entryPointType === "video");
    if (v) return v.uri;
  }
  if (ev.location && /^https?:\/\//.test(ev.location)) return ev.location.split(/\s/)[0];
  return "";
}

// ---- Gmail ----
async function fetchNewMails(tok, state) {
  const q = encodeURIComponent(`in:inbox after:${state.lastMailEpoch}`);
  const list = await gapi(tok, "gmail.googleapis.com", `/gmail/v1/users/me/messages?q=${q}&maxResults=50`);
  const out = [];
  for (const m of list.messages || []) {
    if (state.seenMailIds.includes(m.id)) continue;
    const full = await gapi(tok, "gmail.googleapis.com",
      `/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
    const h = Object.fromEntries((full.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
    out.push({
      id: m.id,
      from: h.from || "?",
      subject: h.subject || "(kein Betreff)",
      snippet: (full.snippet || "").slice(0, 150),
      epoch: Math.floor(Number(full.internalDate || Date.now()) / 1000),
    });
  }
  return out;
}
function mailMuted(mail, rules) {
  const from = mail.from.toLowerCase();
  if (rules.muteSenders.some((s) => from.includes(s.toLowerCase()))) return true;
  return rules.muteRules.some((r) => from.includes(r.sender.toLowerCase()) && mail.subject.includes(r.subjectContains));
}
function isVip(mail, rules) {
  const from = mail.from.toLowerCase();
  return rules.vipSenders.some((s) => from.includes(s.toLowerCase()));
}

function triageWithClaude(mails) {
  const bin = process.env.CLAUDE_BIN;
  if (!bin || !fs.existsSync(bin)) return null; // kein Claude → Aufrufer fällt auf VIP-only zurück
  const listing = mails.map((m, i) => ({ i, from: m.from, subject: m.subject, snippet: m.snippet }));
  const prompt = `Du filterst des Nutzers Posteingang für Telegram-Pings. WICHTIG sind nur: echte Nachrichten von Menschen (Kunden, Leads, Partner), Antworten auf seine Mails, Benachrichtigungen dass ein Lead/Kunde ihm auf einer Plattform geantwortet hat (Upwork "New message", respond.io, Kalender-Buchungen), Termin-/Meeting-Sachen, Geld (Rechnungen, Zahlungen, Mahnungen), harte Blocker. NICHT wichtig: Newsletter, Produkt-Updates, Werbung, Marketing-Sequenzen, LinkedIn-Kontaktvorschläge/-Digests, automatische System-Mails ohne Handlungsbedarf, Job-Alerts.
Neue Mails:
${JSON.stringify(listing)}
Antworte NUR mit einem JSON-Array der wichtigen Mails: [{"i":0,"grund":"max 6 Wörter"}] — oder [] wenn nichts wichtig ist.`;
  const r = spawnSync(bin, ["-p", prompt], { encoding: "utf8", timeout: 120000 });
  const out = (r.stdout || "").trim();
  const a = out.indexOf("["), b = out.lastIndexOf("]");
  if (a === -1 || b === -1) return null;
  try { return JSON.parse(out.slice(a, b + 1)); } catch { return null; }
}

function displayFrom(from) {
  const m = from.match(/^"?([^"<]+)"?\s*</);
  return (m ? m[1] : from).trim();
}

// ---- launchd-Watchdog: Jobs dürfen nie wieder still sterben ----
// Prüft pro Lauf alle dashboard/*.launchd.log auf NEU angehängte Fehlerzeilen.
// Byte-Offset pro Log in state.logOffsets → nur wirklich frische Zeilen zählen
// (die Logs enthalten alte TCC-Fehler von vor dem run-job.js-Fix; die sollen nicht pingen).
// Erstsichtung einer Datei = nur Baseline setzen, kein Ping. Max. EIN Ping pro 12h.
const LOG_ERROR_RX = /Operation not permitted|command not found|Permission denied|permission denied|Exit(?:ed)?(?: code)? 1(?:26|27)\b|status 12[67]/;
function checkLaunchdLogs(state) {
  let logs;
  try {
    logs = fs.readdirSync(__dirname).filter((f) => f.endsWith(".launchd.log"));
  } catch { return; }
  const nowS = Math.floor(Date.now() / 1000);
  state.logOffsets = state.logOffsets || {};
  const hits = [];
  for (const name of logs) {
    const file = path.join(__dirname, name);
    let size;
    try { size = fs.statSync(file).size; } catch { continue; }
    const prev = state.logOffsets[name];
    // Erstsichtung: nur Baseline setzen, historische Fehler ignorieren
    if (prev === undefined) { state.logOffsets[name] = size; continue; }
    // Log rotiert/geleert → ab 0 lesen
    const from = size < prev ? 0 : prev;
    state.logOffsets[name] = size;
    if (size <= from) continue; // nichts Neues angehängt
    let text;
    try {
      const fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(size - from);
      fs.readSync(fd, buf, 0, buf.length, from);
      fs.closeSync(fd);
      text = buf.toString("utf8");
    } catch { continue; }
    const bad = text.split(/\r?\n/).filter((l) => LOG_ERROR_RX.test(l));
    if (bad.length) hits.push({ job: name.replace(/\.launchd\.log$/, ""), line: bad[bad.length - 1].trim().slice(0, 120) });
  }
  if (!hits.length) return;
  if (state.lastLogErrorPing && nowS - state.lastLogErrorPing < 43200) {
    console.log(`watcher: launchd-Fehler in ${hits.map((h) => h.job).join(", ")} — Ping unterdrückt (<12h)`);
    return;
  }
  state.lastLogErrorPing = nowS;
  const lines = hits.slice(0, 6).map((h) => `• ${h.job}: ${h.line}`);
  notify("⚠️ launchd", `Job-Fehler entdeckt:\n${lines.join("\n")}`);
  console.log(`watcher: launchd-Watchdog-Ping (${hits.length} Job(s) mit Fehlern)`);
}

(async () => {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
  let rules = loadJson(RULES_FILE, null);
  if (!rules) { rules = DEFAULT_RULES; saveJson(RULES_FILE, rules); }

  const tok = await accessToken();
  const now = new Date();

  // --today: heutige Termine drucken (für den 08:30-Guardrail-Ping) und raus
  if (process.argv.includes("--today")) {
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    const evs = await fetchEvents(tok, now.toISOString(), end.toISOString());
    for (const ev of evs) {
      if (eventMuted(ev, rules)) continue;
      console.log(`• ${fmtTime(ev.start.dateTime)} ${ev.summary || "(ohne Titel)"}`);
    }
    return;
  }

  const state = loadJson(STATE_FILE, {
    lastMailEpoch: Math.floor(now.getTime() / 1000), // Erstlauf: kein Backfill
    seenMailIds: [],
    notifiedEvents: {},
  });
  const pings = [];

  // 1) Termin-Erinnerungen: startet in den nächsten 30 Min
  const soon = new Date(now.getTime() + 30 * 60000);
  const upcoming = await fetchEvents(tok, now.toISOString(), soon.toISOString());
  for (const ev of upcoming) {
    const key = `${ev.id}@${ev.start.dateTime}`;
    if (eventMuted(ev, rules) || state.notifiedEvents[key]) continue;
    const mins = Math.max(1, Math.round((new Date(ev.start.dateTime) - now) / 60000));
    const link = eventLink(ev);
    pings.push(`🗓 In ${mins} Min: ${ev.summary || "(ohne Titel)"} (${fmtTime(ev.start.dateTime)})${link ? "\n" + link : ""}`);
    state.notifiedEvents[key] = Math.floor(now.getTime() / 1000);
  }

  // 1b) Sales Copilot Auto-Start: Termin MIT Meeting-Link beginnt in <10 Min → App hochfahren.
  // Die Aufnahme selbst startet die App per Ton-Erkennung (siehe sales-copilot/HANDOFF.md).
  state.copilotStarted = state.copilotStarted || {};
  for (const ev of upcoming) {
    if (eventMuted(ev, rules) || !eventLink(ev)) continue;
    const mins = (new Date(ev.start.dateTime) - now) / 60000;
    const key = `${ev.id}@${ev.start.dateTime}`;
    if (mins > 10 || state.copilotStarted[key]) continue;
    state.copilotStarted[key] = Math.floor(now.getTime() / 1000);
    const runningPid = spawnSync("pgrep", ["-f", "sales-copilot"], { encoding: "utf8" }).stdout.trim();
    if (runningPid) { console.log("watcher: Sales Copilot läuft schon"); continue; }
    // Über `open` starten (nicht npm/bash): App bekommt ihre EIGENE Mikrofon-Berechtigung
    // ("Electron"), statt den TCC-Kontext des launchd-Watchers zu erben → sonst nimmt
    // getUserMedia nur Stille auf (Fall 15.07.). Gleicher Startweg wie server.js.
    spawnSync("/usr/bin/open", ["-n",
      "$HOME/AIOS/sales-copilot/node_modules/electron/dist/Electron.app",
      "--args", "$HOME/AIOS/sales-copilot"],
      { encoding: "utf8", timeout: 15000 });
    console.log(`watcher: Sales Copilot gestartet für "${ev.summary || "(ohne Titel)"}"`);
  }
  for (const [k, t] of Object.entries(state.copilotStarted))
    if (now.getTime() / 1000 - t > 172800) delete state.copilotStarted[k];
  // alte Event-Marker aufräumen (>2 Tage)
  for (const [k, t] of Object.entries(state.notifiedEvents))
    if (now.getTime() / 1000 - t > 172800) delete state.notifiedEvents[k];

  // 2) Neue Mails → Mute-Filter → VIP direkt, Rest via Claude-Triage
  const mails = await fetchNewMails(tok, state);
  const candidates = mails.filter((m) => !mailMuted(m, rules));
  const important = [];
  const vips = candidates.filter((m) => isVip(m, rules));
  const rest = candidates.filter((m) => !isVip(m, rules));
  for (const m of vips) important.push({ mail: m, grund: "VIP" });
  if (rest.length) {
    const verdict = triageWithClaude(rest);
    if (verdict) for (const v of verdict) { if (rest[v.i]) important.push({ mail: rest[v.i], grund: v.grund || "" }); }
    else if (!verdict && rest.length) console.log(`watcher: Triage übersprungen/fehlgeschlagen (${rest.length} Mails nur geloggt)`);
  }
  if (important.length) {
    const lines = important.slice(0, 5).map(({ mail, grund }) =>
      `• ${displayFrom(mail.from)} — ${mail.subject}${grund && grund !== "VIP" ? ` (${grund})` : ""}`);
    pings.push(`📬 ${important.length} wichtige Mail${important.length > 1 ? "s" : ""}:\n${lines.join("\n")}`);
    // Action-Inbox im Dashboard füttern (nur was Reaktion braucht; Server de-duped offene Titel)
    for (const { mail, grund } of important) await addAktion(
      `${displayFrom(mail.from)} — ${mail.subject}`.slice(0, 190),
      grund && grund !== "VIP" ? grund : "wichtige Mail",
      "mail", `https://mail.google.com/mail/u/0/#inbox/${mail.id}`);
  }

  // 2b) Rechnungen: EINMAL täglich morgens (ab 8 Uhr) — Wise-Zahlungsabgleich + Auto-Reminder-Drafts.
  // Bewusst NICHT jeden 10-Min-Lauf (Rechnungen ändern sich nicht im Minutentakt; schont den lokalen Rechner).
  // Sofort-Abgleich jederzeit manuell über den Button „🔄 Wise-Abgleich" im Dashboard.
  // Reminder werden NUR als Gmail-Entwurf angelegt (Freigabe durch der Nutzer) — dashboard/rechnung.js.
  try {
    const day = now.toLocaleDateString("sv-SE", { timeZone: TZ });
    const hour = Number(now.toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).slice(0, 2));
    if (state.invoiceCheckDay !== day && hour >= 8) {
      state.invoiceCheckDay = day;
      const rechnung = require("./rechnung");
      const openInv = rechnung.loadInvoices().invoices.filter((iv) => iv.status !== "bezahlt");
      if (openInv.length) {
        try {
          const m = await rechnung.matchWise();
          for (const x of m.matched || []) pings.push(`💰🔔 Rechnung ${x.nr} über ${x.betrag} € von ${x.kunde} ist BEZAHLT (Wise, ${x.datum}). Win!`);
        } catch (e) { console.log("watcher: Wise-Abgleich übersprungen:", e.message); }
        try {
          const r = await rechnung.autoReminders();
          for (const c of r.created || []) {
            pings.push(`✉️ Zahlungserinnerung (Stufe ${c.stufe}) für Rechnung ${c.nr} an ${c.kunde} liegt als Gmail-Entwurf bereit. Kurz checken und absenden.`);
            await addAktion(`Zahlungserinnerung an ${c.kunde} absenden (Rechnung ${c.nr})`, `Stufe ${c.stufe} — Entwurf liegt in Gmail bereit`, "mail", "https://mail.google.com/mail/u/0/#drafts");
          }
          for (const s of r.skipped || []) console.log(`watcher: Reminder ${s.nr} übersprungen: ${s.grund}`);
        } catch (e) { console.log("watcher: Auto-Reminder übersprungen:", e.message); }
      }
    }
  } catch (e) { console.log("watcher: Rechnungsmodul nicht ladbar:", e.message); }

  // State fortschreiben
  for (const m of mails) {
    state.seenMailIds.push(m.id);
    if (m.epoch >= state.lastMailEpoch) state.lastMailEpoch = m.epoch;
  }
  state.seenMailIds = state.seenMailIds.slice(-500);

  // launchd-Watchdog: frische Fehlerzeilen in den Job-Logs → EIN Ping/12h
  checkLaunchdLogs(state);

  saveJson(STATE_FILE, state);

  // 3) Genau EIN Telegram-Ping pro Lauf (sparsam)
  if (pings.length) {
    console.log("PING:\n" + pings.join("\n\n"));
    notify("👁 Watcher", pings.join("\n\n"));
  }
  console.log(`watcher: ${mails.length} neue Mails, ${important.length} wichtig, ${pings.length ? "Ping gesendet" : "kein Ping"}.`);
})().catch(async (e) => {
  console.error("watcher FEHLER:", e.message);
  // Auth-/API-Fehler: max. 1 Warn-Ping pro 12h, nie still sterben
  const state = loadJson(STATE_FILE, {});
  const nowS = Math.floor(Date.now() / 1000);
  if (!state.lastErrorPing || nowS - state.lastErrorPing > 43200) {
    state.lastErrorPing = nowS;
    saveJson(STATE_FILE, state);
    notify("⚠️ Watcher", `Mail/Kalender-Check kaputt: ${e.message.slice(0, 160)}`);
  }
  process.exit(1);
});
