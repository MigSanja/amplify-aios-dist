#!/usr/bin/env node
// Jarvis Outreach → Telegram-Ping an der Nutzer.
// Nutzung:  node dashboard/notify.js "Text"        (Standard-Prefix 🔴 Outreach)
//           node dashboard/notify.js --ok "Text"    (grüner Haken ✅, z.B. Erfolgsmeldung)
//           node dashboard/notify.js --title "🔬 Qualitätsmanager" --buttons "✅ Freigeben|al:rec-x:ja;;❌ Ablehnen|al:rec-x:nein" "Text"
// Zweck: Der Outreach-Agent darf NIE still einen Schritt überspringen. Fehlt ein Zugriff/Login/
// Kandidat oder blockt sonst was → sofort hiermit anpingen, damit der Nutzer freigeben kann und
// Outreach immer weiterläuft. Permission-frei (nur node + https), kein MCP-Tool nötig.

const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
// .env laden (gleiche Logik wie telegram-bot.js, kein dotenv)
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHATS = (process.env.TELEGRAM_ALLOWED_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);

const args = process.argv.slice(2);
let prefix = "🔴 Outreach";
let buttons = null;
if (args[0] === "--ok") { prefix = "✅ Outreach"; args.shift(); }
else if (args[0] === "--title") { prefix = args[1] || "Jarvis"; args.splice(0, 2); }
// --buttons "Label|callback_data;;Label|callback_data" → echte Inline-Buttons.
// Die Aktion steckt in callback_data (max. 64 Byte, Telegram-Limit), NICHT in einem Server-State:
// so überlebt ein Klick jeden Neustart des Bots. Handler: onCallback() in telegram-bot.js.
const bi = args.indexOf("--buttons");
if (bi >= 0) {
  buttons = (args[bi + 1] || "").split(";;").map((p) => {
    const [t, d] = p.split("|");
    return t && d ? { text: t.trim(), callback_data: d.trim().slice(0, 64) } : null;
  }).filter(Boolean);
  args.splice(bi, 2);
  if (!buttons.length) buttons = null;
}
const body = args.join(" ").trim();

if (!TOKEN) { console.error("notify: TELEGRAM_BOT_TOKEN fehlt in .env"); process.exit(1); }
if (!CHATS.length) { console.error("notify: TELEGRAM_ALLOWED_CHAT_ID fehlt in .env"); process.exit(1); }
if (!body) { console.error('notify: kein Text. Nutzung: node dashboard/notify.js "Text"'); process.exit(1); }

const text = `${prefix}: ${body}`;

// Ping zusätzlich ins Log schreiben (JSONL), damit Jarvis im Telegram-Chat weiß, was der Nutzer
// gerade an System-Pings gesehen hat (Heartbeat/Nachtwerker/Outreach laufen an seinem Faden vorbei).
// Best-effort: ein Fehler hier darf den Telegram-Versand NIE blockieren.
try {
  const logFile = path.join(ROOT, "dashboard", "data", "notifications-log.jsonl");
  fs.appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), prefix, body }) + "\n");
} catch {}

function send(chat) {
  return new Promise((resolve) => {
    const msg = { chat_id: chat, text, disable_web_page_preview: true };
    if (buttons) msg.reply_markup = { inline_keyboard: [buttons] };
    const payload = JSON.stringify(msg);
    const req = https.request(
      { hostname: "api.telegram.org", path: `/bot${TOKEN}/sendMessage`, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => resolve({ chat, ok: r.statusCode === 200, d })); }
    );
    req.on("error", (e) => resolve({ chat, ok: false, d: String(e) }));
    req.write(payload); req.end();
  });
}

(async () => {
  const res = await Promise.all(CHATS.map(send));
  const ok = res.filter((r) => r.ok).length;
  console.log(`notify: an ${ok}/${res.length} Chat(s) gesendet.`);
  process.exit(ok ? 0 : 1);
})();
