#!/usr/bin/env node
/**
 * Jarvis Command Center — Prototyp (Phase 2), HUD-Look.
 * Nur Node-Standardbibliothek. Module: Dashboard · Second Brain (Neuronennetz) · Outreach · Projekte · Stubs.
 * Pop-out je Modul (↗). JARVIS-Core-Orb (wackelt wenn Jarvis spricht). Start: node dashboard/server.js → http://localhost:4321
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execSync, execFileSync } = require("child_process");
const https = require("https");
const crypto = require("crypto");
const { writeJsonAtomic } = require("./atomic-write");
const { buildStarmap } = require("./starmap-model");
const wa = require("./wa"); // WhatsApp DM-Setter Modul (Meta Cloud API) — Routen /webhooks/wa + /api/wa/* + /api/settings

const ROOT = path.resolve(__dirname, "..");
// Branding (kundenspezifisch via config/brand.json; Default neutral "AIOS")
let BRAND = { name: "AIOS", accent: "#36e0ff", logoDataUrl: "" };
try { BRAND = { ...BRAND, ...JSON.parse(fs.readFileSync(path.join(ROOT, "config", "brand.json"), "utf8")) }; } catch {}
const rechnung = require("./rechnung"); // Rechnungsmodul: PDF, Gmail-Drafts, Wise-Abgleich, Reminder
const INVOICE_TOOL = path.join(__dirname, "rechnungstool.html"); // Rechnungstool (ins Dashboard eingebettet)
const PROMPTER_TOOL = path.join(ROOT, "content-engine", "reel-pipeline", "teleprompter.html"); // Video-Aufnahme + Teleprompter (aus der Content-Pipeline aufrufbar)
const BRAIN = path.join(ROOT, "brain");
const PORT = process.env.PORT || 4321;
const VOICE_ID = "yRkCcID7C7SG09Wb6tIg"; // ElevenLabs: Roger (rich, mature British) — Jarvis-Stimme
function elevenKey(){ try{ const e=fs.readFileSync(path.join(ROOT,".env"),"utf8"); const m=e.match(/^ELEVENLABS_API_KEY=(.+)$/m); return m?m[1].trim():null; }catch{ return null; } }
function envVal(name){ try{ const e=fs.readFileSync(path.join(ROOT,".env"),"utf8"); const m=e.match(new RegExp("^"+name+"=(.+)$","m")); return m?m[1].trim():null; }catch{ return null; } }
// ---- GoCardless Bank Account Data (Amex/Bank automatisch) ----
const GC_BASE = "https://bankaccountdata.gocardless.com/api/v2";
const GC_STATE = path.join(ROOT, "dashboard", "data", "gocardless.json");
function gcState(){ try{ if(fs.existsSync(GC_STATE)) return JSON.parse(fs.readFileSync(GC_STATE,"utf8")); }catch{} return {}; }
function gcSaveState(s){ try{ writeJsonAtomic(GC_STATE, s, 2); }catch{} }
async function gcToken(){
  const id=envVal("GOCARDLESS_SECRET_ID"), key=envVal("GOCARDLESS_SECRET_KEY");
  if(!id||!key) return null;
  const s=gcState(), now=Date.now();
  if(s.access && s.accessExp && s.accessExp > now+60000) return s.access;
  const r=await fetch(GC_BASE+"/token/new/",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({secret_id:id,secret_key:key})});
  if(!r.ok) throw new Error("GoCardless Token HTTP "+r.status);
  const j=await r.json(); s.access=j.access; s.accessExp=now+((j.access_expires||3600)*1000); s.refresh=j.refresh; gcSaveState(s);
  return s.access;
}
// ---- Wise SCA: signiert 403-Anfragen (x-2fa-approval) mit dem privaten Schlüssel ----
function wisePrivateKey(){ try{ return fs.readFileSync(path.join(ROOT, "config", "wise_private.pem"), "utf8"); }catch{ return null; } }
async function wiseFetch(url, H){
  let r = await fetch(url, { headers: H });
  if (r.status === 403 && r.headers.get("x-2fa-approval")) {
    const ott = r.headers.get("x-2fa-approval"), key = wisePrivateKey();
    if (key) { try { const sig = crypto.sign("sha256", Buffer.from(ott), key).toString("base64");
      r = await fetch(url, { headers: Object.assign({}, H, { "x-2fa-approval": ott, "x-signature": sig }) }); } catch {} }
  }
  return r;
}
// ---- Amex-CSV serverseitig parsen (für Ordner-Scan) ----
function parseAmexCsvNode(text){
  const lines = text.split(/\r?\n/).filter((l) => l.trim()); if (!lines.length) return [];
  const delim = (lines[0].split(";").length > lines[0].split(",").length) ? ";" : ",";
  const split = (line) => { const out = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i+1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else { if (c === '"') q = true; else if (c === delim) { out.push(cur); cur = ""; } else cur += c; } } out.push(cur); return out; };
  const num = (s) => { s = String(s || "").replace(/[^0-9.,-]/g, "").trim(); if (!s) return 0; if (s.indexOf(",") > -1 && s.indexOf(".") > -1) { if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/,/g, ""); } else if (s.indexOf(",") > -1) s = s.replace(",", "."); return Math.abs(parseFloat(s) || 0); };
  const isoDate = (s) => { s = String(s || "").trim(); let m;
    if (m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)) return m[1] + "-" + m[2] + "-" + m[3];
    if (m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)) { let y = m[3]; if (y.length === 2) y = "20" + y; return y + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[1]).padStart(2, "0"); }
    if (m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)) { let y = m[3]; if (y.length === 2) y = "20" + y; let a = +m[1], b = +m[2], day, mon; if (a > 12) { day = a; mon = b; } else if (b > 12) { mon = a; day = b; } else { day = a; mon = b; } /* DE-Default TT/MM */ return y + "-" + String(mon).padStart(2, "0") + "-" + String(day).padStart(2, "0"); }
    return s; };
  const head = split(lines[0]).map((h) => h.toLowerCase().trim());
  const hasHeader = head.some((h) => /datum|date|beschreib|description|betrag|amount|wert/.test(h));
  let start = 0, ci = { d: -1, b: -1, a: -1 };
  if (hasHeader) { start = 1; head.forEach((h, i) => { if (ci.d < 0 && /datum|date/.test(h)) ci.d = i; if (ci.b < 0 && /beschreib|description|verwendung|text|händler|merchant|karteninhaber/.test(h)) ci.b = i; if (ci.a < 0 && /betrag|amount|wert/.test(h)) ci.a = i; }); }
  if (ci.d < 0) ci.d = 0; if (ci.a < 0) ci.a = head.length - 1; if (ci.b < 0) ci.b = Math.min(1, head.length - 1);
  const out = []; for (let i = start; i < lines.length; i++) { const c = split(lines[i]); if (c.length < 2) continue;
    const rawAmt = String(c[ci.a] || ""), descA = String(c[ci.b] || "");
    if (/-/.test(rawAmt) || /überweisung erhalten|payment received|gutschrift|besten dank/i.test(descA)) continue; // Gutschrift/Zahlung → keine Ausgabe
    const betrag = num(c[ci.a]); if (!betrag) continue;
    out.push({ datum: isoDate(c[ci.d]), beschreibung: descA.trim().slice(0, 120), betrag: betrag, source: "amex" }); }
  return out;
}
// ---- Wise-Kontoauszug-CSV parsen (nur Ausgaben, interne Transfers raus) ----
function parseWiseCsvNode(text){
  const lines = text.split(/\r?\n/); if (lines.length < 2) return [];
  const split = (line) => { const out = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i+1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else { if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; } } out.push(cur); return out; };
  const clean = (s) => String(s == null ? "" : s).replace(/^"|"$/g, "").trim();
  const head = split(lines[0]).map((h) => clean(h).toLowerCase());
  const I = (n) => head.indexOf(n);
  const ci = { id: I("id"), status: I("status"), dir: I("direction"), created: I("created on"), samt: I("source amount (after fees)"), tname: I("target name"), cat: I("category") };
  const out = [];
  for (let i = 1; i < lines.length; i++) { if (!lines[i].trim()) continue; const c = split(lines[i]);
    if (clean(c[ci.status]).toUpperCase() !== "COMPLETED") continue;
    if (clean(c[ci.dir]).toUpperCase() !== "OUT") continue;
    const tname = clean(c[ci.tname]); if (/american express|amex\b/i.test(tname)) continue; // interner Transfer / Amex-Rechnung (aus Wise bezahlt) → nicht doppelt zählen
    const betrag = Math.abs(parseFloat(clean(c[ci.samt]).replace(",", ".")) || 0); if (!betrag) continue;
    const id = clean(c[ci.id]), cat = clean(c[ci.cat]);
    let art = /direct_debit/i.test(id) ? "lastschrift" : (/card/i.test(id) ? "karte" : "transfer");
    if (/cash|bargeld|atm|geldautomat|withdraw/i.test(cat) || /cash|atm/i.test(tname)) art = "bargeld";
    out.push({ datum: clean(c[ci.created]).slice(0, 10), betrag: betrag, beschreibung: (tname || cat || "—").slice(0, 120), category: cat, art: art, konto: "privat", source: "wise-privat", typ: "out" });
  }
  return out;
}

// ---- CRM-Inbox (Ausbau Punkt 2, Teilstück 04.07.): Gmail-Posteingang fürs Inbox-Modul ----
// Liest NUR (keine Sende-/Löschrechte genutzt) über die Watcher-Creds (config/.gcreds,
// Refresh-Token-Flow wie dashboard/watcher.js). Ein Konto; weitere Postfächer brauchen je ein
// eigenes OAuth-Token → bewusst offen (Spec brain/03_Projects/aios-crm-inbox-ausbau.md, Punkt 2).
// Lead-Zuordnung (Absender ↔ leads.json) macht der Client gegen die schon geladenen LEADS.
const INBOX_CREDS = path.join(ROOT, "config", ".gcreds", (process.env.GOOGLE_CREDS_FILE || "credentials.json"));
let inboxCache = { at: 0, data: null }; // 60s-Cache — View-Wechsel hämmert nicht die Gmail-API
async function inboxToken() {
  const c = JSON.parse(fs.readFileSync(INBOX_CREDS, "utf8"));
  const body = new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: "refresh_token" }).toString();
  const r = await fetch(c.token_uri || "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("Google-Token HTTP " + r.status);
  const j = await r.json();
  if (!j.access_token) throw new Error("kein access_token");
  return j.access_token;
}
async function fetchInbox(fresh) {
  if (!fresh && inboxCache.data && Date.now() - inboxCache.at < 60000) return inboxCache.data;
  const tok = await inboxToken();
  const g = async (p) => {
    const r = await fetch("https://gmail.googleapis.com" + p, { headers: { Authorization: "Bearer " + tok }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("Gmail HTTP " + r.status);
    return r.json();
  };
  const list = await g("/gmail/v1/users/me/messages?maxResults=25&q=" + encodeURIComponent("in:inbox"));
  const mails = await Promise.all((list.messages || []).map(async (m) => {
    const f = await g(`/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
    const h = Object.fromEntries((f.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
    const from = h.from || "";
    const em = ((from.match(/<([^>]+)>/) || [, from.trim()])[1] || "").toLowerCase();
    const name = ((from.match(/^"?([^"<]+?)"?\s*</) || [, em])[1] || "?").trim();
    return { id: m.id, threadId: f.threadId || m.id, fromName: name, fromEmail: em, subject: h.subject || "(kein Betreff)", snippet: (f.snippet || "").slice(0, 160), epoch: Math.floor(Number(f.internalDate || 0) / 1000), unread: (f.labelIds || []).includes("UNREAD") };
  }));
  mails.sort((a, b) => b.epoch - a.epoch);
  const data = { ok: true, account: (process.env.USER_GOOGLE_EMAIL || ""), fetchedAt: Math.floor(Date.now() / 1000), mails };
  inboxCache = { at: Date.now(), data };
  return data;
}

const BUCKETS = [
  ["01_Identity", "Identity", "#ffb547"], ["03_Projects", "Projekte", "#36e0ff"],
  ["04_Areas", "Bereiche", "#4aa3ff"], ["02_People", "Menschen", "#54e08a"],
  ["06_Ideas", "Ideen", "#b07cff"], ["05_Knowledge", "Wissen", "#9fb3c8"],
  ["07_Tasks", "Tasks", "#ff9d5c"], ["99_Daily", "Daily", "#5b7088"], ["00_Inbox", "Inbox", "#5b7088"],
  ["08_Video-Learnings", "Video-Learnings", "#ff6bd6"], ["09_Coding-Ideen", "Coding-Ideen", "#4ae0c8"],
];
const COLOR = Object.fromEntries(BUCKETS.map(([, l, c]) => [l, c]));
const slug = (s) => s.toLowerCase().replace(/\.md$/, "").replace(/[⭐🔥\s]+/g, "-").replace(/-+$/, "");

function parseNote(file) {
  const raw = fs.readFileSync(file, "utf8");
  let body = raw, fm = {};
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (m) { body = m[2]; m[1].split("\n").forEach((l) => { const mm = l.match(/^(\w+):\s*(.*)$/); if (mm) fm[mm[1]] = mm[2]; }); }
  const h = body.match(/^#\s+(.+)$/m);
  const title = (h ? h[1] : path.basename(file, ".md")).replace(/[⭐🔥]/g, "").trim();
  // pool: aus = Dauerläufer/Kanal (Outreach, Upwork …) — kein abarbeitbares Projekt, fliegt aus dem Projekt-Pool.
  return { title, status: fm.status || "", prio: parseInt(fm.prio, 10) || 0, pool: fm.pool || "", body, raw };
}
function readAll() {
  const list = [];
  for (const [dir, label] of BUCKETS) {
    const p = path.join(BRAIN, dir); if (!fs.existsSync(p)) continue;
    for (const f of fs.readdirSync(p)) {
      if (!f.endsWith(".md") || f === "_README.md") continue;
      const n = parseNote(path.join(p, f));
      list.push({ rel: `${dir}/${f}`, label, title: n.title, status: n.status, prio: n.prio, pool: n.pool, body: n.body });
    }
  }
  return list;
}
function listNotes(all) {
  const out = {}; for (const [, l] of BUCKETS) out[l] = [];
  for (const n of all) out[n.label].push({ title: n.title, status: n.status, prio: n.prio, pool: n.pool, rel: n.rel });
  for (const k in out) out[k].sort((a, b) => a.title.localeCompare(b.title));
  return out;
}
function buildGraph(all) {
  const resolve = {}; for (const n of all) { resolve[slug(path.basename(n.rel))] = n.rel; resolve[slug(n.title)] = n.rel; }
  const deg = {}, links = [], seen = new Set();
  for (const n of all) {
    const re = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g; let m;
    while ((m = re.exec(n.body))) {
      const target = resolve[slug(m[1].trim())]; if (!target || target === n.rel) continue;
      const key = [n.rel, target].sort().join("|"); if (seen.has(key)) continue; seen.add(key);
      links.push({ source: n.rel, target }); deg[n.rel] = (deg[n.rel] || 0) + 1; deg[target] = (deg[target] || 0) + 1;
    }
  }
  return { nodes: all.map((n) => ({ id: n.rel, name: n.title, group: n.label, color: COLOR[n.label], val: 1 + (deg[n.rel] || 0) })), links };
}
function safeFile(rel) { const s = path.normalize(rel || "").replace(/^(\.\.[/\\])+/, ""); const f = path.join(BRAIN, s); return f.startsWith(BRAIN) && f.endsWith(".md") ? f : null; }
// ---- Agents (Mitarbeiter-Akten unter /agents) ----
const AGENTS = path.join(ROOT, "agents");
function readAgentFile(dir, name) { try { return fs.readFileSync(path.join(AGENTS, dir, name), "utf8"); } catch { return ""; } }
function agentTitle(md, fallback) { const h = (md || "").match(/^#\s+(.+)$/m); return h ? h[1].replace(/[⭐🔥]/g, "").trim() : fallback; }
function parseMessages(raw) {
  const blocks = []; let cur = null;
  (raw || "").split("\n").forEach((line) => {
    const t = line.trim();
    const h = t.match(/^##\s*ICP:\s*(.+)$/i); if (h) { if (cur) blocks.push(cur); cur = { icp: h[1].trim(), pain: "", m1: "", m2: "", m3: "" }; return; }
    if (!cur || t.startsWith("#")) return;
    const p = t.match(/^Pain:\s*(.*)$/i); if (p) { cur.pain = p[1]; return; }
    const m = t.match(/^M([123]):\s*(.*)$/i); if (m) { cur["m" + m[1]] = m[2]; return; }
  });
  if (cur) blocks.push(cur); return blocks;
}
function listAgents() {
  const out = []; if (!fs.existsSync(AGENTS)) return out;
  for (const dir of fs.readdirSync(AGENTS)) {
    let st; try { st = fs.statSync(path.join(AGENTS, dir)); } catch { continue; }
    if (!st.isDirectory()) continue;
    const agent = readAgentFile(dir, "agent.md"); if (!agent) continue;
    let runs = []; try { runs = fs.readdirSync(path.join(AGENTS, dir, "runs")).filter((f) => f.endsWith(".md") && f !== "_TEMPLATE.md").sort().reverse(); } catch {}
    const latestName = runs[0] || ""; const latest = latestName ? readAgentFile(dir, "runs/" + latestName) : "";
    let avatar = ""; for (const ext of ["png", "jpg", "jpeg", "webp"]) { if (fs.existsSync(path.join(AGENTS, dir, "avatar." + ext))) { avatar = "avatar." + ext; break; } }
    const tools = readAgentFile(dir, "tools.md").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("|")).map((l) => { const p = l.split("|").map((x) => x.trim()); return { name: p[0] || "", icon: p[1] || "🔧", access: p[2] || "", desc: p[3] || "" }; });
    const messages = readAgentFile(dir, "messages.md"); const messageBlocks = parseMessages(messages);
    let config = {}; try { config = JSON.parse(readAgentFile(dir, "config.json") || "{}"); } catch { config = {}; }
    let playbooks = []; try { playbooks = fs.readdirSync(path.join(AGENTS, dir, "playbooks")).filter((f) => f.endsWith(".md")).sort().map((f) => ({ name: f.replace(/\.md$/, ""), content: readAgentFile(dir, "playbooks/" + f) })); } catch {}
    // "running" nur bei ECHTER Aktivität (Trail in den letzten 3 Min beschrieben) — ein idle Prozess ist "bereit", nicht "läuft".
    const trailFresh = (() => { try { return Date.now() - fs.statSync(path.join(AGENTS, dir, "runs", ".live-" + dayStamp() + ".jsonl")).mtimeMs < 180000; } catch { return false; } })();
    out.push({ id: dir, title: agentTitle(agent, dir), agent, goal: readAgentFile(dir, "goal.md"), learnings: readAgentFile(dir, "learnings.md"), runs, latest, latestName, avatar, tools, messages, messageBlocks, running: !!AC[dir] && trailFresh, idle: !!AC[dir] && !trailFresh, paused: fs.existsSync(path.join(AGENTS, dir, ".paused")), config, playbooks });
  }
  return out;
}
function safeAgentFile(rel) { const s = path.normalize(rel || "").replace(/^(\.\.[/\\])+/, ""); const f = path.join(AGENTS, s); return f.startsWith(AGENTS) && f.endsWith(".md") ? f : null; }
function findClaude() {
  const home = os.homedir();
  const c = [process.env.CLAUDE_BIN, path.join(home, ".claude/local/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude", path.join(home, ".npm-global/bin/claude")].filter(Boolean);
  for (const x of c) { try { if (fs.existsSync(x)) return x; } catch {} }
  // Claude Desktop App bündelt die CLI — neueste Version wählen
  try {
    const ccDir = path.join(home, "Library/Application Support/Claude/claude-code");
    if (fs.existsSync(ccDir)) {
      const vers = fs.readdirSync(ccDir).filter((v) => /^\d/.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const v of vers) { const p = path.join(ccDir, v, "claude.app/Contents/MacOS/claude"); if (fs.existsSync(p)) return p; }
    }
  } catch {}
  try { return execSync("command -v claude", { shell: "/bin/zsh" }).toString().trim() || null; } catch { return null; }
}
const send = (res, code, type, data) => { res.writeHead(code, { "Content-Type": type }); res.end(data); };
const readBody = (req, cb) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { try { cb(JSON.parse(b)); } catch { cb({}); } }); };

// ---- Persistente Claude-Session (kein Kaltstart pro Nachricht) ----
let CP = null, CPbuf = "", CPqueue = [], CPactive = null, CPMODEL = "claude-opus-4-8";
function cpStart() {
  const claude = findClaude(); if (!claude) return false;
  // Google-Workspace-MCP (Gmail/Kalender/Drive/Docs/Sheets) fest an die Copilot-Session binden (additiv zu den Standard-Tools).
  const gmcp = path.join(ROOT, "dashboard", "google-mcp.json");
  const cpArgs = ["-p", "--output-format", "stream-json", "--input-format", "stream-json", "--include-partial-messages", "--verbose", "--permission-mode", "acceptEdits", "--model", CPMODEL];
  // Werkzeuge freischalten: Web lesen (WebFetch/WebSearch), Bash (watch-Skill/Videos), Datei-Tools, Google-MCP.
  if (fs.existsSync(gmcp)) cpArgs.push("--mcp-config", gmcp);
  cpArgs.push("--allowedTools", "mcp__google WebFetch WebSearch Bash Read Edit Write Glob Grep Skill Task");
  CP = spawn(claude, cpArgs, { cwd: ROOT });
  CP.stdout.on("data", (d) => {
    CPbuf += d; let i;
    while ((i = CPbuf.indexOf("\n")) >= 0) {
      const line = CPbuf.slice(0, i); CPbuf = CPbuf.slice(i + 1); if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; } cpHandle(o);
    }
  });
  CP.on("close", (code) => { console.error("[CP] close code=" + code); CP = null; if (CPactive) { try { CPactive.done(); } catch {} CPactive = null; } });
  CP.on("error", (e) => { console.error("[CP] error", e && e.message); CP = null; });
  CP.stderr.on("data", (d) => { console.error("[CP-stderr] " + String(d).slice(0, 400)); });
  return true;
}
function cpHandle(o) {
  if (!CPactive) return;
  if (o.type === "stream_event" && o.event) {
    const ev = o.event;
    if (ev.type === "content_block_start" && ev.content_block && ev.content_block.type === "tool_use") {
      CPactive._tool = { name: ev.content_block.name || "tool", buf: "" };
    } else if (ev.type === "content_block_delta" && ev.delta) {
      if (ev.delta.type === "text_delta") { try { CPactive.emit({ type: "text", t: ev.delta.text }); } catch {} }
      else if (ev.delta.type === "thinking_delta") { try { CPactive.emit({ type: "thinking", t: ev.delta.thinking || "" }); } catch {} }
      else if (ev.delta.type === "input_json_delta" && CPactive._tool) { CPactive._tool.buf += (ev.delta.partial_json || ""); }
    } else if (ev.type === "content_block_stop" && CPactive._tool) {
      const t = CPactive._tool; CPactive._tool = null;
      let detail = "";
      // Bash-Befehle/Queries VOLL zeigen (nur Dateipfade auf Basename kürzen) → "pop, pop, pop" mit echtem Inhalt
      try { const inp = JSON.parse(t.buf || "{}"); let v; if (inp.file_path || inp.path) { v = String(inp.file_path || inp.path).split("/").pop(); } else { v = String(inp.command || inp.pattern || inp.query || inp.url || inp.description || inp.prompt || Object.values(inp).find((x) => typeof x === "string") || ""); } detail = v.replace(/\s+/g, " ").slice(0, 160); } catch {}
      try { CPactive.emit({ type: "step", name: t.name, detail }); } catch {}
    }
  } else if (o.type === "user" && o.message && Array.isArray(o.message.content)) {
    // Tool-Ergebnisse (Bash-Output, Datei-Inhalt, MCP-Antwort) → wie eine Terminal-Ausgabe, gekürzt.
    for (const c of o.message.content) {
      if (c && c.type === "tool_result") {
        let txt = ""; const cc = c.content;
        if (typeof cc === "string") txt = cc; else if (Array.isArray(cc)) txt = cc.map((x) => (x && (x.text || (x.type === "image" ? "[Bild]" : ""))) || "").join(" ");
        txt = String(txt).replace(/\s+/g, " ").trim();
        if (txt) { try { CPactive.emit({ type: "output", t: txt.slice(0, 320), err: !!c.is_error }); } catch {} }
      }
    }
  } else if (o.type === "result") { console.error("[CP] result in " + (o.duration_ms || "?") + "ms"); const a = CPactive; CPactive = null; if (a.timer) clearTimeout(a.timer); try { a.done(); } catch {} cpNext(); }
}
function cpNext() {
  if (CPactive || !CPqueue.length) return;
  if (!CP && !cpStart()) { const a = CPqueue.shift(); try { a.emit({ type: "text", t: "claude CLI nicht gefunden." }); a.done(); } catch {} return; }
  const a = CPqueue.shift(); CPactive = a; console.error("[CP] send turn (queue=" + CPqueue.length + "): " + String(a.prompt).slice(0, 60));
  // Copilot-Turn-Timeout (Alex 06.07.: 3 Min riss lange/komplexe Turns mitten im Antworten ab
  // — "Verbindung unterbrochen"). Auf 30 Min hoch, gleiche Grenze wie Telegram-Video-Turns
  // (dashboard/telegram-bot.js VIDEO_TIMEOUT), plus klare Timeout-Meldung statt stillem Abbruch.
  a.timer = setTimeout(() => { if (CPactive === a) { try { a.emit({ type: "text", t: "\n\n⏳ Timeout nach 30 Min — das war zu lang/komplex für einen Turn. Teil's auf oder frag enger." }); } catch {} try { a.done(); } catch {} CPactive = null; try { CP.kill(); } catch {} CP = null; cpNext(); } }, 1800000);
  try { CP.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: cpBuildContent(a) } }) + "\n"); }
  catch { if (a.timer) clearTimeout(a.timer); CPactive = null; try { a.emit({ type: "text", t: "Fehler beim Senden." }); a.done(); } catch {} }
}
// Content-Array für einen Turn bauen: Text + optional Bild-Blöcke (Claude sieht sie nativ) + Video-Dateien → watch-Skill-Hinweis.
function cpBuildContent(a) {
  const content = []; let prompt = a.prompt; const atts = Array.isArray(a.attachments) ? a.attachments : []; const videos = [];
  for (const att of atts) {
    if (!att || !att.data) continue;
    if (att.kind === "image") {
      content.push({ type: "image", source: { type: "base64", media_type: att.media_type || "image/png", data: att.data } });
    } else if (att.kind === "video") {
      try {
        const dir = path.join(ROOT, "dashboard", "data", "drops"); fs.mkdirSync(dir, { recursive: true });
        const safe = String(att.name || ("video-" + Date.now())).replace(/[^\w.\-]/g, "_");
        const fp = path.join(dir, Date.now() + "-" + safe); fs.writeFileSync(fp, Buffer.from(att.data, "base64")); videos.push(fp);
      } catch (e) { console.error("[cp] video save fail", e && e.message); }
    }
  }
  if (videos.length) {
    prompt += `\n\n[der Nutzer hat ${videos.length > 1 ? videos.length + " Videos" : "ein Video"} in den Copilot gedroppt: ${videos.join(", ")}. Nutze den 'watch'-Skill (~/.claude/skills/watch/scripts/watch.py über Bash) um es WIRKLICH anzuschauen (Frames + Transkript = Bild & Ton), dann besprich kurz die Essenz — NICHT sofort speichern. Erst auf Ansage → verlinkte Notiz in brain/08_Video-Learnings/.]`;
  }
  content.push({ type: "text", text: prompt });
  return content;
}
function cpAsk(prompt, emit, done, attachments) { CPqueue.push({ prompt, emit, done, attachments }); cpNext(); }
// Laufenden Turn hart abbrechen (Stop-Button). Killt die CP-Session → nächster Turn startet frisch (Kontext kommt eh pro Turn mit).
function cpAbort() { if (!CPactive) return false; const a = CPactive; if (a.timer) clearTimeout(a.timer); CPactive = null; try { a.emit({ type: "text", t: "\n\n⏹ Gestoppt." }); } catch {} try { a.done(); } catch {} try { CP.kill(); } catch {} CP = null; setTimeout(cpNext, 50); return true; }

// ---- Live Agent-Konsolen (pro Mitarbeiter — streamt Steps + Text, Stop/Steuern) ----
const AC = {};
function dayStamp() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function acPersist(id, s, m) {
  // Persistiert den Reasoning-Trail pro Tag (coalesced Bloecke) → in der "Heute"-Ansicht lesbar, ueberlebt Neustart.
  if (!s) return;
  const file = path.join(AGENTS, id, "runs", ".live-" + dayStamp() + ".jsonl");
  const flush = () => { if (s._pend && s._pend.t) { try { fs.appendFileSync(file, JSON.stringify(s._pend) + "\n"); } catch {} } s._pend = null; };
  try {
    if (m.type === "thinking" || m.type === "text") {
      if (s._pend && s._pend.type !== m.type) flush();
      if (!s._pend) s._pend = { type: m.type, t: "" };
      s._pend.t += m.t;
    } else if (m.type === "step") {
      flush(); fs.appendFileSync(file, JSON.stringify({ type: "step", name: m.name, detail: m.detail || "" }) + "\n");
    } else if (m.type === "turn-end") {
      flush(); fs.appendFileSync(file, JSON.stringify({ type: "turn-end" }) + "\n");
    }
  } catch {}
}
function acEmit(id, m) {
  const s = AC[id]; if (!s) return;
  // Ring-Buffer: hält den Lauf fest, auch wenn (noch) keine Konsole verbunden ist → Replay beim Öffnen.
  if (s.log) { s.log.push(m); if (s.log.length > 500) s.log.shift(); }
  acPersist(id, s, m);
  if (s.sse) { try { s.sse.write("data: " + JSON.stringify(m) + "\n\n"); } catch {} }
}
function acHandle(id, o) {
  const s = AC[id];
  if (o.type === "stream_event" && o.event) {
    const ev = o.event;
    if (ev.type === "content_block_start" && ev.content_block && ev.content_block.type === "tool_use") {
      if (s) s._tool = { name: ev.content_block.name || "tool", buf: "" };
    } else if (ev.type === "content_block_delta" && ev.delta) {
      if (ev.delta.type === "text_delta") acEmit(id, { type: "text", t: ev.delta.text });
      else if (ev.delta.type === "thinking_delta") acEmit(id, { type: "thinking", t: ev.delta.thinking || "" });
      else if (ev.delta.type === "input_json_delta" && s && s._tool) s._tool.buf += (ev.delta.partial_json || "");
    } else if (ev.type === "content_block_stop" && s && s._tool) {
      const t = s._tool; s._tool = null;
      // Detail = welcher Lead/welche URL/Datei — zeigt in der Konsole, woran der Agent gerade arbeitet.
      let detail = "";
      try { const inp = JSON.parse(t.buf || "{}"); let v = inp.url || inp.file_path || inp.path || inp.query || inp.command || inp.pattern || inp.text || Object.values(inp).find((x) => typeof x === "string") || ""; detail = String(v).replace(/\s+/g, " ").slice(0, 110); } catch {}
      acEmit(id, { type: "step", name: t.name, detail });
    }
  } else if (o.type === "result") acEmit(id, { type: "turn-end" });
}
function acStart(id) {
  const claude = findClaude(); if (!claude) return null;
  const args = ["-p", "--output-format", "stream-json", "--input-format", "stream-json", "--include-partial-messages", "--verbose", "--permission-mode", "acceptEdits"];
  // Browser-Hand pro Agent: chrome-devtools-mcp fest an den Account-Port gebunden (mcp.json im Agent-Ordner)
  const mcpFile = path.join(AGENTS, id, "mcp.json");
  let cfg = {}; try { cfg = JSON.parse(readAgentFile(id, "config.json") || "{}"); } catch {}
  if (fs.existsSync(mcpFile)) { args.push("--mcp-config", mcpFile, "--allowedTools", "mcp__browser,Bash,Read,Write,Edit"); }
  args.push("--model", cfg.model || "claude-haiku-4-5");
  const p = spawn(claude, args, { cwd: ROOT });
  const s = { proc: p, buf: "", started: false, sse: null, log: [], _tool: null, _pend: null };
  p.stdout.on("data", (d) => { s.buf += d; let i; while ((i = s.buf.indexOf("\n")) >= 0) { const line = s.buf.slice(0, i); s.buf = s.buf.slice(i + 1); if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; } acHandle(id, o); } });
  p.on("close", () => { acEmit(id, { type: "closed" }); if (AC[id] === s) delete AC[id]; });
  p.on("error", () => { if (AC[id] === s) delete AC[id]; });
  p.stderr.on("data", () => {});
  AC[id] = s; return s;
}
function acBrief(id) {
  return 'Du bist der Mitarbeiter-Agent "' + id + '" in des Nutzers Jarvis-OS. Deine Akte liegt in agents/' + id + '/ (agent.md = Instruktion, goal.md = ICP/Ziel, messages.md = M1/M2/M3, playbooks/ = Step-by-Step, config.json, tools.md). '
    + 'Du fährst Chrome über die Tools mcp__browser__* (chrome-devtools-mcp), FEST gebunden an deinen Account (eigener Port) — KEINE Browser-Auswahl nötig, eine Verwechslung ist unmöglich. '
    + 'SAFETY (hart): Bei LinkedIn-Login-Seite, Checkpoint, Captcha, SMS-Challenge oder Logout SOFORT STOPPEN und der Nutzer informieren — NIE selbst einloggen. Menschliches Tempo, Limits aus config.json nie überschreiten. '
    + 'BROWSER-DISZIPLIN (hart): NIE pkill/killall auf "Google Chrome" (killt auch des Nutzers eigenes Chrome!) — Neustart NUR via bash dashboard/launch-chrome.sh <port> <profil>; crasht Chrome 2x hintereinander → Lauf abbrechen + melden statt weiter zu experimentieren. Nachrichten NIE über messaging/thread/new + Namenssuche — Chats IMMER über das /in/-Profil. Vor JEDEM Senden den Chat-Verlauf lesen: gesendet wird nur, was laut CHAT als Nächstes dran ist (CRM/Sheet sind Wegweiser, nicht Wahrheit). '
    + 'ABSENDE-GATE (hart, Vorfall 19.07.): Vor JEDEM Senden 5 Checks — richtiger Empfänger im Chat-Header · Feld-Inhalt = EXAKT die jetzt gewollte Nachricht (fremder/alter Text im Feld = Feld leeren, nie mitsenden) · Verlauf gelesen, kein Duplikat/falsche Stufe · Zeitpunkt erlaubt (Sa/So NIE Nachrichten, Limits, kein .paused) · das aktuelle Playbook sieht Senden überhaupt vor. DRAFT-VERBOT: In Eingabefelder nur tippen, was in derselben Minute gesendet wird — Entwürfe/Icebreaker gehören AUSSCHLIESSLICH in Dateien, nie ins Compose-Feld (LinkedIn speichert das als scharfen Entwurf). Am Lauf-Ende Draft-Sweep: kein offenes Chat-Fenster, kein Feld mit Resttext, dann erst Tab zu. '
    + 'TAB-REGEL (Pflicht, als Idle-Signal): Öffne für jeden Lauf einen EIGENEN Arbeits-Tab (new_page), arbeite dort, und schließe ihn am ENDE UND bei jedem Stopp/Abbruch wieder (close_page). Lass NIE einen LinkedIn-/Sales-Navigator-Tab offen — offener Tab bedeutet „arbeite gerade", kein Tab bedeutet „idle". '
    + 'Arbeite nach deinen Playbooks. WICHTIG: Wenn der Nutzer dich korrigiert ("mach das so", "schreib das in deine Instruktion/Playbook"), aktualisiere die passende Datei in agents/' + id + '/ SELBST per Edit und bestätige in EINER Zeile. Zeig deine Schritte, halte Text kurz.';
}
function acSend(id, msg) {
  let s = AC[id]; if (!s) s = acStart(id); if (!s) return false;
  const text = s.started ? msg : (acBrief(id) + "\n\nder Nutzer: " + msg); s.started = true;
  try { s.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n"); return true; } catch { return false; }
}
function acStop(id) { const s = AC[id]; if (s) { try { s.proc.kill("SIGCONT"); } catch {} try { s.proc.kill(); } catch {} delete AC[id]; } }

// ---- Stop/Play (des Nutzers Semantik, 10.07.) ----
// Stop WÄHREND eines Laufs: Prozess wird per SIGSTOP an Ort und Stelle EINGEFROREN (kein Abbruch).
// Play: SIGCONT — er macht exakt dort weiter. Stop im LEERLAUF: nur das .paused-Flag wird gesetzt,
// daily-run.sh + outreach-watchdog.sh prüfen es und starten dann NICHT. Play löscht das Flag.
function pausedFile(id) { return path.join(AGENTS, id, ".paused"); }
function isPaused(id) { try { return fs.existsSync(pausedFile(id)); } catch { return false; } }
function acPause(id) {
  try { writeJsonAtomic(pausedFile(id), { pausedAt: new Date().toISOString() }); } catch {}
  const s = AC[id]; if (s) { try { s.proc.kill("SIGSTOP"); } catch {} }
  acEmit(id, { type: "paused" });
}
function acResume(id) {
  try { fs.unlinkSync(pausedFile(id)); } catch {}
  const s = AC[id]; if (s) { try { s.proc.kill("SIGCONT"); } catch {} }
  acEmit(id, { type: "resumed" });
}

// ---- Meeting-Modus (12.07.) ----
// Trigger: Sales Copilot "Mithören" AN → alles Störende ruht, damit der Call flüssig bleibt.
// AN:  laufende Outreach-Agents per SIGSTOP einfrieren (RAM/CPU frei) + Flag-Datei schreiben.
//      watcher.sh / outreach-watchdog.sh / daily-run.sh prüfen das Flag und ruhen ebenfalls.
// AUS: nur die von UNS eingefrorenen Agents wieder wecken (SIGCONT) — ein manuelles Stop
//      (.paused) bleibt Stop. Flag löschen. Selbstheilend: die Shell-Jobs verwerfen ein
//      Flag, das älter als die Kappe ist (falls der Copilot je ohne "AUS" stirbt).
const MEETING_FLAG = path.join(__dirname, ".meeting-mode");

// Pre-Flight-CPU-Check beim Call-Start: Hintergrund-Leichen finden, die schon VOR dem Call CPU
// fressen (z.B. der hängende Chrome-GPU-Prozess aus einem Playwright-/Video-Job, der tagelang auf
// 100% lief und den Call laggen ließ). Legitime Call-Apps (Copilot, Audio, WindowServer/Screenshare)
// sind ausgenommen, damit kein Fehlalarm bei jedem Demo-Call kommt. Nur EIN informativer Ping;
// Kill-Entscheidung bleibt bei der Nutzer. Fire-and-forget, blockt den Call nie.
function meetingPreflightCpuCheck() {
  try {
    const raw = execSync("ps -Ao pcpu,etime,comm -r | head -12", { encoding: "utf8", timeout: 4000 });
    const SKIP = /Sales Copilot|sales-copilot|coreaudiod|WindowServer|kernel_task|launchd|\bhidd\b|dashboard\/server\.js|Deepgram|zoom\.us|screencapture|loginwindow/i;
    const hot = [];
    for (const line of raw.trim().split("\n").slice(1)) {
      const m = line.trim().match(/^([\d.]+)\s+(\S+)\s+(.+)$/);
      if (!m) continue;
      const cpu = parseFloat(m[1]); const etime = m[2]; const comm = m[3];
      if (cpu < 90) continue;                 // nur echte Ausreißer (hängende Loops sitzen bei ~100%; legitime App-Last bleibt drunter)
      if (SKIP.test(comm)) continue;          // Call-relevante/System-Prozesse ignorieren
      const name = comm.split("/").pop();
      hot.push(`${name} ${cpu.toFixed(0)}% (läuft ${etime})`);
    }
    if (hot.length) {
      const text = `Vor deinem Call laufen noch Hintergrund-Prozesse auf Volllast:\n• ${hot.join("\n• ")}\nFalls das Leichen sind (z.B. ein hängender Video-/Playwright-Job), im Command Center oder Terminal beenden, damit der Call flüssig bleibt.`;
      const child = spawn("node", [path.join(ROOT, "dashboard", "notify.js"), "--title", "🎙️ Call-Check", text], { cwd: ROOT, detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
    }
  } catch {}
}

function meetingModeOn(source = "") {
  const frozen = [];
  for (const id of Object.keys(AC)) {
    if (isPaused(id)) continue;            // manuell gestoppt → nicht anfassen
    try { AC[id].proc.kill("SIGSTOP"); frozen.push(id); acEmit(id, { type: "meeting-frozen" }); } catch {}
  }
  // source = wer den Freeze ausgelöst hat: "calendar" (Watcher, Auto-Termin), "manual" (Telegram /meeting)
  // oder "" (Sales Copilot "Mithören"). Nur "calendar" taut der Watcher selbst wieder auf — Copilot-/
  // Handstart bleibt unberührt, damit ein laufender Call nie mitten drin auftaut.
  try { writeJsonAtomic(MEETING_FLAG, { startedAt: new Date().toISOString(), source, frozen }); } catch {}
  meetingPreflightCpuCheck();             // Hintergrund-Leichen vor dem Call melden (fire-and-forget)
  return { on: true, source, frozen };
}
function meetingModeOff() {
  let frozen = [];
  try { frozen = (JSON.parse(fs.readFileSync(MEETING_FLAG, "utf8")).frozen) || []; } catch {}
  const resumed = [];
  for (const id of frozen) {
    if (isPaused(id)) continue;            // wurde inzwischen manuell gestoppt → nicht wecken
    const s = AC[id]; if (s) { try { s.proc.kill("SIGCONT"); resumed.push(id); acEmit(id, { type: "meeting-resumed" }); } catch {} }
  }
  try { fs.unlinkSync(MEETING_FLAG); } catch {}
  return { on: false, resumed };
}
const MEETING_MAX_MS = 7200 * 1000; // 2h Kappe, gleich wie die Shell-Jobs
function meetingModeStatus() {
  try {
    const f = JSON.parse(fs.readFileSync(MEETING_FLAG, "utf8"));
    // Selbstheilung: stirbt der Copilot je mitten im Call ohne "AUS", bleiben die Agents
    // nicht ewig eingefroren — nach der Kappe automatisch wieder wecken.
    if (Date.now() - new Date(f.startedAt).getTime() > MEETING_MAX_MS) return meetingModeOff();
    return { on: true, ...f };
  } catch { return { on: false }; }
}

// Toleranter JSONL-Parser: extrahiert {…}-Objekte per Klammer-Zählung (ignoriert Klammern in Strings),
// verkraftet auch literale Zeilenumbrüche im Wert (z.B. Icebreaker) → kein vernetzter Lead geht verloren.
function parseLooseJsonl(raw) {
  const out = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start >= 0) { const s = raw.slice(start, i + 1); let o = null; try { o = JSON.parse(s); } catch { try { o = JSON.parse(s.replace(/[\n\r\t]+/g, "\\n")); } catch {} } if (o) out.push(o); start = -1; } }
  }
  return out;
}
// Blocklist (Freunde/Privatkontakte) über ALLE Agents — verhindert, dass Blockierte je ins CRM gelangen.
// Quelle: agents/<id>/runs/.blocklist.json ([{name,url,grund}]). Match per normalisierter URL ODER Name.
function loadBlocklist() {
  const norm = (s) => (s || "").toString().trim().toLowerCase().replace(/\?.*$/, "").replace(/\/+$/, "");
  const urls = new Set(), names = new Set();
  let dirs = []; try { dirs = fs.readdirSync(AGENTS); } catch {}
  for (const id of dirs) {
    try {
      const bl = JSON.parse(fs.readFileSync(path.join(AGENTS, id, "runs", ".blocklist.json"), "utf8"));
      for (const b of (Array.isArray(bl) ? bl : [])) { if (b.url) urls.add(norm(b.url)); if (b.name) names.add(norm(b.name)); }
    } catch {}
  }
  return (lead) => urls.has(norm(lead && lead.url)) || names.has(norm(lead && lead.name));
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  // API-Auth-Vorbereitung (Audit-Fix 4): Wenn AIOS_API_TOKEN gesetzt ist (env oder .env), verlangen
  // ALLE /api/-Routen "Authorization: Bearer <token>". Nicht gesetzt (Default) = Verhalten wie bisher —
  // der Server lauscht ohnehin nur auf 127.0.0.1. Pflicht VOR jeder Tailscale-/Netz-Öffnung.
  // Achtung bei Aktivierung: das Dashboard-Frontend schickt den Header (noch) NICHT mit → UI bräuchte ihn dann auch.
  if (u.pathname.startsWith("/api/")) {
    const tok = process.env.AIOS_API_TOKEN || envVal("AIOS_API_TOKEN");
    if (tok && req.headers.authorization !== "Bearer " + tok) return send(res, 401, "application/json", JSON.stringify({ ok: false, error: "unauthorized" }));
  }
  // WhatsApp-Modul (wa.js): /webhooks/wa läuft BEWUSST außerhalb von /api/ (Meta authentifiziert per HMAC, nicht Bearer)
  if (u.pathname === "/webhooks/wa" || u.pathname === "/api/settings" || u.pathname.startsWith("/api/wa/")) {
    if (wa.handle(req, res, u)) return;
  }
  if (u.pathname === "/") { const all = readAll(); const body = PAGE(listNotes(all), buildGraph(all)); res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" }); return res.end(body); }
  if (u.pathname === "/api/modules") { let m = "{}"; try { m = fs.readFileSync(path.join(ROOT, "config", "modules.json"), "utf8"); } catch {} res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); return res.end(m); }
  // ---- Star-Map (eigene Vollbild-Seite, separate statische Dateien; altes Dashboard bleibt unberührt) ----
  if (u.pathname === "/api/starmap") {
    try { return send(res, 200, "application/json", JSON.stringify(buildStarmap())); }
    catch (e) { return send(res, 500, "application/json", JSON.stringify({ error: String(e) })); }
  }
  if (u.pathname === "/api/starmap-export" && req.method === "POST") {
    // Banner-PNG (data-URL vom Canvas) auf einen FESTEN Pfad schreiben — für den LinkedIn-Titelbild-Export.
    return readBody(req, (b) => {
      try {
        const m = String(b.dataUrl || "").match(/^data:image\/png;base64,(.+)$/);
        if (!m) return send(res, 400, "application/json", JSON.stringify({ ok: false, error: "bad dataUrl" }));
        const out = path.join(__dirname, "public", "starmap", "banner.png");
        fs.writeFileSync(out, Buffer.from(m[1], "base64"));
        send(res, 200, "application/json", JSON.stringify({ ok: true, path: out, bytes: fs.statSync(out).size }));
      } catch (e) { send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
    });
  }
  // ---- Skill-Übersicht (Live-Scan der installierten Skills) ----
  // Scannt ~/.claude/skills und das Repo .claude/skills, liest name+description aus dem SKILL.md-Frontmatter.
  if (u.pathname === "/api/skills") {
    try {
      const dirs = [path.join(os.homedir(), ".claude", "skills"), path.join(ROOT, ".claude", "skills")];
      const seen = {}, skills = [];
      for (const base of dirs) {
        let entries = [];
        try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
        for (const ent of entries) {
          if (!ent.isDirectory()) continue;
          const id = ent.name;
          if (seen[id]) continue;
          const sp = path.join(base, id, "SKILL.md");
          let name = id, desc = "";
          try {
            const txt = fs.readFileSync(sp, "utf8");
            const fm = txt.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/);
            if (fm) {
              const lines = fm[1].split(/\r?\n/);
              const nm = fm[1].match(/^name:\s*(.+)$/m); if (nm) name = nm[1].trim();
              for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/^description:\s*(.*)$/);
                if (!m) continue;
                let val = m[1].trim();
                // YAML-Blockfaltung (>, |, >-, |-, >+, |+) oder leerer Wert → Folgezeilen einlesen
                if (val === "" || /^[>|][+-]?$/.test(val)) {
                  const block = [];
                  for (let j = i + 1; j < lines.length; j++) {
                    if (/^\s+\S/.test(lines[j])) block.push(lines[j].trim());     // eingerückte Fortsetzung
                    else if (lines[j].trim() === "") block.push("");              // Leerzeile im Block
                    else break;                                                    // nächster Key → Block Ende
                  }
                  val = block.join(" ");
                }
                desc = val.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ").trim();
                break;
              }
            }
          } catch { continue; } // kein SKILL.md → kein Skill
          seen[id] = 1;
          skills.push({ id, name, desc, source: base.indexOf(ROOT) === 0 ? "repo" : "global" });
        }
      }
      skills.sort((a, b) => a.id.localeCompare(b.id));
      return send(res, 200, "application/json", JSON.stringify({ count: skills.length, skills }));
    } catch (e) { return send(res, 500, "application/json", JSON.stringify({ error: String(e) })); }
  }
  if (u.pathname === "/skills") {
    try { return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(path.join(__dirname, "skills-uebersicht.html"))); }
    catch { return send(res, 404, "text/plain", "Skill-Übersicht nicht gefunden"); }
  }
  if (u.pathname === "/mitarbeiter") {
    try { return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(path.join(__dirname, "mitarbeiter-katalog.html"))); }
    catch { return send(res, 404, "text/plain", "Mitarbeiter-Katalog nicht gefunden"); }
  }
  if (u.pathname === "/starmap" || u.pathname.startsWith("/starmap/")) {
    const base = path.join(__dirname, "public", "starmap");
    let rel = u.pathname === "/starmap" ? "index.html" : u.pathname.slice("/starmap/".length);
    rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
    const f = path.join(base, rel);
    const ext = path.extname(f).slice(1).toLowerCase();
    const ty = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", json: "application/json", ico: "image/x-icon" }[ext];
    if (!f.startsWith(base) || !ty || !fs.existsSync(f)) return send(res, 404, "text/plain", "nf");
    res.writeHead(200, { "Content-Type": ty, "Cache-Control": "no-store" }); return fs.createReadStream(f).pipe(res);
  }
  if (u.pathname === "/api/note") {
    const file = safeFile(u.searchParams.get("path")); if (!file || !fs.existsSync(file)) return send(res, 404, "application/json", "{}");
    const n = parseNote(file); return send(res, 200, "application/json", JSON.stringify({ title: n.title, markdown: n.body, raw: n.raw }));
  }
  if (u.pathname === "/api/save" && req.method === "POST") {
    return readBody(req, (b) => { const file = safeFile(b.path); if (!file) return send(res, 400, "application/json", JSON.stringify({ ok: false }));
      try { fs.writeFileSync(file, String(b.markdown ?? "")); send(res, 200, "application/json", JSON.stringify({ ok: true })); }
      catch (e) { send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); } });
  }
  if (u.pathname === "/api/note-prio" && req.method === "POST") {
    // Eisenhower-Prio (1=Wichtig, 2=Normal, 3=Später) einer Notiz setzen — patcht NUR die prio:-Zeile im Frontmatter.
    return readBody(req, (b) => {
      const file = safeFile(b.path); if (!file || !fs.existsSync(file)) return send(res, 404, "application/json", JSON.stringify({ ok: false }));
      const pv = Math.min(3, Math.max(1, parseInt(b.prio, 10) || 2));
      try {
        let raw = fs.readFileSync(file, "utf8");
        const m = raw.match(/^(---\n)([\s\S]*?)(\n---)/);
        if (m) {
          const fmNew = /^prio:/m.test(m[2]) ? m[2].replace(/^prio:.*$/m, "prio: " + pv) : m[2] + "\nprio: " + pv;
          raw = m[1] + fmNew + raw.slice(m[1].length + m[2].length);
        } else raw = "---\nprio: " + pv + "\n---\n" + raw;
        fs.writeFileSync(file, raw);
        send(res, 200, "application/json", JSON.stringify({ ok: true, prio: pv }));
      } catch (e) { send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
    });
  }
  if (u.pathname === "/api/todos") {
    // Quellen: tasks.md + roadmap (+ jede Projektnotiz mit Checkboxen). projects = alle Projekt-Slugs → Anzeigename (für [[Link]]→Kunde-Zuordnung). kunden = Slugs mit Frontmatter-Tag "kunde".
    const sources = [], projects = {}, kunden = [];
    const readRel = (rel) => { const file = safeFile(rel); if (!file || !fs.existsSync(file)) return null; try { return fs.readFileSync(file, "utf8"); } catch { return null; } };
    const t = readRel("07_Tasks/tasks.md"); if (t != null) sources.push({ path: "07_Tasks/tasks.md", label: "Tasks", customer: null, raw: t });
    const r = readRel("07_Tasks/jarvis-roadmap.md"); if (r != null) sources.push({ path: "07_Tasks/jarvis-roadmap.md", label: "Jarvis Roadmap", customer: null, raw: r });
    try {
      const projDir = path.join(BRAIN, "03_Projects");
      for (const f of fs.readdirSync(projDir)) {
        if (!f.endsWith(".md")) continue;
        const file = path.join(projDir, f); let raw = "";
        try { raw = fs.readFileSync(file, "utf8"); } catch { continue; }
        const slug = f.replace(/\.md$/, ""); const n = parseNote(file); const name = n.title || slug;
        projects[slug] = name;
        if (/^tags:.*\bkunde\b/m.test(raw)) kunden.push(slug);
        if (/^\s*-\s+\[[ xX]\]/m.test(raw)) sources.push({ path: `03_Projects/${f}`, label: name, customer: slug, raw });
      }
    } catch {}
    return send(res, 200, "application/json", JSON.stringify({ sources, projects, kunden }));
  }
  if (u.pathname === "/api/heartbeat") {
    // Status + Run-Historie des autonomen Heartbeats (dashboard/heartbeat.sh)
    let status = null, runs = [];
    try { status = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "heartbeat-status.json"), "utf8")); } catch {}
    try {
      const lines = fs.readFileSync(path.join(__dirname, "data", "heartbeat-runs.jsonl"), "utf8").trim().split("\n");
      runs = lines.slice(-40).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
    } catch {}
    return send(res, 200, "application/json", JSON.stringify({ status, runs }));
  }
  if (u.pathname === "/api/agents") { return send(res, 200, "application/json", JSON.stringify({ agents: listAgents() })); }
  if (u.pathname === "/api/upwork-proposals") {
    // Proposal-Tracking (Job, Client, Rate, Connects, Loom, Status) + berechnete Quoten für die Upwork-Agent-Ansicht.
    const p = path.join(ROOT, "dashboard", "data", "upwork-proposals.json");
    let data = { proposals: [] };
    try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    const ps = data.proposals || [];
    const n = ps.length, cnt = (f) => ps.filter(f).length;
    const viewed = cnt((x) => x.viewed || x.status === "viewed" || x.replied || x.status === "replied" || x.hired || x.status === "hired");
    const replied = cnt((x) => x.replied || x.status === "replied" || x.hired || x.status === "hired");
    const hired = cnt((x) => x.hired || x.status === "hired");
    const declined = cnt((x) => x.status === "declined");
    const connects = ps.reduce((s, x) => s + (x.connects || 0), 0);
    const pct = (k) => (n ? Math.round((k / n) * 100) : 0);
    const stats = { total: n, viewed, replied, hired, declined, connects, viewedPct: pct(viewed), repliedPct: pct(replied), hiredPct: pct(hired) };
    return send(res, 200, "application/json", JSON.stringify({ ok: true, stats, proposals: ps, updated: data.updated || "" }));
  }
  if (u.pathname === "/api/agent-lab") {
    // Vorschläge des Qualitätsmanagers (agents/agent-lab). Offene zuerst, danach die letzten 20 entschiedenen.
    let recs = [];
    try { recs = JSON.parse(fs.readFileSync(path.join(ROOT, "dashboard", "data", "agent-lab-recs.json"), "utf8")).recs || []; } catch {}
    const rang = { hoch: 0, mittel: 1, niedrig: 2 };
    const offen = recs.filter((r) => r.status === "offen").sort((a, b) => (rang[a.schwere] ?? 1) - (rang[b.schwere] ?? 1));
    const erledigt = recs.filter((r) => r.status !== "offen").sort((a, b) => String(b.entschieden || "").localeCompare(String(a.entschieden || ""))).slice(0, 20);
    let letzterLauf = null;
    try {
      const zeilen = fs.readFileSync(path.join(ROOT, "dashboard", "data", "agent-lab-runs.jsonl"), "utf8").trim().split("\n").filter(Boolean);
      if (zeilen.length) letzterLauf = JSON.parse(zeilen[zeilen.length - 1]);
    } catch {}
    return send(res, 200, "application/json", JSON.stringify({ ok: true, offen, erledigt, letzterLauf }));
  }
  if (u.pathname === "/api/agent-lab/decide" && req.method === "POST") {
    // des Nutzers Freigabe aus der UI. Schreibweg bewusst NUR über agent-lab-decide.js (Single-Writer),
    // damit Dashboard und Telegram-Button exakt dasselbe tun (inkl. Task nach aios-audit-fixes.md).
    return readBody(req, (b) => {
      const id = String(b.id || "");
      const entscheid = b.entscheid === "ja" ? "ja" : b.entscheid === "nein" ? "nein" : null;
      if (!id || !/^[\w-]+$/.test(id) || !entscheid) return send(res, 400, "application/json", JSON.stringify({ ok: false, error: "id/entscheid fehlt" }));
      try {
        const out = execFileSync("node", [path.join(ROOT, "dashboard", "agent-lab-decide.js"), id, entscheid], { timeout: 20000 }).toString().trim();
        return send(res, 200, "application/json", JSON.stringify({ ok: out.startsWith("OK:"), out }));
      } catch (e) {
        return send(res, 500, "application/json", JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
      }
    });
  }
  if (u.pathname === "/api/upwork-proposal-update" && req.method === "POST") {
    // Status/Notiz eines Proposals aktualisieren (des Nutzers Rückmeldung aus der UI). status setzt die Bool-Flags konsistent.
    return readBody(req, (b) => {
      const p = path.join(ROOT, "dashboard", "data", "upwork-proposals.json");
      let data;
      try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch { return send(res, 500, "application/json", JSON.stringify({ ok: false })); }
      const ps = data.proposals || [];
      const idx = ps.findIndex((x) => x.jobUrl === b.jobUrl);
      if (idx < 0) return send(res, 404, "application/json", JSON.stringify({ ok: false, error: "nicht gefunden" }));
      const pr = ps[idx];
      const allowed = ["sent", "viewed", "replied", "hired", "declined"];
      if (b.status && allowed.includes(String(b.status))) {
        const st = String(b.status);
        pr.status = st;
        pr.viewed = ["viewed", "replied", "hired"].includes(st);
        pr.replied = ["replied", "hired"].includes(st);
        pr.hired = st === "hired";
      }
      if (typeof b.notes === "string") pr.notes = b.notes;
      data.updated = dayStamp();
      try { writeJsonAtomic(p, data, 2); } catch (e) { return send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
      send(res, 200, "application/json", JSON.stringify({ ok: true, proposal: pr }));
    });
  }
  if (u.pathname === "/api/upwork-radar") {
    // Gescannte Job-Fits (Score/Draft/Loom/Visual) für die "Neue Fits"-Sektion des Upwork-Cockpits.
    const p = path.join(ROOT, "dashboard", "data", "upwork-radar.json");
    let data = { fits: [] };
    try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    return send(res, 200, "application/json", JSON.stringify({ ok: true, fits: data.fits || [], updated: data.updated || "" }));
  }
  if (u.pathname === "/api/upwork-radar-action" && req.method === "POST") {
    // "Beworben" (applied) → Fit in upwork-proposals.json übernehmen; "Verworfen" (discarded) → nur Status setzen.
    return readBody(req, (b) => {
      const rp = path.join(ROOT, "dashboard", "data", "upwork-radar.json");
      let rd;
      try { rd = JSON.parse(fs.readFileSync(rp, "utf8")); } catch { return send(res, 500, "application/json", JSON.stringify({ ok: false })); }
      const fits = rd.fits || [];
      const f = fits.find((x) => (x.id || x.jobUrl) === b.id);
      if (!f) return send(res, 404, "application/json", JSON.stringify({ ok: false, error: "nicht gefunden" }));
      const action = String(b.action || "");
      if (action === "discarded") { f.status = "discarded"; }
      else if (action === "applied") {
        f.status = "applied";
        const pp = path.join(ROOT, "dashboard", "data", "upwork-proposals.json");
        let pd; try { pd = JSON.parse(fs.readFileSync(pp, "utf8")); } catch { pd = { proposals: [] }; }
        pd.proposals = pd.proposals || [];
        if (!pd.proposals.find((x) => x.jobUrl === f.jobUrl)) {
          pd.proposals.unshift({
            date: dayStamp(), jobTitle: f.jobTitle, jobUrl: f.jobUrl, client: f.client || {},
            bid: f.bid || (f.budget ? { note: f.budget } : {}),
            connects: (b.connects != null ? b.connects : null), loom: true,
            status: "sent", viewed: false, replied: false, hired: false, notes: f.fitReason || ""
          });
          pd.updated = dayStamp();
          try { writeJsonAtomic(pp, pd, 2); } catch (e) { return send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
        }
      } else { return send(res, 400, "application/json", JSON.stringify({ ok: false, error: "unbekannte action" })); }
      rd.updated = dayStamp();
      try { writeJsonAtomic(rp, rd, 2); } catch (e) { return send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
      send(res, 200, "application/json", JSON.stringify({ ok: true }));
    });
  }
  if (u.pathname === "/api/upwork-scan-now" && req.method === "POST") {
    // Scan manuell anstoßen (läuft detached im Hintergrund, schreibt Radar + pingt Telegram; braucht offenen eingeloggten Chrome).
    try {
      const sh = path.join(ROOT, "dashboard", "upwork-scan.sh");
      const child = spawn("/bin/bash", [sh], { cwd: ROOT, detached: true, stdio: "ignore" });
      child.unref();
      return send(res, 200, "application/json", JSON.stringify({ ok: true, note: "Scan gestartet (läuft im Hintergrund, meldet sich per Telegram)." }));
    } catch (e) { return send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
  }
  if (u.pathname.startsWith("/upwork-projekte/") && u.pathname.endsWith(".html")) {
    // HTML-Visuals der Fits ausliefern (nur .html unter upwork-projekte/).
    const f = path.normalize(path.join(ROOT, u.pathname.replace(/^\/+/, "")));
    if (f.startsWith(path.join(ROOT, "upwork-projekte") + path.sep) && fs.existsSync(f)) {
      try { return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(f, "utf8")); } catch {}
    }
    return send(res, 404, "text/plain", "not found");
  }
  if (u.pathname.startsWith("/cw/") && u.pathname.endsWith(".jpg")) {
    // Competitor-Watch-Thumbnails (dashboard/public/cw/, lokal gesichert weil IG-CDN-URLs ablaufen)
    const dir = path.join(__dirname, "public", "cw");
    const f = path.normalize(path.join(dir, u.pathname.slice(4)));
    if (f.startsWith(dir + path.sep) && fs.existsSync(f)) {
      try { res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" }); return res.end(fs.readFileSync(f)); } catch {}
    }
    return send(res, 404, "text/plain", "not found");
  }
  if (u.pathname === "/api/salescopilot") {
    // Status schreibt die Sales-Copilot-App nach data/salescopilot-status.json (siehe sales-copilot/HANDOFF.md)
    let status = null;
    try {
      status = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "salescopilot-status.json"), "utf8"));
      if (status.updated && Date.now() / 1000 - status.updated > 300) status = { ...status, stale: true };
    } catch {}
    const notes = [];
    // Frontmatter-Auszug je Notiz: TEILNEHMER + Call-Typ gehören in die Liste, sonst sieht
    // man nicht, mit wem der Call war (Wunsch 17.07.).
    const noteMeta = (p) => {
      try {
        const head = fs.readFileSync(p, "utf8").slice(0, 600);
        const t = ((head.match(/^teilnehmer:\s*\[(.*?)\]/m) || [])[1] || "").trim();
        let c = ((head.match(/^calltyp:\s*(.+)$/m) || [])[1] || "").trim().replace(/^"|"$/g, "");
        // datum: aus dem Frontmatter — das ECHTE Call-Datum, nicht die Datei-mtime (die springt beim Neuschreiben).
        const dm = ((head.match(/^datum:\s*(\d{4}-\d{2}-\d{2})/m) || [])[1] || "");
        return { teilnehmer: t, calltyp: c, datum: dm };
      } catch { return { teilnehmer: "", calltyp: "", datum: "" }; }
    };
    try {
      const projDir = path.join(BRAIN, "03_Projects");
      for (const d of fs.readdirSync(projDir)) {
        if (!d.endsWith("-calls")) continue;
        const dir = path.join(projDir, d);
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith(".md")) continue;
          const st = fs.statSync(path.join(dir, f));
          notes.push({ rel: `03_Projects/${d}/${f}`, projekt: d.replace(/-calls$/, ""), name: f.replace(/\.md$/, ""), mtime: st.mtimeMs, ...noteMeta(path.join(dir, f)) });
        }
      }
      for (const f of fs.readdirSync(path.join(BRAIN, "00_Inbox"))) {
        if (/^call-.*\.md$/.test(f)) {
          const st = fs.statSync(path.join(BRAIN, "00_Inbox", f));
          notes.push({ rel: `00_Inbox/${f}`, projekt: "Inbox", name: f.replace(/\.md$/, ""), mtime: st.mtimeMs, ...noteMeta(path.join(BRAIN, "00_Inbox", f)) });
        }
      }
      notes.sort((a, b) => b.mtime - a.mtime);
    } catch {}
    const running = (() => { try { return require("child_process").execSync("pgrep -f 'sales-copilot' | head -1", { encoding: "utf8" }).trim() !== ""; } catch { return false; } })();
    return send(res, 200, "application/json", JSON.stringify({ status, running, notes: notes.slice(0, 15) }));
  }
  if (u.pathname === "/api/salescopilot/start" && req.method === "POST") {
    try {
      // WICHTIG: über `open` (LaunchServices) starten, NICHT npm/bash — sonst erbt die App
      // den TCC-Kontext dieses Servers (launchd, KEIN Mikrofonrecht) und macOS liefert
      // getUserMedia nur Stille (Fall 15.07.: "Quelle Ich liefert keinen Ton").
      // Via `open` läuft sie als eigenständige App unter der "Electron"-Berechtigung (erteilt).
      require("child_process").spawn("/usr/bin/open", ["-n",
        "$HOME/AIOS/sales-copilot/node_modules/electron/dist/Electron.app",
        "--args", "$HOME/AIOS/sales-copilot"],
        { detached: true, stdio: "ignore" }).unref();
      return send(res, 200, "application/json", JSON.stringify({ ok: true }));
    } catch (e) { return send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
  }
  if (u.pathname === "/api/salescopilot/stop" && req.method === "POST") {
    // Sauber ausschalten: Befehls-Datei schreiben, die App fährt selbst herunter —
    // läuft gerade eine Aufnahme, macht sie ERST die Notiz fertig, dann beenden.
    // (Die App liest data/salescopilot-command.json, siehe sales-copilot/main.js.)
    try {
      const running = (() => { try { return require("child_process").execSync("pgrep -f 'sales-copilot' | head -1", { encoding: "utf8" }).trim() !== ""; } catch { return false; } })();
      if (!running) return send(res, 200, "application/json", JSON.stringify({ ok: true, running: false }));
      const cmdFile = path.join(__dirname, "data", "salescopilot-command.json");
      fs.mkdirSync(path.dirname(cmdFile), { recursive: true });
      writeJsonAtomic(cmdFile, { cmd: "shutdown", ts: Date.now() });
      return send(res, 200, "application/json", JSON.stringify({ ok: true, running: true }));
    } catch (e) { return send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
  }
  if (u.pathname === "/api/note-delete" && req.method === "POST") {
    // Call-Notiz aus der Sales-Copilot-Liste entfernen. NIE hart löschen (Brain-Regel: nie löschen),
    // sondern in einen Papierkorb (brain/.papierkorb/) verschieben — wiederherstellbar, aber raus aus der Liste.
    // Nur über diese Route (Single-Writer), nur Call-Notizen aus 00_Inbox oder Projekt-*-calls.
    return readBody(req, (b) => {
      const rel = String(b.rel || "");
      const ok = /^00_Inbox\/call-.*\.md$/.test(rel) || /^03_Projects\/[^/]+-calls\/[^/]+\.md$/.test(rel);
      const src = safeFile(rel);
      if (!ok || !src || !fs.existsSync(src)) return send(res, 400, "application/json", JSON.stringify({ ok: false, error: "ungültiger Pfad" }));
      try {
        const trash = path.join(BRAIN, ".papierkorb");
        fs.mkdirSync(trash, { recursive: true });
        const dest = path.join(trash, dayStamp() + "__" + path.basename(rel));
        fs.renameSync(src, dest);
        return send(res, 200, "application/json", JSON.stringify({ ok: true }));
      } catch (e) { return send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
    });
  }
  if (u.pathname === "/api/outreach-stats") {
    // Aggregiert agents/<id>/stats.json pro Tag (summiert über alle Agents). Zahlen = "wie viele" → Daten-Datei, nicht ins Brain-Vault.
    const days = {};
    let agentDirs = []; try { agentDirs = fs.readdirSync(AGENTS).filter((d) => { try { return fs.statSync(path.join(AGENTS, d)).isDirectory(); } catch { return false; } }); } catch {}
    for (const id of agentDirs) {
      let obj; try { obj = JSON.parse(fs.readFileSync(path.join(AGENTS, id, "stats.json"), "utf8")); } catch { continue; }
      for (const [date, s] of Object.entries(obj)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !s || typeof s !== "object") continue;
        if (!days[date]) days[date] = { date, vernetzt: 0, gesynct: 0, erstnachrichten: 0, inmails: 0, followups: 0, geantwortet: 0, agents: {} };
        const d = days[date];
        const v = +s.vernetzt || 0, g = +s.gesynct || 0, e = +s.erstnachrichten || 0, im = +s.inmails || 0, f = +s.followups || 0, ga = +s.geantwortet || 0;
        d.vernetzt += v; d.gesynct += g; d.erstnachrichten += e; d.inmails += im; d.followups += f; d.geantwortet += ga;
        d.agents[id] = { vernetzt: v, gesynct: g, erstnachrichten: e, inmails: im, followups: f, geantwortet: ga };
      }
    }
    const list = Object.values(days).sort((a, b) => b.date.localeCompare(a.date));
    return send(res, 200, "application/json", JSON.stringify({ days: list }));
  }
  // ---- Action-Inbox (11.07.): NUR was des Nutzers Reaktion braucht (Entscheidung, Kundenmail, Agent-Blocker) — abarbeiten & leerhalten. Erledigt wird nie gelöscht, nur eingeklappt. ----
  if (u.pathname === "/api/aktionen") {
    const p = path.join(ROOT, "dashboard", "data", "aktionen.json");
    let data = { aktionen: [] };
    try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    return send(res, 200, "application/json", JSON.stringify(data));
  }
  if (u.pathname === "/api/aktion-add" && req.method === "POST") {
    return readBody(req, (b) => {
      if (!b.titel) return send(res, 400, "application/json", JSON.stringify({ ok: false, error: "titel fehlt" }));
      const p = path.join(ROOT, "dashboard", "data", "aktionen.json");
      let data; try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch { data = { aktionen: [] }; }
      data.aktionen = data.aktionen || [];
      // De-Dupe: gleicher offener Titel → nicht nochmal (Watcher läuft alle 10 Min)
      if (data.aktionen.find((a) => !a.done && a.titel === String(b.titel).slice(0, 200)))
        return send(res, 200, "application/json", JSON.stringify({ ok: true, dupe: true }));
      const a = {
        id: "a" + Date.now() + Math.random().toString(36).slice(2, 6),
        ts: new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 16),
        titel: String(b.titel).slice(0, 200), detail: String(b.detail || "").slice(0, 500),
        quelle: String(b.quelle || "manuell").slice(0, 40), link: String(b.link || "").slice(0, 500), done: false,
      };
      data.aktionen.unshift(a);
      // Cap 300: NIE offene Items verdrängen (raus geht nur, was der Nutzer abhakt) — nur alte erledigte fallen weg.
      if (data.aktionen.length > 300) {
        const open = data.aktionen.filter((x) => !x.done), done = data.aktionen.filter((x) => x.done);
        data.aktionen = open.concat(done.slice(0, Math.max(0, 300 - open.length)));
      }
      try { writeJsonAtomic(p, data, 2); } catch (e) { return send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
      send(res, 200, "application/json", JSON.stringify({ ok: true, aktion: a }));
    });
  }
  if (u.pathname === "/api/aktion-later" && req.method === "POST") {
    // "Später": Item aus der Heute-Sicht nehmen und morgen 07:00 automatisch wieder vorlegen
    // (bleibt offen, wird nur bis dahin ausgeblendet — nie löschen, Später-Bucket-Prinzip).
    return readBody(req, (b) => {
      const p = path.join(ROOT, "dashboard", "data", "aktionen.json");
      let data; try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch { return send(res, 500, "application/json", JSON.stringify({ ok: false })); }
      const a = (data.aktionen || []).find((x) => x.id === b.id);
      if (!a) return send(res, 404, "application/json", JSON.stringify({ ok: false }));
      const days = Math.max(1, Math.min(30, parseInt(b.days, 10) || 1));
      const d = new Date(Date.now() + days * 86400000);
      a.snoozedUntil = d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }) + " 07:00";
      try { writeJsonAtomic(p, data, 2); } catch (e) { return send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
      send(res, 200, "application/json", JSON.stringify({ ok: true, snoozedUntil: a.snoozedUntil }));
    });
  }
  if (u.pathname === "/api/aktion-done" && req.method === "POST") {
    return readBody(req, (b) => {
      const p = path.join(ROOT, "dashboard", "data", "aktionen.json");
      let data; try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch { return send(res, 500, "application/json", JSON.stringify({ ok: false })); }
      const a = (data.aktionen || []).find((x) => x.id === b.id);
      if (!a) return send(res, 404, "application/json", JSON.stringify({ ok: false }));
      a.done = !!b.done;
      a.doneTs = a.done ? new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 16) : "";
      try { writeJsonAtomic(p, data, 2); } catch (e) { return send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
      send(res, 200, "application/json", JSON.stringify({ ok: true }));
    });
  }
  if (u.pathname === "/api/inbox") {
    // Gmail-Posteingang (read-only, 60s-Cache, ?fresh=1 erzwingt Neuabruf). Fehler → {ok:false}, nie Crash.
    fetchInbox(u.searchParams.get("fresh") === "1")
      .then((d) => send(res, 200, "application/json", JSON.stringify(d)))
      .catch((e) => send(res, 200, "application/json", JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 200), mails: [] })));
    return;
  }
  if (u.pathname === "/api/leads") {
    try {
      const p = path.join(ROOT, "dashboard", "data", "leads.json");
      const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { leads: [] };
      const leads = data.leads || [];
      const byUrl = new Set(leads.map((l) => (l.url || "").trim()).filter(Boolean));
      // Frische Vernetzungen aus den Agent-Übergabedateien (.crm-inbox.jsonl) einmergen → CRM aktualisiert sich von selbst.
      const isBlocked = loadBlocklist(); // Freunde/Privat NIE ins CRM mergen (Sicherheitsnetz)
      let agentDirs = []; try { agentDirs = fs.readdirSync(AGENTS); } catch {}
      let added = 0;
      for (const id of agentDirs) {
        let raw; try { raw = fs.readFileSync(path.join(AGENTS, id, "runs", ".crm-inbox.jsonl"), "utf8"); } catch { continue; }
        for (const lead of parseLooseJsonl(raw)) {
          const url = (lead.url || "").trim(); if (!url || byUrl.has(url)) continue;
          if (isBlocked(lead)) continue; // blockierter Freund/Privatkontakt → überspringen
          byUrl.add(url); leads.push(lead); added++;
        }
      }
      data.leads = leads; data.count = leads.length; if (added) data.freshFromAgents = added;
      return send(res, 200, "application/json", JSON.stringify(data));
    } catch { return send(res, 200, "application/json", JSON.stringify({ leads: [] })); }
  }
  if (u.pathname === "/api/lead-save" && req.method === "POST") {
    return readBody(req, (b) => {
      try {
        const p = path.join(ROOT, "dashboard", "data", "leads.json"); const data = JSON.parse(fs.readFileSync(p, "utf8")); const leads = data.leads || [];
        const i = leads.findIndex((l) => (l.url || l.name) === b.id);
        if (i < 0) {
          // Frischer Agent-Lead (nur in .crm-inbox.jsonl, noch nicht in leads.json) → upserten, sonst ginge die Stufe verloren.
          if (b.lead && (b.lead.url || b.lead.name)) {
            if (loadBlocklist()(b.lead)) return send(res, 200, "application/json", JSON.stringify({ ok: false, blocked: true })); // Freund/Privat nie aufnehmen
            const nl = Object.assign({}, b.lead, b.fields || {}); delete nl._i;
            leads.push(nl); data.leads = leads; data.count = leads.length;
            writeJsonAtomic(p, data, 2);
            return send(res, 200, "application/json", JSON.stringify({ ok: true, added: true }));
          }
          return send(res, 404, "application/json", JSON.stringify({ ok: false }));
        }
        // Activity-Timeline (CRM-Inbox-Ausbau Punkt 3): Funnel-Änderungen ab jetzt mit Zeitstempel
        // in lead.history festhalten — die Booleans allein haben kein Datum. Max. 50 Einträge.
        const HIST_FIELDS = ["pipelineStage", "contacted", "replied", "callProposed", "callResult", "settingBooked", "closingBooked", "closed", "won", "lost", "followUpLater", "status", "stage"];
        const hist = Array.isArray(leads[i].history) ? leads[i].history : [];
        for (const [k, v] of Object.entries(b.fields || {})) {
          if (HIST_FIELDS.includes(k) && leads[i][k] !== v)
            hist.push({ ts: new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 16), field: k, value: typeof v === "boolean" ? v : String(v).slice(0, 40) });
        }
        if (hist.length) leads[i].history = hist.slice(-50);
        Object.assign(leads[i], b.fields || {});
        writeJsonAtomic(p, data, 2);
        send(res, 200, "application/json", JSON.stringify({ ok: true }));
      } catch (e) { send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
    });
  }
  if (u.pathname === "/api/lead-delete" && req.method === "POST") {
    return readBody(req, (b) => {
      try {
        const p = path.join(ROOT, "dashboard", "data", "leads.json"); const data = JSON.parse(fs.readFileSync(p, "utf8")); const leads = data.leads || [];
        const i = leads.findIndex((l) => (l.url || l.name) === b.id);
        if (i < 0) return send(res, 404, "application/json", JSON.stringify({ ok: false }));
        leads.splice(i, 1); data.leads = leads; data.count = leads.length;
        writeJsonAtomic(p, data, 2);
        send(res, 200, "application/json", JSON.stringify({ ok: true }));
      } catch (e) { send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
    });
  }
  // ---- PM-Board (Kundenprojekte) — gleiche JSON-Logik wie das CRM ----
  if (u.pathname === "/api/projekte") {
    try {
      const p = path.join(ROOT, "dashboard", "data", "projekte.json");
      const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { projekte: [] };
      return send(res, 200, "application/json", JSON.stringify(data));
    } catch { return send(res, 200, "application/json", JSON.stringify({ projekte: [] })); }
  }
  // ---- Content Pipeline (MVP-Cockpit) — nur Lesen; Ideen/Analytics-Platzhalter aus JSON ----
  if (u.pathname === "/api/content-pipeline") {
    try {
      const p = path.join(ROOT, "dashboard", "data", "content-pipeline.json");
      const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { ideen: [], analytics: { posts: [] } };
      return send(res, 200, "application/json", JSON.stringify(data));
    } catch { return send(res, 200, "application/json", JSON.stringify({ ideen: [], analytics: { posts: [] } })); }
  }
  // Idee im Cockpit bewegen (Start ins Board / Stufe weiterschieben). MVP: nur Stage/started, kein Live-Scrape.
  if (u.pathname === "/api/content-pipeline-save" && req.method === "POST") {
    return readBody(req, (b) => {
      try {
        const p = path.join(ROOT, "dashboard", "data", "content-pipeline.json");
        const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { ideen: [] };
        const list = data.ideen || [];
        const it = list.find((x) => x.id === b.id);
        if (!it) return send(res, 404, "application/json", JSON.stringify({ ok: false }));
        if (b.fields && typeof b.fields === "object") Object.assign(it, b.fields);
        data.updated = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 10);
        writeJsonAtomic(p, data, 2);
        send(res, 200, "application/json", JSON.stringify({ ok: true }));
      } catch (e) { send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
    });
  }
  // Neue Idee ins Cockpit legen (Nachtwerker-Post-Schritt schreibt hierüber — Single-Writer = Server, keine JSON-Races).
  if (u.pathname === "/api/content-idea-add" && req.method === "POST") {
    return readBody(req, (b) => {
      if (!b.titel) return send(res, 400, "application/json", JSON.stringify({ ok: false, error: "titel fehlt" }));
      const p = path.join(ROOT, "dashboard", "data", "content-pipeline.json");
      let data; try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch { data = { ideen: [] }; }
      data.ideen = data.ideen || [];
      // De-Dupe: gleiche offene Idee (Titel, noch in Stufe 'Idee') → nicht doppelt (Nacht-Lauf ist idempotent).
      if (data.ideen.find((x) => x.stage === "Idee" && x.titel === String(b.titel).slice(0, 160)))
        return send(res, 200, "application/json", JSON.stringify({ ok: true, dupe: true }));
      // Viral-Metriken (Original-Post) nur mit numerischen Werten übernehmen
      const viral = {};
      if (b.viral && typeof b.viral === "object")
        for (const k of ["views", "likes", "comments", "shares"])
          if (b.viral[k] != null && !isNaN(+b.viral[k])) viral[k] = +b.viral[k];
      const idea = {
        id: "idea-" + Date.now() + Math.random().toString(36).slice(2, 6),
        titel: String(b.titel).slice(0, 160),
        hook: String(b.hook || "").slice(0, 300),
        kanal: String(b.kanal || "LinkedIn").slice(0, 20),
        quelle: String(b.quelle || "nachtwerker").slice(0, 40),
        typ: String(b.typ || "post").slice(0, 20),
        score: Number(b.score) || 0,
        outlier: (b.outlier != null && !isNaN(+b.outlier)) ? +b.outlier : undefined,
        scoreGrund: String(b.scoreGrund || "").slice(0, 300),
        stage: "Idee",
        notiz: String(b.notiz || "").slice(0, 2000),
        // Feed-Felder (17.07.): Miniaturbild, Original-Link, Alter + Viralität für den Ideen-Feed
        thumb: String(b.thumb || "").slice(0, 500),
        url: String(b.url || "").slice(0, 500),
        postDatum: String(b.postDatum || "").slice(0, 10),
        viral,
        quelleAccount: String(b.quelleAccount || "").slice(0, 80),
        quelleName: String(b.quelleName || "").slice(0, 80),
        erstellt: new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 10),
      };
      data.ideen.unshift(idea);
      data.updated = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 10);
      try { writeJsonAtomic(p, data, 2); } catch (e) { return send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
      send(res, 200, "application/json", JSON.stringify({ ok: true, idea }));
    });
  }
  if (u.pathname === "/api/projekt-save" && req.method === "POST") {
    return readBody(req, (b) => {
      try {
        const p = path.join(ROOT, "dashboard", "data", "projekte.json");
        const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { projekte: [] };
        const list = data.projekte || [];
        const i = list.findIndex((x) => x.id === b.id);
        if (i < 0) {
          if (b.projekt && (b.projekt.id || b.projekt.kunde)) { list.push(b.projekt); data.projekte = list; writeJsonAtomic(p, data, 2); return send(res, 200, "application/json", JSON.stringify({ ok: true, added: true })); }
          return send(res, 404, "application/json", JSON.stringify({ ok: false }));
        }
        // Stage-/Deadline-Wechsel mit Zeitstempel in history festhalten (max. 50).
        const hist = Array.isArray(list[i].history) ? list[i].history : [];
        for (const hf of ["stage", "deadline"])
          if (b.fields && b.fields[hf] !== undefined && b.fields[hf] !== "" && list[i][hf] !== b.fields[hf])
            hist.push({ ts: new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 16), field: hf, value: String(b.fields[hf]).slice(0, 40) });
        if (hist.length) list[i].history = hist.slice(-50);
        Object.assign(list[i], b.fields || {});
        data.updatedAt = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 10);
        writeJsonAtomic(p, data, 2);
        send(res, 200, "application/json", JSON.stringify({ ok: true }));
      } catch (e) { send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
    });
  }
  if (u.pathname === "/api/projekt-delete" && req.method === "POST") {
    return readBody(req, (b) => {
      try {
        const p = path.join(ROOT, "dashboard", "data", "projekte.json");
        const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { projekte: [] };
        data.projekte = (data.projekte || []).filter((x) => x.id !== b.id);
        data.updatedAt = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 10);
        writeJsonAtomic(p, data, 2);
        send(res, 200, "application/json", JSON.stringify({ ok: true }));
      } catch (e) { send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
    });
  }
  if (u.pathname === "/api/kpis") {
    // Live-KPIs für Command Center + Outreach — gezählt aus dem CRM (leads.json), Rechnungen (invoices.json)
    // und Projekten (projekte.json). Eine Quelle für alle Kacheln, damit die Zahlen überall gleich sind.
    try {
      const read = (f, fb) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "dashboard", "data", f), "utf8")); } catch { return fb; } };
      const leads = read("leads.json", {}).leads || [];
      const inv = read("invoices.json", {}).invoices || [];
      const projs = read("projekte.json", {}).projekte || [];
      const n = (f) => leads.filter(f).length;
      const funnel = {
        leads: leads.length,
        contacted: n((l) => l.contacted),
        replied: n((l) => l.replied),
        callProposed: n((l) => l.callProposed),
        setting: n((l) => l.settingBooked),
        closing: n((l) => l.closingBooked),
        won: n((l) => l.won || l.pipelineStage === "Gewonnen"),
        lost: n((l) => l.lost || l.pipelineStage === "Verloren"),
      };
      // --- Outreach-Funnel v2 (17.07.): Vernetzungsquote + Zielgruppen-A/B — ersetzt das Google-Sheet ---
      funnel.contactedUnique = new Set(leads.filter((l) => l.contacted).map((l) => String(l.name || l.url || "").toLowerCase().trim())).size;
      const ZG = (l) => { const c = String(l.category || "").toLowerCase(); if (c === "agentur") return "Agentur"; if (c === "dienstleister") return "Dienstleister"; if (c === "makler" || /immobilien|kapitalanlage|projekt/.test(c)) return "Makler"; return "Sonstige"; };
      const isInMail = (l) => String(l.status || "") === "InMail" || String(l.pipelineStage || "") === "InMail";
      const wasInvited = (l) => !isInMail(l) && !!(String(l.status || "").startsWith("Vernetz") || l.vernetzungAngenommenAm || l.kontaktiertAm || l.contacted || l.replied || l.settingBooked);
      const wasAccepted = (l) => !isInMail(l) && !!(l.vernetzungAngenommenAm || String(l.status || "") === "Vernetzung angenommen" || l.kontaktiertAm || l.contacted);
      const zielgruppen = {};
      for (const g of ["Makler", "Agentur", "Dienstleister", "Sonstige"]) zielgruppen[g] = { invites: 0, angenommen: 0, kontaktiert: 0, geantwortet: 0, inmails: 0 };
      for (const l of leads) { const g = zielgruppen[ZG(l)]; if (!g) continue; if (isInMail(l)) { g.inmails++; continue; } if (wasInvited(l)) g.invites++; if (wasAccepted(l)) g.angenommen++; if (l.contacted || l.kontaktiertAm) g.kontaktiert++; if (l.replied) g.geantwortet++; }
      // Aktivitäts-Wahrheit aus stats.json (alle Agents): Invites raus vs. angenommen (gesamt + 14 Tage)
      const vernetzung = { invites: 0, angenommen: 0, invites14: 0, angenommen14: 0 };
      try {
        const cut = new Date(Date.now() - 14 * 86400000).toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 10);
        for (const id of fs.readdirSync(AGENTS)) {
          let st; try { st = JSON.parse(fs.readFileSync(path.join(AGENTS, id, "stats.json"), "utf8")); } catch { continue; }
          for (const [date, s] of Object.entries(st)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !s || typeof s !== "object") continue;
            const v = +s.vernetzt || 0, g = +s.gesynct || 0;
            vernetzung.invites += v; vernetzung.angenommen += g;
            if (date >= cut) { vernetzung.invites14 += v; vernetzung.angenommen14 += g; }
          }
        }
      } catch {}
      const mon = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 7);
      const sum = (arr) => arr.reduce((s, x) => s + (+x.betrag || 0), 0);
      const umsatz = {
        monat: mon,
        bezahlt: sum(inv.filter((x) => x.status === "bezahlt" && String(x.bezahltAm || x.datum || "").startsWith(mon))),
        gesamtBezahlt: sum(inv.filter((x) => x.status === "bezahlt")),
        fakturiert: sum(inv.filter((x) => String(x.datum || "").startsWith(mon))),
        offen: sum(inv.filter((x) => x.status !== "bezahlt")),
      };
      const projekte = {
        aktiv: projs.filter((p) => (p.stage || "") !== "Backlog" && (p.stage || "") !== "Abgeschlossen").length,
        wert: projs.reduce((s, p) => s + (+p.wert || 0), 0),
      };
      return send(res, 200, "application/json", JSON.stringify({ ok: true, funnel, umsatz, projekte, vernetzung, zielgruppen }));
    } catch (e) { return send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
  }
  if (u.pathname === "/api/agent-asset") {
    const s = path.normalize(u.searchParams.get("path") || "").replace(/^(\.\.[/\\])+/, ""); const f = path.join(AGENTS, s);
    const ext = path.extname(f).slice(1).toLowerCase(); const ty = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[ext];
    if (!f.startsWith(AGENTS) || !ty || !fs.existsSync(f)) return send(res, 404, "text/plain", "nf");
    res.writeHead(200, { "Content-Type": ty }); return fs.createReadStream(f).pipe(res);
  }
  if (u.pathname === "/api/content-thumb") {
    const base = path.join(__dirname, "data", "content-thumbs");
    const s = path.basename(path.normalize(u.searchParams.get("f") || "")); const f = path.join(base, s);
    const ext = path.extname(f).slice(1).toLowerCase(); const ty = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[ext];
    if (!f.startsWith(base) || !ty || !fs.existsSync(f)) return send(res, 404, "text/plain", "nf");
    res.writeHead(200, { "Content-Type": ty, "Cache-Control": "public, max-age=604800" }); return fs.createReadStream(f).pipe(res);
  }
  if (u.pathname === "/api/agent-console" && req.method === "GET") {
    const id = (u.searchParams.get("agent") || "").replace(/[^a-zA-Z0-9_-]/g, "");
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("data: " + JSON.stringify({ type: "ready" }) + "\n\n");
    if (!AC[id]) acStart(id);
    if (AC[id]) { const s = AC[id]; if (s.log && s.log.length) { for (const m of s.log) { try { res.write("data: " + JSON.stringify(m) + "\n\n"); } catch {} } } s.sse = res; }
    req.on("close", () => { if (AC[id] && AC[id].sse === res) AC[id].sse = null; });
    return;
  }
  if (u.pathname === "/api/agent-console-send" && req.method === "POST") {
    return readBody(req, (b) => {
      const id = String(b.agent || "").replace(/[^a-zA-Z0-9_-]/g, "");
      // Stop heißt Stop: pausierter Agent nimmt KEINE neuen Aufträge an (blockt auch daily-run/watchdog serverseitig).
      if (isPaused(id)) return send(res, 200, "application/json", JSON.stringify({ ok: false, error: "paused" }));
      const ok = acSend(id, String(b.msg || "")); send(res, 200, "application/json", JSON.stringify({ ok }));
    });
  }
  if (u.pathname === "/api/agent-today-log") {
    const id = (u.searchParams.get("agent") || "").replace(/[^a-zA-Z0-9_-]/g, "");
    const file = path.join(AGENTS, id, "runs", ".live-" + dayStamp() + ".jsonl");
    let events = [];
    try { events = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch {}
    return send(res, 200, "application/json", JSON.stringify({ events }));
  }
  if (u.pathname === "/api/agent-console-stop" && req.method === "POST") {
    return readBody(req, (b) => { acStop(String(b.agent || "").replace(/[^a-zA-Z0-9_-]/g, "")); send(res, 200, "application/json", JSON.stringify({ ok: true })); });
  }
  if (u.pathname === "/api/agent-pause" && req.method === "POST") {
    return readBody(req, (b) => { const id = String(b.agent || "").replace(/[^a-zA-Z0-9_-]/g, ""); if (!id) return send(res, 400, "application/json", JSON.stringify({ ok: false })); acPause(id); send(res, 200, "application/json", JSON.stringify({ ok: true, paused: true })); });
  }
  if (u.pathname === "/api/agent-resume" && req.method === "POST") {
    return readBody(req, (b) => { const id = String(b.agent || "").replace(/[^a-zA-Z0-9_-]/g, ""); if (!id) return send(res, 400, "application/json", JSON.stringify({ ok: false })); acResume(id); send(res, 200, "application/json", JSON.stringify({ ok: true, paused: false })); });
  }
  if (u.pathname === "/api/meeting-mode" && req.method === "POST") {
    return readBody(req, (b) => { const r = b && b.on ? meetingModeOn(b && b.source || "") : meetingModeOff(); send(res, 200, "application/json", JSON.stringify({ ok: true, ...r })); });
  }
  if (u.pathname === "/api/meeting-mode" && req.method === "GET") {
    return send(res, 200, "application/json", JSON.stringify({ ok: true, ...meetingModeStatus() }));
  }
  if (u.pathname === "/api/agent-run") {
    const id = (u.searchParams.get("agent") || "").replace(/[^a-zA-Z0-9_-]/g, "");
    const run = (u.searchParams.get("run") || "").replace(/[^a-zA-Z0-9_.\- ]/g, "");
    const f = path.join(AGENTS, id, "runs", run);
    if (!f.startsWith(AGENTS) || !f.endsWith(".md") || !fs.existsSync(f)) return send(res, 404, "application/json", "{}");
    return send(res, 200, "application/json", JSON.stringify({ content: fs.readFileSync(f, "utf8") }));
  }
  if (u.pathname === "/api/agent-config" && req.method === "POST") {
    return readBody(req, (b) => {
      const dir = String(b.id || "").replace(/[^a-zA-Z0-9_-]/g, ""); const f = path.join(AGENTS, dir, "config.json");
      if (!dir || !f.startsWith(AGENTS)) return send(res, 400, "application/json", JSON.stringify({ ok: false }));
      try { writeJsonAtomic(f, b.config || {}, 2); send(res, 200, "application/json", JSON.stringify({ ok: true })); }
      catch (e) { send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); }
    });
  }
  if (u.pathname === "/api/agent-save" && req.method === "POST") {
    return readBody(req, (b) => { const file = safeAgentFile(b.path); if (!file) return send(res, 400, "application/json", JSON.stringify({ ok: false }));
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, String(b.markdown ?? "")); send(res, 200, "application/json", JSON.stringify({ ok: true })); }
      catch (e) { send(res, 500, "application/json", JSON.stringify({ ok: false, error: String(e) })); } });
  }
  if (u.pathname === "/api/jarvis" && req.method === "POST") {
    return readBody(req, (b) => {
      const claude = findClaude();
      if (!claude) return send(res, 200, "application/json", JSON.stringify({ reply: "⚠️ `claude` CLI nicht gefunden. Neu starten mit: CLAUDE_BIN=$(which claude) node dashboard/server.js" }));
      const child = spawn(claude, ["-p", b.prompt || "", "--permission-mode", "acceptEdits"], { cwd: ROOT });
      // Gleiche 30-Min-Grenze wie der Copilot-Turn-Timeout (s.o.) — Notiz-Anlage/Quick-Edit
      // kann auch mal ein langer Brain-Dump sein.
      let out = "", err = ""; const t = setTimeout(() => child.kill(), 1800000);
      child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
      child.on("close", () => { clearTimeout(t); send(res, 200, "application/json", JSON.stringify({ reply: out.trim() || err.trim() || "(keine Antwort)" })); });
    });
  }
  if (u.pathname === "/api/speak" && req.method === "POST") {
    return readBody(req, (b) => {
      const key = elevenKey(); if (!key) return send(res, 500, "application/json", JSON.stringify({ error: "no key" }));
      const payload = JSON.stringify({ text: (b.text || "").slice(0, 900), model_id: "eleven_flash_v2_5" });
      const rr = https.request("https://api.elevenlabs.io/v1/text-to-speech/" + VOICE_ID,
        { method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json", accept: "audio/mpeg" } },
        (pr) => { res.writeHead(pr.statusCode === 200 ? 200 : 502, { "Content-Type": pr.statusCode === 200 ? "audio/mpeg" : "application/json" }); pr.pipe(res); });
      rr.on("error", () => send(res, 502, "application/json", "{}")); rr.write(payload); rr.end();
    });
  }
  if (u.pathname === "/api/jarvis-stop" && req.method === "POST") {
    const ok = cpAbort(); return send(res, 200, "application/json", JSON.stringify({ ok }));
  }
  if (u.pathname === "/api/jarvis-stream" && req.method === "POST") {
    // POST statt GET: großer Knowledge-Dump sprengt sonst das URL-Limit → Request hängt still.
    return readBody(req, (b) => {
      const prompt = String(b.prompt || "");
      const attachments = Array.isArray(b.attachments) ? b.attachments : [];
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      // closed an res hängen (nicht req): bei POST feuert req 'close' schon nach dem Body-Lesen.
      let closed = false; res.on("close", () => { closed = true; });
      cpAsk(prompt, (evt) => { if (!closed) res.write("data: " + JSON.stringify(evt) + "\n\n"); }, () => { if (!closed) { res.write("data: [DONE]\n\n"); res.end(); } }, attachments);
    });
  }
  if (u.pathname === "/api/jarvis-model" && req.method === "POST") {
    return readBody(req, (b) => { const m = String(b.model || "").trim(); if (m) { CPMODEL = m; try { if (CP) CP.kill(); } catch {} CP = null; } send(res, 200, "application/json", JSON.stringify({ ok: true, model: CPMODEL })); });
  }
  if (u.pathname === "/api/streak") {
    const p = path.join(ROOT, "dashboard", "data", "streak.json");
    const berlinDay = (ms) => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    const today = berlinDay(Date.now());
    const yest = berlinDay(Date.now() - 86400000);
    const monday = (() => { let ms = Date.now(); while (new Date(ms).toLocaleDateString("en-US", { timeZone: "Europe/Berlin", weekday: "short" }) !== "Mon") ms -= 86400000; return berlinDay(ms); })();
    let s = { lastActiveDay: "", day: today, touchesToday: 0, week: monday, meetingsWeek: 0 };
    try { if (fs.existsSync(p)) s = Object.assign(s, JSON.parse(fs.readFileSync(p, "utf8"))); } catch {}
    if (s.day !== today) { s.day = today; s.touchesToday = 0; }
    if (s.week !== monday) { s.week = monday; s.meetingsWeek = 0; }
    const persist = () => { try { writeJsonAtomic(p, s, 2); } catch {} };
    // Automatik: Outreach-Agent-Stats (agents/<id>/stats.json) zählen als Touches — kein manuelles Klicken nötig.
    const autoByDay = {};
    try {
      for (const id of fs.readdirSync(AGENTS)) {
        let obj; try { obj = JSON.parse(fs.readFileSync(path.join(AGENTS, id, "stats.json"), "utf8")); } catch { continue; }
        for (const [date, st] of Object.entries(obj)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !st || typeof st !== "object") continue;
          autoByDay[date] = (autoByDay[date] || 0) + (+st.vernetzt || 0) + (+st.erstnachrichten || 0) + (+st.inmails || 0) + (+st.followups || 0);
        }
      }
    } catch {}
    const activeOn = (d) => (autoByDay[d] || 0) > 0 || s.lastActiveDay === d || (d === today && (s.touchesToday || 0) > 0);
    const compute = () => {
      let streak = 0, cur = activeOn(today) ? today : yest;
      while (activeOn(cur) && streak < 3650) { streak++; cur = new Date(new Date(cur + "T12:00:00Z").getTime() - 86400000).toISOString().slice(0, 10); }
      return { ...s, streak, autoToday: autoByDay[today] || 0, touchesToday: (autoByDay[today] || 0) + (s.touchesToday || 0) };
    };
    if (req.method === "POST") {
      return readBody(req, (b) => {
        if (b.action === "touch") { s.touchesToday = (s.touchesToday || 0) + 1; s.lastActiveDay = today; }
        else if (b.action === "meeting") { s.meetingsWeek = (s.meetingsWeek || 0) + 1; }
        persist(); send(res, 200, "application/json", JSON.stringify(compute()));
      });
    }
    persist(); return send(res, 200, "application/json", JSON.stringify(compute()));
  }
  if (u.pathname === "/api/invoices") {
    const p = path.join(ROOT, "dashboard", "data", "invoices.json");
    const load = () => { try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")); } catch {} return { invoices: [] }; };
    if (req.method === "POST") {
      return readBody(req, (b) => {
        const data = { invoices: Array.isArray(b.invoices) ? b.invoices : [] };
        try { fs.mkdirSync(path.dirname(p), { recursive: true }); writeJsonAtomic(p, data, 2); } catch {}
        send(res, 200, "application/json", JSON.stringify(data));
      });
    }
    return send(res, 200, "application/json", JSON.stringify(load()));
  }
  if (u.pathname === "/api/expenses") {
    const p = path.join(ROOT, "dashboard", "data", "expenses.json");
    const load = () => { try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")); } catch {} return { expenses: [] }; };
    if (req.method === "POST") {
      return readBody(req, (b) => {
        const data = { expenses: Array.isArray(b.expenses) ? b.expenses : [] };
        try { fs.mkdirSync(path.dirname(p), { recursive: true }); writeJsonAtomic(p, data, 2); } catch {}
        send(res, 200, "application/json", JSON.stringify(data));
      });
    }
    return send(res, 200, "application/json", JSON.stringify(load()));
  }
  if (u.pathname === "/api/gocardless/status") {
    const s = gcState(), configured = !!(envVal("GOCARDLESS_SECRET_ID") && envVal("GOCARDLESS_SECRET_KEY"));
    return send(res, 200, "application/json", JSON.stringify({ configured, linked: !!(s.accounts && s.accounts.length), accounts: (s.accounts || []).length, institution: s.institutionName || null, lastSync: s.lastSync || null }));
  }
  if (u.pathname === "/api/gocardless/institutions") {
    (async () => { try {
      const t = await gcToken(); if (!t) return send(res, 200, "application/json", JSON.stringify({ configured: false, institutions: [] }));
      const country = (u.searchParams.get("country") || "de").toLowerCase();
      const r = await fetch(GC_BASE + "/institutions/?country=" + country, { headers: { Authorization: "Bearer " + t } });
      if (!r.ok) throw new Error("Institutions HTTP " + r.status);
      const list = await r.json();
      send(res, 200, "application/json", JSON.stringify({ configured: true, institutions: (list || []).map((i) => ({ id: i.id, name: i.name })) }));
    } catch (e) { send(res, 200, "application/json", JSON.stringify({ configured: true, error: String(e && e.message || e) })); } })();
    return;
  }
  if (u.pathname === "/api/gocardless/connect" && req.method === "POST") {
    return readBody(req, (b) => { (async () => { try {
      const t = await gcToken(); if (!t) return send(res, 200, "application/json", JSON.stringify({ ok: false, error: "nicht konfiguriert" }));
      const inst = String(b.institution_id || "").trim(); if (!inst) return send(res, 200, "application/json", JSON.stringify({ ok: false, error: "institution_id fehlt" }));
      const redirect = "http://localhost:" + PORT + "/api/gocardless/callback";
      const r = await fetch(GC_BASE + "/requisitions/", { method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ institution_id: inst, redirect, reference: "amplify-aios-" + Date.now() }) });
      if (!r.ok) throw new Error("Requisition HTTP " + r.status);
      const j = await r.json(); const s = gcState(); s.requisitionId = j.id; s.institutionId = inst; s.institutionName = b.institution_name || inst; s.accounts = []; gcSaveState(s);
      send(res, 200, "application/json", JSON.stringify({ ok: true, link: j.link }));
    } catch (e) { send(res, 200, "application/json", JSON.stringify({ ok: false, error: String(e && e.message || e) })); } })(); });
  }
  if (u.pathname === "/api/gocardless/callback") {
    (async () => { try {
      const t = await gcToken(), s = gcState();
      if (t && s.requisitionId) { const r = await fetch(GC_BASE + "/requisitions/" + s.requisitionId + "/", { headers: { Authorization: "Bearer " + t } }); if (r.ok) { const j = await r.json(); s.accounts = j.accounts || []; gcSaveState(s); } }
      send(res, 200, "text/html; charset=utf-8", "<html><body style='font-family:sans-serif;background:#0a1420;color:#eaf6ff;padding:40px'><h2>✅ Konto verbunden</h2><p>Tab schließen und im Dashboard „Sync“ klicken.</p><script>setTimeout(function(){location.href='/#finanzen'},1500)</script></body></html>");
    } catch (e) { send(res, 200, "text/html", "Fehler: " + String(e && e.message || e)); } })();
    return;
  }
  if (u.pathname === "/api/gocardless/sync" && req.method === "POST") {
    (async () => { try {
      const t = await gcToken(), s = gcState(); if (!t || !(s.accounts && s.accounts.length)) return send(res, 200, "application/json", JSON.stringify({ ok: false, error: "nicht verbunden" }));
      const imported = [];
      for (const acc of s.accounts) { try {
        const r = await fetch(GC_BASE + "/accounts/" + acc + "/transactions/", { headers: { Authorization: "Bearer " + t } }); if (!r.ok) continue;
        const j = await r.json(); const booked = (j.transactions && j.transactions.booked) || [];
        for (const tx of booked) { const amt = parseFloat(tx.transactionAmount && tx.transactionAmount.amount || 0); if (!amt) continue;
          imported.push({ datum: String(tx.bookingDate || tx.valueDate || "").slice(0, 10), beschreibung: String(tx.remittanceInformationUnstructured || tx.creditorName || tx.debtorName || "—").slice(0, 120), betrag: Math.abs(amt), source: "gocardless" }); }
      } catch {} }
      const p = path.join(ROOT, "dashboard", "data", "expenses.json");
      let cur = { expenses: [] }; try { if (fs.existsSync(p)) cur = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
      const manual = (cur.expenses || []).filter((e) => e.source !== "gocardless");
      const all = manual.concat(imported);
      writeJsonAtomic(p, { expenses: all }, 2);
      s.lastSync = new Date().toISOString(); gcSaveState(s);
      send(res, 200, "application/json", JSON.stringify({ ok: true, imported: imported.length, total: all.length }));
    } catch (e) { send(res, 200, "application/json", JSON.stringify({ ok: false, error: String(e && e.message || e) })); } })();
    return;
  }
  if (u.pathname === "/api/wise") {
    const token = envVal("WISE_API_TOKEN");
    if (!token) return send(res, 200, "application/json", JSON.stringify({ connected: false, reason: "kein Token (WISE_API_TOKEN in .env)" }));
    const base = "https://api.transferwise.com", H = { Authorization: "Bearer " + token };
    (async () => {
      try {
        const pr = await fetch(base + "/v1/profiles", { headers: H });
        if (!pr.ok) throw new Error("Profiles HTTP " + pr.status);
        const profiles = await pr.json(), out = [];
        for (const p of profiles) {
          let balances = [];
          try {
            const br = await fetch(base + "/v4/profiles/" + p.id + "/balances?types=STANDARD", { headers: H });
            if (br.ok) balances = (await br.json() || []).map((b) => ({ currency: b.amount && b.amount.currency, value: b.amount && b.amount.value }));
          } catch {}
          out.push({ type: p.type, id: p.id, balances });
        }
        send(res, 200, "application/json", JSON.stringify({ connected: true, profiles: out }));
      } catch (e) { send(res, 200, "application/json", JSON.stringify({ connected: false, error: String(e && e.message || e) })); }
    })();
    return;
  }
  if (u.pathname === "/api/wise/transactions") {
    const token = envVal("WISE_API_TOKEN");
    if (!token) return send(res, 200, "application/json", JSON.stringify({ connected: false, transactions: [] }));
    const days = Math.min(parseInt(u.searchParams.get("days") || "90", 10) || 90, 366);
    const base = "https://api.transferwise.com", H = { Authorization: "Bearer " + token };
    const end = new Date(), start = new Date(Date.now() - days * 86400000);
    (async () => { try {
      const pr = await fetch(base + "/v1/profiles", { headers: H }); if (!pr.ok) throw new Error("Profiles HTTP " + pr.status);
      const profiles = await pr.json(), out = [];
      for (const p of profiles) {
        let bals = []; try { const br = await fetch(base + "/v4/profiles/" + p.id + "/balances?types=STANDARD", { headers: H }); if (br.ok) bals = await br.json(); } catch {}
        for (const bal of bals) {
          const cur = bal.amount && bal.amount.currency; if (!cur || !bal.id) continue;
          const url = base + "/v1/profiles/" + p.id + "/balance-statements/" + bal.id + "/statement.json?currency=" + cur + "&intervalStart=" + start.toISOString() + "&intervalEnd=" + end.toISOString() + "&type=COMPACT";
          try { const r = await wiseFetch(url, H); if (!r.ok) continue; const d = await r.json();
            for (const t of (d.transactions || [])) { const val = t.amount && t.amount.value; if (val == null) continue;
              const desc = String(t.details && t.details.description || "");
              if (t.type !== "CREDIT" && /american express|amex\b/i.test(desc)) continue; // interne Umbuchung / Amex-Rechnung raus
              out.push({ datum: String(t.date || "").slice(0, 10), betrag: Math.abs(val), typ: (t.type === "CREDIT" ? "in" : "out"), waehrung: t.amount.currency, konto: p.type, beschreibung: desc.slice(0, 120) });
            }
          } catch {}
        }
      }
      out.sort((a, b) => String(b.datum).localeCompare(String(a.datum)));
      send(res, 200, "application/json", JSON.stringify({ connected: true, days, transactions: out }));
    } catch (e) { send(res, 200, "application/json", JSON.stringify({ connected: false, error: String(e && e.message || e) })); } })();
    return;
  }
  if (u.pathname === "/api/amex/scan" && req.method === "POST") {
    const dir = path.join(ROOT, "dashboard", "data", "amex");
    let all = [], files = 0;
    try { for (const f of fs.readdirSync(dir)) { if (!/\.csv$/i.test(f)) continue; files++;
      try { all = all.concat(parseAmexCsvNode(fs.readFileSync(path.join(dir, f), "utf8"))); } catch {} } } catch {}
    const seen = {}, uniq = []; for (const e of all) { const k = e.datum + "|" + e.beschreibung + "|" + e.betrag; if (seen[k]) continue; seen[k] = 1; uniq.push(e); }
    const p = path.join(ROOT, "dashboard", "data", "expenses.json");
    try { writeJsonAtomic(p, { expenses: uniq }, 2); } catch {}
    return send(res, 200, "application/json", JSON.stringify({ ok: true, files, imported: uniq.length }));
  }
  if (u.pathname === "/api/wise/scan" && req.method === "POST") {
    const dir = path.join(ROOT, "dashboard", "data", "wise");
    let all = [], files = 0;
    try { for (const f of fs.readdirSync(dir)) { if (!/\.csv$/i.test(f)) continue; files++;
      try { all = all.concat(parseWiseCsvNode(fs.readFileSync(path.join(dir, f), "utf8"))); } catch {} } } catch {}
    const seen = {}, uniq = []; for (const e of all) { const k = e.datum + "|" + e.beschreibung + "|" + e.betrag; if (seen[k]) continue; seen[k] = 1; uniq.push(e); }
    const p = path.join(ROOT, "dashboard", "data", "wise-privat.json");
    try { writeJsonAtomic(p, { transactions: uniq }, 2); } catch {}
    return send(res, 200, "application/json", JSON.stringify({ ok: true, files, imported: uniq.length, transactions: uniq }));
  }
  if (u.pathname === "/rechnungstool") {
    try { return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(INVOICE_TOOL)); }
    catch { return send(res, 404, "text/plain", "Rechnungstool nicht gefunden: " + INVOICE_TOOL); }
  }
  // Teleprompter + Video-Aufnahme (Content-Pipeline → Button „🎬 Aufnehmen"); Kamera braucht sicheren
  // Kontext — localhost zählt als sicher, daher hier ausliefern statt file:// öffnen.
  if (u.pathname === "/teleprompter") {
    try { return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(PROMPTER_TOOL)); }
    catch { return send(res, 404, "text/plain", "Teleprompter nicht gefunden: " + PROMPTER_TOOL); }
  }
  // ---- Rechnungsmodul (dashboard/rechnung.js): Kunden, Speichern+PDF+Gmail-Draft, Wise-Abgleich, Reminder ----
  if (u.pathname === "/api/rechnung/kunden") {
    if (req.method === "POST") return readBody(req, (b) => { try { send(res, 200, "application/json", JSON.stringify(rechnung.saveKunden(b.kunden))); } catch (e) { send(res, 200, "application/json", JSON.stringify({ error: String(e.message) })); } });
    return send(res, 200, "application/json", JSON.stringify(rechnung.loadKunden()));
  }
  if (u.pathname === "/api/rechnung/save" && req.method === "POST") {
    return readBody(req, (b) => { rechnung.saveInvoice(b.data, { draft: !!b.draft })
      .then((r) => send(res, 200, "application/json", JSON.stringify(r)))
      .catch((e) => send(res, 200, "application/json", JSON.stringify({ ok: false, error: String(e && e.message || e) }))); });
  }
  if (u.pathname === "/api/rechnung/match" && req.method === "POST") {
    rechnung.matchWise()
      .then((r) => send(res, 200, "application/json", JSON.stringify(r)))
      .catch((e) => send(res, 200, "application/json", JSON.stringify({ matched: [], error: String(e && e.message || e) })));
    return;
  }
  if (u.pathname === "/api/rechnung/reminder" && req.method === "POST") {
    return readBody(req, (b) => { rechnung.manualReminder(String(b.nr || ""))
      .then((r) => send(res, 200, "application/json", JSON.stringify(r)))
      .catch((e) => send(res, 200, "application/json", JSON.stringify({ ok: false, error: String(e && e.message || e) }))); });
  }
  if (u.pathname === "/api/rechnung/auto-reminders" && req.method === "POST") {
    rechnung.autoReminders()
      .then((r) => send(res, 200, "application/json", JSON.stringify(r)))
      .catch((e) => send(res, 200, "application/json", JSON.stringify({ created: [], error: String(e && e.message || e) })));
    return;
  }
  if (u.pathname.startsWith("/rechnungen/")) {
    const name = path.basename(decodeURIComponent(u.pathname.slice("/rechnungen/".length)));
    try { return send(res, 200, "application/pdf", fs.readFileSync(path.join(rechnung.RECH_DIR, name))); }
    catch { return send(res, 404, "text/plain", "PDF nicht gefunden"); }
  }
  if (u.pathname === "/api/search") {
    const q = (u.searchParams.get("q") || "").toLowerCase().trim();
    if (q.length < 2) return send(res, 200, "application/json", JSON.stringify({ results: [] }));
    const all = readAll(); const hits = [];
    for (const n of all) {
      const titleLc = n.title.toLowerCase(); const inTitle = titleLc.includes(q);
      const bodyLc = (n.body || "").toLowerCase(); const inBody = bodyLc.includes(q);
      if (!inTitle && !inBody) continue;
      let snippet = "";
      if (inBody) { const i = bodyLc.indexOf(q); snippet = (n.body || "").slice(Math.max(0, i - 40), i + 70).replace(/\s+/g, " ").trim(); }
      // Relevanz-Rang: exakter Titel > Titel enthält q > nur Body-Treffer
      const rank = titleLc === q ? 0 : inTitle ? 1 : 2;
      hits.push({ rank, rel: n.rel, title: n.title, label: n.label, snippet });
    }
    hits.sort((a, b) => a.rank - b.rank);
    const out = hits.slice(0, 30).map(({ rank, ...r }) => r);
    return send(res, 200, "application/json", JSON.stringify({ results: out }));
  }
  send(res, 404, "text/plain", "not found");
});
server.listen(PORT, "127.0.0.1", () => { console.log(`${BRAND.name} → http://localhost:${PORT}`); setTimeout(() => { try { cpAsk("Bereit.", () => {}, () => {}); } catch {} }, 500); });
wa.startTick(); // WhatsApp-Scheduler: alle 5 Min Outbox/Follow-ups/Nudges (zusätzlich stößt wa-heartbeat.sh /api/wa/tick an)

function PAGE(notes, graph) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${BRAND.name}</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='32'%20height='32'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='6'%20fill='%2303070e'/%3E%3Crect%20x='0.5'%20y='0.5'%20width='31'%20height='31'%20rx='5.5'%20fill='none'%20stroke='%2336e0ff'%20stroke-opacity='0.35'/%3E%3Cpath%20d='M16%206L24%2026H20.5L18.5%2021H13.5L11.5%2026H8L16%206ZM17.5%2018L16%2013.5L14.5%2018H17.5Z'%20fill='%2336e0ff'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/force-graph"></script>
<style>
 :root{--bg:#03070e;--panel:rgba(10,24,42,.55);--line:rgba(54,224,255,.20);--txt:#cfe6f5;--muted:#6f88a6;--cyan:#36e0ff;--teal:#3fd0c9;--gold:#ffb547;--red:#ff5f6d;--green:#54e08a}
 *{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:var(--line) transparent} *::-webkit-scrollbar{width:9px;height:9px} *::-webkit-scrollbar-thumb{background:var(--line);border-radius:6px} *::-webkit-scrollbar-thumb:hover{background:var(--cyan)} *::-webkit-scrollbar-track{background:transparent} body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.55 Inter,sans-serif;display:flex;min-height:100vh}
 body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(circle at 50% -10%,rgba(54,224,255,.10),transparent 55%),repeating-linear-gradient(0deg,rgba(54,224,255,.035) 0 1px,transparent 1px 38px),repeating-linear-gradient(90deg,rgba(54,224,255,.035) 0 1px,transparent 1px 38px)}
 aside,main{position:relative;z-index:1}
 aside{width:236px;flex-shrink:0;background:linear-gradient(180deg,rgba(8,19,32,.9),rgba(4,10,18,.9));border-right:1px solid var(--line);padding:18px 12px;position:sticky;top:0;height:100vh;overflow:auto}
 .brand{display:flex;align-items:center;gap:10px;padding:2px 8px 18px} .brand b{font-family:Orbitron;letter-spacing:3px;font-size:16px;color:#eaf6ff} .brand .aios{color:var(--cyan);text-shadow:0 0 10px rgba(54,224,255,.5)}
 /* Meeting-/Fokus-Modus-Schalter ganz oben: pausiert Outreach & Hintergrund-Jobs, gibt dem Rechner die Leistung fürs Aufnehmen zurück. Klick = an/aus. */
 .mmbtn{display:flex;align-items:center;gap:8px;width:100%;justify-content:center;margin:0 0 14px;padding:9px 10px;border-radius:9px;border:1px solid var(--line);background:rgba(54,224,255,.08);color:var(--cyan);font:700 12px Rajdhani;letter-spacing:.6px;cursor:pointer;transition:.15s} .mmbtn:hover{filter:brightness(1.12);border-color:var(--cyan)}
 .mmbtn.on{background:rgba(255,181,71,.15);border-color:var(--gold);color:var(--gold);box-shadow:0 0 16px rgba(255,181,71,.25);animation:mmpulse 2s ease-in-out infinite} @keyframes mmpulse{0%,100%{box-shadow:0 0 10px rgba(255,181,71,.18)}50%{box-shadow:0 0 22px rgba(255,181,71,.4)}}
 .mmsub{font:600 9.5px Rajdhani;letter-spacing:.5px;color:var(--muted);text-align:center;margin:-9px 0 14px;display:none} .mmsub.on{display:block;color:var(--gold)}
 .pip{width:12px;height:12px;border-radius:50%;background:var(--cyan);box-shadow:0 0 14px var(--cyan);animation:breathe 3s ease-in-out infinite}
 .grp{color:var(--muted);font:600 10px/1 Rajdhani;letter-spacing:2px;margin:16px 8px 6px;text-transform:uppercase}
 .nav{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:8px;cursor:pointer;font-size:14px;color:var(--txt);border:1px solid transparent} .nav:hover{background:rgba(54,224,255,.06)} .nav.active{background:rgba(54,224,255,.10);border-color:var(--line);color:var(--cyan)} .nav small{color:var(--muted);font-size:10px;margin-left:auto}
 .navbadge{margin-left:auto;background:#ff4d5e;color:#fff;border-radius:9px;font-size:10px;font-weight:700;padding:1px 6px;min-width:16px;text-align:center}
 .akdetail{margin:-4px 0 10px 34px;padding:10px 12px;border:1px solid var(--line);border-left:2px solid var(--cyan);border-radius:8px;background:rgba(3,18,30,.5);font-size:12.5px}
 .cpcal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px} .cpcalhd{font:700 10px Rajdhani;letter-spacing:1px;color:var(--muted);text-align:center;padding:2px 0}
 .cpcald{min-height:74px;border:1px solid var(--line);border-radius:8px;background:rgba(3,18,30,.45);padding:4px;font-size:11px} .cpcald.off{visibility:hidden} .cpcald.today{border-color:var(--cyan)}
 .cpcaldn{color:var(--muted);font-size:10px} .cpcalit{margin-top:3px;padding:2px 5px;border:1px solid var(--line);border-radius:5px;background:rgba(54,224,255,.07);color:#cfe6f5;cursor:grab;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .cpcalit:hover{border-color:var(--cyan)}
 .cpcald.dragover{border-color:var(--cyan);background:rgba(63,208,201,.10)}
 .cpcalpool{margin-top:12px;padding:8px 10px;border:1px dashed var(--line);border-radius:8px;min-height:34px} .cpcalpool .cpcalit{display:inline-block;margin:2px 4px 0 0} .cpcalpool.dragover{border-color:var(--cyan);background:rgba(63,208,201,.08)}
 #cp-modal-box input,#cp-modal-box textarea{background:rgba(3,18,30,.7);border:1px solid var(--line);border-radius:8px;color:#eaf6ff;padding:8px;font:13px/1.5 'Segoe UI',sans-serif} #cp-modal-box textarea{resize:vertical}
 main{flex:1;min-width:0} .view{display:none;padding:20px 26px} .view.active{display:block}
 .vh{display:flex;align-items:center;gap:12px} h2.t{margin:0;font:700 22px/1 Rajdhani;letter-spacing:1px;text-transform:uppercase} .pop{background:rgba(54,224,255,.08);color:var(--cyan);border:1px solid var(--line);border-radius:8px;padding:4px 10px;font:600 12px Rajdhani;letter-spacing:.5px;cursor:pointer} .sub{color:var(--muted);font-size:13px;margin:4px 0 18px}
 .panel,.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:15px;position:relative;}
 .panel::before,.card::before{content:"";position:absolute;top:-1px;left:-1px;width:14px;height:14px;border-top:2px solid var(--cyan);border-left:2px solid var(--cyan);border-top-left-radius:10px;opacity:.7}
 .panel::after,.card::after{content:"";position:absolute;bottom:-1px;right:-1px;width:14px;height:14px;border-bottom:2px solid var(--cyan);border-right:2px solid var(--cyan);border-bottom-right-radius:10px;opacity:.7}
 .card h3{margin:0 0 9px;font:600 12px Rajdhani;text-transform:uppercase;letter-spacing:1.5px;color:var(--cyan)}
 .note{padding:5px 8px;border-radius:7px;cursor:pointer;display:flex;justify-content:space-between;gap:8px} .note:hover{background:rgba(54,224,255,.07)} .note small{color:var(--muted);white-space:nowrap}
 .scdel{background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;line-height:1;padding:0 2px;margin-left:6px;opacity:.5;transition:.15s} .scdel:hover{opacity:1;color:var(--red)}
 #viewer h1{font-family:Rajdhani;font-size:20px;color:var(--cyan)} #viewer a{color:var(--gold);cursor:pointer} #viewer table{border-collapse:collapse;width:100%;margin:8px 0} #viewer td,#viewer th{border:1px solid var(--line);padding:4px 7px;font-size:13px} #viewer code{background:rgba(54,224,255,.1);padding:1px 5px;border-radius:4px}
 /* Sales-Copilot-Notiz-Viewer: Transkript lesbar: Zeit+Sprecher (fett) als Label links, Absatz pro Sprecher-Block */
 #sc-viewer{line-height:1.65;font-size:13.5px} #sc-viewer p{margin:0 0 9px} #sc-viewer strong{color:var(--cyan);font-weight:600;white-space:nowrap} #sc-viewer h1,#sc-viewer h2{font-family:Rajdhani;color:var(--cyan);letter-spacing:.5px} #sc-viewer h2{font-size:16px;margin:16px 0 8px} #sc-viewer a{color:var(--gold);cursor:pointer}
 textarea{width:100%;background:rgba(3,12,22,.7);color:var(--txt);border:1px solid var(--line);border-radius:9px;padding:9px;resize:vertical;font:13px ui-monospace,monospace}
 button{background:linear-gradient(180deg,var(--cyan),#1aa6c7);color:#02141d;border:0;border-radius:8px;padding:8px 15px;font:600 13px Rajdhani;letter-spacing:.5px;cursor:pointer;margin:9px 8px 0 0} button:hover{filter:brightness(1.1)}
 #reply{white-space:pre-wrap;margin-top:10px} .muted{color:var(--muted);font-size:11px;margin-top:6px} .row{display:flex;align-items:center;justify-content:space-between}
 .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:13px} .oa-tbl{width:100%;border-collapse:collapse;font-size:14px} .oa-tbl th,.oa-tbl td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line)} .oa-tbl th{color:var(--muted);font-weight:600;font-size:12px} .oa-tbl td{font-variant-numeric:tabular-nums} .oa-tbl td:first-child{white-space:nowrap} .oa-tbl tbody tr:hover{background:rgba(54,224,255,.05)} .oa-rbtn{background:var(--panel);border:1px solid var(--line);color:var(--muted);border-radius:7px;padding:5px 12px;font-size:12px;cursor:pointer} .oa-rbtn.on{background:rgba(54,224,255,.12);border-color:var(--cyan);color:var(--cyan)} .oa-sum{cursor:pointer;color:var(--muted);font-size:13px} .stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;position:relative;}
 .stat .lbl{color:var(--muted);font:600 11px Rajdhani;letter-spacing:1px;text-transform:uppercase} .stat .big{font:700 30px Orbitron;margin:8px 0;color:#eaf6ff} .stat .chg{font-size:12px} .up{color:var(--green)} .warn{color:var(--red)}
 .ph{display:inline-block;font:600 10px Rajdhani;letter-spacing:1px;color:#02141d;background:var(--gold);border-radius:5px;padding:2px 7px;margin-left:8px;vertical-align:middle}
 /* JARVIS Core Orb */
 .core{position:relative;width:200px;height:200px;margin:4px auto 6px} .core div{position:absolute;border-radius:50%}
 .core .ring{inset:0;border:1px solid rgba(54,224,255,.30);box-shadow:inset 0 0 24px rgba(54,224,255,.15)}
 .core .r2{inset:20px;border:1px solid rgba(255,181,71,.40);animation:spin 16s linear infinite}
 .core .r3{inset:44px;border:1px dashed rgba(54,224,255,.55);animation:spin 10s linear infinite reverse}
 .core .glow{inset:68px;background:radial-gradient(circle,#d7f6ff,#36e0ff 42%,#0a3a55 78%);box-shadow:0 0 34px var(--cyan),0 0 80px rgba(54,224,255,.55);animation:breathe 3.4s ease-in-out infinite}
 .core.speaking .glow{animation:wobble .45s ease-in-out infinite}
 @keyframes spin{to{transform:rotate(360deg)}} @keyframes breathe{0%,100%{opacity:.72}50%{opacity:1}}
 @keyframes wobble{0%,100%{transform:scale(1)}25%{transform:scale(1.2)}50%{transform:scale(.92)}75%{transform:scale(1.12)}}
 .hero{text-align:center;margin-bottom:8px} .status{font:600 12px Rajdhani;letter-spacing:2px;color:var(--cyan);text-transform:uppercase}
 #graph{height:54vh;width:100%;background:radial-gradient(circle at 50% 40%,rgba(10,40,66,.6),rgba(3,7,14,.4) 70%);border:1px solid var(--line);border-radius:12px;position:relative}
 #graphhint{position:absolute;top:10px;left:14px;color:var(--muted);font-size:12px;pointer-events:none}
 .cols{display:grid;grid-template-columns:280px 1fr;gap:14px;margin-top:14px} .col{display:flex;flex-direction:column;gap:12px}
 #legend{display:flex;flex-wrap:wrap;gap:14px;margin:10px 0;font-size:12px;color:var(--muted)}
 .funnel{display:flex;flex-direction:column;gap:6px;margin-top:8px} .fbar{background:rgba(3,18,30,.7);border:1px solid var(--line);border-radius:8px;overflow:hidden;position:relative;height:32px} .fbar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#1c6f6a,var(--cyan));opacity:.5} .fbar span{position:absolute;left:11px;top:6px;font:600 13px Rajdhani;letter-spacing:.5px}
 .stub{color:var(--muted);border:1px dashed var(--line);border-radius:12px;padding:46px;text-align:center;font-family:Rajdhani;letter-spacing:1px}
 .tdadd{display:flex;gap:9px;margin-bottom:16px} .tdadd input{flex:1;background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:10px;color:var(--txt);padding:10px 13px;font:14px Inter} .tdadd input:focus{outline:none;border-color:var(--cyan)} .tdadd select{background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:10px;color:var(--txt);padding:0 10px;font:12px Inter;cursor:pointer;max-width:230px}
 .tdfile{margin-bottom:22px} .tdfile>h3{font:700 14px Rajdhani;letter-spacing:1px;text-transform:uppercase;color:var(--cyan);margin:0 0 8px;border-bottom:1px solid var(--line);padding-bottom:6px}
 .tdsec{font:600 12px Rajdhani;letter-spacing:.5px;color:var(--muted);margin:13px 0 5px}
 .tddone{margin-top:8px} .tddone>summary{cursor:pointer;font:600 12px Rajdhani;letter-spacing:.5px;color:var(--muted);list-style:none;user-select:none} .tddone>summary::-webkit-details-marker{display:none} .tddone>summary::before{content:'▸ ';display:inline-block} .tddone[open]>summary::before{content:'▾ '} .tddone .tditem{opacity:.7}
 .tditem{display:flex;align-items:flex-start;gap:9px;padding:6px 9px;border-radius:8px;cursor:pointer;border:1px solid transparent} .tditem:hover{background:rgba(54,224,255,.05)} .tditem.ind{margin-left:22px}
 .tditem .box{width:17px;height:17px;border-radius:5px;border:1.5px solid var(--line);flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--green)} .tditem.done .box{background:rgba(84,224,138,.15);border-color:var(--green)}
 .tditem .txt{font-size:14px;line-height:1.45;flex:1} .tditem.done .txt{color:var(--muted);text-decoration:line-through}
 .tdrole{flex-shrink:0;font:600 11px Inter;padding:1px 8px;border-radius:999px;border:1px solid;background:rgba(3,12,22,.5);white-space:nowrap;margin-top:1px}
 .tditem .tddel{flex-shrink:0;opacity:0;color:var(--muted);font-size:13px;line-height:1;padding:0 3px;margin-top:1px;cursor:pointer;transition:.12s} .tditem:hover .tddel{opacity:.5} .tditem .tddel:hover{color:#ff6b6b;opacity:1}
 .tdfilter{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
 .tdproj{background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:999px;color:var(--txt);padding:5px 12px;font:600 12px Inter;cursor:pointer;max-width:340px;margin-left:auto}
 .tdfbtn{background:rgba(3,12,22,.6);border:1px solid var(--line);border-radius:999px;color:var(--muted);padding:5px 12px;font:600 12px Inter;cursor:pointer;display:flex;align-items:center;gap:5px;transition:.12s} .tdfbtn:hover{border-color:var(--cyan);color:var(--txt)} .tdfbtn.on{background:rgba(54,224,255,.14);border-color:var(--cyan);color:var(--txt)} .tdfbtn .n{opacity:.7;font-size:11px}
 .invadd{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px} .invadd input{background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:9px;color:var(--txt);padding:8px 11px;font:13px Inter} .invadd input:focus{outline:none;border-color:var(--cyan)} .invadd input#iv-kunde{flex:1;min-width:150px} .invadd button{background:var(--cyan);color:#012;border:none;border-radius:9px;padding:8px 15px;font:700 13px Inter;cursor:pointer}
 .invtbl{width:100%;border-collapse:collapse} .invtbl th{text-align:left;font:600 11px Rajdhani;letter-spacing:.5px;color:var(--muted);text-transform:uppercase;padding:6px 8px;border-bottom:1px solid var(--line)} .invtbl td{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.05)} .invtbl tr:hover td{background:rgba(54,224,255,.04)}
 .ivpill{padding:2px 10px;border-radius:999px;font:600 11px Inter;border:1px solid;cursor:pointer;white-space:nowrap} .ivp-offen{color:#ffb547;border-color:#ffb54755} .ivp-bezahlt{color:var(--green);border-color:var(--green)} .ivp-ueberfaellig{color:#ff6b6b;border-color:#ff6b6b55}
 .ivdel{background:none;border:none;color:#cc4444;cursor:pointer;font-size:15px}
 .amexbtn{display:inline-block;background:rgba(54,224,255,.12);border:1px solid var(--cyan);border-radius:9px;color:var(--txt);padding:7px 13px;font:600 12px Inter;cursor:pointer} .amexbtn:hover{background:rgba(54,224,255,.2)}
 .konten{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px} .konto{flex:1;min-width:160px;background:rgba(3,12,22,.5);border:1px solid var(--line);border-radius:10px;padding:10px 12px} .konto .kt{font:600 12px Inter;color:var(--txt);display:flex;align-items:center;gap:7px} .konto .kd{font-size:11px;color:var(--muted);margin-top:4px}
 .kdot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0} .kdot.on{background:var(--green);box-shadow:0 0 6px var(--green)} .kdot.off{background:#ff6b6b}
 .amexmini{background:rgba(54,224,255,.12);border:1px solid var(--cyan);border-radius:7px;color:var(--txt);padding:2px 9px;font:600 10px Inter;cursor:pointer} .amexmini:hover{background:rgba(54,224,255,.22)}
 .trange{display:flex;gap:6px} .rbtn{background:rgba(3,12,22,.6);border:1px solid var(--line);border-radius:999px;color:var(--muted);padding:4px 11px;font:600 11px Inter;cursor:pointer} .rbtn:hover{border-color:var(--cyan);color:var(--txt)} .rbtn.on{background:rgba(54,224,255,.14);border-color:var(--cyan);color:var(--txt)}
 .fdetails{margin-top:6px} .fdetails>summary{cursor:pointer;color:var(--cyan);font:600 12px Inter;padding:6px 0;list-style:none;user-select:none} .fdetails>summary::-webkit-details-marker{display:none} .fdetails>summary::before{content:'▸ ';color:var(--muted)} .fdetails[open]>summary::before{content:'▾ '}
 .agtile.mock{opacity:.62;border-style:dashed;cursor:default} .agava-mock{width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;background:rgba(255,255,255,.05);border:1px solid var(--line);margin:0 auto}
 .agtile.mentor-live{opacity:1;border:1px solid #ffcf6a;cursor:pointer;animation:mentorGlow 2.6s ease-in-out infinite} .agtile.mentor-live:hover{border-color:#ffe0a0;transform:translateY(-3px);box-shadow:0 0 34px rgba(255,190,90,.5)} .agava-mock.live{border-color:#ffcf6a;box-shadow:0 0 16px rgba(255,190,90,.42)} @keyframes mentorGlow{0%,100%{box-shadow:0 0 16px rgba(255,190,90,.2)}50%{box-shadow:0 0 30px rgba(255,190,90,.42)}}
 .brainsearch{margin:8px 0} .brainsearch input{width:100%;background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:10px;color:var(--txt);padding:9px 13px;font:14px Inter} .brainsearch input:focus{outline:none;border-color:var(--cyan)} #bresults{margin-top:6px;max-height:240px;overflow-y:auto} .bresult{padding:7px 10px;border-radius:8px;cursor:pointer;border:1px solid transparent} .bresult:hover{background:rgba(54,224,255,.06);border-color:var(--line)}
 .bkt{padding:0!important;overflow:hidden} .bkt>summary{cursor:pointer;list-style:none;padding:11px 14px;font:700 13px Rajdhani;letter-spacing:.6px;text-transform:uppercase;color:var(--cyan);display:flex;align-items:center;user-select:none} .bkt>summary::-webkit-details-marker{display:none} .bkt>summary::after{content:'▸';margin-left:auto;color:var(--muted);font-size:11px} .bkt[open]>summary::after{content:'▾'} .bktnotes{padding:0 10px 10px}
 #vmode.on{background:var(--red);color:#fff} #vmode.on small{color:#fff}
 #fab{position:fixed;right:22px;bottom:22px;width:56px;height:56px;border-radius:50%;font-size:22px;background:linear-gradient(180deg,var(--cyan),#1aa6c7);color:#02141d;border:0;box-shadow:0 0 24px rgba(54,224,255,.55);cursor:pointer;z-index:7} #fab.on{background:var(--red);color:#fff;animation:breathe 1s infinite}
 #jpop{position:fixed;right:22px;bottom:88px;width:min(420px,80vw);max-height:50vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 15px;display:none;z-index:7;;box-shadow:0 0 40px rgba(0,0,0,.5)}
 #v-copilot.active{display:flex;flex-direction:column;height:100vh}
 .cpwrap{flex:1;min-height:0;display:flex;gap:14px}
 #chathist{width:212px;flex-shrink:0;overflow:auto;display:flex;flex-direction:column;gap:5px;border-right:1px solid var(--line);padding-right:10px}
 .newchat{margin:0 0 6px;width:100%;background:rgba(54,224,255,.10);color:var(--cyan);border:1px solid var(--line);border-radius:9px;padding:9px;font:600 13px Rajdhani;letter-spacing:.5px;cursor:pointer} .newchat:hover{background:rgba(54,224,255,.18)}
 .hchat{display:flex;align-items:center;gap:6px;padding:8px 9px;border-radius:8px;cursor:pointer;border:1px solid transparent;color:var(--txt)} .hchat:hover{background:rgba(54,224,255,.06)} .hchat.on{background:rgba(54,224,255,.12);border-color:var(--line)}
 .hchat .ht{flex:1;min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .hchat .hx{opacity:0;background:none;border:0;color:var(--muted);font-size:16px;line-height:1;padding:0 2px;margin:0;flex-shrink:0;cursor:pointer} .hchat:hover .hx,.hchat.on .hx{opacity:.7} .hchat .hx:hover{color:var(--cyan);opacity:1}
 .cptabs{display:flex;gap:6px;margin-bottom:8px} .cptab{flex:1;background:rgba(3,12,22,.6);border:1px solid var(--line);border-radius:9px;color:var(--muted);padding:7px 4px;font:600 12px Rajdhani;letter-spacing:.5px;cursor:pointer} .cptab.on{background:rgba(54,224,255,.12);border-color:var(--cyan);color:var(--txt)}
 .hbdot{width:9px;height:9px;border-radius:50%;background:var(--cyan);margin-left:auto;flex-shrink:0;box-shadow:0 0 8px var(--cyan);animation:hbpulse 1.1s ease-in-out infinite}
 @keyframes hbpulse{0%,100%{opacity:.35}50%{opacity:1}}
 .hbrun .ht small{color:var(--muted);font-size:11px;margin-right:5px}
 .hbreport{background:rgba(3,12,22,.7);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:10px 0;white-space:pre-wrap;font:13px/1.6 Inter;color:var(--txt)} .hbreport h4{margin:0 0 8px;font:600 14px Rajdhani;letter-spacing:.5px;color:var(--cyan)}
 .hpop{position:fixed;z-index:30;background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:5px;min-width:150px;;box-shadow:0 8px 30px rgba(0,0,0,.5)}
 .hpi{padding:8px 11px;border-radius:7px;font-size:13px;cursor:pointer;color:var(--txt)} .hpi:hover{background:rgba(54,224,255,.1)} .hpi.del:hover{background:rgba(255,95,109,.15);color:var(--red)}
 .cpmain{flex:1;min-width:0;display:flex;flex-direction:column}
 #chatlog{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;margin-bottom:8px}
 .msg{max-width:82%;padding:10px 13px;border-radius:12px;font-size:14px;line-height:1.5} .msg.u{align-self:flex-end;background:rgba(54,224,255,.12);border:1px solid var(--line);white-space:pre-wrap;word-break:break-word} .msg.j{align-self:flex-start;background:var(--panel);border:1px solid var(--line)} .msg.j a{color:var(--gold);cursor:pointer}
 .msg.sys{align-self:stretch;max-width:100%;background:rgba(255,181,71,.07);border:1px dashed var(--line);font-size:13px} .msg.sys b{color:var(--gold);font:600 11px Rajdhani;letter-spacing:.5px;display:block;margin-bottom:5px}
 #ctxbar{display:flex;align-items:center;gap:10px;margin-bottom:8px;font:600 11px Rajdhani;letter-spacing:.5px;color:var(--muted)} #ctxbar .bar{flex:1;height:6px;border-radius:4px;background:rgba(54,224,255,.1);overflow:hidden} #ctxbar .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--teal),var(--cyan));transition:width .3s} #ctxbar.warn{color:var(--gold)} #ctxbar.warn .bar i{background:linear-gradient(90deg,var(--gold),var(--red))} #ctxbar button{background:rgba(54,224,255,.1);color:var(--cyan);border:1px solid var(--line);border-radius:7px;padding:3px 9px;font:600 11px Rajdhani;letter-spacing:.5px;cursor:pointer;flex-shrink:0} #ctxbar button:hover{background:rgba(54,224,255,.2)}
 /* Copilot: Lade-Flimmer + Steps + Gedanken */
 .jthink{display:flex;flex-direction:column;align-items:flex-start;gap:6px} .jthink.done{margin-bottom:6px;opacity:.6} .jthink.done .jload,.jthink.done .jthinktext{display:none}
 .jload{display:inline-block;width:15px;height:15px;border-radius:50%;background:radial-gradient(circle,#bdeeff,#36e0ff 55%,#0a3a55);box-shadow:0 0 12px var(--cyan);animation:jflick .85s ease-in-out infinite;flex-shrink:0}
 @keyframes jflick{0%,100%{transform:scale(.85);opacity:.8}50%{transform:scale(1.35);opacity:1;filter:brightness(1.35)}}
 .jsteps{display:flex;flex-direction:column;align-items:flex-start;gap:5px} .jstep{font:600 11px Rajdhani;letter-spacing:.5px;color:var(--cyan);background:rgba(54,224,255,.1);border:1px solid var(--line);border-radius:6px;padding:3px 9px}
 .jwork{display:none;font:600 11px Rajdhani;letter-spacing:.5px;color:var(--gold);background:rgba(255,181,71,.12);border:1px solid var(--line);border-radius:6px;padding:3px 9px;margin-top:4px} .jwork.on{display:inline-block;animation:jpulse 1.2s ease-in-out infinite} @keyframes jpulse{0%,100%{opacity:.5}50%{opacity:1}}
 .jbar{display:none;position:relative;height:3px;width:170px;border-radius:3px;overflow:hidden;background:rgba(54,224,255,.12);margin-top:6px} .jbar.on{display:block} .jbar::after{content:'';position:absolute;left:-45%;top:0;height:100%;width:45%;background:linear-gradient(90deg,transparent,var(--cyan),transparent);box-shadow:0 0 10px var(--cyan);animation:jslide 1.05s linear infinite} @keyframes jslide{to{left:115%}}
 #cstop{background:var(--red);color:#fff;border:none}
 .jout{font:11px/1.45 ui-monospace,SFMono-Regular,monospace;color:var(--muted);background:rgba(255,255,255,.02);border-left:2px solid rgba(54,224,255,.25);border-radius:4px;padding:4px 8px;align-self:stretch;white-space:pre-wrap;word-break:break-word;opacity:.85;max-height:120px;overflow:auto} .jout.err{border-left-color:var(--red);color:#ffb0b0}
 .jthinktext{flex-basis:100%;font-size:11px;color:var(--muted);font-style:italic;margin-top:5px;line-height:1.5;white-space:pre-wrap;border-left:2px solid rgba(54,224,255,.3);padding-left:9px} .jthinktext:empty{display:none}
 .jans{margin-top:2px} .jans:empty{display:none}
 .segm{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;flex-shrink:0} .segm button{margin:0;border:0;border-radius:0;background:rgba(3,12,22,.85);color:var(--muted);font-size:15px;padding:0 11px;cursor:pointer} .segm button.on{background:rgba(54,224,255,.15);color:var(--cyan)} .segm button:hover{filter:none;color:var(--txt)}
 .viz{width:100%;height:360px;border:1px solid var(--line);border-radius:10px;background:#fff;margin-top:8px}
 .cbar{display:flex;gap:9px;align-items:center;position:sticky;bottom:0;background:linear-gradient(0deg,#03070e 60%,rgba(3,7,14,0));padding:10px 0}
 .cbar input{flex:1;background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:10px;color:var(--txt);padding:11px 13px;font:14px Inter} .cbar input:focus{outline:none;border-color:var(--cyan)}
 .cbar textarea{flex:1;background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:10px;color:var(--txt);padding:11px 13px;font:14px/1.5 Inter;resize:none;max-height:40vh;overflow-y:auto} .cbar textarea:focus{outline:none;border-color:var(--cyan)}
 .cbar select{background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:10px;color:var(--txt);padding:0 8px;font:12px Inter;flex-shrink:0;cursor:pointer}
 .cbar #cmic{margin:0;padding:0;background:rgba(54,224,255,.10);color:var(--cyan);border:1px solid var(--line);border-radius:50%;width:42px;height:42px;font-size:18px;flex-shrink:0} .cbar #cmic.on{background:var(--red);color:#fff;animation:breathe 1s infinite}
 /* Agents — Org-Chart */
 .org{display:flex;flex-direction:column;align-items:center;padding:8px 0 32px}
 .orgline{width:2px;height:26px;background:linear-gradient(180deg,var(--cyan),transparent);opacity:.55}
 .ceonode{display:flex;align-items:center;gap:14px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 24px;;box-shadow:0 0 30px rgba(54,224,255,.12)}
 .ceoorb{width:46px;height:46px;border-radius:50%;background:radial-gradient(circle,#d7f6ff,#36e0ff 45%,#0a3a55 80%);box-shadow:0 0 22px var(--cyan);animation:breathe 3.4s ease-in-out infinite;flex-shrink:0}
 .ceotitle{font:700 16px Orbitron;letter-spacing:2px;color:#eaf6ff}
 .deptpill{font:600 12px Rajdhani;letter-spacing:2px;text-transform:uppercase;color:var(--gold);border:1px solid rgba(255,181,71,.4);border-radius:20px;padding:6px 18px;background:rgba(255,181,71,.06)}
 .agtiles{display:flex;flex-wrap:wrap;gap:18px;justify-content:center}
 .agtile{width:218px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 16px;text-align:center;cursor:pointer;;transition:transform .15s,box-shadow .15s,border-color .15s}
 .agtile:hover{transform:translateY(-3px);border-color:var(--cyan);box-shadow:0 0 26px rgba(54,224,255,.22)}
 .av{border-radius:50%;object-fit:cover;border:2px solid var(--line);box-shadow:0 0 16px rgba(54,224,255,.25);display:inline-flex;align-items:center;justify-content:center;background:rgba(3,18,30,.7);vertical-align:middle}
 .av.ph2{color:var(--cyan)}
 .agtile .agname{font:700 16px Rajdhani;letter-spacing:.5px;color:#eaf6ff;margin-top:11px} .agtile .agmeta{font-size:12px;color:var(--green);margin-top:5px} .agtile .agmeta2{font-size:11px;color:var(--muted);margin-top:2px}
 .aghead{display:flex;align-items:center;gap:16px;position:relative}
 .agx{position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:50%;background:rgba(255,95,109,.15);color:var(--red);border:1px solid rgba(255,95,109,.4);font-size:14px;cursor:pointer;margin:0;padding:0;display:flex;align-items:center;justify-content:center} .agx:hover{background:var(--red);color:#fff}
 #agdetail{max-width:none}
 .agdetail-row{display:flex;gap:14px;align-items:flex-start}
 .agmid{flex:1;min-width:0;display:flex;flex-direction:column;height:80vh;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 13px;}
 .agright{width:340px;flex-shrink:0;max-height:84vh;overflow:auto;padding-right:2px}
 .agmidhead{display:flex;align-items:center;gap:9px;padding-bottom:9px;border-bottom:1px solid var(--line)} .agmidhead select{background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:7px;color:var(--txt);padding:5px 9px;font:12px Inter} .agback{background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:7px;color:var(--txt);width:28px;height:28px;cursor:pointer;font-size:16px;line-height:1;flex-shrink:0;padding:0} .agback:hover{border-color:var(--cyan);color:var(--cyan)} .agcounter{background:linear-gradient(180deg,rgba(54,224,255,.06),transparent);border:1px solid var(--line);border-radius:10px;padding:9px 11px;margin:9px 0;flex-shrink:0} .agkpi-hd{font:700 11px Rajdhani;letter-spacing:.5px;color:var(--cyan);margin-bottom:6px} .agkpi-row{display:grid;grid-template-columns:repeat(6,1fr);gap:7px} .agkpi{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 5px;text-align:center} .agkpi-l{font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .agkpi-n{font:700 19px Rajdhani;color:#eaf6ff}
 #ag-flow{flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:11px 2px}
 #ag-flow img{max-width:100%;border:1px solid var(--line);border-radius:8px;margin:6px 0} #ag-flow h1,#ag-flow h2,#ag-flow h3{font-family:Rajdhani;color:var(--cyan);margin:8px 0 4px} #ag-flow table{border-collapse:collapse;width:100%;margin:6px 0} #ag-flow td,#ag-flow th{border:1px solid var(--line);padding:4px 7px;font-size:12px}
 #ag-stopbtn{flex-shrink:0;margin:9px 0 0}
 @media(max-width:900px){.agdetail-row{flex-direction:column}.agright{width:100%;max-height:none}.agmid{height:62vh}}
 details.card>summary{cursor:pointer;list-style:none;color:var(--cyan);font:600 12px Rajdhani;letter-spacing:1.5px;text-transform:uppercase;display:flex;align-items:center;gap:8px} details.card>summary::-webkit-details-marker{display:none}
 details.card>summary::before{content:"▸";color:var(--cyan);font-size:11px} details.card[open]>summary::before{content:"▾"} details.card[open]>summary{margin-bottom:11px}
 .toolgrid{display:flex;flex-wrap:wrap;gap:10px} .tool{flex:1 1 160px;min-width:150px;background:rgba(3,18,30,.6);border:1px solid var(--line);border-radius:10px;padding:11px 12px} .tool .tn{font:600 13px Rajdhani;letter-spacing:.3px;color:#eaf6ff} .tool .td{font-size:11px;color:var(--muted);margin-top:4px}
 .tool .ta{display:inline-block;font:600 9px Rajdhani;letter-spacing:1px;text-transform:uppercase;padding:1px 6px;border-radius:4px;margin-top:6px}
 .tool.ro{border-color:rgba(54,224,255,.4)} .tool.ro .ta{background:rgba(54,224,255,.15);color:var(--cyan)}
 .tool.rw{border-color:rgba(255,181,71,.5)} .tool.rw .ta{background:rgba(255,181,71,.15);color:var(--gold)}
 .tool.wr{border-color:rgba(84,224,138,.5)} .tool.wr .ta{background:rgba(84,224,138,.15);color:var(--green)}
 .msgblock{border:1px solid var(--line);border-radius:10px;padding:11px 12px;margin:8px 0;background:rgba(3,18,30,.5)} .msgblock .msgicp{font:700 13px Rajdhani;letter-spacing:.5px;color:var(--gold)} .msgblock .msgpain{font-size:11px;color:var(--muted);margin:3px 0 7px} .msgblock .msgline{font-size:12px;margin:3px 0} .msgblock .msgline b{color:var(--cyan);margin-right:6px}
 .pbblock{border:1px solid var(--line);border-radius:8px;padding:8px 11px;margin:7px 0;background:rgba(3,18,30,.4)} .pbblock>summary{cursor:pointer;color:var(--gold);font:600 12px Rajdhani;letter-spacing:.5px;list-style:none} .pbblock>summary::-webkit-details-marker{display:none} .pbblock>summary::before{content:"▸ "} .pbblock[open]>summary::before{content:"▾ "}
 .runrow{border-bottom:1px solid var(--line);padding:7px 0} .runname{cursor:pointer;color:var(--cyan);font-size:13px} .runname:hover{text-decoration:underline} .runbody{margin:9px 0 4px} .runbody img{max-width:100%;border:1px solid var(--line);border-radius:8px;margin:6px 0}
 .substeps{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px} .substep{background:rgba(3,18,30,.6);color:var(--cyan);border:1px solid var(--line);font-size:11px;padding:6px 11px}
 .ctrlrow{display:flex;align-items:center;gap:12px;margin:8px 0} .onbtn{background:linear-gradient(180deg,var(--green),#2f9c5e);color:#02141d} .offbtn{background:#33455e;color:#fff}
 .sched{display:flex;flex-direction:column;gap:5px;margin:10px 0;max-width:340px} .schrow{display:flex;align-items:center;justify-content:space-between} .schrow label{font-size:12px;color:var(--txt)}
 .schrow input,.ctrlrow2 input{width:120px;background:rgba(3,12,22,.7);border:1px solid var(--line);border-radius:6px;color:var(--txt);padding:5px 9px;font:12px Inter} .ctrlrow2 input{width:70px} .ctrlrow2{margin:6px 0;color:var(--muted);font-size:12px}
 /* Pipeline / CRM */
 #v-pipeline .plfilters{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
 #v-pipeline select,#v-pipeline #pl-search{background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:7px 11px;font:13px Inter} #v-pipeline #pl-search{max-width:240px} #v-pipeline select:focus,#v-pipeline #pl-search:focus{outline:none;border-color:var(--cyan)}
 #pl-table{overflow:auto;max-height:60vh} #pl-table table{width:100%;border-collapse:collapse} #pl-table td,#pl-table th{border:1px solid var(--line);padding:5px 9px;font-size:13px;text-align:left;white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis}
 #pl-table th{position:sticky;top:0;background:#08151f;color:var(--cyan);font:600 11px Rajdhani;letter-spacing:1px;text-transform:uppercase;z-index:1} #pl-table a{color:var(--gold)} #pl-table tr:hover td{background:rgba(54,224,255,.05)}
 #pl-detail .plback{margin:0 0 12px} .pldel{background:rgba(255,90,90,.1);color:#ff6b6b;border:1px solid rgba(255,90,90,.35);border-radius:8px;padding:6px 12px;cursor:pointer;font:600 12px Rajdhani;letter-spacing:.5px} .pldel:hover{background:rgba(255,90,90,.2)} .pl-links a{color:var(--gold)} .pl-meta{color:var(--muted);font-size:12px;margin:8px 0 6px;display:flex;gap:16px;flex-wrap:wrap}
 .funnelrow{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 8px}
 .fstep{font:600 11px Rajdhani;letter-spacing:.5px;padding:7px 13px;border-radius:20px;border:1px solid var(--line);color:var(--muted);background:rgba(3,18,30,.6);cursor:pointer;user-select:none} .fstep.on{border-color:var(--green);color:#02141d;background:linear-gradient(180deg,var(--green),#2f9c5e)}
 .cpbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-top:12px}
 .cpgate{display:flex;align-items:center;gap:10px;flex-wrap:wrap} .cptog{font:700 11px Rajdhani;letter-spacing:.6px;padding:6px 12px;border-radius:20px;border:1px solid rgba(63,208,120,.5);color:var(--green);background:rgba(63,208,120,.1)} .cpgatetxt{color:var(--muted);font-size:12px}
 .cpconn{background:rgba(54,224,255,.1);color:var(--cyan);border:1px solid var(--line);border-radius:8px;padding:8px 14px;font:700 12px Rajdhani;letter-spacing:.5px;cursor:pointer;margin:0} .cpconn:hover{filter:brightness(1.15)} .cpconn.done{color:var(--green);border-color:rgba(63,208,120,.5);background:rgba(63,208,120,.1)}
 .cplegend{color:var(--muted);font-size:12px;margin:8px 0 12px;line-height:1.7} .cptyp{font:700 10px Rajdhani;letter-spacing:.5px;padding:2px 8px;border-radius:5px;border:1px solid var(--line)} .cptyp.carousel{color:var(--gold);border-color:rgba(255,181,71,.4);background:rgba(255,181,71,.08)} .cptyp.reel{color:var(--teal);border-color:rgba(63,208,201,.4);background:rgba(63,208,201,.08)} .cptyp.post{color:var(--cyan);border-color:rgba(54,224,255,.4);background:rgba(54,224,255,.08)} .cpfilters{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px} .cpfilters button{font:700 11px Rajdhani;letter-spacing:.5px;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:rgba(3,18,30,.6);color:var(--muted);cursor:pointer} .cpfilters button.on{border-color:var(--cyan);color:var(--cyan);background:rgba(54,224,255,.08)} .cpgrouphd{font:700 11px Rajdhani;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin:14px 0 8px;display:flex;align-items:center;gap:8px} .plcard.cpcard{cursor:pointer} .plcard.cpcard:hover{border-color:var(--cyan)}
 .cpideas{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px} .cpcard{border:1px solid var(--line);border-radius:10px;background:rgba(3,18,30,.5);overflow:hidden;display:flex;flex-direction:column} .cpcard .cpthumb{height:150px;background:linear-gradient(135deg,rgba(54,224,255,.08),rgba(63,208,201,.05));display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px;border-bottom:1px solid var(--line)} .cpcard .cpbody{padding:11px 12px 13px}
 .cpcard .cptop{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px} .cpsrc{font:600 10px Rajdhani;letter-spacing:.4px;color:var(--teal)} .cpscore{font:700 12px Rajdhani;color:#04121a;background:var(--green);border-radius:6px;padding:2px 8px} .cpscore.mid{background:var(--gold)}
 .cpcard .cptit{font-weight:600;color:#eaf6ff;font-size:13.5px;line-height:1.4} .cpcard .cpnote{color:var(--muted);font-size:11.5px;margin:6px 0 10px;line-height:1.5} .cpstart{width:100%;font:700 12px Rajdhani;letter-spacing:.5px;padding:8px;border-radius:8px;border:1px solid var(--cyan);background:var(--cyan);color:#04121a;cursor:pointer;margin:0} .cpstart:hover{filter:brightness(1.1)}
 .cpanalytics{display:flex;flex-direction:column;gap:14px;opacity:.92;max-width:540px} .cpan{border:1px solid var(--line);border-radius:12px;background:rgba(3,18,30,.5);overflow:hidden} .cpan .cpanthumb{position:relative;height:210px;background:linear-gradient(135deg,rgba(255,181,71,.06),rgba(54,224,255,.05));display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:34px;border-bottom:1px solid var(--line)} .cpan .cpanthumb img{width:100%;height:100%;object-fit:cover} .cpan .cpanbody{padding:12px 15px 14px} .cpan .cpantit{font-size:14px;color:#eaf6ff;margin-bottom:9px;line-height:1.35;font-weight:600} .cpan .cpanmet{display:flex;gap:20px;color:var(--muted);font-size:13px} .cpan .cpanmet b{color:#eaf6ff;font-weight:700} .cpan .cpanplat{position:absolute;top:9px;left:9px}
 .cpmodal{position:fixed;inset:0;background:rgba(2,8,14,.74);;z-index:140;display:flex;align-items:center;justify-content:center;padding:20px} .cpmodalbox{width:min(560px,94vw);max-height:88vh;overflow-y:auto;background:var(--panel);border:1px solid var(--line);border-radius:14px} .cpmodalbox .cpovhero{position:relative;height:210px;background:linear-gradient(135deg,rgba(225,48,108,.12),rgba(54,224,255,.06));display:flex;align-items:center;justify-content:center;border-radius:14px 14px 0 0;overflow:hidden} .cpmodalbox .cpovhero img{width:100%;height:100%;object-fit:cover} .cpmodalbox .cpovhero .cpfplay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:40px;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.7);pointer-events:none} .cpmodalbox .cpovin{padding:14px 16px 18px} .cpmodalbox .cpovin label{display:block;font:700 10px Rajdhani;letter-spacing:.6px;text-transform:uppercase;color:var(--cyan);margin:12px 0 3px} .cpmodalbox .cpovin p{margin:0;color:var(--muted);font-size:13px;line-height:1.55} .cpovx{position:absolute;top:9px;right:9px;width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:rgba(2,8,14,.6);color:#eaf6ff;cursor:pointer;font-size:14px}
 .cpwatch{display:inline-flex;align-items:center;gap:4px;font:700 11px Rajdhani;letter-spacing:.4px;color:var(--teal);text-decoration:none;border:1px solid rgba(63,208,201,.4);background:rgba(63,208,201,.08);border-radius:6px;padding:3px 9px;margin-left:6px} .cpwatch:hover{filter:brightness(1.15)}
 .plcard .cpmove{display:flex;align-items:center;gap:6px;margin-top:9px} .plcard .cpmove button{flex:0 0 auto;width:27px;height:24px;border-radius:6px;border:1px solid var(--line);background:rgba(3,12,22,.6);color:var(--cyan);font-size:13px;cursor:pointer;padding:0} .plcard .cpmove button:hover:not(:disabled){border-color:var(--cyan);background:rgba(54,224,255,.12)} .plcard .cpmove button:disabled{opacity:.28;cursor:default;color:var(--muted)} .plcard .cpmove .cpmovest{flex:1;text-align:center;font:600 9.5px Rajdhani;letter-spacing:.4px;color:var(--muted);text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .cpplat{width:24px;height:24px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.35)} .cpplat svg{width:24px;height:24px;display:block}
 .cpfeed{display:flex;flex-direction:column;gap:10px} .cpfrow{display:flex;gap:12px;align-items:stretch;border:1px solid var(--line);border-radius:11px;background:rgba(3,18,30,.5);padding:11px;transition:.15s} .cpfrow:hover{border-color:var(--cyan)}
 .cpfrow .cpfthumb{position:relative;flex:0 0 132px;height:96px;border-radius:9px;overflow:hidden;background:linear-gradient(135deg,rgba(54,224,255,.1),rgba(63,208,201,.06));display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px} .cpfrow .cpfthumb img{width:100%;height:100%;object-fit:cover} .cpfrow .cpfthumb .cpfplay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:26px;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.6)} .cpfrow .cpfthumb .cpplat{position:absolute;top:6px;left:6px}
 .cpfrow .cpfbody{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px} .cpfrow .cpftop{display:flex;align-items:center;gap:8px;flex-wrap:wrap} .cpfrow .cpftit{font-weight:600;color:#eaf6ff;font-size:14px} .cpfrow .cpfsrc{color:var(--muted);font-size:11.5px} .cpfrow .cpfsrc a{color:var(--teal);text-decoration:none} .cpfrow .cpfsrc a:hover{text-decoration:underline} .cpfrow .cpfcap{color:var(--muted);font-size:12px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
 .cpscore{font:800 12px Rajdhani;letter-spacing:.3px;padding:2px 9px;border-radius:14px;border:1px solid var(--line);color:var(--muted)} .cpscore.hi{color:var(--green);border-color:rgba(63,208,120,.5);background:rgba(63,208,120,.1)} .cpscore.mid{color:var(--gold);border-color:rgba(255,181,71,.5);background:rgba(255,181,71,.1)}
 .cpfrow .cpfact{flex:0 0 118px;display:flex;flex-direction:column;justify-content:center;gap:6px} .cpfstart{width:100%;font:700 12px Rajdhani;letter-spacing:.5px;padding:8px 10px;border-radius:8px;border:1px solid var(--cyan);background:var(--cyan);color:#04121a;cursor:pointer;transition:.15s} .cpfstart:hover{filter:brightness(1.1)} .cpfstart.on{background:transparent;color:var(--green);border-color:rgba(63,208,120,.5);cursor:default}
 .plcard .cptyp{margin-top:6px;display:inline-block} .plcard .cptop{display:flex;align-items:center;gap:7px;margin-bottom:4px}
 #pl-detail label{display:block;font:600 11px Rajdhani;letter-spacing:1px;text-transform:uppercase;color:var(--cyan);margin:13px 0 5px} #pl-detail textarea{width:100%;background:rgba(3,12,22,.7);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:9px;font:13px Inter;resize:vertical} #pl-detail textarea:focus{outline:none;border-color:var(--cyan)}
 .stagebadge{display:inline-block;font:600 10px Rajdhani;letter-spacing:1px;text-transform:uppercase;padding:2px 9px;border-radius:5px;background:rgba(54,224,255,.15);color:var(--cyan);vertical-align:middle;margin-left:8px}
 .plview{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden;margin-left:8px} .plview button{margin:0;border:0;border-radius:0;background:rgba(3,12,22,.85);color:var(--muted);font:600 12px Rajdhani;letter-spacing:.5px;padding:6px 12px;cursor:pointer} .plview button.on{background:rgba(54,224,255,.15);color:var(--cyan)}
 .plboard{display:flex;gap:12px;overflow-x:auto;padding-bottom:10px;align-items:flex-start;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
 .pmtabs{display:flex;gap:8px;flex-wrap:wrap}
 .pmtab{font:600 13px Rajdhani;letter-spacing:.5px;padding:8px 16px;border-radius:9px;border:1px solid var(--line);background:transparent;color:var(--muted);cursor:pointer;transition:.15s}
 .pmtab:hover{color:#fff;border-color:var(--cyan)}
 .pmtab.on{background:rgba(54,224,255,.15);color:var(--cyan);border-color:var(--cyan)}
 .pmtabs.sm .pmtab{font-size:11px;padding:5px 11px}
 #pl-board{display:flex;gap:12px;overflow-x:auto;padding-bottom:10px;align-items:flex-start;scrollbar-width:thin;scrollbar-color:var(--line) transparent} #pl-board::-webkit-scrollbar{height:8px} #pl-board::-webkit-scrollbar-thumb{background:var(--line);border-radius:6px} #pl-board::-webkit-scrollbar-thumb:hover{background:var(--cyan)} #pl-board::-webkit-scrollbar-track{background:transparent} .plval{font:700 12px Rajdhani;color:var(--cyan);letter-spacing:.3px;margin:-3px 0 9px;opacity:.9}
 .plcol{flex:0 0 232px;background:rgba(3,18,30,.5);border:1px solid var(--line);border-radius:10px;padding:9px;max-height:66vh;overflow-y:auto} .plcol>h4{margin:0 0 9px;font:700 11px Rajdhani;letter-spacing:1px;text-transform:uppercase;color:var(--cyan);display:flex;justify-content:space-between;position:sticky;top:0} .plcol>h4 span{color:var(--muted)}
 .plcol.dragover{border-color:var(--cyan);background:rgba(63,208,201,.08)}
 .plcard{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:10px;margin-bottom:8px;cursor:grab} .plcard:active{cursor:grabbing} .plcard:hover{border-color:var(--cyan)}
 .plcard .nm{font-weight:600;color:#eaf6ff;font-size:13px;display:flex;justify-content:space-between;gap:6px} .plcard .icp{flex-shrink:0;font:600 10px Rajdhani;color:var(--gold);border:1px solid var(--line);border-radius:5px;padding:0 5px;height:16px;line-height:15px}
 .plcard .co{color:var(--muted);font-size:12px;margin:2px 0 6px} .plcard .src{font:600 10px Rajdhani;letter-spacing:.5px;color:var(--teal);background:rgba(63,208,201,.1);border:1px solid var(--line);border-radius:5px;padding:1px 6px;display:inline-block} .plcard .ice{color:var(--muted);font-size:11px;font-style:italic;margin-top:7px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
 /* CRM v2: Tag-Chips (Karte + Detail), Später-Filter, Abgeschlossen-Spalten, Konversation, editierbarer Kopf */
 .plcard .pltags{display:flex;flex-wrap:wrap;gap:4px;margin:7px 0 2px}
 .pltag{font:600 10px Rajdhani;letter-spacing:.4px;padding:2px 7px;border-radius:12px;border:1px solid var(--line);color:var(--muted);background:rgba(3,18,30,.6);white-space:nowrap;display:inline-flex;align-items:center;gap:3px}
 .plcard .pltag.later{color:var(--gold);border-color:rgba(240,200,90,.4);background:rgba(240,200,90,.08)} .plcard .pltag.ok{color:var(--green);border-color:rgba(63,208,120,.4);background:rgba(63,208,120,.08)} .plcard .pltag.no{color:var(--red);border-color:rgba(255,110,110,.4);background:rgba(255,110,110,.08)}
 .pltagrow{display:flex;flex-wrap:wrap;gap:7px;margin:4px 0 8px;align-items:center}
 .pltag.click{cursor:pointer;padding:6px 12px;font-size:11px;border-radius:16px;user-select:none} .pltag.click:hover{border-color:var(--cyan)} .pltag.click.on{border-color:var(--green);color:#02141d;background:linear-gradient(180deg,var(--green),#2f9c5e)} .pltag.click.on.ok{background:linear-gradient(180deg,var(--green),#2f9c5e)} .pltag.click.on.no{border-color:var(--red);color:#fff;background:linear-gradient(180deg,#e8635f,#b8433f)} .pltag.click.on.later{border-color:var(--gold);color:#1c1400;background:linear-gradient(180deg,#f0c85a,#d0a63a)}
 .pldate{background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:12px;color:var(--txt);padding:5px 9px;font:12px Inter;color-scheme:dark} .pldate:focus{outline:none;border-color:var(--cyan)}
 .callno textarea{margin-top:4px}
 .plchip{margin-left:8px;border:1px solid var(--line);border-radius:9px;background:rgba(3,12,22,.85);color:var(--muted);font:600 12px Rajdhani;letter-spacing:.5px;padding:6px 12px;cursor:pointer} .plchip:hover{border-color:var(--gold)} .plchip.on{border-color:var(--gold);color:var(--gold);background:rgba(240,200,90,.1)}
 .plcol.done{opacity:.75;border-style:dashed} .plcol.donetoggle{flex:0 0 150px;cursor:pointer;background:rgba(3,18,30,.35);border-style:dashed;text-align:center} .plcol.donetoggle:hover{border-color:var(--cyan)}
 .pl-head{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px} .pl-nameinp,.pl-coinp{background:rgba(3,12,22,.7);border:1px solid var(--line);border-radius:8px;color:#eaf6ff;padding:8px 10px;font:600 16px Inter} .pl-nameinp{flex:1 1 200px} .pl-coinp{flex:1 1 200px;font-weight:400;font-size:14px;color:var(--muted)} .pl-nameinp:focus,.pl-coinp:focus{outline:none;border-color:var(--cyan)}
 .convo{display:flex;flex-direction:column;gap:6px} .cvb{border:1px solid var(--line);border-left:2px solid var(--teal);border-radius:8px;padding:7px 10px;background:rgba(3,18,30,.5)} .cvb .cvh{font:600 11px Rajdhani;letter-spacing:.5px;color:var(--cyan)} .cvb .cvt{font-size:12px;color:var(--txt);margin-top:3px;line-height:1.45}
 /* PM-Board (Projekt-Pipeline) — Detail-Panel + Karten-Badges */
 #pm-detail label{display:block;font:600 11px Rajdhani;letter-spacing:1px;text-transform:uppercase;color:var(--cyan);margin:13px 0 5px} #pm-detail textarea,#pm-detail input.pminp{width:100%;background:rgba(3,12,22,.7);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:9px;font:13px Inter;resize:vertical} #pm-detail textarea:focus,#pm-detail input.pminp:focus{outline:none;border-color:var(--cyan)}
 #pm-detail .plback{margin:0 0 12px} #pm-detail .pl-meta{color:var(--muted);font-size:12px;margin:8px 0 6px;display:flex;gap:16px;flex-wrap:wrap} #pm-detail a{color:var(--gold)}
 .plcard .pmval{font:700 12px Rajdhani;color:var(--gold);letter-spacing:.3px;margin-top:6px} .plcard .pmbadges{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px} .plcol .plval.pm{color:var(--gold)}
 /* Action-Inbox: Zeilen zum Abarbeiten; erledigt = durchgestrichen, nie gelöscht */
 .akrow{display:flex;align-items:center;gap:10px;padding:8px 11px;border:1px solid var(--line);border-radius:10px;margin-bottom:7px;background:rgba(3,12,22,.5)}
 .akrow .t1{flex:1;min-width:0;font-size:13px}
 .akrow .aki{flex:none}
 .akrow.done{opacity:.5}
 .akrow.done .t1>div:first-child{text-decoration:line-through}
 .akrow a{color:var(--cyan);cursor:pointer}
 /* Projekt-Deadlines: Karte pulsiert rötlich bei Verzug, Badge wird ab 3 Tage vorher gelb */
 @keyframes pmlate{0%,100%{box-shadow:0 0 0 0 rgba(255,80,80,0)}50%{box-shadow:0 0 16px 2px rgba(255,80,80,.4)}}
 .plcard.late{border-color:rgba(255,90,90,.6);animation:pmlate 2.2s ease-in-out infinite}
 .pltag.od{color:#ff8585;border-color:rgba(255,90,90,.55)}
 .pltag.ds{color:#ffb84d;border-color:rgba(255,184,77,.5)}
 /* Projekt-Pool: Liste untereinander, Prio links, Start-Button rechts (des Nutzers Feedback 11.07.) */
 .pmpool{display:flex;flex-direction:column;gap:8px}
 .plcard.pool{cursor:pointer;display:flex;align-items:center;gap:12px;width:100%;flex:none;margin-bottom:0}
 .plcard.pool .nm{flex:1;margin:0;min-width:0}
 .plcard.pool .co{margin:0;white-space:nowrap;flex:none}
 .poolbtn{margin-left:auto;flex:none}
 .pmprio{flex:none;font-size:11px;border:1px solid var(--line);border-radius:999px;padding:3px 9px;color:var(--muted);cursor:pointer;white-space:nowrap;user-select:none}
 .pmprio.p1{color:#ffb84d;border-color:rgba(255,184,77,.5)}
 .pmprio.p3{opacity:.65}
 /* Notiz-Overlay: Brain-Notizen öffnen überall im System als schließbares Fenster statt View-Wechsel */
 #notemodal{display:none;position:fixed;inset:0;z-index:90}
 #notemodal .nm-back{position:absolute;inset:0;background:rgba(1,8,16,.72)}
 #notemodal .nm-card{position:absolute;top:6vh;left:50%;transform:translateX(-50%);width:min(760px,92vw);max-height:84vh;display:flex;flex-direction:column;background:rgba(3,14,25,.98);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.55);padding:16px 18px}
 #notemodal .nm-head{display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:10px}
 #notemodal .nm-head b{font-size:15px;flex:1;min-width:0}
 #notemodal .nm-body{overflow:auto;font-size:13.5px;line-height:1.55}
 #notemodal .nm-body a{color:var(--cyan);cursor:pointer}
 .pmstart{margin-top:9px;width:100%;font:700 12px Rajdhani;letter-spacing:.5px;padding:7px 10px;border-radius:8px;border:1px solid var(--cyan);background:var(--cyan);color:#04121a;cursor:pointer;transition:.15s} .pmstart:hover{filter:brightness(1.1)} .pmstart.on{background:transparent;color:var(--green);border-color:rgba(63,208,120,.5)} .plcard.pool.done{opacity:.72}
 /* Live-Konsole */
 #ag-console{position:fixed;inset:0;z-index:20;background:rgba(2,6,12,.86);;display:flex;align-items:center;justify-content:center}
 .acwrap{width:min(900px,94vw);height:88vh;background:var(--panel);border:1px solid var(--line);border-radius:14px;display:flex;flex-direction:column;padding:14px 16px;box-shadow:0 0 60px rgba(0,0,0,.6)}
 .achead{display:flex;align-items:center;gap:12px;padding-bottom:10px;border-bottom:1px solid var(--line)} .achead b{font:700 16px Rajdhani;letter-spacing:.5px;color:#eaf6ff}
 #ac-log{flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:12px 2px}
 .acstep{font:600 12px Rajdhani;letter-spacing:.5px;color:var(--cyan);background:rgba(54,224,255,.08);border:1px solid var(--line);border-radius:8px;padding:6px 10px;align-self:flex-start} .acstep+.acstep{margin-top:-2px} .acthink{font:italic 13px/1.55 ui-monospace,SFMono-Regular,monospace;color:var(--muted);background:rgba(255,255,255,.02);border-left:2px solid var(--line);border-radius:4px;padding:6px 10px;align-self:flex-start;max-width:90%;white-space:pre-wrap;opacity:.8}
 .acmsg{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 12px;font-size:14px;align-self:flex-start;max-width:88%;white-space:pre-wrap;line-height:1.5} .acmsg.acuser{align-self:flex-end;background:rgba(54,224,255,.12)}
 #ac-stop{background:var(--red);color:#fff}
 .ibmail{border-bottom:1px solid var(--line);padding:10px 2px} .ibmail:last-child{border-bottom:none}
 .ibmail .ibtop{display:flex;align-items:center;gap:10px;flex-wrap:wrap} .ibmail .ibtop small{margin-left:auto;color:var(--muted)}
 .ibmail.unread .ibtop b::before{content:'●';color:var(--cyan);margin-right:6px;font-size:9px;vertical-align:2px}
 .ibbadge{font:600 11px Rajdhani;letter-spacing:.4px;color:var(--cyan);border:1px solid var(--line);border-radius:20px;padding:2px 9px;cursor:pointer;background:rgba(54,224,255,.07)}
 .ibsub{font-weight:600;color:#eaf6ff;margin-top:2px;font-size:13px} .ibsnip{color:var(--muted);font-size:13px;margin-top:2px}
 .iblinks{margin-top:4px;font-size:12px} .iblinks a{color:var(--cyan);text-decoration:none}
 .tlrow{display:flex;gap:10px;padding:4px 0 4px 12px;border-left:2px solid var(--line);margin-left:6px;font-size:13px} .tlrow small{color:var(--muted);min-width:96px}
 /* WhatsApp DM-Setter */
 .wawrap{display:flex;gap:12px;height:62vh}
 .walist{flex:0 0 300px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;background:rgba(3,18,30,.5)}
 .wat{padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer} .wat:hover{background:rgba(54,224,255,.05)} .wat.on{background:rgba(54,224,255,.1)}
 .wat .wn{font-weight:600;font-size:13px;color:#eaf6ff;display:flex;gap:6px;align-items:center;flex-wrap:wrap} .wat .wl{color:var(--muted);font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .wabadge{font:600 9px Rajdhani;letter-spacing:.5px;padding:1px 6px;border-radius:8px;border:1px solid var(--line);color:var(--muted)} .wabadge.ai{color:var(--green);border-color:rgba(63,208,120,.4)} .wabadge.hot{color:var(--gold);border-color:rgba(240,200,90,.4)} .wabadge.red{color:#ff6b6b;border-color:rgba(255,110,110,.4)}
 .wachat{flex:1;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:10px;background:rgba(3,12,22,.5);min-width:0}
 .wahead{display:flex;align-items:center;gap:9px;padding:10px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap}
 .wamsgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:6px}
 .wam{max-width:74%;padding:8px 11px;border-radius:10px;font-size:13px;line-height:1.45;white-space:pre-wrap;border:1px solid var(--line);background:rgba(3,18,30,.7);align-self:flex-start}
 .wam.out{align-self:flex-end;background:rgba(63,208,120,.08);border-color:rgba(63,208,120,.3)}
 .wam.tpl{border-style:dashed} .wam small{display:block;color:var(--muted);font-size:10px;margin-top:3px;text-align:right}
 .wabar{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line)} .wabar input{flex:1;background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:9px 11px;font:13px Inter} .wabar input:focus{outline:none;border-color:var(--cyan)}
 .waset .row{gap:12px;justify-content:flex-start} .waset .row>.muted{margin-left:auto;margin-top:0} .svcico{display:inline-flex;align-items:center;flex-shrink:0} .svcico svg{display:block;filter:drop-shadow(0 1px 4px rgba(0,0,0,.3))}
 .waset label,.wafrm label{display:block;font:600 11px Rajdhani;letter-spacing:1px;text-transform:uppercase;color:var(--cyan);margin:12px 0 4px}
 .waset input,.waset select,.wafrm input,.wafrm select,.wafrm textarea{width:100%;background:rgba(3,12,22,.7);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:8px 10px;font:13px Inter} .waset input:focus,.wafrm input:focus,.wafrm textarea:focus,.waset select:focus,.wafrm select:focus{outline:none;border-color:var(--cyan)}
 .wagrid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
 .watbl{overflow:auto;max-height:56vh} .watbl table{width:100%;border-collapse:collapse} .watbl td,.watbl th{border:1px solid var(--line);padding:5px 9px;font-size:12.5px;text-align:left;white-space:nowrap;max-width:340px;overflow:hidden;text-overflow:ellipsis} .watbl th{position:sticky;top:0;background:#08151f;color:var(--cyan);font:600 11px Rajdhani;letter-spacing:1px;text-transform:uppercase}
 .wast{font:600 10px Rajdhani;letter-spacing:.6px;padding:2px 8px;border-radius:10px;border:1px solid var(--line)} .wast.APPROVED{color:var(--green);border-color:rgba(63,208,120,.5)} .wast.PENDING{color:var(--gold);border-color:rgba(240,200,90,.5)} .wast.REJECTED{color:#ff6b6b;border-color:rgba(255,110,110,.5)}
 .wacamp{border:1px solid var(--line);border-radius:10px;padding:12px;margin:9px 0;background:rgba(3,18,30,.5)} .wacamp .nm{font:700 15px Rajdhani;color:#eaf6ff;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
 .waprog{height:6px;background:rgba(255,255,255,.06);border-radius:4px;margin:9px 0;overflow:hidden} .waprog i{display:block;height:100%;background:linear-gradient(90deg,var(--teal),var(--green))}
 .warow{cursor:pointer} .warow:hover{background:rgba(54,224,255,.06)} .warow td{border:1px solid var(--line);padding:8px 11px;font-size:13px}
 .wapill{display:inline-block;font:600 11px Rajdhani;letter-spacing:.5px;padding:5px 12px;border-radius:9px;border:1px solid var(--line);background:rgba(3,18,30,.7);color:var(--muted);white-space:nowrap;cursor:pointer;transition:.15s} .wapill:hover{color:#eaf6ff;border-color:var(--cyan)} .wapill.sel{background:rgba(54,224,255,.16);color:var(--cyan);border-color:var(--cyan)} .wapill.active{color:var(--green);border-color:rgba(63,208,120,.5)} .wapill.paused{color:var(--gold);border-color:rgba(240,200,90,.5)} .wapill.draft{color:var(--muted)} .wapill.done{color:var(--cyan);border-color:var(--cyan)}
 #v-whatsapp select{color-scheme:dark} #v-whatsapp select option{background:#0a1622;color:#eaf6ff}
 .wadrop{position:relative;display:inline-block;min-width:160px;vertical-align:middle} .wadrop.full{display:block;width:100%}
 .wadrop-cur{background:rgba(3,12,22,.85);border:1px solid var(--line);border-radius:8px;color:#eaf6ff;padding:7px 11px;font:13px Inter;cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:center} .wadrop-cur:hover{border-color:var(--cyan)} .wadrop-cur .cv{opacity:.55;font-size:11px}
 .wadrop-menu{display:none;position:absolute;z-index:60;top:calc(100% + 4px);left:0;right:0;min-width:100%;background:#0a1622;border:1px solid var(--cyan);border-radius:8px;max-height:280px;overflow:auto;box-shadow:0 12px 34px rgba(0,0,0,.55)} .wadrop-menu.open{display:block}
 .wadrop-opt{padding:8px 11px;font:13px Inter;color:#cfe6f5;cursor:pointer;white-space:nowrap} .wadrop-opt:hover{background:rgba(54,224,255,.14);color:#fff} .wadrop-opt.on{color:var(--cyan)}
 .waseg{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden} .waseg button{background:transparent;border:none;color:var(--muted);font:600 12px Rajdhani;letter-spacing:.5px;padding:8px 16px;cursor:pointer;transition:.15s} .waseg button:hover{color:#eaf6ff} .waseg button.on{background:rgba(54,224,255,.16);color:var(--cyan)}
 .wachips{display:flex;gap:7px;flex-wrap:wrap;align-items:center} .wachip{display:inline-flex;gap:6px;align-items:center;background:rgba(54,224,255,.1);border:1px solid var(--line);border-radius:20px;padding:4px 10px 4px 12px;font:600 12px Rajdhani;color:var(--cyan)} .wachip b{color:#eaf6ff;font-weight:700} .wachip x{cursor:pointer;color:var(--muted);font-family:Inter;font-weight:400} .wachip x:hover{color:#ff6b6b}
 .waform{max-width:680px} .waform .fld{margin:0 0 14px} .waform .fld label{display:block;font:600 11px Rajdhani;letter-spacing:1px;text-transform:uppercase;color:var(--cyan);margin:0 0 5px} .waform .fld .hint{color:var(--muted);font-size:11.5px;margin-top:4px} .waform input,.waform textarea{width:100%;background:rgba(3,12,22,.7);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:9px 11px;font:13px Inter} .waform input:focus,.waform textarea:focus{outline:none;border-color:var(--cyan)} .waform .two{display:grid;grid-template-columns:1fr 1fr;gap:14px} .wasec{border-top:1px solid var(--line);margin:16px 0 12px;padding-top:12px} .wasec h5{margin:0 0 10px;font:700 12px Rajdhani;letter-spacing:1px;text-transform:uppercase;color:#eaf6ff} .wachk{display:flex;gap:9px;align-items:flex-start;margin:8px 0;font-size:13px;color:var(--txt);cursor:pointer} .wachk input{width:auto;margin-top:2px}
 .wafil{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:0 0 10px}
 .wacol{display:flex;gap:12px;height:60vh} .waleadp{flex:0 0 248px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;background:rgba(3,18,30,.5);padding:12px;font-size:12.5px} .waleadp h4{margin:0 0 6px;font:700 12px Rajdhani;letter-spacing:1px;text-transform:uppercase;color:var(--cyan)} .waleadp .lk{color:var(--muted);font-size:11px} .waleadp .lv{color:#eaf6ff;margin-bottom:7px}
 .wastats{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px;margin:6px 0 14px} .wastat{border:1px solid var(--line);border-radius:10px;padding:11px 13px;background:rgba(3,18,30,.5)} .wastat b{display:block;font:700 22px Rajdhani;color:var(--cyan);line-height:1.1} .wastat span{color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.5px}
 .waseq{border:1px solid var(--line);border-radius:10px;padding:12px;margin:8px 0;background:rgba(3,18,30,.5)} .waseq .sh{display:flex;gap:8px;align-items:center;margin-bottom:6px} .waseq .sh b{font:700 13px Rajdhani;letter-spacing:.5px;color:#eaf6ff} .wawait{text-align:center;color:var(--muted);font-size:12px;margin:2px 0}
 .walbl{font:600 9px Rajdhani;letter-spacing:.4px;padding:1px 6px;border-radius:8px;border:1px solid var(--line);color:var(--muted)} .walbl.interested{color:var(--green);border-color:rgba(63,208,120,.45)} .walbl.meetingbooked{color:var(--cyan);border-color:var(--cyan)} .walbl.notinterested{color:#ff6b6b;border-color:rgba(255,110,110,.4)} .walbl.ooo,.walbl.autoreply{color:var(--gold);border-color:rgba(240,200,90,.4)}
 .wadays{display:flex;gap:6px;flex-wrap:wrap} .wady{display:flex;gap:5px;align-items:center;padding:5px 9px;border:1px solid var(--line);border-radius:8px;cursor:pointer;font-size:12px} .wady.on{background:rgba(54,224,255,.14);border-color:var(--cyan);color:var(--cyan)}
</style></head><body>
<aside>
 <div class="brand"><svg width="18" height="18" viewBox="0 0 32 32" style="flex-shrink:0;filter:drop-shadow(0 0 6px rgba(54,224,255,.6))" aria-hidden="true"><rect width="32" height="32" rx="6" fill="#0a1826"/><rect x="0.5" y="0.5" width="31" height="31" rx="5.5" fill="none" stroke="#36e0ff" stroke-opacity="0.45"/><path d="M16 6L24 26H20.5L18.5 21H13.5L11.5 26H8L16 6ZM17.5 18L16 13.5L14.5 18H17.5Z" fill="#36e0ff"/></svg>${BRAND.logoDataUrl ? ('<img src="' + BRAND.logoDataUrl + '" alt="" style="height:20px;width:auto;border-radius:4px;margin-right:2px">') : ''}<b><span class="aios">${BRAND.name}</span></b></div>
 <button id="mmbtn" class="mmbtn" onclick="toggleMeeting()" title="Fokus/Meeting-Modus: pausiert Outreach & Hintergrund-Jobs, damit der Rechner die volle Leistung fürs Aufnehmen/Meeting hat. Nochmal klicken = alles läuft weiter.">🎬 <span id="mmlabel">Meeting-Modus</span></button>
 <div id="mmsub" class="mmsub">● Fokus aktiv — Outreach pausiert</div>
 <div class="nav active" data-v="dashboard">◎ <span>Command Center</span></div>
 <a class="nav" href="/starmap" style="text-decoration:none">✦ <span>Brain</span></a>
 <div class="nav" data-v="brain">🧠 <span>Second Brain</span></div>
 <div class="nav" data-v="copilot">💬 <span>Jarvis Copilot</span><span id="hbdot" class="hbdot" title="Heartbeat arbeitet gerade" style="display:none"></span></div>
 <div class="nav" data-v="todos">✅ <span>To-Dos</span></div>
 <div class="grp">Business</div>
 <div class="nav" data-v="inbox">⚡ <span>Action Needed</span><span class="navbadge" id="nb-inbox" style="display:none"></span></div>
 <div class="nav" data-v="pipeline">🧭 <span>Sales-Pipeline</span></div>
 <div class="nav" data-v="projekte">📁 <span>Projekt-Board</span></div>
 <div class="nav" data-v="salescopilot">🎙 <span>Sales Copilot</span></div>
 <div class="nav" data-v="outreach">📣 <span>Outreach</span></div>
 <div class="nav" data-v="contentpipeline">🎬 <span>Content Pipeline</span><small>MVP</small></div>
 <div class="nav" data-v="whatsapp">🟢 <span>WhatsApp</span></div>
 <div class="nav" data-v="agents">🤖 <span>Agents</span></div>
 <div class="nav" data-v="finanzen">💰 <span>Finanzen</span></div>
 <div class="nav" data-v="rechnungen">🧾 <span>Rechnungen</span></div>
 <div class="nav" data-v="proposals">📄 <span>Proposals</span><small>bald</small></div>
 <div class="grp">Kunden</div>
 <div class="nav" data-v="analyse">🔎 <span>KI-Analyse</span><small>bald</small></div>
 <div class="grp">System</div>
 <div class="nav" data-v="settings">⚙️ <span>Einstellungen</span></div>
</aside>
<main>
 <section class="view active" id="v-dashboard">
  <div class="vh"><h2 class="t">Command Center</h2><button class="pop" onclick="popout('dashboard')">↗ Fenster</button></div>
  <div class="sub">Alles auf einen Blick — live aus CRM, Rechnungen &amp; Projekten.</div>
  <div class="hero">
   <div class="core" id="core"><div class="ring"></div><div class="r2"></div><div class="r3"></div><div class="glow"></div></div>
   <div class="status" id="orbstatus">● Online · Subscription</div>
  </div>
  <div class="stats">
   <div class="stat"><div class="lbl">Umsatz · Monat</div><div class="big" id="d-umsatz">–</div><div class="chg" id="d-umsatz-sub">Ziel 10.000 €</div></div>
   <div class="stat"><div class="lbl">Kontaktiert</div><div class="big" id="d-contact">–</div><div class="chg up" id="d-reply"></div></div>
   <div class="stat"><div class="lbl">Setting / Closing</div><div class="big" id="d-setclose">–</div><div class="chg warn" id="d-closed"></div></div>
   <div class="stat"><div class="lbl">Brain-Notizen</div><div class="big" id="d-notes">–</div><div class="chg">verlinkt</div></div>
   <div class="stat"><div class="lbl">Aktive Projekte</div><div class="big" id="d-proj">–</div><div class="chg">in Arbeit</div></div>
   <div class="stat"><div class="lbl">Signal-Tasks</div><div class="big" id="d-tasks">–</div><div class="chg">The One Thing</div></div>
  </div>
  <div class="card" id="streakcard" style="margin-top:14px">
   <div class="row"><h3 style="margin:0">🔥 Outreach-Streak</h3><span id="sk-streak" class="ph">…</span></div>
   <div class="stats" style="margin-top:10px">
    <div class="stat"><div class="lbl">Streak</div><div class="big" id="sk-days">–</div><div class="chg">Tage in Folge</div></div>
    <div class="stat"><div class="lbl">Touches heute</div><div class="big" id="sk-touch">–</div><div class="chg" id="sk-touchgoal">Ziel 5</div></div>
    <div class="stat"><div class="lbl">Meetings · Woche</div><div class="big" id="sk-meet">–</div><div class="chg">gebucht</div></div>
   </div>
   <div style="display:flex;gap:9px;margin-top:12px"><button onclick="skTouch()">✅ +1 Touch von mir (eigene DM/Mail/Call)</button><button onclick="skMeet()" style="background:linear-gradient(180deg,var(--gold),#d68f1e)">📅 +1 Meeting gebucht</button></div>
   <div class="muted" style="margin-top:8px">Agent-Outreach (LinkedIn-Lauf) zählt automatisch — die Buttons sind nur für das, was du selbst machst. Jeder Tag mit mindestens 1 Touch hält die 🔥-Streak am Leben.</div>
  </div>
  <div class="card" style="margin-top:14px"><h3>Aktueller Fokus</h3><div id="d-now" class="muted">…</div></div>
 </section>
 <section class="view" id="v-brain">
  <div class="vh"><h2 class="t">Second Brain</h2><button class="pop" onclick="popout('brain')">↗ Fenster</button></div>
  <div class="sub">Knoten anklicken → Notiz öffnet rechts. Suchen, Themen & Notiz sind einklappbar.</div>
  <div id="legend"></div>
  <div id="graph"><div id="graphhint">Knoten anklicken · ziehen · zoomen</div></div>
  <div class="cols">
   <div class="col">
    <div class="brainsearch"><input id="bsearch" placeholder="🔍 Notizen durchsuchen …" oninput="searchBrain(this.value)"><div id="bresults"></div></div>
    <details class="card bkt" style="margin-top:12px"><summary>＋ Thema hinzufügen</summary><div class="bktnotes"><textarea id="newt" rows="2" placeholder="z. B. Neue Idee: WhatsApp-Funnel für Coaches …"></textarea><button onclick="addNote()">Anlegen — Jarvis ordnet zu</button><div id="addmsg" class="muted"></div></div></details>
    <div id="lists" style="margin-top:12px"></div>
   </div>
   <div class="col">
    <details class="card bkt" open id="viewercard"><summary>📄 Notiz <span id="vtitle" style="color:var(--muted);font-family:Inter;text-transform:none;letter-spacing:0;font-weight:400"></span></summary>
     <div class="bktnotes">
      <div id="vbtns" style="display:none;margin-bottom:8px"><button onclick="edit()">✏️ Bearbeiten</button></div>
      <div id="viewer"><span class="muted">Knoten oder Suchergebnis anklicken …</span></div>
      <div id="editor" style="display:none"><textarea id="ed" rows="18"></textarea><div><button onclick="save()">💾 Speichern</button><button onclick="cancelEdit()" style="background:#33455e;color:#fff">Abbrechen</button></div></div>
      <div id="jedit" style="display:none;margin-top:12px;border-top:1px solid var(--line);padding-top:10px"><textarea id="ji" rows="2" placeholder="Jarvis, ändere diese Notiz: …"></textarea><button onclick="jarvisEdit()" style="background:linear-gradient(180deg,var(--gold),#d68f1e)">Durch Jarvis ändern</button></div>
     </div>
    </details>
    <div class="card"><h3>Mit Jarvis sprechen</h3><textarea id="q" rows="3" placeholder="z. B. Was steht heute an?"></textarea>
     <div><button onclick="ask()">Fragen</button><button onclick="checkin()" style="background:linear-gradient(180deg,var(--gold),#d68f1e)">Check-in</button></div><div id="reply"></div><div class="muted">Über deine Claude-Subscription (claude -p).</div></div>
   </div>
  </div>
 </section>
 <section class="view" id="v-outreach">
  <div class="vh"><h2 class="t">Outreach</h2><button class="pop" onclick="popout('outreach')">↗ Fenster</button></div>
  <div class="sub">Tägliche Aktivität deiner Outreach-Agents — live aus den Läufen.</div>
  <div class="card" id="oa-daily-card" style="margin-bottom:16px">
   <div class="row"><h3 style="margin:0">📊 Outreach-Zahlen</h3>
    <span style="margin-left:auto;display:flex;gap:6px">
     <button class="oa-rbtn on" data-r="today" onclick="setOaRange('today')">Heute</button>
     <button class="oa-rbtn" data-r="week" onclick="setOaRange('week')">Diese Woche</button>
     <button class="oa-rbtn" data-r="30d" onclick="setOaRange('30d')">30 Tage</button>
    </span>
   </div>
   <div id="oa-kpis" style="margin-top:13px"><span class="muted">… lädt</span></div>
   <div id="oa-goal" style="margin-top:11px"></div>
   <details style="margin-top:13px"><summary class="oa-sum">📅 Verlauf pro Tag</summary><div id="oa-daily" style="margin-top:10px;overflow-x:auto"></div></details>
  </div>
  <div class="sub" style="margin-top:4px">Funnel-Zahlen — live aus dem CRM + Agent-Läufen (Google-Sheet abgelöst 17.07.).</div>
  <div class="stats">
   <div class="stat"><div class="lbl">Vernetzungsquote</div><div class="big" id="ot-annahme">–</div><div class="chg" id="ot-annahmesub"></div></div>
   <div class="stat"><div class="lbl">Reply Rate</div><div class="big" id="ot-reply">–</div><div class="chg" id="ot-replysub"></div></div>
   <div class="stat"><div class="lbl">Kontaktiert (unique)</div><div class="big" id="ot-contact">–</div><div class="chg" id="ot-contactsub">im CRM</div></div>
   <div class="stat"><div class="lbl">Setting Calls</div><div class="big" id="ot-setting">–</div><div class="chg" id="ot-setclose"></div></div>
   <div class="stat"><div class="lbl">Closing Calls</div><div class="big" id="ot-closing">–</div><div class="chg warn" id="ot-closed"></div></div>
   <div class="stat"><div class="lbl">Calls vorgeschlagen</div><div class="big" id="ot-call">–</div><div class="chg">aus dem CRM</div></div>
   <div class="stat"><div class="lbl">AOV</div><div class="big" id="ot-aov">–</div><div class="chg" id="ot-aovsub"></div></div>
   <div class="stat"><div class="lbl">Umsatz gesamt</div><div class="big" id="ot-umsatz">–</div><div class="chg" id="ot-umsatzsub"></div></div>
  </div>
  <div class="card" style="margin-top:14px"><h3>Conversion Funnel</h3>
   <div class="funnel" id="ot-funnel"><span class="muted">… lädt</span></div>
   <div id="ot-rates" style="margin-top:12px"></div>
   <div class="muted">Live aus dem CRM — Settingcall/Closing im Lead anhaken, hier steigt die Zahl.</div>
  </div>
  <div class="card" style="margin-top:14px"><h3>🎯 Zielgruppen-A/B (Makler · Agentur · Dienstleister)</h3>
   <div id="ot-zg" style="overflow-x:auto"><span class="muted">… lädt</span></div>
   <div class="muted" style="margin-top:6px">Vernetzungsquote je Zielgruppe (Ziel: 40%+) · Reply-Quote je Messaging. Alt-Immobilien-Kategorien zählen als Makler. ⚠️ Quote hier = CRM-Näherung, bei Juni-Altdaten überschätzt (abgelehnte Invites wurden damals nicht gespeichert) — die harte Quote ist die Kachel oben. Ab dem neuen ICP (17.07.) stimmen beide überein.</div>
  </div>
 </section>
 <section class="view" id="v-agents">
  <div class="vh"><h2 class="t">Org · Agents</h2><button class="pop" onclick="popout('agents')">↗ Fenster</button></div>
  <div class="pmtabs" style="margin-top:2px">
   <button class="pmtab on" data-agv="mitarbeiter" onclick="setAgView('mitarbeiter')">👥 Mein Team</button>
   <button class="pmtab" data-agv="nervensystem" onclick="setAgView('nervensystem')">🧠 Nervensystem</button>
   <button class="pmtab" data-agv="skills" onclick="setAgView('skills')">🧩 Skills</button>
   <button class="pmtab" data-agv="einstellen" onclick="setAgView('einstellen')">🧑‍💼 Zum Einstellen</button>
  </div>
  <div id="agv-mitarbeiter">
   <div class="sub" style="margin-top:10px">Jarvis = CEO · deine KI-Mitarbeiter. Kachel anklicken → Übersicht & steuern.</div>
   <div id="agorg" class="org"><span class="muted">… lädt</span></div>
   <div id="agdetail" style="display:none"></div>
   <div class="card" id="al-card" style="margin-top:14px;display:none">
    <div style="display:flex;justify-content:space-between;align-items:center">
     <h3 style="margin:0">🔬 Qualitätsmanager · Vorschläge</h3><span class="muted" id="al-lauf" style="font-size:11px"></span>
    </div>
    <div class="muted" style="font-size:12px;margin-top:4px">Er prüft nachts die Läufe der anderen Agenten. Freigeben = der Nacht-Werker setzt es um.</div>
    <div id="al-liste" style="margin-top:10px"></div>
   </div>
  </div>
  <div id="agv-nervensystem" style="display:none">
   <iframe id="agv-frame-nerv" style="width:calc(100% + 52px);height:calc(100vh - 74px);border:0;border-top:1px solid var(--line);margin:4px -26px -20px;background:#0a0a0f;display:block" data-src="/starmap"></iframe>
  </div>
  <div id="agv-skills" style="display:none">
   <iframe id="agv-frame-skills" style="width:calc(100% + 52px);height:calc(100vh - 74px);border:0;border-top:1px solid var(--line);margin:4px -26px -20px;background:#0a0a0f;display:block" data-src="/skills"></iframe>
  </div>
  <div id="agv-einstellen" style="display:none">
   <iframe id="agv-frame-einstellen" style="width:calc(100% + 52px);height:calc(100vh - 74px);border:0;border-top:1px solid var(--line);margin:4px -26px -20px;background:#0B1526;display:block" data-src="/mitarbeiter"></iframe>
  </div>
 </section>
 <section class="view" id="v-salescopilot">
  <div class="vh"><h2 class="t">Sales Copilot · Note Taker</h2><button class="pop" onclick="loadSalesCopilot()">↻ Aktualisieren</button><button class="pop" onclick="popout('salescopilot')">↗ Fenster</button></div>
  <div class="sub">Dein Call-Overlay: Live-Sales-Tipps oder Note Taker — transkribiert beide Seiten lokal (Deepgram + BlackHole, kein Bot im Call), Recap + To-Dos landen im Brain.</div>
  <div class="stats" style="grid-template-columns:repeat(3,1fr)">
   <div class="stat"><div class="lbl">Status</div><div class="big" id="sc-status" style="font-size:20px">…</div><div class="chg" id="sc-status-sub"></div></div>
   <div class="stat"><div class="lbl">Modus</div><div class="big" id="sc-mode" style="font-size:20px">—</div><div class="chg" id="sc-project"></div></div>
   <div class="stat"><div class="lbl">Steuerung</div><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button onclick="scStart()" id="sc-startbtn">▶︎ App starten</button><button onclick="scStop()" id="sc-stopbtn" style="display:none;background:var(--red);color:#fff">⏻ Ausschalten</button></div><div class="chg muted" style="font-size:11px">Auto-Start: Kalender-Watcher + Ton-Erkennung</div></div>
  </div>
  <div id="sc-hint" class="card" style="margin-top:12px;display:none;border-color:rgba(248,113,113,.35)"></div>
  <div class="card" style="margin-top:14px"><h3>Letzte Call-Notizen & Recaps</h3>
   <div class="pmtabs sm" id="sc-tabs" style="margin:8px 0 12px">
    <button class="pmtab on" data-f="alle" onclick="scTab('alle')">Alle</button>
    <button class="pmtab" data-f="setting" onclick="scTab('setting')">Setting</button>
    <button class="pmtab" data-f="closing" onclick="scTab('closing')">Closing</button>
    <button class="pmtab" data-f="notiz" onclick="scTab('notiz')">Notizen</button>
   </div>
   <div id="sc-notes"><span class="muted">… lädt</span></div></div>
  <div class="card" id="sc-viewercard" style="margin-top:14px;display:none">
   <div style="display:flex;justify-content:space-between;align-items:center"><h3 id="sc-viewer-title" style="margin:0">Notiz</h3><button class="pop" onclick="scCloseNote()">✕ schließen</button></div>
   <div id="sc-viewer" style="margin-top:10px"></div>
  </div>
 </section>
 <section class="view" id="v-copilot">
  <div class="vh"><h2 class="t">Jarvis Copilot</h2><button class="pop" onclick="popout('copilot')">↗ Fenster</button></div>
  <div class="sub">Sprich oder schreib mit Jarvis. Er kennt dein Brain & deine Business-Daten.</div>
  <div class="cpwrap">
   <div id="chathist"></div>
   <div class="cpmain">
    <div id="ctxbar"></div>
    <div id="chatlog"></div>
    <div id="catt" style="display:flex;flex-wrap:wrap;gap:6px;padding:0 2px 6px"></div>
    <div class="cbar"><button id="cattbtn" onclick="document.getElementById('cfile').click()" title="Bild oder Video anhängen" style="flex:0 0 auto">📎</button><input id="cfile" type="file" accept="image/*,video/*" multiple style="display:none" onchange="cAttachFiles(this.files);this.value=''"><textarea id="cin" rows="1" placeholder="Mit Jarvis schreiben … (Enter senden · Shift+Enter neue Zeile · Bild einfügen/droppen)" oninput="cinGrow(this)" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();copilotSend();}"></textarea><button id="cstop" onclick="stopRun()" title="Laufenden Auftrag stoppen" style="display:none">⏹ Stop</button><button onclick="copilotSend()">Senden</button></div>
   </div>
  </div>
 </section>
 <section class="view" id="v-todos">
  <div class="vh"><h2 class="t">To-Dos</h2><button class="pop" onclick="loadTodos()">↻ Aktualisieren</button><button class="pop" onclick="popout('todos')">↗ Fenster</button></div>
  <div class="sub">Aus deinem Brain (07_Tasks) — Abhaken speichert direkt zurück. Filter: wer's macht · Signal/Noise · Projekt.</div>
  <div class="tdadd"><input id="td-new" placeholder="Neue Aufgabe … (Enter)" onkeydown="if(event.key==='Enter')addTodo()"><select id="td-role" title="Wer macht's?"><option value="">— Rolle</option><option value="me">👤 Ich</option><option value="claude">🧑‍💻 Claude Code</option><option value="sub">🤖 Subagent</option><option value="team">👥 Team</option></select><select id="td-target" title="Wohin?"><option value="signal">🎯 Signal</option><option value="noise">🔇 Noise</option></select><select id="td-proj-add" title="Projekt (optional)"><option value="">📁 — Projekt</option></select><button onclick="addTodo()">+ Hinzufügen</button></div>
  <div id="td-filter" class="tdfilter"></div>
  <div id="td-row2" class="tdfilter"></div>
  <div id="td-list"><span class="muted">… lädt</span></div>
 </section>
 <section class="view" id="v-projekte"><div class="vh"><h2 class="t">Projekt-Board</h2><button class="pop" onclick="loadProjekte()">↻ Aktualisieren</button><button class="pop" onclick="addProjekt()">+ Projekt</button><button class="pop" onclick="popout('projekte')">↗ Fenster</button></div><div class="sub">PM-Board: Kundenprojekte durch die Phasen ziehen. Rechnung (Anzahlung/Rest) + Retainer je Karte. Karten liegen in <code>data/projekte.json</code>, Jarvis liest sie.</div>
 <div class="pmtabs" style="margin-top:12px"><button class="pmtab on" data-typ="kunde" onclick="pmSetTyp('kunde')">👥 Kundenprojekte</button><button class="pmtab" data-typ="eigen" onclick="pmSetTyp('eigen')">🚀 Eigene Projekte</button></div>
 <div class="card" style="margin-top:10px"><div id="pm-stand" class="muted" style="font-size:12px;margin-bottom:8px">lädt …</div><div id="pm-board" class="plboard"></div></div>
 <div id="pm-detail" style="display:none"></div>
 <div class="sub" style="margin-top:16px">📥 Projekte aus deinem Second Brain — „▶ Projekt starten" hebt eins ins Board (Onboarding) der gerade aktiven Pipeline (oben umschaltbar).</div><div class="card" id="proj-list"></div></section>
 <section class="view" id="v-pipeline">
  <div class="vh"><h2 class="t">Sales-Pipeline · CRM</h2><button class="pop" onclick="popout('pipeline')">↗ Fenster</button></div>
  <div class="sub">Kontakte aus Airtable „Immovertrieb Leads". <span id="pl-stand" class="ph">… lädt</span></div>
  <div class="stats" id="pl-stats"></div>
  <div class="card" style="margin-top:14px"><h3>ICP-Kategorien (Top 10)</h3><div id="pl-buckets" class="funnel"></div></div>
  <div class="card" style="margin-top:14px">
   <div class="row"><h3 style="margin:0">Kontakte</h3><div class="plview"><button id="plv-board" class="on" onclick="setPlView('board')">▦ Pipeline</button><button id="plv-list" onclick="setPlView('list')">≣ Liste</button></div><input id="pl-search" placeholder="suchen …" oninput="renderLeads()"><button id="pl-later" class="plchip" onclick="togglePlLater()">⏰ Später dran</button></div>
   <div class="plfilters"><select id="pl-cat" onchange="renderLeads()"></select><select id="pl-status" onchange="renderLeads()"></select><select id="pl-acc" onchange="renderLeads()"></select></div>
   <div id="pl-board"></div>
   <div id="pl-table" style="display:none"><span class="muted">… Export läuft, gleich da.</span></div>
   <div id="pl-detail" style="display:none"></div>
  </div>
 </section>
  <section class="view" id="v-finanzen">
  <div class="vh"><h2 class="t">Finanzen</h2><button class="pop" onclick="refreshCsv()">🔄 CSVs aktualisieren</button><button class="pop" onclick="popout('finanzen')">↗ Fenster</button></div>
  <div class="sub">Gesamt-Überblick: Konten · Einnahmen/Ausgaben · wohin dein Geld geht · Tool-Fixkosten. Details sind einklappbar.</div>
  <div class="konten" id="konten"></div>
  <div class="card" style="margin-top:4px">
   <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:8px"><h3 style="margin:0">📊 Einnahmen & Ausgaben</h3><div class="trange"><button class="rbtn on" onclick="setTxRange(30,this)">30 T</button><button class="rbtn" onclick="setTxRange(90,this)">90 T</button><button class="rbtn" onclick="setTxRange(180,this)">6 Mon</button></div></div>
   <div class="stats" id="tx-stats" style="grid-template-columns:repeat(3,1fr);gap:12px"></div>
   <details class="fdetails"><summary>Andere Umsätze (Wise Business + Privat) anzeigen</summary><div id="tx-list" style="margin-top:10px"><span class="muted">… lädt</span></div></details>
  </div>
  <div class="card" style="margin-top:14px">
   <h3 style="margin:0 0 4px">🥧 Wo geht mein Geld hin</h3>
   <div class="sub" style="margin:0 0 12px">Ausgaben nach Kategorie im gewählten Zeitraum (Wise · Amex · Bargeld — zusammengeführt).</div>
   <div id="pie-box"><span class="muted">… lädt</span></div>
  </div>
  <div class="card" style="margin-top:14px">
   <details class="fdetails" open><summary>🔧 Kosten · Business-Fixkosten (Tools & Abos)</summary>
    <div class="sub" style="margin:8px 0 10px">Alle erkannten Software-Abos, teuerste zuerst — was kannst du austauschen/kündigen?</div>
    <div id="fix-box"><span class="muted">… lädt</span></div>
   </details>
  </div>
  <div class="card" style="margin-top:14px">
   <h3 style="margin:0 0 4px">📅 Nach Monat</h3>
   <div class="sub" style="margin:0 0 10px">Einnahmen/Ausgaben pro Monat — Wise Business + Amex + Wise Privat.</div>
   <div id="tx-months"><span class="muted">… lädt</span></div>
  </div>
  <div class="card" style="margin-top:14px">
   <details class="fdetails"><summary>💳 Amex-Umsätze (alle importierten CSVs)</summary>
    <div class="sub" style="margin:8px 0 10px">Neue CSVs in die Desktop-Ordner <b>„Amex-CSV"</b> / <b>„Wise-CSV"</b> legen → oben <b>„🔄 CSVs aktualisieren"</b>.</div>
    <div class="stats" id="exp-stats" style="grid-template-columns:repeat(2,1fr);gap:12px"></div>
    <div id="exp-list" style="margin-top:12px"></div>
   </details>
  </div>
 </section>
 <section class="view" id="v-rechnungen">
  <div class="vh"><h2 class="t">Rechnungen</h2><button class="pop" onclick="loadInvoices()">↻ Aktualisieren</button><button class="pop" onclick="toggleRtool()">🧾 Rechnungstool</button><button class="pop" onclick="wiseMatch(this)">🔄 Wise-Abgleich</button><button class="pop" onclick="window.open('/rechnungstool','_blank')">↗ Tool im Tab</button><button class="pop" onclick="popout('rechnungen')">↗ Fenster</button></div>
  <div class="sub">Offene · bezahlte · überfällige Rechnungen. „Rechnungstool" hier im Modul: Kunde anlegen, Rechnung bauen, PDF + Gmail-Entwurf direkt raus. Zahlungseingänge werden automatisch mit Wise abgeglichen (Watcher, alle 10 Min); Zahlungserinnerungen nach 14/21 Tagen landen als Gmail-Entwurf zur Freigabe.</div>
  <div class="stats" id="inv-stats" style="grid-template-columns:repeat(3,1fr);gap:12px;margin-top:8px"></div>
  <div class="card" style="margin-top:14px">
   <div class="invadd"><input id="iv-kunde" placeholder="Kunde"><input id="iv-betrag" type="number" step="0.01" placeholder="€ Betrag"><input id="iv-datum" type="date" title="verschickt am"><input id="iv-faellig" type="date" title="fällig am"><button onclick="addInvoice()">+ Rechnung erfassen</button></div>
   <div id="inv-list"></div>
  </div>
  <div id="rtool-wrap" style="display:none;margin-top:14px"><iframe id="rtool" style="width:100%;height:840px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#fff"></iframe></div>
 </section>
 <section class="view" id="v-inbox"><div class="vh"><h2 class="t">⚡ Action Needed</h2><button class="pop" onclick="loadInbox(true);loadAktionen()">↻ Aktualisieren</button><button class="pop" onclick="popout('inbox')">↗ Fenster</button></div>
  <div class="sub">Nur was deine Reaktion braucht — abarbeiten &amp; leer halten. Befüllt von Watcher, Agents &amp; Jarvis.</div>
  <div class="card"><div class="row"><h3 style="margin:0">⚡ Zu erledigen</h3><span id="ak-count" class="ph" style="margin-left:auto"></span></div>
   <div id="ak-list" style="margin-top:10px"><span class="muted">… lädt</span></div>
   <details style="margin-top:10px"><summary class="oa-sum">✅ Erledigt (<span id="ak-donecount">0</span>)</summary><div id="ak-done" style="margin-top:8px"></div></details>
  </div>
  <details style="margin-top:14px"><summary class="oa-sum">📧 Posteingang (alle Mails) <span id="ib-stand" class="ph"></span></summary>
   <div class="card" style="margin-top:8px"><div id="ib-list"><span class="muted">… lädt</span></div></div>
  </details>
  <div class="muted" style="margin-top:10px">Ausbau (weitere Postfächer · antworten aus dem CRM · 📞 Calls via Telnyx): brain/03_Projects/aios-crm-inbox-ausbau.md</div>
 </section>
${["calls","proposals","analyse"].map((id)=>`<section class="view" id="v-${id}"><div class="vh"><h2 class="t">${id}</h2><button class="pop" onclick="popout('${id}')">↗ Fenster</button></div><div class="stub">Modul in Aufbau — als Nächstes.</div></section>`).join("")}
 <section class="view" id="v-contentpipeline">
  <div class="vh"><h2 class="t">Content Pipeline</h2><button class="pop" onclick="loadContentPipeline()">↻ Aktualisieren</button><button class="pop" onclick="popout('contentpipeline')">↗ Fenster</button></div>
  <div class="cpbar">
   <div class="cpgate"><span class="cptog on" title="In der MVP-Phase fest an">Freigabe erforderlich · AN</span><span class="cpgatetxt">Nichts geht raus ohne des Nutzers OK.</span></div>
  </div>
  <div class="pmtabs" id="cp-tabs" style="margin:14px 0 12px">
   <button class="pmtab on" id="cptab-pipeline" onclick="cpTab('pipeline')">🎬 Pipeline</button>
   <button class="pmtab" style="margin-left:auto" onclick="window.open('/teleprompter','_blank','width=1200,height=900')" title="Teleprompter + Video-Aufnahme (9:16 Reel / 16:9 YouTube) — Datei landet in Downloads">🎥 Video aufnehmen</button>
   <button class="pmtab" id="cptab-kalender" onclick="cpTab('kalender')">🗓 Kalender</button>
   <button class="pmtab" id="cptab-analytics" onclick="cpTab('analytics')">📊 Analytics</button>
  </div>
  <div id="cp-pipeline">
   <div class="card"><h3>Pipeline-Board</h3>
    <div class="sub" style="margin:0 0 10px">Content wandert durch die Stufen: Idee → Skript/Entwurf → In Arbeit → Freigabe → Live. Mit „→" schiebst du eine Karte in die nächste Stufe.</div>
    <div id="cp-board" class="plboard"><span class="muted">… lädt</span></div>
   </div>
   <div class="card" style="margin-top:14px"><h3>Ideen-Feed</h3>
    <div class="sub" style="margin:0 0 6px">Score 1 bis 10 (wie gut der Post ist und wie sehr er zu uns passt) + Performance des Originals + Alter. Quellen-Schalter: ✎ Eigene (inkl. Nachtwerker) · 📥 Eingeworfen (per Chat reingegebene Creator-Posts) · 🔍 Auto-Research (Competitor Watch). „Start" schiebt die Idee ins Board.</div>
    <div class="cplegend"><span class="cptyp carousel">🖼 Karussell</span> wird nach Freigabe automatisch erstellt · <span class="cptyp reel">🎥 Reel/Video</span> der Nutzer nimmt per Teleprompter auf, Editing danach automatisch (Deepgram-Captions, Hyperframe-Animationen, Stil noch offen)</div>
    <div id="cp-ideas" class="cpfeed"><span class="muted">… lädt</span></div>
   </div>
  </div>
  <div id="cp-kalender-tab" style="display:none">
   <div class="card"><h3>Content-Kalender</h3>
    <div class="sub" style="margin:0 0 10px">Was geht wann raus. Datum setzt du im Post-Fenster („✎ Bearbeiten" → geplant für). Posts ohne Datum stehen unten.</div>
    <div id="cp-kalender" class="cpcalwrap"><span class="muted">… lädt</span></div>
   </div>
  </div>
  <div id="cp-analytics-tab" style="display:none">
   <div class="card"><h3>Analytics <span class="ph">bald</span></h3>
    <div class="sub" id="cp-anhint" style="margin:0 0 10px">Wie performen meine hochgeladenen Posts. Kommt mit dem Instagram-Connect, aktuell Dummy-Vorschau.</div>
    <div id="cp-analytics" class="cpanalytics"><span class="muted">… lädt</span></div>
   </div>
  </div>
 </section>
 <!-- Lese-Modal der Content-Pipeline: global (außerhalb der Views), damit es auch aus der Inbox heraus funktioniert (akShowPost) -->
 <div id="cp-modal" class="cpmodal" style="display:none" onclick="if(event.target===this)cpCloseModal()"><div class="cpmodalbox" id="cp-modal-box"></div></div>
 <section class="view" id="v-whatsapp">
  <div class="vh"><h2 class="t">WhatsApp</h2><button class="pop" onclick="waRefresh()">↻ Aktualisieren</button><button class="pop" onclick="waTickNow(this)">▶ Tick jetzt</button><button class="pop" onclick="popout('whatsapp')">↗ Fenster</button></div>
  <div class="sub" id="wa-sub">Kampagnen, Inbox &amp; Templates über die Meta WhatsApp Business API. Der KI-Setter beantwortet Leads automatisch und übergibt an dich, wenn nötig.</div>
  <div class="pmtabs" style="margin:4px 0 12px">
   <button class="pmtab on" id="watab-inbox" onclick="waTab('inbox')">💬 Inbox</button>
   <button class="pmtab" id="watab-tpl" onclick="waTab('tpl')">📋 Templates</button>
   <button class="pmtab" id="watab-camp" onclick="waTab('camp')">📣 Kampagnen</button>
  </div>
  <!-- ===== KAMPAGNEN ===== -->
  <div id="wa-camp">
   <div id="wa-camp-list-wrap">
    <div class="card"><div class="row"><h3 style="margin:0">Kampagnen</h3><span style="margin-left:auto;display:flex;gap:7px"><button class="pop" onclick="waCampVoice()">🎙 Per Sprache anlegen</button><button class="pop" onclick="waCampNew()">+ Add New</button></span></div>
     <div id="wa-camplist" style="margin-top:10px"><span class="muted">…</span></div></div>
   </div>
   <div id="wa-camp-detail" style="display:none"></div>
  </div>
  <!-- ===== INBOX ===== -->
  <div id="wa-inbox" style="display:none">
   <div class="wafil">
    <span class="muted" style="font:600 10px Rajdhani;letter-spacing:1px;text-transform:uppercase">Inbox</span>
    <button class="wapill sel" id="wain-auto" onclick="waInSet('box','auto')">🤖 Automatisch</button>
    <button class="wapill" id="wain-human" onclick="waInSet('box','human')">🖐 Übernehmen</button>
    <span style="width:1px;height:20px;background:var(--line);margin:0 4px"></span>
    <button class="wapill sel" id="wain-scope-all" onclick="waInSet('scope','all')">Alle</button>
    <button class="wapill" id="wain-scope-inbound" onclick="waInSet('scope','inbound')">Inbound</button>
    <button class="wapill" id="wain-scope-camp" onclick="waInSet('scope','campaign')">Kampagne</button>
    <span id="wain-label-wrap" style="margin-left:auto"></span>
    <button class="pop" onclick="waNewChat()">+ Neuer Chat</button>
   </div>
   <div class="wacol">
    <div class="walist" id="wa-threads"><div class="wat"><span class="muted">… lädt</span></div></div>
    <div class="wachat">
     <div class="wahead" id="wa-chathead"><span class="muted">Thread links auswählen</span></div>
     <div class="wamsgs" id="wa-msgs"></div>
     <div class="wabar" id="wa-bar" style="display:none"><input id="wa-input" placeholder="Nachricht … (Enter sendet)" onkeydown="if(event.key==='Enter')waSendMsg()"><button onclick="waSendMsg()">Senden</button></div>
     <div class="wabar" id="wa-closedbar" style="display:none"><span class="muted" style="flex:1;align-self:center">24h-Fenster geschlossen. Kontakt nur per genehmigtem Template.</span><button onclick="waGenFu(this)" style="background:linear-gradient(180deg,var(--gold),#d68f1e)">✨ Follow-up-Template</button></div>
    </div>
    <div class="waleadp" id="wa-leadp"><span class="muted">Lead-Details erscheinen hier.</span></div>
   </div>
  </div>
  <!-- ===== TEMPLATES ===== -->
  <div id="wa-tpl" style="display:none">
   <div class="card"><div class="row"><h3 style="margin:0">Nachrichten-Templates</h3><span style="margin-left:auto;display:flex;gap:7px"><button class="pop" onclick="waTplSync(this)">↻ Mit Meta syncen</button><button class="pop" onclick="waTplAI()">🎙 Per Sprache</button><button class="pop" onclick="waTplNew()">+ Template</button></span></div>
    <div class="muted" style="margin:6px 0 10px">Erstkontakt außerhalb des 24h-Fensters geht NUR über genehmigte Templates. Kalt-Outreach = MARKETING (strenger geprüft), Transaktional = UTILITY. Variablen als <code>{{1}}</code>, <code>{{2}}</code> … Nach Genehmigung ist ein Template nicht mehr editierbar (dann neues anlegen).</div>
    <div class="watbl" id="wa-tpllist"><span class="muted">…</span></div>
   </div>
   <div class="card wafrm" id="wa-tplform" style="display:none;margin-top:12px"></div>
  </div>
 </section>
 <section class="view" id="v-settings">
  <div class="vh"><h2 class="t">Einstellungen</h2><button class="pop" onclick="loadSettings()">↻ Aktualisieren</button></div>
  <div class="sub">API-Zugänge &amp; Modul-Konfiguration. Secrets landen in <code>.env</code> (nie im Repo/Brain), Rest in <code>data/settings.json</code>. Gespeicherte Secrets werden maskiert angezeigt und beim Speichern nie durch die Maske überschrieben.</div>
  <div class="card waset" style="max-width:860px">
   <div class="row"><span class="svcico"><svg width="38" height="38" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#25D366"/><path fill="#fff" d="M16 6.2c-5.4 0-9.8 4.4-9.8 9.8 0 1.73.46 3.4 1.32 4.88L6.2 25.8l5.06-1.32a9.76 9.76 0 004.74 1.2c5.4 0 9.8-4.4 9.8-9.8s-4.4-9.68-9.8-9.68zm0 17.6c-1.5 0-2.97-.4-4.25-1.16l-.3-.18-3 .78.8-2.93-.2-.3a8.13 8.13 0 01-1.25-4.33c0-4.5 3.66-8.15 8.16-8.15 4.5 0 8.15 3.65 8.15 8.15 0 4.5-3.66 8.16-8.16 8.16zm4.48-6.1c-.24-.12-1.45-.72-1.67-.8-.22-.08-.39-.12-.55.12-.16.24-.63.8-.77.96-.14.16-.28.18-.52.06-.24-.12-1.03-.38-1.97-1.22-.73-.65-1.22-1.45-1.36-1.69-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2 0 1.18.86 2.32.98 2.48.12.16 1.69 2.58 4.1 3.62.57.25 1.02.4 1.37.5.57.19 1.1.16 1.51.1.46-.07 1.45-.59 1.65-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28z"/></svg></span><h3 style="margin:0">WhatsApp Business API (Meta Cloud API)</h3><span id="set-wa-status" class="muted"></span></div>
   <div class="wagrid">
    <div><label>Access Token (System-User, läuft nie ab)</label><input type="password" id="set-WA_ACCESS_TOKEN" placeholder="EAAx…" autocomplete="off"></div>
    <div><label>App Secret</label><input type="password" id="set-WA_APP_SECRET" autocomplete="off"></div>
    <div><label>Verify Token (selbst gewählt, für Webhook-Setup)</label><input type="password" id="set-WA_VERIFY_TOKEN" autocomplete="off"></div>
    <div><label>Telefonnummer-ID</label><input id="set-phoneNumberId" placeholder="deine Telefonnummer-ID"></div>
    <div><label>WhatsApp-Unternehmenskonto-ID (WABA)</label><input id="set-wabaId" placeholder="deine WABA-ID"></div>
    <div><label>Webhook-Host (Tunnel-Domain, z. B. xxx.ngrok-free.app)</label><input id="set-webhookHost" placeholder="deine-domain.ngrok-free.app"></div>
    <div><label>Globales Tageslimit (Sends/Tag)</label><input id="set-globalDailyCap" type="number" min="1" max="250"></div>
    <div><label>Sendefenster (Quiet Hours dazwischen gesperrt)</label><div style="display:flex;gap:8px;align-items:center"><input id="set-qFrom" type="number" min="0" max="23" style="width:80px"> <span class="muted">bis</span> <input id="set-qTo" type="number" min="1" max="24" style="width:80px"> <span class="muted">Uhr (Europe/Berlin)</span></div></div>
   </div>
   <label style="margin-top:14px">Webhook-URL (bei Meta unter WhatsApp → Konfiguration eintragen)</label>
   <div class="muted" id="set-webhookUrl" style="font-family:ui-monospace,monospace;font-size:12px">–</div>
   <div style="display:flex;gap:9px;margin-top:14px"><button onclick="saveSettings(this)">💾 Speichern</button><button onclick="waTest(this)" class="offbtn">🔌 Verbindung testen</button></div>
   <div id="set-testresult" style="margin-top:10px"></div>
  </div>
  <div class="card waset" style="max-width:860px;margin-top:14px">
   <div class="row"><span class="svcico"><svg width="38" height="38" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#0a0a0a"/><g stroke="#13EF93" stroke-width="2.2" stroke-linecap="round"><line x1="10" y1="13" x2="10" y2="19"/><line x1="13.7" y1="10" x2="13.7" y2="22"/><line x1="17.4" y1="7.5" x2="17.4" y2="24.5"/><line x1="21.1" y1="11" x2="21.1" y2="21"/><line x1="24" y1="14" x2="24" y2="18" stroke="#0a0a0a"/></g></svg></span><h3 style="margin:0">Deepgram</h3><span class="muted">Live-Transkription (Sales Copilot / Note Taker)</span></div>
   <div class="wagrid"><div><label>API-Key</label><input type="password" id="set-DEEPGRAM_API_KEY" autocomplete="off"></div></div>
  </div>
  <div class="card waset" style="max-width:860px;margin-top:14px">
   <div class="row"><span class="svcico"><svg width="38" height="38" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#0e1c14"/><g stroke="#a6e22e" stroke-width="1.7" stroke-linecap="round" fill="none"><path d="M9.5 11l3.2 4M22.5 11l-3.2 4M8.5 16.5H13M23.5 16.5H19M9.5 22l3.2-3M22.5 22l-3.2-3"/></g><ellipse cx="16" cy="12.6" rx="2.2" ry="1.8" fill="#a6e22e"/><circle cx="16" cy="16.6" r="3.6" fill="#a6e22e"/></svg></span><h3 style="margin:0">Apify</h3><span class="muted">Creator-Scraping für die Content Pipeline (Instagram)</span></div>
   <div class="wagrid"><div><label>API-Token</label><input type="password" id="set-APIFY_TOKEN" placeholder="apify_api_…" autocomplete="off"></div></div>
   <div style="display:flex;gap:9px;margin-top:14px"><button onclick="saveSettings(this)">💾 Speichern</button></div>
  </div>
  <div class="card waset" style="max-width:860px;margin-top:14px">
   <div class="row"><span class="svcico"><svg width="38" height="38" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#000"/><rect x="11" y="8.5" width="3.6" height="15" rx="1.3" fill="#fff"/><rect x="17.4" y="8.5" width="3.6" height="15" rx="1.3" fill="#fff"/></svg></span><h3 style="margin:0">ElevenLabs</h3><span class="muted">Jarvis-Stimme (Text-to-Speech im Dashboard)</span></div>
   <div class="wagrid"><div><label>API-Key</label><input type="password" id="set-ELEVENLABS_API_KEY" autocomplete="off"></div></div>
  </div>
  <div class="card waset" style="max-width:860px;margin-top:14px">
   <div class="row"><span class="svcico"><svg width="38" height="38" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#29A9EB"/><path fill="#fff" d="M23.4 9.1L7.6 15.2c-1.08.43-1.07 1.03-.2 1.3l4.06 1.27 1.57 4.94c.19.53.09.74.65.74.43 0 .62-.2.86-.43l2.08-2.02 4.32 3.19c.8.44 1.37.21 1.57-.74l2.84-13.4c.29-1.16-.44-1.68-1.2-1.34z"/><path fill="#bfe3f7" d="M11.46 17.77l10.3-6.5c.5-.3.96-.14.58.19l-8.82 7.96-.34 3.63z"/></svg></span><h3 style="margin:0">Telegram</h3><span class="muted">Jarvis-Bot + Notifications (dein Telegram-Bot)</span></div>
   <div class="wagrid"><div><label>Bot-Token</label><input type="password" id="set-TELEGRAM_BOT_TOKEN" autocomplete="off"></div></div>
  </div>
  <div class="card waset" style="max-width:860px;margin-top:14px">
   <div class="row"><span class="svcico"><svg width="38" height="38" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#fff"/><rect x="5.5" y="9" width="21" height="14" rx="2.5" fill="none" stroke="#EA4335" stroke-width="1.8"/><path d="M6.5 10.5L16 17.5 25.5 10.5" fill="none" stroke="#EA4335" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span><h3 style="margin:0">SMTP · E-Mail</h3><span class="muted">für späteren Mail-Versand (noch kein Modul angeschlossen)</span></div>
   <div class="wagrid">
    <div><label>Host</label><input id="set-smtpHost" placeholder="smtp.beispiel.de"></div>
    <div><label>Port</label><input id="set-smtpPort" type="number" placeholder="587"></div>
    <div><label>Benutzer</label><input id="set-smtpUser" placeholder="mail@<DEINE_DOMAIN>"></div>
    <div><label>Absender (From)</label><input id="set-smtpFrom" placeholder="der Nutzer  &lt;mail@<DEINE_DOMAIN>&gt;"></div>
    <div><label>Passwort</label><input type="password" id="set-SMTP_PASS" autocomplete="off"></div>
   </div>
   <div style="display:flex;gap:9px;margin-top:14px"><button onclick="saveSettings(this)">💾 Alle Einstellungen speichern</button></div>
  </div>
 </section>
</main>
<div id="ag-console" style="display:none">
 <div class="acwrap">
  <div class="achead"><b id="ac-title">Live-Konsole</b><span id="ac-status" class="muted"></span><div style="margin-left:auto;display:flex;gap:8px"><button id="ac-stop" onclick="consoleStop()">⏹ Stop</button><button onclick="consoleClose()" class="offbtn">✕ Schließen</button></div></div>
  <div id="ac-log"></div>
  <div class="cbar"><input id="ac-in" placeholder="Sag dem Agenten was … (Enter) — z. B. schreib das in deine Instruktion" onkeydown="if(event.key==='Enter')consoleSend()"><button onclick="consoleSend()">Senden</button></div>
 </div>
</div>
<script>
const NOTES=${JSON.stringify(notes)}, GRAPH=${JSON.stringify(graph)}, BCOLOR=${JSON.stringify(COLOR)};
const cnt=k=>(NOTES[k]||[]).length;
function pulseOrb(){const c=document.getElementById('core');if(!c)return;c.classList.add('speaking');clearTimeout(window.__ot);window.__ot=setTimeout(()=>c.classList.remove('speaking'),1800);}
document.querySelectorAll('.nav').forEach(el=>{ if(el.tagName==='A') return; el.onclick=()=>show(el.dataset.v,el); });
// ---- Modul-Gate: nicht eingerichtete Module zeigen eine "jetzt einrichten"-Platzhalterseite ----
window.MODULES={};
fetch('/api/modules').then(r=>r.json()).then(function(m){window.MODULES=m||{};aiosDecorateNav();}).catch(function(){});
function aiosDecorateNav(){Object.keys(window.MODULES).forEach(function(k){var n=document.querySelector('.nav[data-v="'+k+'"]');if(n&&window.MODULES[k]&&!window.MODULES[k].configured){n.classList.add('mod-off');if(!n.querySelector('.mod-badge')){var b=document.createElement('small');b.className='mod-badge';b.textContent='· einrichten';n.appendChild(b);}}});}
function aiosModuleStub(v,el){var vs=document.querySelectorAll('.view');vs.forEach(function(s){s.classList.remove('active');});document.querySelectorAll('.nav').forEach(function(n){n.classList.remove('active');});if(el)el.classList.add('active');var parent=(vs[0]&&vs[0].parentNode)||document.querySelector('main')||document.body;var host=document.getElementById('v-modstub');if(!host){host=document.createElement('section');host.id='v-modstub';host.className='view';parent.appendChild(host);}var m=window.MODULES[v]||{};host.innerHTML='<div class="card" style="max-width:640px"><h2 style="margin-top:0">'+(m.label||v)+': noch nicht eingerichtet</h2><p class="muted">'+(m.desc||'Dieses Modul ist installiert, aber noch nicht konfiguriert.')+'</p><p>Richte es gemeinsam mit Claude Code ein: öffne den Ordner <code>~/AIOS</code> in Claude Code und tippe <b>/aios-setup</b>.</p></div>';host.classList.add('active');location.hash=v;window.CUR=v;}
function show(v,el){if(window.MODULES&&window.MODULES[v]&&!window.MODULES[v].configured){return aiosModuleStub(v,el);}const sec=document.getElementById('v-'+v); if(!sec)return;
 document.querySelectorAll('.view').forEach(s=>s.classList.remove('active')); sec.classList.add('active');
 document.querySelectorAll('.nav').forEach(n=>n.classList.remove('active')); (el||document.querySelector('[data-v="'+v+'"]')).classList.add('active');
 location.hash=v; window.CUR=v;
 // Brain-Graph nur rendern, wenn er sichtbar ist: autoPauseRedraw(false) + Partikel + Glow
 // laufen sonst ab Boot in JEDEM Modul weiter und ruckeln das ganze Dashboard (Fund 17.07.).
 if(window.G){if(v==='brain')G.resumeAnimation();else G.pauseAnimation();}
 if(v==='brain'&&window.G){const g=document.getElementById('graph');setTimeout(()=>G.width(g.clientWidth).height(g.clientHeight),60);}
 if(v==='todos')loadTodos(); if(v==='outreach'){loadOutreachStats();loadKpis();} if(v==='dashboard')loadKpis(); if(v==='finanzen'){loadExpenses();loadWise();loadGoCardless();loadTx();loadWisePrivat();} if(v==='rechnungen')loadInvoices(); if(v==='salescopilot')loadSalesCopilot(); if(v==='inbox'){loadInbox();loadAktionen();} if(v==='projekte')loadProjekte(); if(v==='contentpipeline')loadContentPipeline(); if(v==='whatsapp')waRefresh(); if(v==='settings')loadSettings(); }
// ---- Inbox-Modul (CRM-Inbox-Ausbau Punkt 2, Teilstück): Gmail-Liste + Lead-Zuordnung ----
// Zuordnung Absender ↔ CRM: E-Mail-Adresse in lead.contactInfo/email ODER Absendername == Lead-Name.
function ibLeadFor(m){if(!window.LEADS||!LEADS.length)return null;
 var nn=function(s){return String(s||'').toLowerCase().replace(/[^a-zà-ÿäöüß ]+/gi,' ').replace(/\s+/g,' ').trim();};
 var em=(m.fromEmail||'').toLowerCase();
 if(em){for(var i=0;i<LEADS.length;i++){var ci=(String(LEADS[i].contactInfo||'')+' '+String(LEADS[i].email||'')).toLowerCase();if(ci.indexOf(em)>=0)return LEADS[i];}}
 var n=nn(m.fromName);
 if(n&&n.indexOf(' ')>0){for(var j=0;j<LEADS.length;j++){if(nn(LEADS[j].name)===n)return LEADS[j];}}
 return null;}
function ibOpenLead(i){show('pipeline');setTimeout(function(){openLead(i);},80);}
/* Action-Inbox: Benachrichtigungen, die des Nutzers Reaktion brauchen. Abhaken = durchstreichen + einklappen, nie löschen. */
var AKT=[];
function loadAktionen(){fetch('/api/aktionen').then(r=>r.json()).then(function(d){AKT=(d&&d.aktionen)||[];renderAktionen();}).catch(function(){});}
function akIcon(q){return ({mail:'📧',agent:'🤖',projekt:'📁',crm:'🧭',jarvis:'✨',watcher:'👁'})[q]||'🔔';}
function akLink(a){if(!a.link)return '';
 if(a.link.indexOf('note:')===0)return ' <a onclick="event.stopPropagation();openNote(\\''+esc(a.link.slice(5))+'\\')">📄 öffnen</a>';
 if(a.link.indexOf('view:')===0)return ' <a onclick="event.stopPropagation();show(\\''+esc(a.link.slice(5))+'\\')">↗ öffnen</a>';
 if(a.link.indexOf('http')===0)return ' <a href="'+esc(a.link)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">↗ öffnen</a>';
 return '';}
var AKOPENID=null; // Akkordeon: genau EIN aufgeklapptes Item — das nächste schließt das vorige
function akRow(a){
 var opened=AKOPENID===a.id;
 var head='<div class="akrow'+(a.done?' done':'')+'"><span class="aki">'+akIcon(a.quelle)+'</span>'+
  '<div class="t1" style="cursor:pointer" onclick="akOpen(\\''+a.id+'\\')"><div>'+esc(a.titel)+akLink(a)+'</div>'+
  (a.detail&&!opened?'<div class="muted" style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(a.detail)+'</div>':'')+'</div>'+
  '<span class="muted" style="font-size:11px;white-space:nowrap">'+esc(a.ts||'')+'</span>'+
  (!a.done?'<button class="pop" title="morgen früh wieder vorlegen" onclick="akLater(\\''+a.id+'\\')">⏰ später</button>':'')+
  '<button class="pop" onclick="akToggle(\\''+a.id+'\\','+(a.done?'false':'true')+')">'+(a.done?'↩ zurück':'✓ erledigt')+'</button></div>';
 if(!opened)return head;
 // Detail-Panel: alles anschauen ohne die Inbox zu verlassen (Wunsch 15.07.)
 return head+'<div class="akdetail">'+
  (a.detail?'<div style="white-space:pre-wrap;line-height:1.6;color:#cfe6f5">'+esc(a.detail)+'</div>':'<div class="muted">Keine weiteren Details hinterlegt.</div>')+
  '<div class="muted" style="margin-top:8px;font-size:11px">Quelle: '+esc(a.quelle||'?')+' · '+esc(a.ts||'')+(a.snoozedUntil?' · ⏰ vorgelegt ab '+esc(a.snoozedUntil):'')+'</div>'+
  (a.link?'<div style="margin-top:8px"><a class="pop" href="'+esc(a.link)+'" target="_blank">↗ öffnen</a></div>':'')+
  ((a.quelle==='nachtwerker'||a.quelle==='content')?'<div style="margin-top:8px" id="ak-post-'+a.id+'"><button class="pop" onclick="akShowPost(\\''+a.id+'\\')">🪟 Post ansehen</button></div>':'')+
 '</div>';}
function akOpen(id){AKOPENID=(AKOPENID===id)?null:id;renderAktionen();}
// Post-Idee als Fenster öffnen: passendes Content-Pipeline-Item per Titel finden und
// das vorhandene Lese-Modal (cpOpenIdea) zeigen — anschauen, schließen, in der Inbox bleiben.
function akNormTitle(s){return (s||'').toLowerCase().replace(/post-idee f(ü|ue)r heute:?/,'').replace(/[^a-zäöüß0-9 ]/g,'').replace(/\s+/g,' ').trim();}
function akShowPost(id){
 var a=AKT.find(function(x){return x.id===id;});if(!a)return;
 var ready=(CPDATA&&(CPDATA.ideen||[]).length)?Promise.resolve():fetch('/api/content-pipeline').then(function(r){return r.json();}).then(function(d){CPDATA=d||{ideen:[]};});
 ready.then(function(){
  var want=akNormTitle(a.titel);
  var hit=(CPDATA.ideen||[]).find(function(x){var t=akNormTitle(x.titel);return t&&want&&(want.indexOf(t)>=0||t.indexOf(want)>=0);});
  if(hit){cpOpenIdea(hit.id);return;}
  var slot=document.getElementById('ak-post-'+id);
  if(slot)slot.innerHTML='<span class="muted" style="font-size:11px">Nicht in der Pipeline gefunden — </span><button class="pop" onclick="show(\\'contentpipeline\\')">→ Content-Pipeline öffnen</button>';
 }).catch(function(){});}
function akNowStr(){return new Date().toLocaleString('sv-SE',{timeZone:'Europe/Berlin'}).slice(0,16);}
function renderAktionen(){var l=document.getElementById('ak-list');if(!l)return;
 var now=akNowStr();
 var snoozed=AKT.filter(function(a){return !a.done&&a.snoozedUntil&&a.snoozedUntil>now;});
 var open=AKT.filter(function(a){return !a.done&&!(a.snoozedUntil&&a.snoozedUntil>now);}),done=AKT.filter(function(a){return a.done;});
 var cnt=document.getElementById('ak-count');if(cnt)cnt.textContent=open.length?open.length+' offen':'';
 var nb=document.getElementById('nb-inbox');if(nb){nb.textContent=open.length;nb.style.display=open.length?'':'none';}
 l.innerHTML=(open.length?open.map(akRow).join(''):'<span class="muted">🎉 Leer — nichts braucht dich gerade.</span>')+
  (snoozed.length?'<div class="muted" style="margin-top:10px;font-size:11.5px">⏰ '+snoozed.length+' auf später geschoben — '+snoozed.map(function(a){return esc(a.titel.slice(0,40))+' (ab '+esc((a.snoozedUntil||'').slice(5,11))+')';}).join(' · ')+'</div>':'');
 var dc=document.getElementById('ak-donecount');if(dc)dc.textContent=done.length;
 var dl=document.getElementById('ak-done');if(dl)dl.innerHTML=done.slice(0,30).map(akRow).join('')||'<span class="muted">—</span>';}
function akToggle(id,done){fetch('/api/aktion-done',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,done:done})}).then(r=>r.json()).then(function(){var a=AKT.find(function(x){return x.id===id;});if(a)a.done=done;renderAktionen();}).catch(function(){});}
function akLater(id){fetch('/api/aktion-later',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})}).then(r=>r.json()).then(function(d){var a=AKT.find(function(x){return x.id===id;});if(a&&d&&d.snoozedUntil)a.snoozedUntil=d.snoozedUntil;renderAktionen();}).catch(function(){});}
function loadInbox(fresh){var box=document.getElementById('ib-list'),st=document.getElementById('ib-stand');if(!box)return;
 if(fresh)box.innerHTML='<span class="muted">… lädt frisch</span>';
 fetch('/api/inbox'+(fresh?'?fresh=1':'')).then(r=>r.json()).then(d=>{
  if(!d.ok){box.innerHTML='<span class="muted">⚠ Mail-Abruf fehlgeschlagen: '+esc(d.error||'?')+'</span>';if(st)st.textContent='';return;}
  if(st){st.textContent='Stand '+new Date(d.fetchedAt*1000).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+' · '+d.account;st.className='muted';}
  if(!d.mails.length){box.innerHTML='<span class="muted">Posteingang leer.</span>';return;}
  box.innerHTML=d.mails.map(function(m){var l=ibLeadFor(m);
   var dt=m.epoch?new Date(m.epoch*1000).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
   return '<div class="ibmail'+(m.unread?' unread':'')+'"><div class="ibtop"><b>'+esc(m.fromName)+'</b>'+
    (l?'<span class="ibbadge" onclick="ibOpenLead('+l._i+')" title="Lead im CRM öffnen">👤 '+esc(l.name)+(l.company?' · '+esc(l.company):'')+'</span>':'')+
    '<small>'+dt+'</small></div><div class="ibsub">'+esc(m.subject)+'</div><div class="ibsnip">'+esc(m.snippet)+'</div>'+
    '<div class="iblinks"><a href="https://mail.google.com/mail/u/0/#inbox/'+esc(m.threadId||m.id)+'" target="_blank" rel="noopener">In Gmail öffnen ↗</a></div></div>';
  }).join('');
 }).catch(function(){box.innerHTML='<span class="muted">⚠ Server nicht erreichbar.</span>';});}
function loadSalesCopilot(){
 fetch('/api/salescopilot').then(r=>r.json()).then(d=>{
  const st=document.getElementById('sc-status'),sub=document.getElementById('sc-status-sub'),md=document.getElementById('sc-mode'),pj=document.getElementById('sc-project'),btn=document.getElementById('sc-startbtn'),stopbtn=document.getElementById('sc-stopbtn'),hint=document.getElementById('sc-hint');
  const rec=d.status&&!d.status.stale&&d.status.recording;
  if(rec){st.textContent='● REC';st.style.color='var(--red)';sub.textContent='nimmt auf seit '+(d.status.since?new Date(d.status.since*1000).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'—');}
  else if(d.running){st.textContent='BEREIT';st.style.color='var(--green)';sub.textContent='App läuft, wartet auf Call';}
  else{st.textContent='AUS';st.style.color='var(--muted)';sub.textContent='App ist nicht gestartet';}
  if(btn)btn.style.display=d.running?'none':'';
  if(stopbtn){stopbtn.style.display=d.running?'':'none';stopbtn.textContent=rec?'⏻ Notiz fertig & ausschalten':'⏻ Ausschalten';}
  md.textContent=(d.status&&!d.status.stale&&d.status.mode)||'—';
  pj.textContent=(d.status&&!d.status.stale&&d.status.project)?('Projekt: '+d.status.project):'';
  // Hinweis-Box: NUR wenn gerade aufgenommen wird — der Nutzer soll den laufenden Call
  // nicht vergessen zu stoppen, und weiß, wie er das Fenster zurückholt (Overlay ist evtl. versteckt).
  if(hint){
   if(rec){hint.style.display='';hint.innerHTML='<b style="color:var(--red)">● Aufnahme läuft gerade.</b> &nbsp;Fertig? Hier auf <b>⏻ Notiz fertig &amp; ausschalten</b> — die Notiz wird noch erstellt, dann fährt die App runter. Oder Fenster zurückholen mit <b>⌘⇧H</b> (bzw. weißer Punkt ○ oben rechts) und im Overlay auf <b>Stoppen</b>.';}
   else{hint.style.display='none';}
  }
  window.__scNotes=d.notes||[];
  scRenderNotes();
 }).catch(()=>{const st=document.getElementById('sc-status');if(st)st.textContent='FEHLER';});
 clearTimeout(window.__scT); if(window.CUR==='salescopilot')window.__scT=setTimeout(loadSalesCopilot,10000);
}
window.__scFilter=window.__scFilter||'alle'; window.__scNotes=window.__scNotes||[];
// Tab-Umschalter: Alle · Setting · Closing · Notizen ("Notizen" = alles außer Setting/Closing, z.B. Note-Taker-Learnings).
function scTab(f){window.__scFilter=f;document.querySelectorAll('#sc-tabs .pmtab').forEach(function(b){b.classList.toggle('on',b.dataset.f===f);});scRenderNotes();}
function scRenderNotes(){
 var box=document.getElementById('sc-notes'); if(!box)return;
 var f=window.__scFilter, all=window.__scNotes||[];
 var notes=all.filter(function(n){var c=(n.calltyp||'').toLowerCase();
  if(f==='setting')return c==='setting'; if(f==='closing')return c==='closing';
  if(f==='notiz')return c!=='setting'&&c!=='closing'; return true;});
 if(!notes.length){box.innerHTML='<span class="muted">Keine Notizen in dieser Ansicht.</span>';return;}
 box.innerHTML=notes.map(function(n){
  // Datum aus dem Frontmatter (echtes Call-Datum), Fallback mtime.
  var dt=/^\\d{4}-\\d{2}-\\d{2}$/.test(n.datum||'')?(n.datum.slice(8,10)+'.'+n.datum.slice(5,7)+'.'):new Date(n.mtime).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
  var typ=n.calltyp?n.calltyp.charAt(0).toUpperCase()+n.calltyp.slice(1):'';
  var rel=String(n.rel).replace(/'/g,"\\\\'");
  return '<div class="note" onclick="scOpenNote(&quot;'+n.rel+'&quot;)"><span>🗒 '+(n.teilnehmer?'<b style="color:var(--cyan)">'+esc(n.teilnehmer)+'</b> · ':'')+esc(n.name)+'</span>'+
   '<small>'+(typ?typ+' · ':'')+esc(n.projekt)+' · '+dt+' <button class="scdel" title="Notiz löschen" onclick="event.stopPropagation();scDeleteNote(\\''+rel+'\\')">🗑</button></small></div>';
 }).join('');
}
function scDeleteNote(rel){
 if(!confirm('Diese Notiz wirklich löschen?\\n\\n'+rel+'\\n\\nSie wandert in den Papierkorb (brain/.papierkorb) und ist wiederherstellbar.'))return;
 fetch('/api/note-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rel:rel})}).then(r=>r.json()).then(function(o){
  if(o&&o.ok){window.__scNotes=(window.__scNotes||[]).filter(function(n){return n.rel!==rel;});scRenderNotes();}
  else alert('Löschen fehlgeschlagen: '+((o&&o.error)||'unbekannt'));
 }).catch(function(){alert('Server nicht erreichbar.');});
}
function scStart(){fetch('/api/salescopilot/start',{method:'POST'}).then(()=>setTimeout(loadSalesCopilot,2500));}
function scStop(){var b=document.getElementById('sc-stopbtn');var wasRec=b&&b.textContent.indexOf('Notiz')>=0;if(wasRec&&!confirm('Aufnahme läuft. Erst wird die Notiz fertig erstellt, dann fährt die App runter. Ausschalten?'))return;if(b){b.disabled=true;b.textContent='… fährt runter';}fetch('/api/salescopilot/stop',{method:'POST'}).then(r=>r.json()).then(()=>{setTimeout(function(){if(b)b.disabled=false;loadSalesCopilot();},wasRec?8000:2500);}).catch(function(){if(b)b.disabled=false;});}
// Notiz INLINE im Sales-Copilot-Modul zeigen (nicht ins Brain-Modul springen — sonst
// findet der Nutzer nicht zurück). Klick auf [[Links]] öffnet die Ziel-Notiz im Brain.
function scOpenNote(rel){
 var card=document.getElementById('sc-viewercard'),v=document.getElementById('sc-viewer'),t=document.getElementById('sc-viewer-title');
 card.style.display='';t.textContent='Notiz lädt …';v.innerHTML='';
 card.scrollIntoView({behavior:'smooth',block:'nearest'});
 fetch('/api/note?path='+encodeURIComponent(rel)).then(r=>r.json()).then(function(n){
  t.textContent=n.title||rel;
  var md=(n.markdown||'').replace(/\\[\\[([^\\]|]+)(\\|([^\\]]+))?\\]\\]/g,function(m,a,b,c){return '<a onclick="openTitle(\\''+a.trim()+'\\')">'+(c||a)+'</a>';});
  v.innerHTML=marked.parse(md);
 }).catch(function(){t.textContent='Fehler';v.innerHTML='<span class="muted">Notiz nicht ladbar.</span>';});
}
function scCloseNote(){var card=document.getElementById('sc-viewercard');if(card)card.style.display='none';}
var OA_DAYS=[],OA_RANGE='today',OA_GOALS=null;
function setOaRange(r){OA_RANGE=r;document.querySelectorAll('.oa-rbtn').forEach(b=>b.classList.toggle('on',b.dataset.r===r));renderOaKpis();}
function oaDstr(off){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-off);return d.toISOString().slice(0,10);}
function oaSum(days){const k=['vernetzt','gesynct','erstnachrichten','inmails','followups'],a={};k.forEach(x=>a[x]=0);days.forEach(d=>k.forEach(x=>a[x]+=(d[x]||0)));return a;}
function oaRange(from,to){return OA_DAYS.filter(d=>d.date>=from&&d.date<=to);}
function loadOutreachStats(){
 Promise.all([fetch('/api/outreach-stats').then(r=>r.json()).catch(()=>({days:[]})),fetch('/api/agents').then(r=>r.json()).catch(()=>({agents:[]}))])
 .then(function(res){const s=res[0],ag=res[1];OA_DAYS=s.days||[];
  let gc=0,gm=0;(ag.agents||[]).forEach(a=>{const l=(a.config&&a.config.limits)||{};gc+=+(l.connectsPerDay||0);gm+=+(l.messagesPerDay||0);});
  OA_GOALS={connects:gc||20,messages:gm||15};
  renderOaKpis();renderOaTable();
 }).catch(()=>{const b=document.getElementById('oa-kpis');if(b)b.innerHTML='<span class="muted">Fehler beim Laden.</span>';});}
function renderOaKpis(){const box=document.getElementById('oa-kpis');if(!box)return;const today=oaDstr(0);
 let cur,prev,plabel;
 if(OA_RANGE==='today'){cur=oaRange(today,today);prev=oaRange(oaDstr(1),oaDstr(1));plabel='vs. gestern';}
 else if(OA_RANGE==='week'){cur=oaRange(oaDstr(6),today);prev=oaRange(oaDstr(13),oaDstr(7));plabel='vs. Vorwoche';}
 else{cur=oaRange(oaDstr(29),today);prev=oaRange(oaDstr(59),oaDstr(30));plabel='vs. 30 T davor';}
 const c=oaSum(cur),p=oaSum(prev);
 const cells=[['vernetzt','🔗 Vernetzungen'],['gesynct','🤝 Angenommen'],['erstnachrichten','✉️ Erstkontakt'],['inmails','📩 InMails'],['followups','↪️ Follow-ups']];
 box.innerHTML='<div class="stats" style="grid-template-columns:repeat(5,1fr);gap:10px">'+cells.map(function(k){
   const cv=c[k[0]]||0,pv=p[k[0]]||0;let chg='—',cls='';
   if(pv===0&&cv>0){chg='▲ neu';cls='up';}
   else if(pv>0){const pct=Math.round((cv-pv)/pv*100);cls=pct>0?'up':(pct<0?'warn':'');chg=(pct>0?'▲ ':(pct<0?'▼ ':''))+Math.abs(pct)+'% '+plabel;}
   return '<div class="stat"><div class="lbl">'+k[1]+'</div><div class="big">'+cv+'</div><div class="chg '+cls+'">'+chg+'</div></div>';
 }).join('')+'</div>';
 renderOaGoal(c);}
function renderOaGoal(c){const box=document.getElementById('oa-goal');if(!box)return;
 if(OA_RANGE!=='today'||!OA_GOALS){box.innerHTML='';return;}
 const conn=c.vernetzt||0,msg=(c.erstnachrichten||0)+(c.inmails||0)+(c.followups||0);
 const bar=function(val,goal,label,emoji){const pct=goal?Math.min(100,Math.round(val/goal*100)):0,done=goal&&val>=goal;
   return '<div style="flex:1"><div class="row" style="font-size:12px;margin-bottom:3px"><span>'+emoji+' '+label+'</span><span class="'+(done?'up':'muted')+'">'+val+' / '+goal+(done?' ✓':'')+'</span></div><div style="height:7px;background:var(--line);border-radius:4px;overflow:hidden"><i style="display:block;height:100%;width:'+pct+'%;background:'+(done?'var(--green)':'var(--cyan)')+'"></i></div></div>';};
 box.innerHTML='<div class="row" style="gap:14px;align-items:center"><span class="muted" style="font-size:11px">🎯 Tagesziel</span>'+bar(conn,OA_GOALS.connects,'Vernetzungen','🔗')+bar(msg,OA_GOALS.messages,'Messages','✉️')+'</div>';}
function renderOaTable(){const box=document.getElementById('oa-daily');if(!box)return;
 if(!OA_DAYS.length){box.innerHTML='<span class="muted">Noch keine Outreach-Läufe erfasst — füllt sich beim ersten Lauf.</span>';return;}
 const cols=[['vernetzt','🔗'],['gesynct','🤝'],['erstnachrichten','✉️'],['inmails','📩'],['followups','↪️']];
 let h='<table class="oa-tbl"><thead><tr><th>Tag</th>'+cols.map(c=>'<th>'+c[1]+'</th>').join('')+'</tr></thead><tbody>';
 for(const day of OA_DAYS){h+='<tr><td><b>'+esc(day.date)+'</b></td>'+cols.map(c=>'<td>'+(day[c[0]]||0)+'</td>').join('')+'</tr>';}
 h+='</tbody></table>';box.innerHTML=h;}
function popout(v){window.open(location.pathname+'#'+v,'_blank','width=1280,height=860');}
// ---- Content Pipeline (Cockpit: Board + Ideen-Feed + Analytics) ----
var CPDATA=null;
var CP_IG='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#e1306c" stroke-width="2" stroke-linecap="round"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.6" cy="6.4" r="1.1" fill="#e1306c" stroke="none"/></svg>';
function cpTypBadge(t){return t==='carousel'?'<span class="cptyp carousel">🖼 Karussell</span>':t==='post'?'<span class="cptyp post">📝 Post</span>':'<span class="cptyp reel">🎥 Reel</span>';}
function cpScoreCls(s){return s>=8?'hi':(s>=5?'mid':'');}
function cpKanal(x){return x.kanal||'LinkedIn';}
function cpKanalBadge(k){var li=(k||'LinkedIn')==='LinkedIn';return '<span class="cptyp" style="color:'+(li?'#36e0ff':'#e1306c')+';border-color:'+(li?'rgba(54,224,255,.4)':'rgba(225,48,108,.4)')+';background:'+(li?'rgba(54,224,255,.08)':'rgba(225,48,108,.08)')+'">'+(li?'in LinkedIn':'◎ Instagram')+'</span>';}
function cpQuelleBadge(q){
 if(q==='research')return '<span class="cptyp" style="color:var(--cyan);border-color:rgba(54,224,255,.4);background:rgba(54,224,255,.08)">🔍 Auto-Research</span>';
 if(q==='scrape')return '<span class="cptyp" style="color:#e1306c;border-color:rgba(225,48,108,.4);background:rgba(225,48,108,.08)">📥 Eingeworfen</span>';
 if(q==='nachtwerker')return '<span class="cptyp" style="color:#a78bfa;border-color:rgba(167,139,250,.4);background:rgba(167,139,250,.08)">🌙 Nachtwerker</span>';
 return '<span class="cptyp" style="color:#ffb547;border-color:rgba(255,181,71,.4);background:rgba(255,181,71,.08)">✎ Meine Idee</span>';}
// Ideen-Feed-Quellen (Wunsch 17.07.): 3 schaltbare Herkünfte, damit man die Sorten auseinanderhalten kann.
// eigen+nachtwerker = selbst erdacht · scrape = via Chat eingeworfene Creator-Posts · research = Competitor-Watch (Agent kommt noch).
var CPFEEDSRC=localStorage.getItem('cp-feedsrc')||'alle';
function cpFeedSrcOf(x){return x.quelle==='research'?'research':(x.quelle==='scrape'?'chat':'eigen');}
function cpFeedFilter(s){CPFEEDSRC=s;try{localStorage.setItem('cp-feedsrc',s);}catch(e){}cpRenderIdeas();}
function cpNum(n){if(n==null||n==='')return '';n=+n;if(isNaN(n))return '';return n>=1e6?(n/1e6).toFixed(1).replace('.',',')+' M':(n>=1e3?(n/1e3).toFixed(n>=1e4?0:1).replace('.',',')+'k':String(n));}
function cpAgeChip(x){var d=x.postDatum||x.erstellt||x.datum;if(!d)return '';var t=new Date(d).getTime();if(isNaN(t))return '';
 var days=Math.floor((Date.now()-t)/864e5);var txt=days<=0?'heute':(days===1?'gestern':'vor '+days+' T');
 var col=days<=7?'var(--green)':(days<=21?'var(--muted)':'#ff8f6d');
 return '<span style="color:'+col+';font-size:11px;white-space:nowrap" title="'+esc(String(d))+'">🕓 '+txt+(days>21?' · alt':'')+'</span>';}
function cpViralChips(x){var v=x.viral||{};var p=[];
 if(v.views!=null&&v.views!=='')p.push('👁 '+cpNum(v.views));
 if(v.likes!=null&&v.likes!=='')p.push('❤ '+cpNum(v.likes));
 if(v.comments!=null&&v.comments!=='')p.push('💬 '+cpNum(v.comments));
 if(v.shares!=null&&v.shares!=='')p.push('↗ '+cpNum(v.shares));
 if(!p.length)return '';
 return '<span style="display:inline-flex;gap:9px;color:#ffb547;font-size:11.5px;white-space:nowrap" title="Performance des Original-Posts">'+p.join(' ')+'</span>';}
// Ausreißer-Faktor (17.07.): wie stark der Original-Post über dem Account-Schnitt lief (Views/Median). Eigene Kennzahl neben dem Score.
function cpOutlier(x){var o=+x.outlier;if(!o||isNaN(o)||o<1.05)return 0;return o;}
function cpOutlierChip(x){var o=cpOutlier(x);if(!o)return '';
 var col=o>=2?'#ff5da2':(o>=1.5?'#ffb547':'var(--cyan)');
 var t=(Math.round(o*100)/100).toString().replace('.',',');
 return '<span title="Ausreißer-Faktor: '+t+'x über dem Account-Schnitt" style="display:inline-flex;align-items:center;gap:3px;font-weight:700;font-size:11px;color:'+col+';border:1px solid '+col+'55;background:'+col+'14;border-radius:999px;padding:1px 7px;white-space:nowrap">🚀 '+t+'x</span>';}
var CPFILTER=localStorage.getItem('cp-filter')||'LinkedIn'; // nur LinkedIn|Instagram — kein "Alle" (Wunsch 15.07.)
if(CPFILTER!=='LinkedIn'&&CPFILTER!=='Instagram')CPFILTER='LinkedIn';
function cpKanalFilter(k){CPFILTER=k;try{localStorage.setItem('cp-filter',k);}catch(e){}cpRenderBoard();cpRenderIdeas();}
function loadContentPipeline(){
 fetch('/api/content-pipeline').then(function(r){return r.json();}).then(function(d){
  CPDATA=d||{ideen:[],stages:[],analytics:{posts:[]}};
  cpRenderBoard();cpRenderIdeas();cpRenderAnalytics();
 }).catch(function(){var el=document.getElementById('cp-board');if(el)el.innerHTML='<span class="muted">⚠ konnte nicht laden</span>';});
}
function cpTab(which){
 ['pipeline','kalender','analytics'].forEach(function(k){
  var t=document.getElementById('cptab-'+k),v=document.getElementById(k==='pipeline'?'cp-pipeline':'cp-'+k+'-tab');
  if(t)t.classList.toggle('on',k===which);
  if(v)v.style.display=(k===which)?'':'none';
 });
 if(which==='kalender')cpRenderKalender();
}
function cpStages(){return (CPDATA&&CPDATA.stages&&CPDATA.stages.length)?CPDATA.stages:['Idee','Skript/Entwurf','In Arbeit','Freigabe','Live'];}
function cpMatchFilter(x){return cpKanal(x)===CPFILTER;}
function cpFilterBar(){return '<div class="cpfilters">'+
  ['LinkedIn','Instagram'].map(function(k){return '<button class="'+(CPFILTER===k?'on':'')+'" onclick="cpKanalFilter(\\''+k+'\\')">'+k+'</button>';}).join('')+
  '</div>';}
function cpRenderBoard(){var el=document.getElementById('cp-board');if(!el)return;
 el.classList.remove('plboard'); // Filter-Zeile steht ÜBER den Spalten, Board fängt links an (Wunsch 15.07.)
 var stages=cpStages(),ideen=(CPDATA.ideen||[]).filter(function(x){return x.started&&cpMatchFilter(x);});
 el.innerHTML=cpFilterBar()+'<div class="plboard" style="margin-top:0">'+stages.map(function(st){
  var cards=ideen.filter(function(x){return (x.stage||'Idee')===st;});
  return '<div class="plcol" ondragover="cpDragOver(event)" ondragleave="cpDragLeave(event)" ondrop="cpDrop(event,\\''+esc(st)+'\\')"><h4>'+esc(st)+'<span>'+cards.length+'</span></h4>'+
   (cards.length?cards.map(cpBoardCard).join(''):'<div class="muted" style="font-size:11px;padding:6px 2px">— hierher ziehen</div>')+'</div>';
 }).join('')+'</div>';
}
function cpBoardCard(x){var s=x.score||0;
 return '<div class="plcard cpcard" draggable="true" ondragstart="cpDragStart(event,\\''+x.id+'\\')" onclick="cpOpenIdea(\\''+x.id+'\\')">'+
  '<div class="cptop"><span class="cpscore '+cpScoreCls(s)+'">'+s+'/10</span>'+cpKanalBadge(cpKanal(x))+'</div>'+
  '<div class="cptit" style="font-size:12.5px;color:#eaf6ff;line-height:1.35;margin:2px 0 4px">'+esc(x.titel||'')+'</div>'+
  cpTypBadge(x.typ)+
 '</div>';
}
function cpRenderIdeas(){var el=document.getElementById('cp-ideas');if(!el)return;
 var pool=(CPDATA.ideen||[]).filter(function(x){return !x.started;});
 var counts={alle:pool.length,eigen:0,chat:0,research:0};
 pool.forEach(function(x){counts[cpFeedSrcOf(x)]++;});
 var tabs=[['alle','Alle'],['eigen','✎ Eigene'],['chat','📥 Eingeworfen'],['research','🔍 Auto-Research']];
 var bar='<div class="cpfilters" style="margin:0 0 10px">'+tabs.map(function(t){return '<button class="'+(CPFEEDSRC===t[0]?'on':'')+'" onclick="cpFeedFilter(\\''+t[0]+'\\')">'+t[1]+' <span style="opacity:.55">'+counts[t[0]]+'</span></button>';}).join('')+'</div>';
 var list=pool.filter(function(x){return CPFEEDSRC==='alle'||cpFeedSrcOf(x)===CPFEEDSRC;});
 // Neueste zuerst (Wunsch 17.07.): nach Post-Datum absteigend, Score als Gleichstand-Entscheider.
 list.sort(function(a,b){var da=new Date(a.postDatum||a.erstellt||0).getTime()||0,db=new Date(b.postDatum||b.erstellt||0).getTime()||0;return (db-da)||((b.score||0)-(a.score||0));});
 var empty=CPFEEDSRC==='research'?'Noch keine Auto-Research-Funde. Der Competitor-Watch-Agent ist noch nicht gebaut.':'Keine offenen Ideen in dieser Ansicht.';
 el.innerHTML=bar+(list.length?list.map(cpFeedRow).join(''):'<span class="muted">'+empty+'</span>');
}
function cpFeedRow(x){var s=x.score||0;var src=cpFeedSrcOf(x);
 var thumb=x.thumb?'<img src="'+esc(x.thumb)+'" style="width:100%;height:100%;object-fit:cover">':(src==='eigen'?'<span style="font-size:22px;opacity:.55">'+(x.quelle==='nachtwerker'?'🌙':'✎')+'</span>':CP_IG);
 var srcLabel=src==='eigen'?(x.quelle==='nachtwerker'?'<span style="color:#a78bfa">🌙 Nachtwerker</span>':'<span style="color:#ffb547">✎ eigene Idee</span>')
  :'<span style="display:inline-flex;align-items:center;gap:5px">'+CP_IG+' @'+esc(x.quelleAccount||'?')+(src==='research'?' <span style="color:var(--cyan)">· 🔍 Auto</span>':'')+'</span>';
 var reel=x.url?'<a href="'+esc(x.url)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:#e1306c;font-size:11.5px;white-space:nowrap;text-decoration:none">▶ Reel ansehen ↗</a>':'';
 var viral=cpViralChips(x),age=cpAgeChip(x);
 return '<div class="cpfrow" style="cursor:pointer" onclick="cpOpenIdea(\\''+x.id+'\\')">'+
  '<div style="flex:0 0 92px;min-height:82px;border:1px solid var(--line);border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,rgba(225,48,108,.08),rgba(54,224,255,.05))">'+thumb+'</div>'+
  '<div style="flex:1;min-width:0">'+
   '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="cpsrc">'+srcLabel+'</span><span style="display:inline-flex;gap:9px;align-items:center">'+age+cpOutlierChip(x)+'<span class="cpscore '+cpScoreCls(s)+'">'+s+'/10</span></span></div>'+
   '<div style="font-weight:600;color:#eaf6ff;font-size:13px;line-height:1.35;margin:4px 0">'+esc(x.titel||'')+'</div>'+
   '<div style="margin:4px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+cpTypBadge(x.typ)+cpKanalBadge(cpKanal(x))+viral+reel+'</div>'+
   (x.scoreGrund?'<div style="color:var(--muted);font-size:11.5px;line-height:1.5;margin:4px 0 0">'+esc(x.scoreGrund)+'</div>':'')+
  '</div>'+
  '<div style="flex:0 0 90px;display:flex;align-items:center"><button class="cpstart" onclick="event.stopPropagation();cpStartIdea(\\''+x.id+'\\')">▶ Start</button></div>'+
 '</div>';
}
function cpRenderAnalytics(){var el=document.getElementById('cp-analytics');if(!el)return;
 var a=(CPDATA.analytics&&CPDATA.analytics.posts)||[];
 var hint=document.getElementById('cp-anhint');
 if(hint&&CPDATA.analytics&&CPDATA.analytics.hinweis)hint.textContent=CPDATA.analytics.hinweis;
 if(!a.length){el.innerHTML='<span class="muted">Noch keine Posts. Kommt mit dem Instagram-Connect.</span>';return;}
 el.innerHTML=a.map(function(p){
  return '<div class="cpan"><div class="cpanthumb"><span class="cpanplat">'+CP_IG+'</span>'+(p.typ==='carousel'?'🖼':'🎥')+'</div>'+
   '<div class="cpanbody"><div class="cpantit">'+esc(p.titel||'')+'</div>'+
   '<div class="cpanmet"><span>👁 '+esc(p.views||'–')+'</span><span>❤ '+esc(p.likes||'–')+'</span><span>🔖 '+esc(p.saves||'–')+'</span></div></div></div>';
 }).join('');
}
function cpSave(id,fields,cb){fetch('/api/content-pipeline-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,fields:fields})}).then(function(r){return r.json();}).then(function(res){if(cb)cb(res);}).catch(function(){});}
function cpStartIdea(id){cpSave(id,{started:true,stage:'Idee'},function(){loadContentPipeline();});}
function cpAdvance(id){var it=(CPDATA.ideen||[]).find(function(x){return x.id===id;});if(!it)return;var stages=cpStages(),idx=stages.indexOf(it.stage||'Idee');if(idx<0||idx>=stages.length-1)return;cpSave(id,{stage:stages[idx+1]},function(){loadContentPipeline();});}
function cpFind(id){return (CPDATA&&CPDATA.ideen||[]).find(function(x){return x.id===id;});}
// Karte anklickbar: Lese-Modal (nur anschauen/durchlesen, NICHT ausschreiben).
function cpOpenIdea(id){var x=cpFind(id);if(!x)return;
 var box=document.getElementById('cp-modal-box'),m=document.getElementById('cp-modal');if(!box||!m)return;
 var s=x.score||0,scrape=x.quelle==='scrape'||x.quelle==='research';
 var hero=x.thumb?'<img src="'+esc(x.thumb)+'">':'<div style="font-size:34px;opacity:.7">'+(scrape?CP_IG:'✎')+'</div>';
 var stages=cpStages(),idx=stages.indexOf(x.stage||'Idee');
 var play=scrape?(x.url?'<a class="cpfplay" href="'+esc(x.url)+'" target="_blank" rel="noopener" title="Original auf Instagram ansehen" style="text-decoration:none">▶</a>':'<span class="cpfplay">▶</span>'):'';
 var viral=cpViralChips(x),age=cpAgeChip(x);
 box.innerHTML='<div class="cpovhero">'+hero+play+'<button class="cpovx" onclick="cpCloseModal()">✕</button></div>'+
  '<div class="cpovin">'+
   '<div class="cptop" style="margin-bottom:8px"><span class="cpscore '+cpScoreCls(s)+'">'+s+'/10</span>'+cpKanalBadge(cpKanal(x))+' '+cpQuelleBadge(x.quelle)+' '+cpTypBadge(x.typ)+'</div>'+
   '<div style="font-size:16px;font-weight:700;color:#eaf6ff;line-height:1.35">'+esc(x.titel||'')+'</div>'+
   (viral||age?'<label>Performance Original</label><p style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">'+viral+age+'</p>':'')+
   (x.hook?'<label>Hook</label><p style="color:#cfe6f5">'+esc(x.hook)+'</p>':'')+
   (x.notiz?'<label>Idee / Notiz</label><p>'+esc(x.notiz).replace(/\\n/g,'<br>')+'</p>':'')+
   (x.scoreGrund?'<label>Warum der Score</label><p>'+esc(x.scoreGrund)+'</p>':'')+
   (scrape&&x.quelleAccount?'<label>Quelle</label><p>'+CP_IG+' @'+esc(x.quelleAccount)+(x.quelleName?' · '+esc(x.quelleName):'')+'</p>':'')+
   (x.url?'<label>Original</label><p><a href="'+esc(x.url)+'" target="_blank" rel="noopener" style="color:#e1306c;text-decoration:none">▶ Auf Instagram ansehen ↗</a></p>':'')+
   (x.plannedAt?'<label>Geplant für</label><p style="color:#cfe6f5">🗓 '+esc(x.plannedAt)+'</p>':'')+
   '<div style="display:flex;gap:8px;margin-top:16px">'+
    '<button class="pop" onclick="cpEditIdea(\\''+x.id+'\\')">✎ Bearbeiten</button>'+
    (!x.started?'<button class="cpstart" style="flex:1" onclick="cpStartIdea(\\''+x.id+'\\');cpCloseModal()">▶ In die Pipeline</button>':
     (idx>=0&&idx<stages.length-1?'<button class="cpstart" style="flex:1" onclick="cpAdvance(\\''+x.id+'\\');cpCloseModal()">→ Nächste Stufe ('+esc(stages[idx+1])+')</button>':'<button class="cpstart" style="flex:1" disabled>✓ Live</button>'))+
   '</div>'+
  '</div>';
 m.style.display='flex';
}
function cpCloseModal(){var m=document.getElementById('cp-modal');if(m)m.style.display='none';}
// Bearbeiten-Modus im selben Modal: Titel/Hook/Text/Datum direkt ändern (Wunsch 15.07.)
function cpEditIdea(id){var x=cpFind(id);if(!x)return;
 var box=document.getElementById('cp-modal-box');if(!box)return;
 box.innerHTML='<div class="cpovin" style="padding-top:18px">'+
  '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b style="color:#eaf6ff">✎ Bearbeiten</b><button class="cpovx" style="position:static" onclick="cpOpenIdea(\\''+id+'\\')">✕</button></div>'+
  '<label>Titel</label><input id="cpe-titel" style="width:100%" value="'+esc(x.titel||'').replace(/"/g,'&quot;')+'">'+
  '<label style="margin-top:10px;display:block">Hook</label><textarea id="cpe-hook" rows="3" style="width:100%">'+esc(x.hook||'')+'</textarea>'+
  '<label style="margin-top:10px;display:block">Text / Skript</label><textarea id="cpe-notiz" rows="12" style="width:100%">'+esc(x.notiz||'')+'</textarea>'+
  '<label style="margin-top:10px;display:block">Geplant für (Content-Kalender)</label><input id="cpe-datum" type="date" value="'+esc(x.plannedAt||'')+'">'+
  '<label style="margin-top:10px;display:block">Reel-/Post-Link (Instagram-URL)</label><input id="cpe-url" style="width:100%" placeholder="https://www.instagram.com/…" value="'+esc(x.url||'').replace(/"/g,'&quot;')+'">'+
  '<label style="margin-top:10px;display:block">Thumbnail-URL (Miniaturbild)</label><input id="cpe-thumb" style="width:100%" placeholder="https://… (Bild-URL)" value="'+esc(x.thumb||'').replace(/"/g,'&quot;')+'">'+
  '<div style="display:flex;gap:8px;margin-top:10px">'+
   '<div style="flex:1"><label>👁 Views (Original)</label><input id="cpe-views" type="number" style="width:100%" value="'+esc(String((x.viral&&x.viral.views)!=null?x.viral.views:''))+'"></div>'+
   '<div style="flex:1"><label>❤ Likes</label><input id="cpe-likes" type="number" style="width:100%" value="'+esc(String((x.viral&&x.viral.likes)!=null?x.viral.likes:''))+'"></div>'+
   '<div style="flex:1"><label>🕓 Post-Datum</label><input id="cpe-postdatum" type="date" style="width:100%" value="'+esc(x.postDatum||'')+'"></div>'+
  '</div>'+
  '<div style="display:flex;gap:8px;margin-top:16px">'+
   '<button class="pop" onclick="cpOpenIdea(\\''+id+'\\')">Abbrechen</button>'+
   '<button class="cpstart" style="flex:1" onclick="cpSaveEdit(\\''+id+'\\')">💾 Speichern</button>'+
  '</div></div>';}
function cpSaveEdit(id){
 var x0=cpFind(id)||{};
 var viral=Object.assign({},x0.viral||{});
 var vv=document.getElementById('cpe-views').value,vl=document.getElementById('cpe-likes').value;
 if(vv==='')delete viral.views;else viral.views=+vv;
 if(vl==='')delete viral.likes;else viral.likes=+vl;
 var f={titel:document.getElementById('cpe-titel').value.trim(),hook:document.getElementById('cpe-hook').value.trim(),notiz:document.getElementById('cpe-notiz').value,plannedAt:document.getElementById('cpe-datum').value||'',
  url:document.getElementById('cpe-url').value.trim(),thumb:document.getElementById('cpe-thumb').value.trim(),postDatum:document.getElementById('cpe-postdatum').value||'',viral:viral};
 cpSave(id,f,function(){var x=cpFind(id);if(x)Object.assign(x,f);cpRenderBoard();cpRenderIdeas();cpRenderKalender();cpOpenIdea(id);});}
// Content-Kalender: Monatsraster, Posts nach plannedAt; ohne Datum unten als Chips.
// Planen per Drag & Drop: Chip auf einen Tag ziehen = Datum setzen, zwischen Tagen
// verschieben = umplanen, zurück auf die "Ohne Datum"-Zeile = Datum löschen.
// Reines Planen — es geht NICHTS live (Zernio noch nicht verbunden, Test-Mode).
var CPCALOFF=0;
function cpCalShift(d){CPCALOFF+=d;cpRenderKalender();}
function cpCalDrop(e,ds){e.preventDefault();e.currentTarget.classList.remove('dragover');
 var id=CPDRAG||(e.dataTransfer&&e.dataTransfer.getData('text/plain'));CPDRAG=null;
 var x=cpFind(id);if(!x||(x.plannedAt||'')===ds)return;
 x.plannedAt=ds;cpRenderKalender();
 cpSave(id,{plannedAt:ds},function(){});}
function cpCalChip(x,short){return '<div class="cpcalit" draggable="true" ondragstart="cpDragStart(event,\\''+x.id+'\\')" onclick="cpOpenIdea(\\''+x.id+'\\')" title="'+esc(x.titel||'')+'">'+(cpKanal(x)==='Instagram'?'◎':'in')+' '+esc((x.titel||'').slice(0,short))+'</div>';}
function cpRenderKalender(){var el=document.getElementById('cp-kalender');if(!el||!CPDATA)return;
 var base=new Date();base.setDate(1);base.setMonth(base.getMonth()+CPCALOFF);
 var y=base.getFullYear(),m=base.getMonth();
 var monat=base.toLocaleDateString('de-DE',{month:'long',year:'numeric'});
 var first=(new Date(y,m,1).getDay()+6)%7; // Mo=0
 var days=new Date(y,m+1,0).getDate();
 var todayStr=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Berlin'});
 var byDay={};(CPDATA.ideen||[]).forEach(function(x){if(x.plannedAt)((byDay[x.plannedAt]=byDay[x.plannedAt]||[])).push(x);});
 var html='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><button class="pop" onclick="cpCalShift(-1)">‹</button><b style="color:#eaf6ff;min-width:150px;text-align:center">'+esc(monat)+'</b><button class="pop" onclick="cpCalShift(1)">›</button><span class="muted" style="font-size:11px">Chips per Drag &amp; Drop auf einen Tag ziehen</span></div>';
 html+='<div class="cpcal">'+['Mo','Di','Mi','Do','Fr','Sa','So'].map(function(w){return '<div class="cpcalhd">'+w+'</div>';}).join('');
 for(var i=0;i<first;i++)html+='<div class="cpcald off"></div>';
 for(var d=1;d<=days;d++){
  var ds=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  var items=byDay[ds]||[];
  html+='<div class="cpcald'+(ds===todayStr?' today':'')+'" ondragover="cpDragOver(event)" ondragleave="cpDragLeave(event)" ondrop="cpCalDrop(event,\\''+ds+'\\')"><span class="cpcaldn">'+d+'</span>'+
   items.map(function(x){return cpCalChip(x,18);}).join('')+'</div>';
 }
 html+='</div>';
 var undated=(CPDATA.ideen||[]).filter(function(x){return x.started&&!x.plannedAt;});
 html+='<div class="cpcalpool" ondragover="cpDragOver(event)" ondragleave="cpDragLeave(event)" ondrop="cpCalDrop(event,\\'\\')">'+
  '<span class="muted" style="font-size:12px;margin-right:6px">Ohne Datum'+(undated.length?'':' — hierher ziehen löscht das Datum')+':</span>'+
  (undated.length?undated.map(function(x){return cpCalChip(x,28);}).join(''):'<span class="muted" style="font-size:11px">alles geplant 🎉</span>')+
 '</div>';
 el.innerHTML=html;}
// Drag zwischen Stufen (nur vorwärts/rückwärts manuell, spätere Auto-Progression separat).
var CPDRAG=null;
function cpDragStart(e,id){CPDRAG=id;try{e.dataTransfer.setData('text/plain',id);e.dataTransfer.effectAllowed='move';}catch(_){}}
function cpDragOver(e){e.preventDefault();e.dataTransfer.dropEffect='move';e.currentTarget.classList.add('dragover');}
function cpDragLeave(e){e.currentTarget.classList.remove('dragover');}
function cpDrop(e,stage){e.preventDefault();e.currentTarget.classList.remove('dragover');
 var id=CPDRAG||(e.dataTransfer&&e.dataTransfer.getData('text/plain'));CPDRAG=null;
 var x=cpFind(id);if(!x||(x.stage||'Idee')===stage)return;
 x.stage=stage;x.started=true;cpRenderBoard();cpSave(id,{stage:stage,started:true},function(){loadContentPipeline();});}
// ---- To-Dos (liest/schreibt Brain 07_Tasks, Rollen-Buckets) ----
var TDSRC=[]; // [{path,label,customer,raw}] — vom Server (/api/todos)
var TDROLES={me:['👤','Ich','#ffb547'],claude:['🧑‍💻','Claude Code','#36e0ff'],sub:['🤖','Subagent','#b07cff'],team:['👥','Team','#54e08a']};
var TDEMOJI={me:'👤',claude:'🧑‍💻',sub:'🤖',team:'👥'};
window.TD={};window.TDFILTER='all';window.TDCUST='all';window.TDSEC='all';window.TDKNOWN={};window.TDKUNDE={};
// Rolle steht ggf. HINTER Prio-Emojis (🔴 👤🧑‍💻 …) — Rollen-Cluster im Segment vor **/[[ suchen.
function tdRoleStr(t){t=t||'';var head=t.split(/\\*\\*|\\[\\[/)[0];var m=head.match(/(?:👤|🧑‍💻|🤖|👥)+/);return m?m[0]:'';}
function tdRolesOf(t){var s=tdRoleStr(t),o=[];if(s.indexOf('👤')>-1)o.push('me');if(s.indexOf('🧑‍💻')>-1)o.push('claude');if(s.indexOf('🤖')>-1)o.push('sub');if(s.indexOf('👥')>-1)o.push('team');return o.length?o:['none'];}
function tdStripRole(t){var rs=tdRoleStr(t);return rs?t.replace(rs,'').replace(/^\\s+/,''):t;}
function tdCustOf(src,line){if(src.customer)return src.customer;var links=line.match(/\\[\\[[^\\]]+\\]\\]/g)||[];for(var k=0;k<links.length;k++){var name=links[k].replace(/^\\[\\[|\\]\\]$/g,'').split('|')[0].split('/').pop().replace(/\\.md$/,'');if(window.TDKNOWN[name])return name;}return '';}
function loadTodos(){var list=document.getElementById('td-list');if(list)list.innerHTML='<span class="muted">… lädt</span>';
 fetch('/api/todos').then(function(r){return r.json();}).then(function(d){TDSRC=(d&&d.sources)||[];window.TD={};window.TDKNOWN=(d&&d.projects)||{};
  window.TDKUNDE={};((d&&d.kunden)||[]).forEach(function(k){window.TDKUNDE[k]=1;});
  TDSRC.forEach(function(a){window.TD[a.path]=a;if(a.customer&&!window.TDKNOWN[a.customer])window.TDKNOWN[a.customer]=a.label||a.customer;});
  renderTodos();}).catch(function(){if(list)list.innerHTML='<span class="muted">Konnte To-Dos nicht laden.</span>';});}
function tdSecClass(h){if(/signal/i.test(h||''))return 'signal';if(/noise/i.test(h||''))return 'noise';return '';}
function tdOpenLines(fn){for(var s=0;s<TDSRC.length;s++){var a=TDSRC[s],lines=(a.raw||'').split('\\n'),sec='';for(var i=0;i<lines.length;i++){var h=lines[i].match(/^#{2,3}\\s+(.*)$/);if(h){sec=tdSecClass(h[1]);continue;}var m=lines[i].match(/^\\s*-\\s+\\[([ xX])\\]\\s?(.*)$/);if(m&&m[1].toLowerCase()!=='x')fn(a,m[2],sec);}}}
function tdMatch(a,txt,sec,skip){
 if(skip!=='role'&&window.TDFILTER!=='all'&&tdRolesOf(txt).indexOf(window.TDFILTER)<0)return false;
 if(skip!=='cust'&&window.TDCUST!=='all'&&tdCustOf(a,txt)!==window.TDCUST)return false;
 if(skip!=='sec'&&window.TDSEC!=='all'&&sec!==window.TDSEC)return false;
 return true;}
function tdCounts(){var c={all:0,me:0,claude:0,sub:0,team:0,none:0};tdOpenLines(function(a,txt,sec){if(!tdMatch(a,txt,sec,'role'))return;c.all++;tdRolesOf(txt).forEach(function(r){c[r]=(c[r]||0)+1;});});return c;}
function tdSecCounts(){var c={all:0,signal:0,noise:0};tdOpenLines(function(a,txt,sec){if(!tdMatch(a,txt,sec,'sec'))return;c.all++;if(sec)c[sec]=(c[sec]||0)+1;});return c;}
function tdCustCounts(){var c={all:0};tdOpenLines(function(a,txt,sec){if(!tdMatch(a,txt,sec,'cust'))return;c.all++;var cu=tdCustOf(a,txt);if(cu)c[cu]=(c[cu]||0)+1;});return c;}
function renderFilter(){var box=document.getElementById('td-filter');if(!box)return;var c=tdCounts();
 var defs=[['all','🎯','Alle'],['me','👤','Ich'],['claude','🧑‍💻','Claude Code'],['sub','🤖','Subagents'],['team','👥','Team']];
 box.innerHTML=defs.map(function(d){return '<button class="tdfbtn'+(window.TDFILTER===d[0]?' on':'')+'" onclick="setTdFilter(\\''+d[0]+'\\')">'+d[1]+' '+d[2]+' <span class="n">'+(c[d[0]]||0)+'</span></button>';}).join('');}
function renderRow2(){var box=document.getElementById('td-row2');if(!box)return;var sc=tdSecCounts(),pc=tdCustCounts();
 var chips=[['all','Alle',sc.all],['signal','🎯 Signal',sc.signal],['noise','🔇 Noise',sc.noise]].map(function(d){return '<button class="tdfbtn'+(window.TDSEC===d[0]?' on':'')+'" onclick="setTdSec(\\''+d[0]+'\\')">'+d[1]+' <span class="n">'+(d[2]||0)+'</span></button>';}).join('');
 var mk=function(k){return '<option value="'+k+'"'+(window.TDCUST===k?' selected':'')+'>'+esc(window.TDKNOWN[k])+' ('+(pc[k]||0)+')</option>';};
 var keys=Object.keys(window.TDKNOWN).filter(function(k){return pc[k]||window.TDCUST===k;});
 var kunden=keys.filter(function(k){return window.TDKUNDE[k];}).sort(function(a,b){return (pc[b]||0)-(pc[a]||0);});
 var eigene=keys.filter(function(k){return !window.TDKUNDE[k];}).sort(function(a,b){return (pc[b]||0)-(pc[a]||0);});
 var sel='<select id="td-proj" class="tdproj" onchange="setTdCust(this.value)"><option value="all">📁 Alle Projekte ('+(pc.all||0)+')</option>'
  +(kunden.length?'<optgroup label="Kundenprojekte">'+kunden.map(mk).join('')+'</optgroup>':'')
  +(eigene.length?'<optgroup label="Meine Projekte">'+eigene.map(mk).join('')+'</optgroup>':'')+'</select>';
 box.innerHTML=chips+sel;
 var ap=document.getElementById('td-proj-add');
 if(ap){var cur=ap.value;var allKeys=Object.keys(window.TDKNOWN);
  var mkA=function(k){return '<option value="'+k+'">'+esc(window.TDKNOWN[k])+'</option>';};
  var ku=allKeys.filter(function(k){return window.TDKUNDE[k];}).sort();
  var ei=allKeys.filter(function(k){return !window.TDKUNDE[k];}).sort();
  ap.innerHTML='<option value="">📁 — Projekt</option>'
   +(ku.length?'<optgroup label="Kundenprojekte">'+ku.map(mkA).join('')+'</optgroup>':'')
   +(ei.length?'<optgroup label="Meine Projekte">'+ei.map(mkA).join('')+'</optgroup>':'');
  ap.value=cur||'';}}
function setTdFilter(r){window.TDFILTER=r;renderTodos();}
function setTdSec(s){window.TDSEC=s;renderTodos();}
function setTdCust(k){window.TDCUST=k;renderTodos();var ap=document.getElementById('td-proj-add');if(ap)ap.value=(k==='all'?'':k);}
function renderTodos(){renderFilter();renderRow2();var list=document.getElementById('td-list');if(!list)return;var html='';
 for(var s=0;s<TDSRC.length;s++){var a=TDSRC[s],lines=(a.raw||'').split('\\n');
  var fileBody='',secHtml='',secHas=false,fileHas=false,cursec='',doneHtml='',doneN=0;
  var flush=function(){if(secHas)fileBody+=secHtml;secHtml='';secHas=false;};
  for(var i=0;i<lines.length;i++){var ln=lines[i];
   var h=ln.match(/^(#{2,3})\\s+(.*)$/);if(h){flush();cursec=tdSecClass(h[2]);secHtml='<div class="tdsec">'+esc(h[2])+'</div>';continue;}
   var m=ln.match(/^(\\s*)-\\s+\\[([ xX])\\]\\s?(.*)$/);if(!m)continue;
   var roles=tdRolesOf(m[3]);
   if(!tdMatch(a,m[3],cursec))continue;
   fileHas=true;var done=m[2].toLowerCase()==='x';var ind=m[1].length>=2?' ind':'';
   var badge=roles.map(function(rk){var rr=TDROLES[rk];return rr?'<span class="tdrole" style="color:'+rr[2]+';border-color:'+rr[2]+'55">'+rr[0]+'</span>':'';}).join('');
   var txt=tdStripRole(m[3]);
   var row='<div class="tditem'+(done?' done':'')+ind+'" onclick="toggleTodo(\\''+a.path+'\\','+i+')"><span class="box">'+(done?'✓':'')+'</span><span class="txt">'+esc(txt)+'</span>'+badge+'<span class="tddel" title="löschen" onclick="delTodo(event,\\''+a.path+'\\','+i+')">✕</span></div>';
   // Erledigte Punkte NIE aus der Datei löschen — nur aus der aktiven Ansicht in einen
   // eingeklappten Block schieben, damit Alte-Recherche/Deja-vu nicht passiert, aber die
   // Liste nicht mit Vergangenem zumüllt.
   if(done){doneHtml+=row;doneN++;}else{secHas=true;secHtml+=row;}}
  flush();
  if(doneN)fileBody+='<details class="tddone"><summary>✅ '+doneN+' erledigt</summary>'+doneHtml+'</details>';
  if(fileHas)html+='<div class="tdfile"><h3>'+esc(a.label)+'</h3>'+fileBody+'</div>';}
 list.innerHTML=html||'<span class="muted">Nichts in diesem Filter.</span>';
 var dt=document.getElementById('d-tasks');if(dt)dt.textContent=tdCounts().me;}
function toggleTodo(path,idx){var a=window.TD[path];if(!a)return;var lines=a.raw.split('\\n');var m=lines[idx]&&lines[idx].match(/^(\\s*-\\s+\\[)([ xX])(\\].*)$/);if(!m)return;
 lines[idx]=m[1]+(m[2].toLowerCase()==='x'?' ':'x')+m[3];a.raw=lines.join('\\n');renderTodos();
 fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:path,markdown:a.raw})}).then(function(){loadTodos();}).catch(function(){});}
function delTodo(ev,path,idx){if(ev&&ev.stopPropagation)ev.stopPropagation();var a=window.TD[path];if(!a)return;var lines=a.raw.split('\\n');if(idx<0||idx>=lines.length)return;
 if(!/^\\s*-\\s+\\[[ xX]\\]/.test(lines[idx]||''))return;
 lines.splice(idx,1);a.raw=lines.join('\\n');renderTodos();
 fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:path,markdown:a.raw})}).then(function(){loadTodos();}).catch(function(){});}
function addTodo(){var inp=document.getElementById('td-new');var v=(inp.value||'').trim();if(!v)return;
 var rsel=document.getElementById('td-role');var em=(rsel&&TDEMOJI[rsel.value])?TDEMOJI[rsel.value]+' ':'';
 var psel=document.getElementById('td-proj-add');var proj=(psel&&psel.value)||'';
 var task='- [ ] '+em+v;
 var tdSave=function(a){inp.value='';renderTodos();fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:a.path,markdown:a.raw})}).then(function(){loadTodos();}).catch(function(){});};
 if(proj){var pa=window.TD['03_Projects/'+proj+'.md'];
  if(pa){// Projektnotiz hat schon eine To-Do-Liste → dort einsortieren (Regel: Kunden-To-Dos leben in der Projektnotiz)
   var plines=pa.raw.split('\\n'),hi=-1;
   for(var j=0;j<plines.length;j++){if(/^#{2,3}\\s.*to-dos/i.test(plines[j])){hi=j;break;}}
   var pins;
   if(hi>=0){pins=hi+1;while(pins<plines.length&&!/^#{1,3}\\s/.test(plines[pins]))pins++;while(pins>hi+1&&!plines[pins-1].trim())pins--;}
   else{pins=plines.length;}
   plines.splice(pins,0,task);pa.raw=plines.join('\\n');return tdSave(pa);}
  // Notiz (noch) ohne Checkbox-Liste → tasks.md mit [[Link]], taucht so trotzdem im Projektfilter auf
  task+=' → [['+proj+']]';}
 var sel=document.getElementById('td-target');var want=(sel&&sel.value)||'signal';
 var a=window.TD['07_Tasks/tasks.md'];if(!a)return;var lines=a.raw.split('\\n'),after=-1;
 for(var i=0;i<lines.length;i++){var h=lines[i].match(/^#{2,3}\\s+(.*)$/);if(h&&tdSecClass(h[1])===want){after=i;break;}}
 var ins=lines.length;if(after>=0){ins=after+1;while(ins<lines.length&&!/^#{1,3}\\s/.test(lines[ins]))ins++;while(ins>after+1&&!lines[ins-1].trim())ins--;}
 lines.splice(ins,0,task);a.raw=lines.join('\\n');tdSave(a);}
// ---- Outreach-Streak ----
function loadStreak(){fetch('/api/streak').then(r=>r.json()).then(renderStreak).catch(()=>{});}
function renderStreak(s){const d=document.getElementById('sk-days');if(!d)return;d.textContent=s.streak||0;document.getElementById('sk-touch').textContent=s.touchesToday||0;document.getElementById('sk-meet').textContent=s.meetingsWeek||0;const st=document.getElementById('sk-streak');if(st)st.textContent=(s.streak>0?('🔥 '+s.streak+' Tage'):'heute noch kein Outreach');const tg=document.getElementById('sk-touchgoal');if(tg)tg.textContent=((s.touchesToday||0)>=5?'Ziel erreicht ✅':'Ziel 5')+((s.autoToday||0)>0?(' · '+s.autoToday+' vom Agent'):'');}
function skTouch(){fetch('/api/streak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'touch'})}).then(r=>r.json()).then(s=>{renderStreak(s);pulseOrb();}).catch(()=>{});}
function skMeet(){fetch('/api/streak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'meeting'})}).then(r=>r.json()).then(renderStreak).catch(()=>{});}
// ---- Finanzen (Rechnungs-Tracking) ----
window.INV=[];
function loadInvoices(){fetch('/api/invoices').then(r=>r.json()).then(d=>{window.INV=(d&&d.invoices)||[];renderInvoices();}).catch(()=>{});}
function invStatus(iv){if(iv.status==='bezahlt')return 'bezahlt';const t=new Date().toISOString().slice(0,10);if(iv.faellig&&iv.faellig<t)return 'ueberfaellig';return 'offen';}
function eur(n){return (Number(n)||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';}
function renderInvoices(){const st=document.getElementById('inv-stats'),list=document.getElementById('inv-list');if(!list)return;
 let off=0,bez=0,ueb=0;for(const iv of window.INV){const s=invStatus(iv),b=Number(iv.betrag)||0;if(s==='bezahlt')bez+=b;else{off+=b;if(s==='ueberfaellig')ueb+=b;}}
 if(st)st.innerHTML=[['Offen',off,'var(--cyan)'],['Überfällig',ueb,'#ff6b6b'],['Bezahlt',bez,'var(--green)']].map(k=>'<div class="stat"><div class="lbl">'+k[0]+'</div><div class="big" style="color:'+k[2]+'">'+eur(k[1])+'</div></div>').join('');
 if(!window.INV.length){list.innerHTML='<span class="muted">Noch keine Rechnungen erfasst — oben hinzufügen oder „🧾 Rechnungstool".</span>';return;}
 const rows=window.INV.map((iv,i)=>{const s=invStatus(iv),lbl=(s==='ueberfaellig'?'überfällig':s);
  const rem=(iv.reminders&&iv.reminders.length)||0;
  const pdf=iv.pdf?'<a href="/rechnungen/'+encodeURIComponent(iv.pdf)+'" target="_blank" title="PDF öffnen">📄</a>':'';
  const mail=(iv.email&&s!=='bezahlt')?'<button class="ivdel" style="color:var(--cyan)" title="Zahlungserinnerung als Gmail-Entwurf erstellen'+(rem?' (bisher '+rem+')':'')+'" onclick="invReminder('+i+')">✉'+(rem||'')+'</button>':(rem?'<span class="muted" title="Erinnerungen">✉'+rem+'</span>':'');
  return '<tr><td>'+esc(iv.nr||'—')+'</td><td title="'+esc(iv.email||'')+'">'+esc(iv.kunde||'—')+'</td><td>'+eur(iv.betrag)+'</td><td>'+esc(iv.datum||'')+'</td><td>'+esc(iv.faellig||'')+'</td><td><span class="ivpill ivp-'+s+'" onclick="cycleInvoice('+i+')" title="klicken: offen ↔ bezahlt'+(iv.bezahltAm?' · bezahlt am '+iv.bezahltAm+' ('+esc(iv.zahlungsQuelle||'')+')':'')+'">'+lbl+'</span></td><td>'+pdf+'</td><td>'+mail+'</td><td><button class="ivdel" onclick="delInvoice('+i+')">✕</button></td></tr>';}).join('');
 list.innerHTML='<table class="invtbl"><thead><tr><th>Nr.</th><th>Kunde</th><th>Betrag</th><th>Verschickt</th><th>Fällig</th><th>Status</th><th></th><th></th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';}
function toggleRtool(){var w=document.getElementById('rtool-wrap'),f=document.getElementById('rtool');if(!f.src)f.src='/rechnungstool';w.style.display=(w.style.display==='none')?'':'none';if(w.style.display!=='none')w.scrollIntoView({behavior:'smooth'});}
window.addEventListener('message',function(e){if(e.data==='invoices-updated')loadInvoices();});
function wiseMatch(btn){if(btn){btn.disabled=true;btn.textContent='… gleiche ab';}
 fetch('/api/rechnung/match',{method:'POST'}).then(r=>r.json()).then(d=>{
  if(btn){btn.disabled=false;btn.textContent='🔄 Wise-Abgleich';}
  if(d.matched&&d.matched.length)alert('💰 Bezahlt erkannt: '+d.matched.map(m=>m.nr+' · '+m.kunde+' ('+eur(m.betrag)+')').join(', '));
  else if(d.error)alert('Wise-Abgleich: '+d.error);
  else alert('Keine neuen Zahlungseingänge zu offenen Rechnungen.');
  loadInvoices();
 }).catch(()=>{if(btn){btn.disabled=false;btn.textContent='🔄 Wise-Abgleich';}});}
function invReminder(i){var iv=window.INV[i];if(!iv)return;
 if(!iv.nr){alert('Manuell erfasste Rechnung ohne Nr. — Erinnerung bitte selbst schicken.');return;}
 if(!confirm('Zahlungserinnerung für '+iv.nr+' ('+(iv.kunde||'')+') als Gmail-Entwurf erstellen?'))return;
 fetch('/api/rechnung/reminder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nr:iv.nr})}).then(r=>r.json()).then(d=>{
  alert(d.ok?'✉️ Entwurf liegt in Gmail bereit (Stufe '+d.stufe+'). Kurz checken und absenden.':'Fehler: '+(d.error||'unbekannt'));loadInvoices();}).catch(()=>{});}
function saveInvoices(){fetch('/api/invoices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invoices:window.INV})}).catch(()=>{});}
function addInvoice(){const k=document.getElementById('iv-kunde'),b=document.getElementById('iv-betrag'),d=document.getElementById('iv-datum'),f=document.getElementById('iv-faellig');
 if(!(k.value||'').trim()&&!(b.value||'').trim())return;
 window.INV.push({kunde:k.value.trim(),betrag:Number(b.value)||0,datum:d.value||new Date().toISOString().slice(0,10),faellig:f.value||'',status:'offen'});
 k.value='';b.value='';d.value='';f.value='';renderInvoices();saveInvoices();}
function cycleInvoice(i){const iv=window.INV[i];if(!iv)return;iv.status=(iv.status==='bezahlt')?'offen':'bezahlt';renderInvoices();saveInvoices();}
function delInvoice(i){if(!window.INV[i])return;window.INV.splice(i,1);renderInvoices();saveInvoices();}
// ---- Amex-Ausgaben (CSV-Import) ----
window.EXP=[];
function loadExpenses(){fetch('/api/expenses').then(r=>r.json()).then(d=>{window.EXP=(d&&d.expenses)||[];renderExpenses();renderTx();renderMonths();}).catch(()=>{});}
function saveExpenses(){fetch('/api/expenses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expenses:window.EXP})}).catch(()=>{});}
function renderExpenses(){const st=document.getElementById('exp-stats'),list=document.getElementById('exp-list');if(!list)return;
 let sum=0;for(const e of window.EXP)sum+=Number(e.betrag)||0;
 if(st)st.innerHTML='<div class="stat"><div class="lbl">Ausgaben gesamt</div><div class="big" style="color:#ff6b6b">'+eur(sum)+'</div></div><div class="stat"><div class="lbl">Buchungen</div><div class="big">'+window.EXP.length+'</div></div>';
 if(!window.EXP.length){list.innerHTML='<span class="muted">Noch keine Amex-Umsätze — oben CSV importieren.</span>';return;}
 const rows=window.EXP.slice().sort((a,b)=>String(b.datum||'').localeCompare(String(a.datum||''))).map(e=>'<tr><td>'+esc(e.datum||'')+'</td><td>'+esc(e.beschreibung||'')+'</td><td style="text-align:right">'+eur(e.betrag)+'</td></tr>').join('');
 list.innerHTML='<table class="invtbl"><thead><tr><th>Datum</th><th>Beschreibung</th><th style="text-align:right">Betrag</th></tr></thead><tbody>'+rows+'</tbody></table>';
 renderKonten();}
function importAmex(input){const files=Array.from(input.files||[]);if(!files.length)return;let done=0,all=(window.EXP||[]).slice();
 files.forEach(function(f){const rd=new FileReader();
  rd.onload=function(){try{all=all.concat(parseAmexCsv(String(rd.result)));}catch(e){}
   if(++done===files.length){const seen={},uniq=[];for(const e of all){const k=e.datum+'|'+e.beschreibung+'|'+e.betrag;if(seen[k])continue;seen[k]=1;uniq.push(e);}
    window.EXP=uniq;renderExpenses();saveExpenses();input.value='';
    if(!uniq.length)alert('Keine Umsätze erkannt — Format prüfen, ich pass den Parser an.');else alert('Importiert: '+uniq.length+' Buchungen aus '+files.length+' Datei(en).');}};
  rd.readAsText(f);});}
function splitCsvLine(line,delim){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(q){if(c==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}else{if(c==='"')q=true;else if(c===delim){out.push(cur);cur='';}else cur+=c;}}out.push(cur);return out;}
function parseNum(s){s=String(s||'').replace(/[^0-9.,-]/g,'').trim();if(!s)return 0;
 if(s.indexOf(',')>-1&&s.indexOf('.')>-1){if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
 else if(s.indexOf(',')>-1)s=s.replace(',','.');
 return Math.abs(parseFloat(s)||0);}
function parseAmexCsv(text){const lines=text.split(/\\r?\\n/).filter(l=>l.trim());if(!lines.length)return [];
 const delim=(lines[0].split(';').length>lines[0].split(',').length)?';':',';
 const head=splitCsvLine(lines[0],delim).map(h=>h.toLowerCase().trim());
 const hasHeader=head.some(h=>/datum|date|beschreib|description|betrag|amount|wert/.test(h));
 let start=0,ci={d:-1,b:-1,a:-1};
 if(hasHeader){start=1;head.forEach((h,i)=>{if(ci.d<0&&/datum|date/.test(h))ci.d=i;if(ci.b<0&&/beschreib|description|verwendung|text|händler|merchant|karteninhaber/.test(h))ci.b=i;if(ci.a<0&&/betrag|amount|wert/.test(h))ci.a=i;});}
 if(ci.d<0)ci.d=0;if(ci.a<0)ci.a=head.length-1;if(ci.b<0)ci.b=Math.min(1,head.length-1);
 const out=[];for(let i=start;i<lines.length;i++){const c=splitCsvLine(lines[i],delim);if(c.length<2)continue;const betrag=parseNum(c[ci.a]);if(!betrag)continue;out.push({datum:String(c[ci.d]||'').trim(),beschreibung:String(c[ci.b]||'').trim(),betrag:betrag});}
 return out;}
// ---- Konten (Wise + Amex Status) ----
window.WISE=null;window.GC=null;
function loadWise(){fetch('/api/wise').then(r=>r.json()).then(w=>{window.WISE=w;renderKonten();}).catch(()=>{window.WISE={connected:false};renderKonten();});}
function loadGoCardless(){fetch('/api/gocardless/status').then(r=>r.json()).then(g=>{window.GC=g;renderKonten();}).catch(()=>{window.GC={configured:false};renderKonten();});}
function renderKonten(){const box=document.getElementById('konten');if(!box)return;const w=window.WISE,g=window.GC||{};
 let biz='Token nötig',prv='Token nötig',bizOn=false,prvOn=false;
 if(w&&w.connected&&w.profiles){for(const p of w.profiles){const nz=(p.balances||[]).filter(b=>Number(b.value));const s=(nz.length?nz:(p.balances||[]).slice(0,1)).map(b=>eur(b.value)+' '+(b.currency||'')).join(' · ')||'verbunden';if(p.type==='business'){biz=s;bizOn=true;}else{prv=s;prvOn=true;}}}
 else if(w&&!w.connected&&w.error){biz=prv='Fehler: '+w.error;}
 let amexTxt,amexOn=false,amexBtn='';
 if(g.linked){amexOn=true;amexTxt=(g.institution||'Amex')+' · '+(g.accounts||0)+' Konto(s)'+(g.lastSync?' · sync '+String(g.lastSync).slice(0,10):'');amexBtn='<button class="amexmini" onclick="gcSync()">↻ Sync</button>';}
 else if(g.configured){amexTxt='bereit zum Verbinden';amexBtn='<button class="amexmini" onclick="gcConnect()">🔗 Amex verbinden</button>';}
 else{const csv=!!(window.EXP&&window.EXP.length);amexOn=csv;amexTxt=csv?(window.EXP.length+' Buchungen · CSV'):'GoCardless-Secrets nötig (oder CSV oben)';}
 box.innerHTML=[
  ['🏦 Wise Business',biz,bizOn,''],
  ['👤 Wise Privat',prv,prvOn,''],
  ['💳 Amex',amexTxt,amexOn,amexBtn]
 ].map(k=>'<div class="konto"><div class="kt"><span class="kdot '+(k[2]?'on':'off')+'"></span>'+k[0]+(k[3]?'<span style="margin-left:auto">'+k[3]+'</span>':'')+'</div><div class="kd">'+esc(k[1])+'</div></div>').join('');}
function gcConnect(){fetch('/api/gocardless/institutions?country=de').then(r=>r.json()).then(d=>{
  if(!d.configured){alert('Zuerst GoCardless Secret-ID + Secret-Key in .env eintragen.');return;}
  if(d.error){alert('GoCardless: '+d.error);return;}
  const insts=d.institutions||[];let pick=insts.find(i=>/amex|american express/i.test(i.name));
  if(!pick){const name=prompt('Amex nicht direkt in DE gefunden. Institut aus der Liste tippen:\\n'+insts.map(i=>i.name).slice(0,60).join(', '));if(!name)return;pick=insts.find(i=>i.name.toLowerCase().includes(name.toLowerCase()));if(!pick){alert('Nicht gefunden.');return;}}
  fetch('/api/gocardless/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({institution_id:pick.id,institution_name:pick.name})}).then(r=>r.json()).then(c=>{if(c.ok&&c.link)window.open(c.link,'_blank');else alert('Verbinden fehlgeschlagen: '+(c.error||''));});
 }).catch(()=>alert('GoCardless nicht erreichbar.'));}
function gcSync(){fetch('/api/gocardless/sync',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.ok){alert('Importiert: '+d.imported+' Buchungen.');loadExpenses();loadGoCardless();}else alert('Sync fehlgeschlagen: '+(d.error||''));}).catch(()=>{});}
function amexScan(){fetch('/api/amex/scan',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.ok){alert('Aus Ordner geladen: '+d.imported+' Buchungen aus '+d.files+' CSV-Datei(en).');loadExpenses();}else alert('Ordner-Scan fehlgeschlagen.');}).catch(()=>alert('Ordner-Scan nicht erreichbar.'));}
window.WPRIV=[];
function loadWisePrivat(){fetch('/api/wise/scan',{method:'POST'}).then(r=>r.json()).then(d=>{window.WPRIV=(d&&d.transactions)||[];renderTx();renderMonths();}).catch(()=>{});}
function refreshCsv(){Promise.all([fetch('/api/amex/scan',{method:'POST'}).then(r=>r.json()).catch(()=>({})),fetch('/api/wise/scan',{method:'POST'}).then(r=>r.json()).catch(()=>({}))]).then(function(res){const a=res[0]||{},w=res[1]||{};window.WPRIV=w.transactions||[];loadExpenses();renderTx();renderMonths();alert('Aktualisiert 🔄\\nAmex: '+(a.imported||0)+' Buchungen · Wise: '+(w.imported||0)+' Ausgaben.');}).catch(()=>alert('Aktualisieren fehlgeschlagen.'));}
// ---- Einnahmen & Ausgaben (Wise-Transaktionen) ----
window.TXALL=[];window.TXDAYS=30;
function loadTx(){const l=document.getElementById('tx-list');if(l)l.innerHTML='<span class="muted">… lädt Wise-Transaktionen …</span>';
 fetch('/api/wise/transactions?days=365').then(r=>r.json()).then(d=>{window.TXALL=(d&&d.transactions)||[];renderTx();renderMonths();}).catch(()=>{const x=document.getElementById('tx-list');if(x)x.innerHTML='<span class="muted">Fehler beim Laden.</span>';});}
function allFinanceTx(){const wise=(window.TXALL||[]).map(t=>({datum:t.datum,typ:t.typ,betrag:t.betrag,beschreibung:t.beschreibung,konto:t.konto,waehrung:t.waehrung}));const amex=(window.EXP||[]).map(e=>({datum:String(e.datum||''),typ:'out',betrag:e.betrag,beschreibung:e.beschreibung,konto:'amex',waehrung:'EUR'}));const wpriv=(window.WPRIV||[]).map(e=>({datum:String(e.datum||''),typ:'out',betrag:e.betrag,beschreibung:e.beschreibung,konto:'privat',waehrung:'EUR'}));return wise.concat(amex).concat(wpriv);}
function kontoIcon(k){return k==='business'?'🏦':(k==='amex'?'💳':'👤');}
function txInRange(){const cut=new Date(Date.now()-window.TXDAYS*86400000).toISOString().slice(0,10);return allFinanceTx().filter(t=>String(t.datum)>=cut);}
function setTxRange(d,btn){window.TXDAYS=d;document.querySelectorAll('#v-finanzen .rbtn').forEach(b=>b.classList.remove('on'));if(btn)btn.classList.add('on');renderTx();}
function renderTx(){const st=document.getElementById('tx-stats'),list=document.getElementById('tx-list');if(!list)return;const TX=txInRange();
 let ein=0,aus=0;for(const t of TX){if(t.typ==='in')ein+=Number(t.betrag)||0;else aus+=Number(t.betrag)||0;}
 const netto=ein-aus;
 if(st)st.innerHTML=[['Einnahmen',ein,'var(--green)','+'],['Ausgaben',aus,'#ff6b6b','−'],['Netto',netto,netto>=0?'var(--cyan)':'#ff6b6b',(netto>=0?'+':'−')]].map(k=>'<div class="stat"><div class="lbl">'+k[0]+'</div><div class="big" style="color:'+k[2]+'">'+k[3]+eur(Math.abs(k[1]))+'</div></div>').join('');
 if(!TX.length){list.innerHTML='<span class="muted">Keine Transaktionen im Zeitraum.</span>';renderPie();return;}
 const rows=TX.filter(t=>t.konto!=='amex').slice().sort((a,b)=>String(b.datum).localeCompare(String(a.datum))).map(t=>'<tr><td>'+esc(t.datum)+'</td><td title="'+esc(t.konto||'')+'">'+kontoIcon(t.konto)+'</td><td>'+esc(t.beschreibung||'—')+'</td><td style="text-align:right;white-space:nowrap;color:'+(t.typ==='in'?'var(--green)':'#ff6b6b')+'">'+(t.typ==='in'?'+':'−')+eur(t.betrag)+' '+esc(t.waehrung||'')+'</td></tr>').join('');
 list.innerHTML='<table class="invtbl"><thead><tr><th>Datum</th><th></th><th>Beschreibung</th><th style="text-align:right">Betrag</th></tr></thead><tbody>'+rows+'</tbody></table>';renderPie();}
var CATRULES=[
 ['Wohnen',/airbnb|booking\.com|hotel|\brent\b|miete|apartment|hostel|expedia|agoda/i],
 ['Subscriptions/Tools',/openai|chatgpt|anthropic|claude|hetzner|voiceflow|apify|elevenlabs|higgsfield|n8n|make\.com|zapier|notion|figma|adobe|github|vercel|netlify|google|microsoft|spotify|netflix|icloud|apple\.com|canva|calendly|typeform|\bloom\b|slack|zoom|fonio|instantly|smartlead|\bclay\b|dropscan|quimple|anymailfinder|webgo|stackblitz/i],
 ['Lebensmittel',/amzn|amazon|spar|freshmart|lidl|rewe|kaufland|migros|grocer|supermarkt|conad|billa|carrefour|aldi|edeka/i],
 ['Restaurants',/kfc|burger king|mcdonald|restaurant|glovo|wolt|uber ?eats|pizza|cafe|coffee|starbucks|kebab|sushi|bistro|dominos|dajti/i],
 ['Transport',/\buber\b|bolt|taxi|ryanair|wizz|lufthansa|flight|flug|\bbahn\b|train|shell|aral|westfalen|tankstelle|fuel|petrol|benzin|yandex/i],
 ['Shopping/Kleidung',/zara|h&m|nike|adidas|zalando|clothing|fashion|decathlon|ikea|waikiki|lc waikiki/i],
 ['Gesundheit/Drogerie',/pharmacy|apotheke|dm-drog|rossmann|dentist|clinic/i],
 ['Auto/Werkstatt',/jaroslaw markowski|werkstatt|autohaus|reparatur|\bkfz\b|garage/i],
 ['Investment/Bildung',/dscvry|moneymaking|\bsprint\b|coaching|mastermind|\bcourse\b|\bkurs\b|seminar/i]
];
function categorize(desc,art){if(art==='bargeld')return 'Bargeld';const t=(desc||'').toLowerCase();for(var i=0;i<CATRULES.length;i++){if(CATRULES[i][1].test(t))return CATRULES[i][0];}return 'Sonstiges';}
function mapWiseCat(c){const m={'Groceries':'Lebensmittel','Eating out':'Restaurants','Shopping':'Shopping/Kleidung','Personal care':'Gesundheit/Drogerie','Transport':'Transport','Bills':'Rechnungen/Fixkosten','Entertainment':'Unterhaltung','Cash':'Bargeld','Travel':'Wohnen','Home':'Wohnen','General':'Sonstiges'};return m[c]||c;}
function financeExpenses(){const cut=new Date(Date.now()-window.TXDAYS*86400000).toISOString().slice(0,10);const out=[];
 for(const t of (window.TXALL||[])){if(t.typ==='out'&&String(t.datum)>=cut)out.push({betrag:t.betrag,kat:categorize(t.beschreibung)});}
 for(const e of (window.EXP||[])){if(String(e.datum)>=cut)out.push({betrag:e.betrag,kat:categorize(e.beschreibung)});}
 for(const w of (window.WPRIV||[])){if(String(w.datum)>=cut){let k=categorize(w.beschreibung,w.art);if(k==='Sonstiges'&&w.category)k=mapWiseCat(w.category);out.push({betrag:w.betrag,kat:k});}}
 return out;}
function renderPie(){const box=document.getElementById('pie-box');if(!box)return;const ex=financeExpenses();const g={};let total=0;
 for(const e of ex){g[e.kat]=(g[e.kat]||0)+(Number(e.betrag)||0);total+=Number(e.betrag)||0;}
 const entries=Object.entries(g).sort((a,b)=>b[1]-a[1]);
 if(!total){box.innerHTML='<span class="muted">Keine Ausgaben im Zeitraum.</span>';return;}
 const colors=['#36e0ff','#ff6b6b','#ffb547','#54e08a','#b07cff','#4aa3ff','#ff9d5c','#f062a0','#5ad1c8','#c9d64a','#9fb3c8','#e0b04a'];
 let acc=0;const stops=[];entries.forEach((e,i)=>{const pct=e[1]/total*100;const c=colors[i%colors.length];stops.push(c+' '+acc.toFixed(2)+'% '+(acc+pct).toFixed(2)+'%');acc+=pct;});
 const legend=entries.map((e,i)=>{const pct=Math.round(e[1]/total*100);const c=colors[i%colors.length];return '<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin:4px 0"><span style="width:11px;height:11px;border-radius:3px;background:'+c+';flex-shrink:0"></span><span style="flex:1">'+esc(e[0])+'</span><span class="muted" style="white-space:nowrap">'+eur(e[1])+' · '+pct+'%</span></div>';}).join('');
 box.innerHTML='<div style="display:flex;gap:28px;align-items:center;flex-wrap:wrap"><div style="width:250px;height:250px;border-radius:50%;background:conic-gradient('+stops.join(',')+');flex-shrink:0;box-shadow:0 0 26px rgba(0,0,0,.35)"></div><div style="flex:1;min-width:240px">'+legend+'<div style="border-top:1px solid var(--line);margin-top:8px;padding-top:8px;font-size:13px;font-weight:700;display:flex;justify-content:space-between"><span>Gesamt-Ausgaben</span><span style="color:#ff6b6b">'+eur(total)+'</span></div></div></div>';renderFixkosten();}
function normMerchant(s){s=(s||'').trim().replace(/\\*.*$/,'').replace(/\\s{2,}.*$/,'').replace(/[0-9#].*$/,'').replace(/\\s+(gmbh|llc|ltd|inc|subscr.*|europe.*|s\\.a.*)$/i,'');return (s.trim()||'—').slice(0,30);}
function financeToolItems(){const out=[];const add=(datum,betrag,desc)=>{if(categorize(desc)==='Subscriptions/Tools')out.push({datum:String(datum||''),betrag:Number(betrag)||0,m:normMerchant(desc)});};
 for(const e of (window.EXP||[]))add(e.datum,e.betrag,e.beschreibung);
 for(const w of (window.WPRIV||[]))add(w.datum,w.betrag,w.beschreibung);
 for(const t of (window.TXALL||[]))if(t.typ==='out')add(t.datum,t.betrag,t.beschreibung);
 return out;}
function renderFixkosten(){const box=document.getElementById('fix-box');if(!box)return;const items=financeToolItems();const g={};
 for(const it of items){if(!g[it.m])g[it.m]={sum:0,mon:{}};g[it.m].sum+=it.betrag;g[it.m].mon[it.datum.slice(0,7)]=1;}
 const rows=Object.keys(g).map(m=>({m:m,sum:g[m].sum,mo:Object.keys(g[m].mon).length})).sort((a,b)=>b.sum-a.sum);
 if(!rows.length){box.innerHTML='<span class="muted">Keine Tool-Abos erkannt.</span>';return;}
 const permonth=rows.reduce((s,r)=>s+r.sum/Math.max(1,r.mo),0);
 box.innerHTML='<table class="invtbl"><thead><tr><th>Tool / Anbieter</th><th style="text-align:right">~ / Monat</th><th style="text-align:right">Gesamt</th><th style="text-align:right">Monate</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.m)+'</td><td style="text-align:right;color:#ffb547">'+eur(r.sum/Math.max(1,r.mo))+'</td><td style="text-align:right" class="muted">'+eur(r.sum)+'</td><td style="text-align:right" class="muted">'+r.mo+'</td></tr>').join('')+'</tbody></table><div style="border-top:1px solid var(--line);margin-top:8px;padding-top:8px;font-size:13px;font-weight:700;display:flex;justify-content:space-between"><span>Fixkosten Tools · ~/Monat</span><span style="color:#ffb547">'+eur(permonth)+'</span></div>';}
function monthName(ym){const M=['Jan','Feb','März','Apr','Mai','Juni','Juli','Aug','Sep','Okt','Nov','Dez'];const p=String(ym).split('-');return (M[(+p[1])-1]||p[1])+' '+p[0];}
function renderMonths(){const box=document.getElementById('tx-months');if(!box)return;const g={};
 for(const t of allFinanceTx()){const ym=String(t.datum).slice(0,7);if(ym.length<7)continue;if(!g[ym])g[ym]={ein:0,aus:0};if(t.typ==='in')g[ym].ein+=Number(t.betrag)||0;else g[ym].aus+=Number(t.betrag)||0;}
 const keys=Object.keys(g).sort().reverse();
 if(!keys.length){box.innerHTML='<span class="muted">Keine Daten.</span>';return;}
 box.innerHTML='<table class="invtbl"><thead><tr><th>Monat</th><th style="text-align:right">Einnahmen</th><th style="text-align:right">Ausgaben</th><th style="text-align:right">Netto</th></tr></thead><tbody>'+keys.map(k=>{const n=g[k].ein-g[k].aus;return '<tr><td><b>'+monthName(k)+'</b></td><td style="text-align:right;color:var(--green)">+'+eur(g[k].ein)+'</td><td style="text-align:right;color:#ff6b6b">−'+eur(g[k].aus)+'</td><td style="text-align:right;color:'+(n>=0?'var(--cyan)':'#ff6b6b')+'">'+(n>=0?'+':'−')+eur(Math.abs(n))+'</td></tr>';}).join('')+'</tbody></table>';}
document.getElementById('d-notes').textContent=GRAPH.nodes.length;
document.getElementById('d-proj').textContent=cnt('Projekte');
document.getElementById('d-tasks').textContent='—';loadTodos();
// Auto-Refresh: wenn das Fenster wieder Fokus bekommt, To-Dos frisch laden (extern geänderte Dateien, z.B. via Claude Code)
window.addEventListener('focus',function(){if(window.CUR==='todos'||window.CUR==='dashboard')loadTodos();});
const lists=document.getElementById('lists');
for(const k of Object.keys(NOTES)){ if(!cnt(k))continue;
 const dot=BCOLOR[k]||'#9fb3c8';
 lists.insertAdjacentHTML('beforeend','<details class="card bkt"><summary><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+dot+';margin-right:7px"></i>'+k+' <span style="color:var(--muted);font-weight:400">'+cnt(k)+'</span></summary><div class="bktnotes">'+
  NOTES[k].map(n=>'<div class="note" onclick="openRel(\\''+n.rel+'\\')"><span>'+n.title+'</span><small>'+(n.status||'')+'</small></div>').join('')+'</div></details>');
}
renderProjNotes();
var __bsT;
function searchBrain(q){clearTimeout(__bsT);__bsT=setTimeout(function(){const box=document.getElementById('bresults');if(!box)return;
 if(!q||q.trim().length<2){box.innerHTML='';return;}
 fetch('/api/search?q='+encodeURIComponent(q)).then(r=>r.json()).then(d=>{const rs=d.results||[];
  if(!rs.length){box.innerHTML='<div class="muted" style="padding:7px 10px">Nichts gefunden.</div>';return;}
  box.innerHTML=rs.map(r=>'<div class="bresult" onclick="openRel(\\''+r.rel+'\\')"><b>'+esc(r.title)+'</b> <span class="muted" style="font-size:11px">· '+esc(r.label)+'</span>'+(r.snippet?'<div class="muted" style="font-size:11px;margin-top:2px">…'+esc(r.snippet)+'…</div>':'')+'</div>').join('');
 }).catch(()=>{});},220);}
document.getElementById('legend').innerHTML=Object.keys(NOTES).filter(k=>(NOTES[k]||[]).length).map(function(n){var c=BCOLOR[n]||'#9fb3c8';return '<span><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+c+';box-shadow:0 0 6px '+c+';margin-right:5px"></i>'+n+' <b style="color:var(--muted)">'+NOTES[n].length+'</b></span>';}).join('');
let curPath='', curRaw='';
function openRel(rel){curPath=rel;cancelEdit();var __vc=document.getElementById('viewercard');if(__vc)__vc.open=true;fetch('/api/note?path='+encodeURIComponent(rel)).then(r=>r.json()).then(n=>{
 curRaw=n.raw||''; document.getElementById('vtitle').textContent='· '+(n.title||rel);
 let md=(n.markdown||'').replace(/\\[\\[([^\\]|]+)(\\|([^\\]]+))?\\]\\]/g,(m,a,b,c)=>'<a onclick="openTitle(\\''+a.trim()+'\\')">'+(c||a)+'</a>');
 document.getElementById('viewer').innerHTML=marked.parse(md);
 document.getElementById('vbtns').style.display='inline'; document.getElementById('jedit').style.display='block';});}
function titleToRel(t){const s=t.toLowerCase();for(const n of GRAPH.nodes){if(n.id.toLowerCase().includes(s.replace(/ /g,'-'))||n.name.toLowerCase()===s)return n.id;}return null;}
function openTitle(t){var rel=titleToRel(t);if(rel)openNote(rel);}
// Notiz überall im System öffnen: im Brain-View inline (wie gehabt), sonst als schließbares Overlay —
// kein View-Wechsel mehr, der Nutzer bleibt wo er ist (Feedback 11.07.).
function openNote(rel){if(window.CUR==='brain'){openRel(rel);return;}
 var m=document.getElementById('notemodal');
 if(!m){m=document.createElement('div');m.id='notemodal';
  m.innerHTML='<div class="nm-back" onclick="closeNote()"></div><div class="nm-card"><div class="nm-head"><b id="nm-title">…</b><button class="pop" onclick="nmToBrain()">✏️ im Brain öffnen</button><button class="pop" onclick="closeNote()">✕</button></div><div id="nm-body" class="nm-body">… lädt</div></div>';
  document.body.appendChild(m);}
 m.style.display='block';m.dataset.rel=rel;
 document.getElementById('nm-title').textContent='…';document.getElementById('nm-body').innerHTML='… lädt';
 fetch('/api/note?path='+encodeURIComponent(rel)).then(r=>r.json()).then(function(n){
  document.getElementById('nm-title').textContent=n.title||rel;
  var md=(n.markdown||'').replace(/\\[\\[([^\\]|]+)(\\|([^\\]]+))?\\]\\]/g,function(mm,a,b,c){return '<a onclick="openTitle(\\''+a.trim()+'\\')">'+(c||a)+'</a>';});
  document.getElementById('nm-body').innerHTML=marked.parse(md);
 }).catch(function(){document.getElementById('nm-body').innerHTML='<span class="muted">⚠ Notiz konnte nicht geladen werden.</span>';});}
function closeNote(){var m=document.getElementById('notemodal');if(m)m.style.display='none';}
function nmToBrain(){var m=document.getElementById('notemodal');var rel=m&&m.dataset.rel;closeNote();if(rel){show('brain');openRel(rel);}}
window.addEventListener('keydown',function(e){if(e.key==='Escape')closeNote();});
function edit(){if(!curPath)return;document.getElementById('ed').value=curRaw;document.getElementById('viewer').style.display='none';document.getElementById('editor').style.display='block';}
function cancelEdit(){document.getElementById('editor').style.display='none';document.getElementById('viewer').style.display='block';}
function save(){fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:curPath,markdown:document.getElementById('ed').value})}).then(r=>r.json()).then(()=>{openRel(curPath);loadTodos();});}
function jarvisEdit(){const ins=document.getElementById('ji').value.trim();if(!ins||!curPath)return;const r=document.getElementById('reply');r.textContent='… Jarvis bearbeitet die Notiz (15–40s)';
 fetch('/api/jarvis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'Bearbeite die Datei brain/'+curPath+' direkt gemäß: '+ins+' — speichere sie. Antworte mit EINER kurzen Zeile, was geändert wurde.'})})
  .then(x=>x.json()).then(d=>{pulseOrb();r.innerHTML=marked.parse(d.reply||'');document.getElementById('ji').value='';openRel(curPath);});}
function addNote(){const v=document.getElementById('newt').value.trim();if(!v)return;const m=document.getElementById('addmsg');m.textContent='… Jarvis legt an & ordnet zu (15–40s)';
 fetch('/api/jarvis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'Lege aus diesem Input eine neue Notiz im Brain (Ordner brain/) an. Entscheide SELBST Bucket (02_People/03_Projects/04_Areas/05_Knowledge/06_Ideas/07_Tasks) und Typ. Bei Ideen tagge: projektidee, marketing oder zielgruppe. YAML-Frontmatter + [[Verlinkungen]]. Input: \\"\\"\\"'+v+'\\"\\"\\". Antworte mit EINER Zeile: was und wo angelegt.'})})
  .then(x=>x.json()).then(d=>{pulseOrb();m.innerHTML=marked.parse(d.reply||'');document.getElementById('newt').value='';setTimeout(()=>location.reload(),1500);});}
GRAPH.nodes.forEach(n=>n.__ph=Math.random()*6.28);
const el=document.getElementById('graph');
window.G=ForceGraph()(el).graphData(GRAPH).backgroundColor('rgba(0,0,0,0)').width(el.clientWidth||900).height(el.clientHeight||420).autoPauseRedraw(false)
 .linkColor(()=>'rgba(54,224,255,0.22)').linkWidth(1).linkDirectionalParticles(2).linkDirectionalParticleWidth(1.6).linkDirectionalParticleColor(()=>'rgba(120,230,255,0.6)')
 .nodeRelSize(4).onNodeClick(n=>openRel(n.id))
 .nodeCanvasObject((n,ctx,scale)=>{const t=Date.now()/1000,pulse=0.6+0.4*Math.sin(t*1.8+n.__ph),r=(2.2+Math.sqrt(n.val)*1.6);
   ctx.shadowColor=n.color;ctx.shadowBlur=16*pulse;ctx.globalAlpha=0.55+0.45*pulse;ctx.fillStyle=n.color;ctx.beginPath();ctx.arc(n.x,n.y,r,0,6.2832);ctx.fill();ctx.shadowBlur=0;ctx.globalAlpha=1;
   if(scale>1.3){ctx.fillStyle='rgba(207,230,245,0.85)';ctx.font=(11/scale)+'px Inter';ctx.textAlign='center';ctx.fillText(n.name,n.x,n.y+r+10/scale);}});
G.d3Force('charge').strength(-130);
addEventListener('resize',()=>{const g=document.getElementById('graph');if(g.clientWidth)G.width(g.clientWidth).height(g.clientHeight);});
const VIEWS='dashboard, brain, inbox, agents, outreach, finanzen, rechnungen, pipeline, calls, proposals, analyse, projekte';
const NAVHELP='[System] Du bist Jarvis, der Agent/Copilot im "${BRAND.name}"-Dashboard. Du kennst des Nutzers Obsidian-Brain (Ordner brain/) und seine Business-Daten/Dateien. Antworte kurz, direkt, auf Deutsch. Hol bei Bedarf Daten aus dem Brain/den Dateien und berichte knapp. WICHTIG: Wechsle NIEMALS die Ansicht und navigiere NICHT — bleib einfach im Chat und antworte.\\n\\nNutzer: ';
function runActions(text){
 // Auto-Navigation bewusst deaktiviert — Jarvis wechselt NIE selbst die Ansicht. Tokens nur entfernen.
 return text.replace(/@@(nav|note):[^@]+@@/g,'').trim();
}
function post(p,label){const r=document.getElementById('reply');r.textContent=label;
 fetch('/api/jarvis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:p})}).then(x=>x.json()).then(d=>{pulseOrb();r.innerHTML=marked.parse(runActions(d.reply||'(leer)'));}).catch(e=>{r.textContent='Fehler: '+e;});}
function ask(){const q=document.getElementById('q').value.trim();if(q)post(NAVHELP+q,'… Jarvis denkt nach (10–30s)');}
function checkin(){post('Mach einen kurzen, proaktiven Check-in. Lies brain/01_Identity/now.md und brain/07_Tasks/tasks.md, nenne den wichtigsten offenen Signal-Task und frag mich in EINER lockeren, kurzen Frage, ob ich ihn erledigt habe. Max 3 Zeilen.','… Jarvis macht einen Check-in');}
function jpop(html){const p=document.getElementById('jpop');p.style.display='block';p.innerHTML=marked.parse(html||'');}
function renderReply(md){const parts=(md||'').split(/\`\`\`html\\n([\\s\\S]*?)\`\`\`/);let out='';for(let i=0;i<parts.length;i++){if(i%2===1){out+='<iframe class="viz" sandbox="allow-scripts allow-same-origin" srcdoc="'+parts[i].replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"></iframe>';}else if(parts[i].trim()){out+=marked.parse(parts[i]);}}return out;}
function htmlToText(h){const d=document.createElement('div');d.innerHTML=h||'';return (d.textContent||'').replace(/\\s+/g,' ').trim();}
function buildContext(msgs){const m=(msgs||[]).filter(x=>x&&(x.r==='sys'?x.t:(x.r==='u'?x.t:x.h))).slice(-200);if(!m.length)return '';
 const lines=m.map(x=>x.r==='u'?('der Nutzer: '+x.t):(x.r==='sys'?('[ZUSAMMENFASSUNG FRÜHERER VERLAUF]\\n'+x.t):('Jarvis: '+htmlToText(x.h)))).filter(s=>s.length>8||s.startsWith('der Nutzer: '));
 return 'BISHERIGER CHATVERLAUF (deine einzige Wahrheit für Fragen wie „was war meine erste/letzte Nachricht"; chronologisch, älteste zuerst):\\n'+lines.join('\\n')+'\\n\\n';}
function streamAsk(text,mode){if(mode!=='chat')return;const log=document.getElementById('chatlog');
 const ATTS=(window.__catt||[]).slice();window.__catt=[];if(typeof cAttUI==='function')cAttUI();
 log.insertAdjacentHTML('beforeend','<div class="msg u"></div>');log.lastChild.textContent=text;
 if(ATTS.length){const nImg=ATTS.filter(a=>a.kind==='image').length,nVid=ATTS.length-nImg;const parts=[];if(nImg)parts.push('🖼 '+nImg+' Bild'+(nImg>1?'er':''));if(nVid)parts.push('🎬 '+nVid+' Video'+(nVid>1?'s':''));log.lastChild.insertAdjacentHTML('beforeend','<div style="font-size:11px;opacity:.7;margin-top:3px">'+parts.join(' · ')+'</div>');}
 log.insertAdjacentHTML('beforeend','<div class="msg j"><div class="jthink"><span class="jload"></span><span class="jsteps"></span><span class="jwork"></span><div class="jbar"></div><div class="jthinktext"></div></div><div class="jans"></div></div>');
 const wrap=log.lastChild,jthink=wrap.querySelector('.jthink'),steps=wrap.querySelector('.jsteps'),tt=wrap.querySelector('.jthinktext'),ans=wrap.querySelector('.jans'),load=wrap.querySelector('.jload'),work=wrap.querySelector('.jwork'),bar=wrap.querySelector('.jbar');
 const ac=new AbortController();const cstop=document.getElementById('cstop');
 let workT=null;const wfmt=s=>{s=Math.floor(s);return s>=60?Math.floor(s/60)+':'+String(s%60).padStart(2,'0')+'min':s+'s';};
 const startWork=(label)=>{const t0=Date.now();work.className='jwork on';work.textContent='⏳ '+label+' … 0s';clearInterval(workT);workT=setInterval(()=>{work.textContent='⏳ '+label+' … '+wfmt((Date.now()-t0)/1000);},1000);};
 const stopWork=()=>{clearInterval(workT);workT=null;work.className='jwork';};
 const startRun=()=>{bar.className='jbar on';if(cstop)cstop.style.display='inline-block';window.curAC=ac;};
 const endUI=()=>{stopWork();bar.className='jbar';if(cstop)cstop.style.display='none';if(window.curAC===ac)window.curAC=null;};
 const myChat=activeChat();
 const hist=buildContext(myChat.msgs); // VOR dem Pushen: Verlauf dieses Chats → wird mitgeschickt, damit die History stimmt (überlebt Neustarts, pro Chat isoliert)
 myChat.msgs.push({r:'u',t:text});if(myChat.title==='Neuer Chat')myChat.title=chatTitle(myChat.msgs);myChat.ts=Date.now();saveChats(window.CHATS);renderHist();
 const aMsg={r:'j',h:''};myChat.msgs.push(aMsg); // Antwort SOFORT als Platzhalter ablegen → live mitspeichern, kein Verlust bei Reload/Hänger
 log.scrollTop=1e9;let acc='',think='',lastSave=0;
 const persist=(final)=>{aMsg.h=ans.innerHTML;myChat.ts=Date.now();const n=Date.now();if(final||n-lastSave>800){lastSave=n;saveChats(window.CHATS);renderCtx();}};
 const prompt='[Kontext: Nutzer ist gerade im Modul "'+(window.CUR||'dashboard')+'".] '+NAVHELP.replace(/Nutzer: $/,'')+hist+'Nutzer: '+text;
 startWork('denkt');startRun(); // sofort sichtbarer Herzschlag + blaues Laufband + Stop-Button — schon bevor der erste Step kommt
 const handle=(data)=>{
  if(data==='[DONE]'){endUI();const clean=runActions(acc);ans.innerHTML=renderReply(clean);jthink.classList.add('done');pulseOrb();log.scrollTop=1e9;persist(true);maybeAutoCompact(myChat);return true;}
  let o;try{o=JSON.parse(data);}catch{return false;}
  if(o.type==='step'){steps.insertAdjacentHTML('beforeend','<span class="jstep">🔧 '+esc(o.name||'tool')+(o.detail?' · '+esc(o.detail):'')+'</span>');startWork(o.name==='Task'?'🤖 Subagent läuft':('läuft · '+(o.name||'tool')));log.scrollTop=1e9;}
  else if(o.type==='output'){steps.insertAdjacentHTML('beforeend','<span class="jout'+(o.err?' err':'')+'">↳ '+esc(o.t||'')+'</span>');log.scrollTop=1e9;}
  else if(o.type==='thinking'){think+=(o.t||'');tt.textContent=think.trim();}
  else if(o.type==='text'||typeof o.t==='string'){acc+=(o.t||'');if(load)load.style.display='none';stopWork();ans.innerHTML=renderReply(acc);log.scrollTop=1e9;persist(false);}
  return false;};
 fetch('/api/jarvis-stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,attachments:ATTS}),signal:ac.signal}).then(async(res)=>{
  const reader=res.body.getReader();const dec=new TextDecoder();let buf='';
  for(;;){const {value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});
   let i;while((i=buf.indexOf('\\n\\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+2);
    if(line.startsWith('data: ')&&handle(line.slice(6)))return;}}
  endUI();persist(true); // Stream zu Ende ohne [DONE] → trotzdem sichern
 }).catch((e)=>{endUI();if(load)load.style.display='none';if(e&&e.name==='AbortError'){acc+='\\n\\n⏹ Gestoppt.';ans.innerHTML=renderReply(acc);}else if(!acc){ans.textContent='Verbindung unterbrochen — Antwort evtl. unvollständig.';}persist(true);});}
// Stop-Button: bricht den lokalen Stream ab (→ AbortError) UND killt den Turn serverseitig (CP-Session).
function stopRun(){if(window.curAC){try{window.curAC.abort();}catch{}}fetch('/api/jarvis-stop',{method:'POST'}).catch(()=>{});}
// ---- Chat-Historien (mehrere Gespräche, wie ChatGPT/Claude) ----
function cid(){return 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function chatTitle(msgs){const u=(msgs||[]).find(m=>m.r==='u');let t=((u&&u.t)||'Neuer Chat').trim().replace(/\\s+/g,' ');return t.length>38?t.slice(0,38)+'…':t;}
function saveChats(a){try{localStorage.setItem('jarvis_chats',JSON.stringify((a||[]).slice(0,40)));}catch{}}
function loadChats(){let a=null;try{a=JSON.parse(localStorage.getItem('jarvis_chats')||'null');}catch{}
 if(!Array.isArray(a)){let old=[];try{old=JSON.parse(localStorage.getItem('jarvis_chat')||'[]');}catch{} a=old.length?[{id:cid(),title:chatTitle(old),ts:Date.now(),msgs:old}]:[];}
 a.forEach(c=>{c._compacting=false;});return a;}
function activeChat(){const cs=window.CHATS||[];let c=cs.find(x=>x.id===window.ACTIVE);if(!c){c=cs[0];if(c)window.ACTIVE=c.id;}return c;}
function renderLog(msgs){const log=document.getElementById('chatlog');if(!log)return;log.innerHTML='';for(const m of (msgs||[])){
  if(m.r==='u'){log.insertAdjacentHTML('beforeend','<div class="msg u"></div>');log.lastChild.textContent=m.t;}
  else if(m.r==='sys'){log.insertAdjacentHTML('beforeend','<div class="msg sys"><b>📋 Zusammenfassung bisher (komprimiert)</b><div>'+marked.parse(m.t||'')+'</div></div>');}
  else{log.insertAdjacentHTML('beforeend','<div class="msg j"><div class="jans">'+(m.h||'')+'</div></div>');}}
 log.scrollTop=1e9;renderCtx();}
function chatTokens(c){if(!c)return 0;let n=0;for(const m of (c.msgs||[]))n+=((m.r==='u'||m.r==='sys')?(m.t||'').length:htmlToText(m.h).length);return Math.ceil(n/4);}
function renderCtx(){const el=document.getElementById('ctxbar');if(!el)return;const c=activeChat();if(!c){el.innerHTML='';return;}
 if(c._compacting){el.className='warn';el.innerHTML='<span>🗜 Komprimiere Verlauf …</span><div class="bar"><i style="width:100%"></i></div>';return;}
 const tok=chatTokens(c),BUD=100000,pct=Math.min(100,Math.round(tok/BUD*100));
 el.className=pct>=70?'warn':'';
 el.innerHTML='<span>Kontext '+(tok>=1000?((Math.round(tok/100)/10)+'k'):tok)+' / 100k</span><div class="bar"><i style="width:'+pct+'%"></i></div>'+(pct>=55?'<button onclick="compactChat()" title="Ältere Nachrichten zu einer Zusammenfassung verdichten — Chat bleibt, Kontext schrumpft">⚡ Komprimieren</button>':'');}
function askModel(prompt){return new Promise((resolve)=>{let acc='';
 fetch('/api/jarvis-stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})}).then(async(res)=>{
  const rd=res.body.getReader();const dec=new TextDecoder();let buf='';
  for(;;){const{value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});
   let i;while((i=buf.indexOf('\\n\\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+2);if(!line.startsWith('data: '))continue;const d=line.slice(6);
    if(d==='[DONE]'){resolve(acc);return;}let o;try{o=JSON.parse(d);}catch{continue;}if(o.type==='text'||typeof o.t==='string')acc+=(o.t||'');}}
  resolve(acc);}).catch(()=>resolve(acc));});}
async function compactChat(c){c=c||activeChat();if(!c||c._compacting)return;
 const keep=6;if(c.msgs.length<keep+4){alert('Chat ist noch zu kurz zum Komprimieren.');return;}
 const head=c.msgs.slice(0,-keep),tail=c.msgs.slice(-keep);
 const tx=head.map(m=>m.r==='u'?('der Nutzer: '+m.t):(m.r==='sys'?('[bisherige Zusammenfassung]\\n'+m.t):('Jarvis: '+htmlToText(m.h)))).join('\\n');
 c._compacting=true;renderCtx();
 const p='Fasse den folgenden Gesprächsverlauf KOMPAKT als Stichpunkte zusammen. Bewahre ALLE wichtigen Fakten, Entscheidungen, Wording, Zahlen und offenen Punkte, sodass das Gespräch nahtlos weitergehen kann. Deutsch, keine Einleitung, kein Vorwort — nur die Zusammenfassung:\\n\\n'+tx;
 let sum='';try{sum=(await askModel(p)).trim();}catch{}
 c._compacting=false;
 if(!sum){renderCtx();alert('Komprimieren fehlgeschlagen — nochmal versuchen.');return;}
 c.msgs=[{r:'sys',t:sum}].concat(tail);c.ts=Date.now();saveChats(window.CHATS);renderLog(c.msgs);}
function maybeAutoCompact(c){if(!c||c._compacting)return;if(chatTokens(c)>=85000&&c.msgs.length>=12)compactChat(c);}
window.CPTAB='chats';window.HB={status:null,runs:[]};window.HBSEL=-1;
function cpTabs(){return '<div class="cptabs"><button class="cptab'+(window.CPTAB==='chats'?' on':'')+'" onclick="setCpTab(\\'chats\\')">💬 Chats</button><button class="cptab'+(window.CPTAB==='auto'?' on':'')+'" onclick="setCpTab(\\'auto\\')">🫀 Autoruns'+((window.HB.status&&window.HB.status.running)?' <span class="hbdot" style="display:inline-block"></span>':'')+'</button></div>';}
function setCpTab(t){window.CPTAB=t;window.HBSEL=-1;renderHist();
 if(t==='auto'){loadHeartbeat(true);const log=document.getElementById('chatlog');if(log)log.innerHTML='<div class="hbreport"><h4>🫀 Autoruns</h4>Links einen Lauf anklicken — hier erscheint sein Report.\\nDer Heartbeat läuft stündlich 09–19 Uhr, nimmt sich pro Lauf einen 🤖-Task, arbeitet ihn ab und hakt ihn ab. Bei Fragen pingt er dich per Telegram.</div>';}
 else renderLog((activeChat()||{}).msgs||[]);}
function hbTime(ts){if(!ts)return '';var d=new Date(ts*1000);return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+'. '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);}
function hbHead(r){var first=(r.report||'').split('\\n')[0]||'(kein Report)';return (r.ok?'':'⚠️ ')+first;}
function showRun(i){window.HBSEL=i;renderHist();var r=(window.HB.runs||[])[i];var log=document.getElementById('chatlog');if(!log||!r)return;
 var dur=(r.end&&r.start)?Math.max(0,r.end-r.start):0;var dtxt=dur?(Math.floor(dur/60)+' Min '+(dur%60)+' Sek'):'';
 log.innerHTML='<div class="hbreport"><h4>🫀 Heartbeat-Lauf · '+hbTime(r.start)+(dtxt?' · '+dtxt:'')+(r.ok?'':' · ⚠️ Fehler')+'</h4>'+esc(r.report||'(kein Report)')+'</div>';}
function loadHeartbeat(rerender){fetch('/api/heartbeat').then(function(r){return r.json();}).then(function(d){window.HB=d||{status:null,runs:[]};
 var running=!!(d&&d.status&&d.status.running);
 var dot=document.getElementById('hbdot');if(dot)dot.style.display=running?'':'none';
 var dot2=document.getElementById('ceohbdot');if(dot2)dot2.style.display=running?'inline-block':'none';
 if(rerender||window.CPTAB==='auto')renderHist();}).catch(function(){});}
function renderHist(){const h=document.getElementById('chathist');if(!h)return;
 if(window.CPTAB==='auto'){var runs=window.HB.runs||[];var st=window.HB.status||{};
  h.innerHTML=cpTabs()
   +(st.running?'<div class="hchat on"><span class="ht"><span class="hbdot" style="display:inline-block;margin-right:6px"></span>läuft gerade …</span></div>':'')
   +(runs.length?runs.map(function(r,i){return '<div class="hchat hbrun'+(window.HBSEL===i?' on':'')+'" onclick="showRun('+i+')"><span class="ht"><small>'+hbTime(r.start)+'</small>'+esc(hbHead(r))+'</span></div>';}).join(''):'<div class="hchat"><span class="ht" style="color:var(--muted)">Noch keine Läufe.</span></div>');
  return;}
 const list=[...(window.CHATS||[])].sort((a,b)=>((b.pinned?1:0)-(a.pinned?1:0))||((b.ts||0)-(a.ts||0)));
 h.innerHTML=cpTabs()+'<button class="newchat" onclick="newChat()">＋ Neuer Chat</button>'+list.map(c=>'<div class="hchat'+(c.id===window.ACTIVE?' on':'')+'" onclick="selectChat(\\''+c.id+'\\')"><span class="ht">'+(c.pinned?'📌 ':'')+esc(c.title||'Neuer Chat')+'</span><button class="hx" onclick="chatMenu(\\''+c.id+'\\',event)" title="Optionen">⋯</button></div>').join('');}
function chatMenu(id,ev){ev.stopPropagation();closeChatMenu();const c=(window.CHATS||[]).find(x=>x.id===id);if(!c)return;
 const m=document.createElement('div');m.className='hpop';m.id='hpop';
 m.innerHTML='<div class="hpi" onclick="renameChat(\\''+id+'\\')">✏️ Umbenennen</div><div class="hpi" onclick="togglePin(\\''+id+'\\')">'+(c.pinned?'📌 Lösen':'📌 Anheften')+'</div><div class="hpi del" onclick="delChat(\\''+id+'\\',event)">🗑 Löschen</div>';
 document.body.appendChild(m);const r=ev.currentTarget.getBoundingClientRect();m.style.top=(r.bottom+4)+'px';m.style.left=Math.min(r.left,window.innerWidth-170)+'px';
 setTimeout(()=>document.addEventListener('click',closeChatMenu,{once:true}),0);}
function closeChatMenu(){const m=document.getElementById('hpop');if(m)m.remove();}
function togglePin(id){const c=(window.CHATS||[]).find(x=>x.id===id);if(c){c.pinned=!c.pinned;saveChats(window.CHATS);renderHist();}closeChatMenu();}
function renameChat(id){closeChatMenu();const c=(window.CHATS||[]).find(x=>x.id===id);if(!c)return;const v=prompt('Chat umbenennen:',c.title||'');if(v===null)return;const nv=v.trim();if(nv){c.title=nv;c.named=true;saveChats(window.CHATS);renderHist();}}
function selectChat(id){window.ACTIVE=id;renderHist();const c=activeChat();renderLog(c?c.msgs:[]);const i=document.getElementById('cin');if(i)i.focus();}
function delChat(id,ev){if(ev)ev.stopPropagation();closeChatMenu();window.CHATS=(window.CHATS||[]).filter(x=>x.id!==id);if(window.ACTIVE===id)window.ACTIVE=(window.CHATS[0]||{}).id;if(!window.CHATS.length){const c={id:cid(),title:'Neuer Chat',ts:Date.now(),msgs:[]};window.CHATS.push(c);window.ACTIVE=c.id;}saveChats(window.CHATS);renderHist();renderLog((activeChat()||{}).msgs||[]);}
function newChat(){const c={id:cid(),title:'Neuer Chat',ts:Date.now(),msgs:[]};(window.CHATS=window.CHATS||[]).unshift(c);window.ACTIVE=c.id;saveChats(window.CHATS);renderHist();renderLog([]);const i=document.getElementById('cin');if(i)i.focus();}
function initChat(){window.CHATS=loadChats();if(!window.CHATS.length)window.CHATS=[{id:cid(),title:'Neuer Chat',ts:Date.now(),msgs:[]}];window.ACTIVE=window.CHATS[0].id;saveChats(window.CHATS);renderHist();renderLog(window.CHATS[0].msgs);}
function cinGrow(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,window.innerHeight*0.4)+'px';}
function copilotSend(){const i=document.getElementById('cin');const v=i.value.trim();const atts=window.__catt||[];if(!v&&!atts.length)return;i.value='';cinGrow(i);streamAsk(v||'(Anhang)','chat');}
// ---- Bild/Video-Anhänge (Copilot): paste, drop, File-Picker → base64 → an /api/jarvis-stream ----
window.__catt=[];
function cAttUI(){var el=document.getElementById('catt');if(!el)return;el.innerHTML=(window.__catt||[]).map(function(a,i){return '<span style="display:inline-flex;align-items:center;gap:5px;background:rgba(54,224,255,.12);border:1px solid rgba(54,224,255,.4);border-radius:6px;padding:2px 7px;font-size:12px">'+(a.kind==='video'?'🎬':'🖼')+' '+esc((a.name||a.kind).slice(0,24))+' <b onclick="cAttDel('+i+')" style="cursor:pointer;color:var(--red,#f66)">×</b></span>';}).join('');}
function cAttDel(i){(window.__catt||[]).splice(i,1);cAttUI();}
function cAttachFiles(files){if(!files)return;Array.prototype.forEach.call(files,function(f){var isImg=/^image\\//.test(f.type),isVid=/^video\\//.test(f.type);if(!isImg&&!isVid){return;}if(f.size>60*1024*1024){alert('Datei zu groß (max 60 MB): '+f.name);return;}var rd=new FileReader();rd.onload=function(){var b64=(String(rd.result).split(',')[1])||'';window.__catt.push({kind:isImg?'image':'video',media_type:f.type||'application/octet-stream',name:f.name,data:b64});cAttUI();};rd.readAsDataURL(f);});}
function cInitDrop(){var ci=document.getElementById('cin');var view=document.getElementById('v-copilot')||ci;if(!ci||ci.__dropWired)return;ci.__dropWired=true;
 ci.addEventListener('paste',function(e){var items=(e.clipboardData&&e.clipboardData.items)||[];var got=false;for(var k=0;k<items.length;k++){if(items[k].kind==='file'){var f=items[k].getAsFile();if(f&&/^image\\//.test(f.type)){cAttachFiles([f]);got=true;}}}if(got)e.preventDefault();});
 ['dragover','dragenter'].forEach(function(ev){view.addEventListener(ev,function(e){e.preventDefault();view.style.boxShadow='inset 0 0 0 2px var(--cyan,#36e0ff)';});});
 ['dragleave','drop'].forEach(function(ev){view.addEventListener(ev,function(e){e.preventDefault();view.style.boxShadow='';});});
 view.addEventListener('drop',function(e){e.preventDefault();view.style.boxShadow='';var f=(e.dataTransfer&&e.dataTransfer.files);if(f&&f.length)cAttachFiles(f);});}
window.addEventListener('load',cInitDrop);
// Stimme satzweise (Warteschlange)
let SPEAKQ=[],SPEAKING=false;
function cleanSpeech(t){return (t||'').replace(/@@(nav|note):[^@]*@@/g,'').replace(/[#*_\`>\\[\\]]/g,'').replace(/\\s+/g,' ').trim();}
function enqueueSpeak(t){t=cleanSpeech(t);if(t.length<2)return;SPEAKQ.push(t);drainSpeak();}
function drainSpeak(){if(SPEAKING||!SPEAKQ.length)return;SPEAKING=true;const t=SPEAKQ.shift();
 fetch('/api/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:t})}).then(r=>r.ok?r.blob():null).then(b=>{if(!b){SPEAKING=false;return drainSpeak();}const a=new Audio(URL.createObjectURL(b));reactOrb(a);a.onended=()=>{SPEAKING=false;drainSpeak();maybeResumeVoice();};a.onerror=()=>{SPEAKING=false;drainSpeak();maybeResumeVoice();};a.play().catch(()=>{SPEAKING=false;drainSpeak();});}).catch(()=>{SPEAKING=false;drainSpeak();});}
function reactOrb(audio){const core=document.getElementById('core');const glow=core&&core.querySelector('.glow');
 try{const C=window.__ac||(window.__ac=new(window.AudioContext||window.webkitAudioContext)());if(C.state==='suspended')C.resume();const s=C.createMediaElementSource(audio);const an=C.createAnalyser();an.fftSize=64;s.connect(an);an.connect(C.destination);const d=new Uint8Array(an.frequencyBinCount);
  (function loop(){an.getByteFrequencyData(d);let sum=0;for(const x of d)sum+=x;const lvl=sum/d.length/255;if(glow)glow.style.transform='scale('+(1+lvl*0.9)+')';if(!audio.paused&&!audio.ended)requestAnimationFrame(loop);else if(glow)glow.style.transform='';})();
 }catch(e){pulseOrb();}}
let REC=null,MICMANUAL=false,MICBASE='';
const SRClass=window.SpeechRecognition||window.webkitSpeechRecognition;
function setMicOn(on){const f=document.getElementById('fab');if(f)f.classList.toggle('on',on);const c=document.getElementById('cmic');if(c)c.classList.toggle('on',on);}
function startRec(){REC=new SRClass();REC.lang='de-DE';REC.continuous=true;REC.interimResults=true;
 REC.onresult=e=>{let t='';for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript;window.__mictxt=(MICBASE+' '+t).trim();const ci=document.getElementById('cin');if(window.CUR==='copilot'&&ci)ci.value=window.__mictxt;};
 REC.onerror=()=>{};
 REC.onend=()=>{ if(MICMANUAL){finishMic();} else { MICBASE=(window.__mictxt||MICBASE); try{REC.start();}catch{finishMic();} } };
 try{REC.start();setMicOn(true);}catch{} }
function finishMic(){setMicOn(false);REC=null;const v=(window.__mictxt||'').trim();window.__mictxt='';MICBASE='';if(!v)return;if(window.CUR==='copilot'){const ci=document.getElementById('cin');if(ci)ci.value='';streamAsk(v,'chat');}else streamAsk(v,'pop');}
function micToggle(){if(!SRClass){jpop('Spracherkennung nicht verfügbar — nutze das Textfeld.');return;}if(REC){MICMANUAL=true;REC.stop();return;}MICMANUAL=false;MICBASE='';window.__mictxt='';startRec();}
// ---- Live-Sprachmodus (freihändig, durchgehend) ----
let VOICEMODE=false,VREC=null,vutter='',awaiting=false;
function maybeResumeVoice(){ if(awaiting && !window.STREAMING_RESP && !SPEAKING && !SPEAKQ.length){ awaiting=false; if(VOICEMODE) setTimeout(vListen,250); } }
function vListen(){ if(!VOICEMODE||awaiting||SPEAKING||VREC||!SRClass)return;
 VREC=new SRClass();VREC.lang='de-DE';VREC.continuous=true;VREC.interimResults=true;vutter='';
 VREC.onresult=e=>{let t='';for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript;vutter=t;setMicOn(true);};
 VREC.onerror=()=>{};
 VREC.onend=()=>{VREC=null;setMicOn(false);const v=vutter.trim();vutter='';if(!VOICEMODE)return;if(v&&!awaiting&&!SPEAKING){awaiting=true;streamAsk(v,window.CUR==='copilot'?'chat':'pop');}else{setTimeout(vListen,150);}};
 try{VREC.start();setMicOn(true);}catch{}
}
function voiceModeToggle(){VOICEMODE=!VOICEMODE;const el=document.getElementById('vmode');el.classList.toggle('on',VOICEMODE);document.getElementById('vmstat').textContent=VOICEMODE?'AN':'aus';
 if(VOICEMODE){if(window.__ac&&window.__ac.state==='suspended')window.__ac.resume();jpop('🎙️ Live-Sprachmodus AN — sprich einfach drauflos. Jarvis hört zu, antwortet und hört dann wieder zu. Nochmal klicken zum Beenden.');awaiting=false;vListen();}
 else{if(VREC){try{VREC.stop();}catch{}}VREC=null;awaiting=false;}}
// ---- Agents (Org-Chart) ----
let AGENTS=[],curAgent=null;
const SUBS=['Leads Daily','Vernetzung-Sync','Outreach','InMails','Follow-ups'];
function setAgView(v){document.querySelectorAll('#v-agents .pmtab').forEach(b=>b.classList.toggle('on',b.dataset.agv===v));['mitarbeiter','nervensystem','skills','einstellen'].forEach(k=>{const el=document.getElementById('agv-'+k);if(el)el.style.display=k===v?'':'none';});const frameId={nervensystem:'agv-frame-nerv',skills:'agv-frame-skills',einstellen:'agv-frame-einstellen'}[v];if(frameId){const f=document.getElementById(frameId);if(f&&!f.src&&f.dataset.src)f.src=f.dataset.src;}}
function loadAgents(){fetch('/api/agents').then(r=>r.json()).then(d=>{AGENTS=d.agents||[];const open=document.getElementById('agdetail').style.display==='block';if(curAgent){const a=AGENTS.find(x=>x.id===curAgent.id);curAgent=a||null;}if(open&&curAgent)openAgent(curAgent.id);else renderOrg();});loadAgentLab();}
// Qualitätsmanager-Panel: offene Vorschläge mit Freigabe. Karte bleibt versteckt, wenn es nie einen Lauf gab.
const AL_RANG={hoch:'🔴 hoch',mittel:'🟡 mittel',niedrig:'⚪ niedrig'};
function loadAgentLab(){fetch('/api/agent-lab').then(r=>r.json()).then(d=>{
 const card=document.getElementById('al-card');if(!card)return;
 const offen=d.offen||[],erledigt=d.erledigt||[];
 if(!offen.length&&!erledigt.length&&!d.letzterLauf){card.style.display='none';return;}
 card.style.display='block';
 document.getElementById('al-lauf').textContent=d.letzterLauf?('letzter Lauf: '+new Date(d.letzterLauf.end*1000).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})):'noch kein Lauf';
 const esc=s=>String(s||'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
 let h='';
 if(!offen.length)h+='<div class="muted">Nichts Offenes. Keine Vorschläge heißt: nichts Belegtes gefunden.</div>';
 for(const r of offen){h+='<div style="border:1px solid var(--bd);border-radius:8px;padding:10px;margin-bottom:8px">'
  +'<div style="display:flex;justify-content:space-between;gap:8px"><b>'+esc(r.titel)+'</b><span class="muted" style="font-size:11px;white-space:nowrap">'+(AL_RANG[r.schwere]||'')+'</span></div>'
  +'<div class="muted" style="font-size:12px;margin:2px 0 6px">Agent: '+esc(r.agent)+'</div>'
  +'<div style="font-size:13px"><b>Befund:</b> '+esc(r.befund)+'</div>'
  +'<div style="font-size:13px;margin-top:4px"><b>Fix:</b> '+esc(r.fix)+'</div>'
  +'<div style="margin-top:8px;display:flex;gap:8px"><button onclick="alDecide(\\''+r.id+'\\',\\'ja\\')">✅ Freigeben</button>'
  +'<button onclick="alDecide(\\''+r.id+'\\',\\'nein\\')" style="background:var(--red);color:#fff">❌ Ablehnen</button></div></div>';}
 if(erledigt.length){h+='<details style="margin-top:8px"><summary class="muted" style="cursor:pointer;font-size:12px">Entschieden ('+erledigt.length+')</summary>';
  for(const r of erledigt)h+='<div class="muted" style="font-size:12px;margin-top:6px;text-decoration:line-through">'+(r.status==='freigegeben'?'✅':'❌')+' '+esc(r.agent)+': '+esc(r.titel)+'</div>';
  h+='</details>';}
 document.getElementById('al-liste').innerHTML=h;
});}
function alDecide(id,entscheid){
 if(entscheid==='nein'&&!confirm('Ablehnen? Der Vorschlag kommt dann nicht wieder.'))return;
 fetch('/api/agent-lab/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,entscheid})})
  .then(r=>r.json()).then(d=>{if(!d.ok)alert('Fehler: '+(d.error||d.out||'unbekannt'));loadAgentLab();});
}
function agMd(s){return marked.parse((s||'').replace(/\\[\\[([^\\]|]+)(\\|([^\\]]+))?\\]\\]/g,(m,a,b,c)=>(c||a)));}
function avatarHtml(a,s){return a.avatar?'<img class="av" style="width:'+s+'px;height:'+s+'px" src="/api/agent-asset?path='+encodeURIComponent(a.id+'/'+a.avatar)+'">':'<div class="av ph2" style="width:'+s+'px;height:'+s+'px;font-size:'+Math.round(s*0.46)+'px">🤖</div>';}
function deptLabel(a){var d=(a.config&&a.config.department)||'sales';return {sales:'Sales',marketing:'Marketing',cto:'System & Betrieb'}[d]||'Sales';}
function agStatus(a){if(a.paused)return'⏸ pausiert'+(a.running||a.idle?' (eingefroren — Play macht dort weiter)':'');if(a.running)return'🔴 läuft gerade';if(a.idle)return'🟢 bereit (wartet auf Auftrag)';return a.runs&&a.runs.length?'● '+a.runs.length+' Berichte':'○ neu · kein Lauf';}
var MENTORS=[{e:'💰',n:'Alex Hormozi',r:'Offers & Leads',live:true,cmd:'Alex Hormozi',skill:'/MentorHormozi'},{e:'🔥',n:'Tony Robbins',r:'State & Mindset',live:true,cmd:'Tony Robbins',skill:'/mentor-tony'},{e:'🎬',n:'Rick Rubin',r:'in Auswahl',parked:true},{e:'🧭',n:'Naval Ravikant',r:'in Auswahl',parked:true}];
var MARKETING=[{e:'✍️',n:'Content-Agent',r:'bald'},{e:'📣',n:'Ads-Agent',r:'bald'},{e:'🔎',n:'SEO-Agent',r:'bald'}];
function mockCard(m){return '<div class="agtile mock"><div class="agava-mock">'+m.e+'</div><div class="agname">'+m.n+'</div><div class="agmeta">'+m.r+'</div></div>';}
function mentorCard(m){if(m.live)return '<div class="agtile mentor-live" onclick="askMentor(\\''+m.cmd+'\\',\\''+m.skill+'\\')" title="Fragen: Was würde '+m.n+' raten?"><div class="agava-mock live">'+m.e+'</div><div class="agname">'+m.n+'</div><div class="agmeta" style="color:#ffd27a">🟢 aktiv · '+m.skill+'</div></div>';return mockCard(m);}
function askMentor(name,skill){var q=prompt('Was würde '+name+' raten? Beschreib kurz die Entscheidung / Situation:','');if(!q)return;show('copilot');setTimeout(function(){streamAsk((skill||'/MentorHormozi')+' '+q,'chat');},350);}
function renderOrg(){const el=document.getElementById('agorg');if(!el)return;el.style.display='flex';document.getElementById('agdetail').style.display='none';
 const isMktg=a=>((a.config&&a.config.department)||'sales')==='marketing';
 const isSystem=a=>((a.config&&a.config.department)||'sales')==='cto';
 const salesA=AGENTS.filter(a=>!isMktg(a)&&!isSystem(a)), mktgA=AGENTS.filter(isMktg), sysA=AGENTS.filter(isSystem);
 const isUpwork=a=>((a.config&&a.config.channel)||'linkedin')==='upwork';
 const liA=salesA.filter(a=>!isUpwork(a)), upA=salesA.filter(isUpwork);
 const salesTile=a=>'<div class="agtile" onclick="openAgent(\\''+a.id+'\\')">'+avatarHtml(a,72)+'<div class="agname">'+a.title+'</div><div class="agmeta">'+agStatus(a)+'</div><div class="agmeta2">letzter: '+(a.latestName?a.latestName.replace(/\\.md$/,''):'—')+'</div></div>';
 const mktgTile=a=>{var sk=(a.config&&a.config.skills)||[];return '<div class="agtile" onclick="openAgent(\\''+a.id+'\\')">'+avatarHtml(a,72)+'<div class="agname">'+a.title+'</div><div class="agmeta">'+sk.length+' Skills</div><div class="agmeta2" style="font-size:10px;opacity:.75">'+sk.slice(0,3).join(' · ')+(sk.length>3?' …':'')+'</div></div>';};
 const liTiles=liA.length?liA.map(salesTile).join(''):'<div class="muted">Keine.</div>';
 const upTiles=upA.length?upA.map(salesTile).join(''):'<div class="muted">Keine.</div>';
 const mktgTiles=mktgA.length?mktgA.map(mktgTile).join(''):MARKETING.map(mockCard).join('');
 const sysTiles=sysA.length?sysA.map(salesTile).join(''):'';
 el.innerHTML='<div class="deptpill" style="background:rgba(176,124,255,.14);border-color:#b07cff">🧠 Mentoren &amp; Berater <span class="muted" style="font-weight:400">— externe Ratgeber · Jarvis holt hier Rat (Mock-up)</span></div>'+
  '<div class="agtiles">'+MENTORS.map(mentorCard).join('')+'</div>'+
  '<div class="deptpill" style="background:rgba(255,157,92,.14);border-color:#ff9d5c;margin-top:8px">⚖️ Council / Gremium <span class="muted" style="font-weight:400">— Jarvis befragt es bei Entscheidungen (Mock-up)</span></div>'+
  '<div class="orgline"></div>'+
  '<div class="ceonode" style="cursor:pointer" onclick="show(\\'copilot\\')" title="Zu Jarvis Copilot"><div class="ceoorb"></div><div><div class="ceotitle">CEO · JARVIS <span id="ceohbdot" class="hbdot" title="Heartbeat arbeitet gerade" style="display:none"></span></div><div class="muted">befragt Berater &amp; Council ↑ · koordiniert das Team ↓ · klicken für Copilot</div></div></div>'+
  '<div class="orgline"></div>'+
  '<div class="deptpill">📣 Sales · LinkedIn <span class="muted" style="font-weight:400">— live</span></div>'+
  '<div class="agtiles">'+liTiles+'</div>'+
  '<div class="orgline"></div>'+
  '<div class="deptpill" style="background:rgba(54,224,255,.12);border-color:#36e0ff">💼 Sales · Upwork <span class="muted" style="font-weight:400">— täglicher Scan 06:30 · Proposals + Loom</span></div>'+
  '<div class="agtiles">'+upTiles+'</div>'+
  '<div class="orgline"></div>'+
  '<div class="deptpill" style="background:rgba(84,224,138,.14);border-color:#54e08a">📈 Marketing <span class="muted" style="font-weight:400">— '+mktgA.length+' Agents · Skills zugewiesen (laufen noch nicht autonom)</span></div>'+
  '<div class="agtiles">'+mktgTiles+'</div>'+
  (sysA.length?('<div class="orgline"></div>'+
  '<div class="deptpill" style="background:rgba(167,139,250,.14);border-color:#a78bfa">⚙️ System &amp; Betrieb <span class="muted" style="font-weight:400">— Qualitätsmanager &amp; Nacht-Werker · halten das AIOS sauber (kein Sales)</span></div>'+
  '<div class="agtiles">'+sysTiles+'</div>'):'');}
function upKpi(label,val,sub){return '<div class="upkpi"><div class="upkpi-v">'+val+'</div><div class="upkpi-l">'+label+'</div>'+(sub?'<div class="upkpi-s">'+sub+'</div>':'')+'</div>';}
function upBadge(s){var m={sent:['📨','verschickt','#7d94a8'],viewed:['👀','angesehen','#36e0ff'],replied:['💬','Antwort','#ffb547'],hired:['✅','gewonnen','#54e08a'],declined:['✖','abgesagt','#e0607a']};var x=m[s]||m.sent;return '<span class="upbadge" style="color:'+x[2]+';border-color:'+x[2]+'">'+x[0]+' '+x[1]+'</span>';}
function upRow(p){
 var meta=[(p.client?(p.client.city||p.client.country||''):''),(p.bid?('$'+(p.bid.rateUsd||'?')+(p.bid.type==='hourly'?'/hr':' fix')):''),(p.connects!=null?p.connects+' Connects':''),(p.loom?'🎬 Loom'+(p.loomCount>1?' ×'+p.loomCount:''):'')].filter(Boolean).join('  ·  ');
 var st=p.status||'sent';
 var btn=function(s,lbl){return '<button class="upbtn'+(st===s?' on':'')+'" onclick="upSet(\\''+esc(p.jobUrl)+'\\',\\''+s+'\\')">'+lbl+'</button>';};
 return '<div class="uprow"><div class="uprow-main">'+
   '<a href="'+esc(p.jobUrl)+'" target="_blank" rel="noopener" class="uprow-title">'+esc(p.jobTitle)+' ↗</a>'+
   '<div class="uprow-meta">'+esc(meta)+'</div>'+
   (p.notes?'<div class="uprow-notes">'+esc(p.notes)+'</div>':'')+
   '</div><div class="uprow-side">'+upBadge(st)+
   '<div class="upbtns">'+btn('viewed','👀')+btn('replied','💬')+btn('hired','✅')+btn('declined','✖')+'</div>'+
   '<div class="uprow-date">'+esc(p.date||'')+'</div></div></div>';
}
function upScoreCls(n){return n>=8?'up-sc-hi':(n>=6?'up-sc-mid':'up-sc-lo');}
function upTog(id){var e=document.getElementById(id);if(e)e.style.display=(e.style.display==='none'?'block':'none');}
function upCopy(id){var e=document.getElementById(id);if(e&&navigator.clipboard)navigator.clipboard.writeText(e.textContent);}
function upToolsBox(){return '<div class="uptools"><div class="uptbh">🛠 Tools &amp; Zugriff (Upwork-spezifisch)</div>'+
 '<div class="uptoolrow"><b>Upwork-Login / Chrome</b> — Best Matches + Saved Searches scannen (lesend)</div>'+
 '<div class="uptoolrow"><b>Skill upwork-application</b> — Scoring gegen ICP + Proposal-Draft in deiner Voice</div>'+
 '<div class="uptoolrow"><b>Gmail (Phase 2)</b> — "Proposal viewed" / Reply → Status + Telegram-Ping</div>'+
 '<div class="uptoolrow"><b>Dateien</b> — upwork-radar.json · upwork-proposals.json · upwork-projekte/</div></div>';}
function upFitCard(f,i){
 var cli=f.client||{};
 var meta=[(cli.city||cli.country||''),(f.budget||''),(cli.paymentVerified?'Payment verified':''),(cli.rating?cli.rating+'★'+(cli.reviews?' ('+cli.reviews+')':''):(cli.reviews===0?'neu (0 Reviews)':'')),(cli.spentUsd?'$'+cli.spentUsd+' spent':'')].filter(Boolean).join(' · ');
 var chips='<span class="upchip" onclick="upTog(\\'rdd'+i+'\\')">📄 Proposal-Draft</span>'+(f.loomScript?'<span class="upchip" onclick="upTog(\\'rdl'+i+'\\')">🎬 Loom-Skript</span>':'')+(f.visualPath?'<a class="upchip" href="/'+esc(f.visualPath)+'" target="_blank">🖼 HTML-Visual</a>':'')+'<a class="upchip" href="'+esc(f.jobUrl)+'" target="_blank">🔗 Zum Job</a>';
 var dd=f.draft?'<div id="rdd'+i+'" class="uprdetail" style="display:none"><div class="uprdhead">Proposal-Draft <button class="uprcopy" onclick="upCopy(\\'rddt'+i+'\\')">kopieren</button></div><pre id="rddt'+i+'" class="uprpre">'+esc(f.draft)+'</pre></div>':'';
 var ll=f.loomScript?'<div id="rdl'+i+'" class="uprdetail" style="display:none"><div class="uprdhead">Loom-Skript</div><pre class="uprpre">'+esc(f.loomScript)+'</pre></div>':'';
 return '<div class="uprcard"><div class="uprtop"><div class="upscore '+upScoreCls(f.score||0)+'"><span class="n">'+(f.score||'?')+'</span><span class="x">/10</span></div><div class="uprmain">'+
  '<a href="'+esc(f.jobUrl)+'" target="_blank" class="uprtitle">'+esc(f.jobTitle)+' ↗</a><div class="uprmeta">'+esc(meta)+'</div>'+
  (f.fitReason?'<div class="uprfit">'+esc(f.fitReason)+'</div>':'')+
  '<div class="uprassets">'+chips+'</div>'+dd+ll+
  '<div class="upract"><button class="upapply" onclick="upApply(\\''+esc(f.id||f.jobUrl)+'\\')">✅ Beworben (ins Tracking)</button><button class="updrop" onclick="upDiscard(\\''+esc(f.id||f.jobUrl)+'\\')">✖ Verworfen</button></div>'+
  '</div></div></div>';
}
function upApply(id){var c=prompt('Wie viele Connects ausgegeben? (leer = unbekannt)','');fetch('/api/upwork-radar-action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,action:'applied',connects:c?parseInt(c,10):null})}).then(function(r){return r.json();}).then(function(){if(curAgent)renderUpworkAgent(curAgent,document.getElementById('agdetail'));});}
function upDiscard(id){if(!confirm('Diesen Fit verwerfen?'))return;fetch('/api/upwork-radar-action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,action:'discarded'})}).then(function(r){return r.json();}).then(function(){if(curAgent)renderUpworkAgent(curAgent,document.getElementById('agdetail'));});}
function upScanNow(){if(!confirm('Scan jetzt starten? Läuft im Hintergrund (paar Minuten), meldet sich per Telegram.'))return;fetch('/api/upwork-scan-now',{method:'POST'}).then(function(r){return r.json();}).then(function(o){alert(o&&o.ok?'Scan gestartet.':'Konnte Scan nicht starten (Chrome offen & bei Upwork eingeloggt?).');});}
function renderUpworkAgent(a,d){
 d.innerHTML='<style>'+
  '.uphead{display:flex;align-items:center;gap:10px;margin-bottom:14px}.uphead b{color:#eaf6ff;font-size:17px;font-weight:800;letter-spacing:.3px}'+
  '.upscanbar{display:flex;align-items:center;gap:9px;margin-left:auto;font-size:12px}.uppill{background:rgba(54,224,255,.12);border:1px solid #36e0ff;color:#bfefff;border-radius:8px;padding:5px 11px;cursor:pointer;font-size:12px}.uppill.gold{background:rgba(255,181,71,.14);border-color:#ffb547;color:#ffdca0}'+
  '.upkpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px}.upkpi{flex:1;min-width:92px;background:rgba(54,224,255,.06);border:1px solid var(--line);border-radius:11px;padding:11px 12px;text-align:center}'+
  '.upkpi-v{font:800 23px Rajdhani,sans-serif;color:#eaf6ff}.upkpi-l{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:#88aaaa;margin-top:2px}.upkpi-s{font-size:10px;color:#667788}'+
  '.upsech{display:flex;align-items:center;gap:8px;margin:20px 0 10px;font-size:14px;font-weight:700;color:#eaf6ff}.upsech .upcnt{font-size:11px;font-weight:400;color:var(--muted)}'+
  '.uprcard{border:1px solid var(--line);border-radius:12px;padding:13px 14px;margin-bottom:11px;background:linear-gradient(180deg,rgba(54,224,255,.05),rgba(255,255,255,.015))}.uprtop{display:flex;gap:13px;align-items:flex-start}'+
  '.upscore{flex:0 0 auto;width:52px;height:52px;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:800;border:1.5px solid}.upscore .n{font-size:20px;line-height:1}.upscore .x{font-size:9px;opacity:.7}'+
  '.up-sc-hi{color:#54e08a;border-color:#54e08a;background:rgba(84,224,138,.1)}.up-sc-mid{color:#ffb547;border-color:#ffb547;background:rgba(255,181,71,.1)}.up-sc-lo{color:#e0607a;border-color:#e0607a;background:rgba(224,96,122,.1)}'+
  '.uprmain{flex:1;min-width:0}.uprtitle{color:#eaf6ff;font-weight:700;font-size:15px;text-decoration:none;display:block}.uprtitle:hover{color:#36e0ff}.uprmeta{font-size:12px;color:#88aaaa;margin-top:3px}'+
  '.uprfit{font-size:12.5px;color:#aac3d6;margin-top:7px;line-height:1.45;border-left:2px solid #36e0ff;padding-left:9px}'+
  '.uprassets{display:flex;gap:7px;margin-top:10px;flex-wrap:wrap}.upchip{font-size:11.5px;border:1px solid var(--line);background:rgba(255,255,255,.03);border-radius:7px;padding:4px 9px;cursor:pointer;color:#cfe;text-decoration:none;display:inline-block}.upchip:hover{border-color:#36e0ff}'+
  '.uprdetail{margin-top:9px}.uprdhead{font-size:11px;color:#88aaaa;margin-bottom:4px;display:flex;gap:8px;align-items:center}.uprcopy{font-size:10px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:#cfe;border-radius:6px;padding:2px 7px;cursor:pointer}.uprpre{white-space:pre-wrap;font:12px/1.5 ui-monospace,Menlo,monospace;background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:8px;padding:9px 11px;color:#cde;margin:0}'+
  '.upract{display:flex;gap:7px;margin-top:11px}.upapply{background:linear-gradient(180deg,#14a800,#0f8600);color:#eafff0;border:0;border-radius:8px;padding:7px 13px;font-weight:700;cursor:pointer;font-size:12.5px}.updrop{background:rgba(255,255,255,.04);border:1px solid var(--line);color:#9ab;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:12.5px}'+
  '.uprow{display:flex;gap:12px;justify-content:space-between;border:1px solid var(--line);border-radius:10px;padding:11px 13px;margin-bottom:9px;background:rgba(255,255,255,.02)}.uprow-main{flex:1;min-width:0}.uprow-title{color:#eaf6ff;font-weight:700;text-decoration:none;font-size:13.5px;display:block}.uprow-title:hover{color:#36e0ff}.uprow-meta{font-size:12px;color:#88aaaa;margin-top:4px}.uprow-notes{font-size:11px;color:#667788;margin-top:5px}'+
  '.uprow-side{text-align:right;white-space:nowrap}.upbadge{display:inline-block;border:1px solid;border-radius:20px;padding:2px 9px;font-size:11px;font-weight:600}.upbtns{margin-top:8px;display:flex;gap:4px;justify-content:flex-end}.upbtn{background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:7px;padding:4px 7px;cursor:pointer;font-size:13px;line-height:1}.upbtn.on{border-color:#36e0ff;background:rgba(54,224,255,.18)}.uprow-date{font-size:10px;color:#556677;margin-top:7px}'+
  '.uptools{margin-top:20px;border:1px dashed var(--line);border-radius:11px;padding:12px 14px}.uptbh{font-size:12px;font-weight:700;color:#cfe;margin-bottom:6px}.uptoolrow{font-size:12px;color:#9ab;margin:4px 0}.uptoolrow b{color:#cfe}'+
  '</style>'+
  '<div class="uphead"><button class="agback" onclick="closeAgent()" title="Zurück">←</button>'+avatarHtml(a,32)+'<b>'+esc(a.title)+'</b>'+
   '<div class="upscanbar muted"><span>Scan 06:30</span><button class="uppill" onclick="upScanNow()">▶ Scan jetzt</button></div></div>'+
  '<div id="up-body"><span class="muted">lädt …</span></div>';
 Promise.all([fetch('/api/upwork-radar').then(function(r){return r.json();}),fetch('/api/upwork-proposals').then(function(r){return r.json();})]).then(function(res){
  var rad=res[0]||{},trk=res[1]||{};
  var fits=(rad.fits||[]).filter(function(f){return (f.status||'new')==='new';}).sort(function(x,y){return (y.score||0)-(x.score||0);});
  var st=trk.stats||{},ps=trk.proposals||[];
  var kpis='<div class="upkpis">'+upKpi('Neue Fits',fits.length,'offen')+upKpi('Verschickt',(st.total||0),'gesamt')+upKpi('Angesehen',(st.viewedPct||0)+'%',(st.viewed||0)+'/'+(st.total||0))+upKpi('Antwort',(st.repliedPct||0)+'%',(st.replied||0)+'/'+(st.total||0))+upKpi('Hire',(st.hiredPct||0)+'%',(st.hired||0)+'/'+(st.total||0))+upKpi('Connects',(st.connects||0),'gesamt')+'</div>';
  var fitHtml=fits.length?fits.map(upFitCard).join(''):'<div class="muted" style="padding:10px 2px">Keine neuen Fits. Der Scan (06:30) legt hier bewertete Jobs ab.</div>';
  var trkHtml=ps.length?ps.map(upRow).join(''):'<div class="muted" style="padding:10px 2px">Noch keine verschickten Proposals.</div>';
  document.getElementById('up-body').innerHTML=kpis+'<div class="upsech">📡 Neue Fits <span class="upcnt">— vom Scan, nach Bewertung sortiert · noch nicht beworben</span></div>'+fitHtml+'<div class="upsech">📊 Verschickt <span class="upcnt">— Status pflegen (Phase 2: Gmail pingt automatisch)</span></div>'+trkHtml+upToolsBox();
 }).catch(function(){document.getElementById('up-body').innerHTML='<div class="muted">Konnte Upwork-Daten nicht laden.</div>';});
}
function upSet(jobUrl,status){fetch('/api/upwork-proposal-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobUrl:jobUrl,status:status})}).then(function(r){return r.json();}).then(function(){if(curAgent)renderUpworkAgent(curAgent,document.getElementById('agdetail'));});}
function openAgent(id){curAgent=AGENTS.find(a=>a.id===id);if(!curAgent)return;const a=curAgent;
 document.getElementById('agorg').style.display='none';const d=document.getElementById('agdetail');d.style.display='block';if((a.config&&a.config.channel)==='upwork'){renderUpworkAgent(a,d);return;}
 const report=a.latest?agMd(a.latest):'<span class="muted">Noch kein Lauf — Format steht, der Runner füllt es (pro Step mit Zahlen).</span>';
 const tools=(a.tools&&a.tools.length)?'<div class="toolgrid">'+a.tools.map(t=>{const w=/schreib|upload/i.test(t.access);const cls=w?(/lesen/i.test(t.access)?'rw':'wr'):'ro';return '<div class="tool '+cls+'"><div class="tn">'+t.icon+' '+esc(t.name)+'</div><div class="ta">'+esc(t.access||'—')+'</div><div class="td">'+esc(t.desc)+'</div></div>';}).join('')+'</div>':'<span class="muted">Keine Tools in tools.md.</span>';
 const msgs=(a.messageBlocks&&a.messageBlocks.length)?a.messageBlocks.map(b=>'<div class="msgblock"><div class="msgicp">🎯 '+esc(b.icp)+'</div>'+(b.pain?'<div class="msgpain">Pain: '+esc(b.pain)+'</div>':'')+'<div class="msgline"><b>M1</b>'+esc(b.m1||'—')+'</div><div class="msgline"><b>M2</b>'+esc(b.m2||'—')+'</div><div class="msgline"><b>M3</b>'+esc(b.m3||'—')+'</div></div>').join(''):'<span class="muted">Keine Messages in messages.md.</span>';
 const cfg=a.config||{},sch=cfg.schedule||{},lim=cfg.limits||{};
 const steuerung='<details class="card" open><summary>▶ Steuerung</summary>'+
   '<div class="muted" style="margin-bottom:4px">Account <b>'+esc(cfg.account||a.title)+'</b> · Chrome-Profil <b>'+esc(cfg.chromeProfile||'TODO')+'</b> · Konto <b>'+esc(cfg.verifyAccount||'—')+'</b><br>🔒 Prüft vor jeder Aktion das richtige Konto · Parallel-Sperre pro Account — nie zwei Läufe auf demselben Profil.</div>'+
   '<div class="ctrlrow"><button class="'+(a.paused?'offbtn':'onbtn')+'" onclick="togglePause()">'+(a.paused?'▶ Play':'⏸ Stop')+'</button><span class="muted">'+(a.paused?'Pausiert — Play macht an derselben Stelle weiter bzw. gibt den nächsten geplanten Start wieder frei':'Stop friert einen laufenden Lauf sofort ein (Play setzt exakt dort fort); läuft nichts, blockt Stop den nächsten geplanten Start')+'</span></div>'+
   '<div class="sched">'+SUBS.map((s,i)=>'<div class="schrow"><label>'+s+'</label><input id="sch'+i+'" value="'+esc(sch[s]||'')+'"></div>').join('')+'</div>'+
   '<div class="ctrlrow2">Limits/Tag — Connects <input id="limC" type="number" value="'+(lim.connectsPerDay||20)+'"> · Messages <input id="limM" type="number" value="'+(lim.messagesPerDay||20)+'"></div>'+
   '<button onclick="saveAgentConfig()">💾 Zeiten & Limits speichern</button> <span id="cfg-saved" class="muted"></span>'+
   '<div style="border-top:1px solid var(--line);margin:12px 0 0;padding-top:11px"><button onclick="agentRun(\\'die ganze Tageskette\\')">▶ Jetzt starten (Live)</button><div class="substeps">'+SUBS.map(s=>'<button class="substep" onclick="agentRun(\\''+s+'\\')">'+s+'</button>').join('')+'</div><div id="ag-run" class="muted" style="margin-top:8px"></div></div>'+
 '</details>';
 d.innerHTML='<div class="agdetail-row">'+
   '<div class="agmid">'+
     '<div class="agmidhead"><button class="agback" onclick="closeAgent()" title="Zurück zur Übersicht">←</button>'+avatarHtml(a,30)+'<b style="color:#eaf6ff;font:700 14px Rajdhani;letter-spacing:.5px">'+a.title+'</b>'+
       '<select id="ag-day" onchange="selectDay(this.value)" style="margin-left:auto"><option value="__live__">📅 Heute</option>'+(a.runs||[]).map(r=>{var m=r.match(/^(\\d{4})-(\\d{2})-(\\d{2})-?(.*?)\\.md$/);var lbl=m?(m[3]+'.'+m[2]+'.'+m[1]+(m[4]?' · '+m[4]:'')):r.replace(/\\.md$/,'');return '<option value="'+esc(r)+'">'+esc(lbl)+'</option>';}).join('')+'</select></div>'+
     '<div id="ag-counter" class="agcounter"></div>'+
     '<div id="ag-flow"><span class="muted">…</span></div>'+
     '<div class="cbar"><input id="ag-steer" placeholder="Mit '+esc(a.title)+' reden / steuern … (Enter)" onkeydown="if(event.key===\\'Enter\\')midSend()">'+
       '<button id="ag-stopbtn" onclick="midStop()" title="Stop" style="background:var(--red);color:#fff">⏹</button><button onclick="midSend()">Senden</button></div>'+
   '</div>'+
   '<div class="agright">'+
     '<div class="card aghead"><button class="agx" onclick="closeAgent()">✕</button>'+avatarHtml(a,54)+'<div><h3 style="margin:0 0 3px;color:#eaf6ff;font-size:16px">'+a.title+'</h3><div class="muted" style="font-size:12px">'+deptLabel(a)+' · '+agStatus(a)+'</div></div></div>'+
     steuerung+
     '<details class="card" open><summary>🛠 Tools & Zugriff ('+((a.tools||[]).length)+')</summary>'+tools+'</details>'+
     '<details class="card"><summary>💬 Messages & ICPs ('+((a.messageBlocks||[]).length)+')</summary>'+msgs+'<div style="margin-top:9px"><button onclick="editAgentMessages()">✏️ Messages bearbeiten</button></div><div id="ag-msg-edit" style="display:none;margin-top:9px"><textarea id="ag-msg-ta" rows="14"></textarea><div><button onclick="saveAgentMessages()">💾 Speichern</button></div></div></details>'+
     '<details class="card"><summary>📋 Playbooks ('+((a.playbooks||[]).length)+')</summary>'+((a.playbooks&&a.playbooks.length)?a.playbooks.map(p=>'<details class="pbblock"><summary>📋 '+esc(p.name)+'</summary>'+agMd(p.content)+'</details>').join(''):'<span class="muted">Keine Playbooks.</span>')+'</details>'+
     '<details class="card"><summary>📊 Letzter Report</summary>'+report+'</details>'+
     '<details class="card"><summary>💡 Learnings</summary>'+agMd(a.learnings||'_(noch leer)_')+'</details>'+
     '<details class="card"><summary>⚙ Anleitung & Ziel</summary><div>'+agMd(a.agent)+'</div><div style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><div class="row"><b class="muted">Ziel / ICP</b><button onclick="editAgentGoal()">✏️ ändern</button></div><div id="ag-goal">'+agMd(a.goal||'_(kein goal.md)_')+'</div><div id="ag-goal-edit" style="display:none"><textarea id="ag-goal-ta" rows="12"></textarea><div><button onclick="saveAgentGoal()">💾 Speichern</button></div></div></div></details>'+
   '</div>'+
 '</div>';
 document.getElementById('ag-day').value='__live__';selectDay('__live__');}
function agentRun(task){if(!curAgent)return;const i=document.getElementById('ag-steer');if(!i)return;i.value='Starte JETZT echt: '+task+'. Arbeite das passende Playbook in agents/'+curAgent.id+'/playbooks/ Schritt für Schritt ab und FÜHRE jeden Schritt wirklich aus — über deine mcp__browser__* Tools (chrome-devtools, fest an deinen Account-Port gebunden). Pflicht-Check zuerst: eigener Arbeits-Tab, Login/Checkpoint/Captcha → sofort stoppen + melden, nie selbst einloggen. Vergib pro Lead den ICP-Score VOR dem Vernetzen, vernetze nur ≥7, speichere jeden vernetzten Lead laut Playbook. Zeig mir jeden Schritt + deine ICP-Begründung. Nur lesen/dokumentieren ist NICHT gemeint — handle.';midSend();}
function togglePause(){if(!curAgent)return;const url=curAgent.paused?'/api/agent-resume':'/api/agent-pause';fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent:curAgent.id})}).then(()=>loadAgents()).catch(()=>{});}
function saveAgentConfig(){if(!curAgent)return;const c=curAgent.config=curAgent.config||{};c.schedule={};SUBS.forEach((s,i)=>{const e=document.getElementById('sch'+i);if(e)c.schedule[s]=e.value;});const lc=document.getElementById('limC'),lm=document.getElementById('limM');c.limits=Object.assign({},c.limits,{connectsPerDay:+(lc?lc.value:20),messagesPerDay:+(lm?lm.value:20)});persistConfig('cfg-saved');}
function persistConfig(savedId){if(!curAgent)return;fetch('/api/agent-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:curAgent.id,config:curAgent.config})}).then(r=>r.json()).then(d=>{if(savedId){const e=document.getElementById(savedId);if(e)e.textContent=d.ok?'✓ gespeichert':'⚠ Fehler';}loadAgents();}).catch(()=>{});}
// ---- Live-Konsole ----
let acES=null,acAgent=null,acBubble=null,acThink=null;
function openConsole(id){acAgent=id;document.getElementById('ag-console').style.display='flex';document.getElementById('ac-title').textContent='🖥 Live-Konsole · '+id;document.getElementById('ac-log').innerHTML='';document.getElementById('ac-status').textContent='verbindet …';acBubble=null;
 if(acES)acES.close();acES=new EventSource('/api/agent-console?agent='+encodeURIComponent(id));
 acES.onmessage=e=>{let o;try{o=JSON.parse(e.data);}catch{return;}acEvent(o);};acES.onerror=()=>{const s=document.getElementById('ac-status');if(s)s.textContent='Verbindung unterbrochen';};
 setTimeout(()=>document.getElementById('ac-in').focus(),100);}
function acLog(txt,cls){const l=document.getElementById('ac-log');const el=document.createElement('div');el.className=cls;el.textContent=txt;l.appendChild(el);l.scrollTop=1e9;return el;}
function acEvent(o){const st=document.getElementById('ac-status');
 if(o.type==='step'){acBubble=null;acThink=null;acLog('🔧 '+o.name+(o.detail?' · '+o.detail:''),'acstep');}
 else if(o.type==='thinking'){acBubble=null;if(!acThink)acThink=acLog('','acthink');acThink.textContent+=o.t;document.getElementById('ac-log').scrollTop=1e9;}
 else if(o.type==='text'){acThink=null;if(!acBubble)acBubble=acLog('','acmsg');acBubble.textContent+=o.t;document.getElementById('ac-log').scrollTop=1e9;}
 else if(o.type==='turn-end'){acBubble=null;acThink=null;if(st)st.textContent='bereit';if(acAgent)loadAgents();}
 else if(o.type==='closed'){if(st)st.textContent='Session beendet';acBubble=null;}
 else if(o.type==='ready'){if(st)st.textContent='bereit';}}
function consoleSend(){const i=document.getElementById('ac-in');const v=i.value.trim();if(!v||!acAgent)return;i.value='';acLog(v,'acmsg acuser');acBubble=null;const st=document.getElementById('ac-status');if(st)st.textContent='… arbeitet';
 fetch('/api/agent-console-send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent:acAgent,msg:v})});}
function consoleStop(){if(!acAgent)return;fetch('/api/agent-console-stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent:acAgent})});const st=document.getElementById('ac-status');if(st)st.textContent='⏹ gestoppt';acBubble=null;}
function consoleClose(){if(acES){acES.close();acES=null;}document.getElementById('ag-console').style.display='none';}
function editAgentMessages(){if(!curAgent)return;document.getElementById('ag-msg-edit').style.display='block';document.getElementById('ag-msg-ta').value=curAgent.messages||'';}
function saveAgentMessages(){if(!curAgent)return;const v=document.getElementById('ag-msg-ta').value;
 fetch('/api/agent-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:curAgent.id+'/messages.md',markdown:v})}).then(r=>r.json()).then(()=>{curAgent.messages=v;loadAgents();});}
function runMd(md,id){const fixed=(md||'').replace(/\\]\\((?:\\.\\/)?((?:runs\\/)?screenshots\\/[^)]+)\\)/g,(m,p)=>'](/api/agent-asset?path='+encodeURIComponent(id+'/'+(p.indexOf('runs/')===0?p:'runs/'+p))+')');return agMd(fixed);}
function openRun(id,run,el){const body=el.parentNode.querySelector('.runbody');if(body.style.display==='block'){body.style.display='none';return;}
 body.style.display='block';body.innerHTML='<span class="muted">… lädt</span>';
 fetch('/api/agent-run?agent='+encodeURIComponent(id)+'&run='+encodeURIComponent(run)).then(r=>r.json()).then(d=>{body.innerHTML=runMd(d.content||'(leer)',id);}).catch(()=>{body.innerHTML='Fehler';});}
let midES=null,midBubble=null,midThink=null,midMode=null,liveCache={},midCounterTimer=null;
function midStopSSE(){if(midES){midES.close();midES=null;}if(midCounterTimer){clearInterval(midCounterTimer);midCounterTimer=null;}midBubble=null;}
function saveLive(){if(midMode==='__live__'&&curAgent){const f=document.getElementById('ag-flow');if(f)liveCache[curAgent.id]=f.innerHTML;}}
function loadAgentToday(id){renderCounter(id);const head=document.getElementById('ag-today-head');if(head){head.innerHTML='<div id="ag-today-trail"></div>';renderTodayTrail(id);}}
function renderCounter(id,dateStr){const box=document.getElementById('ag-counter');if(!box)return;
 const today=new Date().toISOString().slice(0,10);const day0=dateStr||today;const dd=day0.split('-').reverse().join('.');
 fetch('/api/outreach-stats').then(r=>r.json()).then(d=>{const b=document.getElementById('ag-counter');if(!b)return;
  const day=(d.days||[]).find(x=>x.date===day0);const a=(day&&day.agents&&day.agents[id])||null;
  const cells=[['🔗','Vernetzt','vernetzt'],['🤝','Angenommen','gesynct'],['✉️','Erstnachr.','erstnachrichten'],['📩','InMails','inmails'],['↪️','Follow-ups','followups'],['💬','Geantwortet','geantwortet']];
  const nums=cells.map(c=>'<div class="agkpi"><div class="agkpi-l">'+c[0]+' '+c[1]+'</div><div class="agkpi-n">'+((a&&a[c[2]])||0)+'</div></div>').join('');
  b.innerHTML='<div class="agkpi-hd">📅 '+(day0===today?'HEUTE · ':'')+dd+'</div><div class="agkpi-row">'+nums+'</div>';
 }).catch(()=>{});}
function renderTodayTrail(id){const box=document.getElementById('ag-today-trail');if(!box)return;
 fetch('/api/agent-today-log?agent='+encodeURIComponent(id)).then(r=>r.json()).then(d=>{const evs=d.events||[];const b=document.getElementById('ag-today-trail');if(!b)return;
  const nstep=evs.filter(e=>e.type==='step').length;
  if(!evs.length){b.innerHTML='<span class="muted">Heute noch kein Lauf — seine Schritte erscheinen hier live.</span>';return;}
  let h='<details open><summary class="oa-sum">🧠 Heute — Schritte & Bewertung ('+nstep+' Aktionen)</summary><div style="display:flex;flex-direction:column;gap:7px;margin-top:10px;padding-right:4px">';
  for(const e of evs){
   if(e.type==='step')h+='<div class="acstep">🔧 '+esc(e.name||'')+(e.detail?' · '+esc(e.detail):'')+'</div>';
   else if(e.type==='thinking')h+='<div class="acthink">'+esc(e.t||'')+'</div>';
   else if(e.type==='text')h+='<div class="acmsg">'+esc(e.t||'')+'</div>';
   else if(e.type==='turn-end')h+='<div style="border-top:1px dashed var(--line);margin:3px 0"></div>';}
  h+='</div></details>';b.innerHTML=h;const fl=document.getElementById('ag-flow');if(fl)fl.scrollTop=1e9;}).catch(()=>{});}
function selectDay(v){saveLive();midStopSSE();const flow=document.getElementById('ag-flow');if(!flow||!curAgent)return;const sb=document.getElementById('ag-stopbtn');
 midMode=v;const live=v==='__live__';if(sb)sb.style.display='none';
 if(live){flow.innerHTML='<div id="ag-today-head"></div>';loadAgentToday(curAgent.id);flow.scrollTop=1e9;
  midES=new EventSource('/api/agent-console?agent='+encodeURIComponent(curAgent.id));midES.onmessage=e=>{let o;try{o=JSON.parse(e.data);}catch{return;}midEvent(o);};midCounterTimer=setInterval(()=>{if(curAgent)renderCounter(curAgent.id);},12000);}
 else{const m=v.match(/^(\\d{4}-\\d{2}-\\d{2})/);renderCounter(curAgent.id,m?m[1]:null); // Counter zeigt den GEWÄHLTEN Tag, nicht heute
  flow.innerHTML='<span class="muted">… lädt</span>';fetch('/api/agent-run?agent='+encodeURIComponent(curAgent.id)+'&run='+encodeURIComponent(v)).then(r=>r.json()).then(d=>{flow.innerHTML=runMd(d.content||'(leer)',curAgent.id);flow.scrollTop=0;}).catch(()=>{flow.innerHTML='Fehler beim Laden.';});}}
function midEvent(o){const flow=document.getElementById('ag-flow');if(!flow)return;const m=flow.querySelector('.muted');const sb=document.getElementById('ag-stopbtn');
 if(o.type==='step'){if(sb)sb.style.display='';midBubble=null;midThink=null;if(m)m.remove();const e=document.createElement('div');e.className='acstep';e.textContent='🔧 '+o.name+(o.detail?' · '+o.detail:'');flow.appendChild(e);}
 else if(o.type==='thinking'){if(sb)sb.style.display='';midBubble=null;if(!midThink){if(m)m.remove();midThink=document.createElement('div');midThink.className='acthink';flow.appendChild(midThink);}midThink.textContent+=o.t;}
 else if(o.type==='text'){if(sb)sb.style.display='';midThink=null;if(!midBubble){if(m)m.remove();midBubble=document.createElement('div');midBubble.className='acmsg';flow.appendChild(midBubble);}midBubble.textContent+=o.t;}
 else if(o.type==='turn-end'||o.type==='closed'){if(sb)sb.style.display='none';midBubble=null;midThink=null;saveLive();}
 flow.scrollTop=1e9;}
function midSend(){if(!curAgent)return;const i=document.getElementById('ag-steer');const v=i.value.trim();if(!v)return;i.value='';
 const sel=document.getElementById('ag-day');if(sel.value!=='__live__'||!midES){sel.value='__live__';selectDay('__live__');}
 const flow=document.getElementById('ag-flow');const m=flow.querySelector('.muted');if(m)m.remove();
 const u=document.createElement('div');u.className='acmsg acuser';u.textContent=v;flow.appendChild(u);midBubble=null;flow.scrollTop=1e9;
 const sb=document.getElementById('ag-stopbtn');if(sb)sb.style.display='';
 fetch('/api/agent-console-send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent:curAgent.id,msg:v})});}
function midStop(){if(curAgent)fetch('/api/agent-console-stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent:curAgent.id})});}
function closeAgent(){saveLive();midStopSSE();midMode=null;curAgent=null;renderOrg();}
function editAgentGoal(){if(!curAgent)return;document.getElementById('ag-goal').style.display='none';document.getElementById('ag-goal-edit').style.display='block';document.getElementById('ag-goal-ta').value=curAgent.goal||'';}
function saveAgentGoal(){if(!curAgent)return;const v=document.getElementById('ag-goal-ta').value;
 fetch('/api/agent-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:curAgent.id+'/goal.md',markdown:v})}).then(r=>r.json()).then(()=>{curAgent.goal=v;loadAgents();});}
function askAgent(){if(!curAgent)return;const q=document.getElementById('ag-q').value.trim();if(!q)return;const r=document.getElementById('ag-reply');r.textContent='… '+curAgent.title+' antwortet (10–30s)';
 const p='Du bist der Mitarbeiter-Agent "'+curAgent.title+'" (Ordner agents/'+curAgent.id+'). Lies agents/'+curAgent.id+'/agent.md, goal.md, learnings.md und den neuesten Report in agents/'+curAgent.id+'/runs/. Antworte der Nutzer (CEO) kurz & direkt als dieser Agent. Wenn er ein Ziel/ICP/eine Anweisung gibt, aktualisiere agents/'+curAgent.id+'/goal.md entsprechend und sag in EINER Zeile, was du geändert hast. Frage: '+q;
 fetch('/api/jarvis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:p})}).then(x=>x.json()).then(d=>{pulseOrb();r.innerHTML=marked.parse(d.reply||'(leer)');document.getElementById('ag-q').value='';loadAgents();}).catch(e=>{r.textContent='Fehler: '+e;});}
loadAgents();
// ---- Pipeline / CRM (aus Airtable-Snapshot) ----
let LEADS=[],LEADSMETA={};
function loadLeads(){fetch('/api/leads').then(r=>r.json()).then(d=>{LEADS=d.leads||[];LEADS.forEach((l,i)=>{l._i=i;l._origId=l.url||l.name;});LEADSMETA=d;initPipeline();}).catch(()=>{});}
// Live-KPIs (Command Center + Outreach) aus /api/kpis — CRM, Rechnungen & Projekte, eine Quelle für alle Kacheln.
function loadKpis(){fetch('/api/kpis').then(r=>r.json()).then(d=>{if(!d||!d.ok)return;var f=d.funnel,u=d.umsatz;
 function set(id,v){var e=document.getElementById(id);if(e)e.textContent=v;return e;}
 function pct(a,b){return b?(Math.round(a/b*1000)/10).toLocaleString('de-DE')+' %':'–';}
 // Nur echte Zahlungseingänge (bezahlt = Wise-bestätigt). Offene Rechnungen leben im Rechnungen-Modul, nicht hier.
 set('d-umsatz',fmtEur(u.bezahlt));set('d-umsatz-sub','Ziel 10.000 € · '+Math.round((u.bezahlt||0)/10000*100)+' %');
 set('d-contact',f.contacted);set('d-reply','Reply '+pct(f.replied,f.contacted));
 set('d-setclose',f.setting+' / '+f.closing);
 var dc=set('d-closed',f.won+' Closed');if(dc)dc.className='chg '+(f.won>0?'up':'warn');
 set('ot-setting',f.setting);set('ot-setclose','Setting→Closing '+pct(f.closing,f.setting));
 set('ot-reply',pct(f.replied,f.contacted));set('ot-replysub',f.replied+' / '+f.contacted);
 set('ot-call',f.callProposed);
 var oc=set('ot-closing',f.closing);var ocs=set('ot-closed',f.won+' Closed');if(ocs)ocs.className='chg '+(f.won>0?'up':'warn');
 set('ot-aov',f.won?fmtEur(Math.round(d.projekte.wert/f.won)):'–');set('ot-aovsub','Umsatz '+fmtEur(u.bezahlt));
 set('ot-contact',f.contacted);
 // Funnel v2 (17.07.): Vernetzungsquote, Umsatz gesamt, alle Conversion-Quoten, Zielgruppen-A/B
 var vn=d.vernetzung||{};
 var q14=vn.invites14?Math.round(vn.angenommen14/vn.invites14*100):null,qg=vn.invites?Math.round(vn.angenommen/vn.invites*100):null;
 set('ot-annahme',q14!==null?q14+' %':(qg!==null?qg+' %':'–'));
 set('ot-annahmesub','14 T: '+(vn.angenommen14||0)+' / '+(vn.invites14||0)+(qg!==null?' · Gesamt '+qg+' % ('+vn.angenommen+' / '+vn.invites+')':''));
 set('ot-umsatz',fmtEur(u.gesamtBezahlt||u.bezahlt||0));set('ot-umsatzsub','Monat: '+fmtEur(u.bezahlt||0));
 set('ot-contactsub',(f.contactedUnique||f.contacted)+' unique');
 var rt=document.getElementById('ot-rates');
 if(rt){var R=[['Reply Rate',f.replied,f.contacted],['Replied→Setting',f.setting,f.replied],['Setting→Closing',f.closing,f.setting],['Closing→Closed',f.won,f.closing],['Contacted→Setting',f.setting,f.contacted],['Contacted→Closing',f.closing,f.contacted],['Contacted→Closed',f.won,f.contacted],['Setting→Closed',f.won,f.setting]];
  rt.innerHTML='<div class="stats" style="grid-template-columns:repeat(4,1fr);gap:8px">'+R.map(function(x){return '<div class="stat"><div class="lbl">'+x[0]+'</div><div class="big" style="font-size:17px">'+pct(x[1],x[2])+'</div><div class="chg">'+x[1]+' / '+x[2]+'</div></div>';}).join('')+'</div>';}
 var zg=d.zielgruppen,zge=document.getElementById('ot-zg');
 if(zge){var rows=zg?Object.keys(zg).filter(function(k){var z=zg[k];return z.invites||z.inmails||z.kontaktiert;}):[];
  zge.innerHTML=rows.length?'<table class="oa-tbl"><thead><tr><th>Zielgruppe</th><th>Invites</th><th>Angenommen</th><th>Quote</th><th>Kontaktiert</th><th>Replies</th><th>Reply-Quote</th><th>InMails</th></tr></thead><tbody>'+rows.map(function(k){var z=zg[k];return '<tr><td><b>'+esc(k)+'</b></td><td>'+z.invites+'</td><td>'+z.angenommen+'</td><td>'+pct(z.angenommen,z.invites)+'</td><td>'+z.kontaktiert+'</td><td>'+z.geantwortet+'</td><td>'+pct(z.geantwortet,z.kontaktiert)+'</td><td>'+z.inmails+'</td></tr>';}).join('')+'</tbody></table>':'<span class="muted">Füllt sich mit den ersten Läufen unter dem neuen ICP.</span>';}
}).catch(()=>{});}
function leadId(l){return l.url||l._origId||l.name;}
function defObj(k,v){var o={};o[k]=v;return o;}
function plCount(f){return LEADS.filter(f).length;}
function initPipeline(){const stand=document.getElementById('pl-stand');if(!stand)return;
 if(!LEADS.length){stand.textContent='noch kein Export';document.getElementById('pl-table').innerHTML='<span class="muted">Noch keine Daten — Export läuft, lade gleich neu.</span>';return;}
 stand.textContent='Stand '+(LEADSMETA.exportedAt||'—')+' · '+LEADS.length+' Kontakte';stand.className='';
 const acc={};LEADS.forEach(l=>acc[l.account||'—']=(acc[l.account||'—']||0)+1);
 // Kopf-Statistik zählt über die Funnel-Booleans (wie /api/kpis + stageOf) — NICHT über das alte status-Textfeld,
 // das nur beim Import gesetzt wird („Angenommen 0 / Geantwortet 0"-Bug, des Nutzers Feedback 11.07.).
 const scored=LEADS.filter(l=>l.icpScore);const avg=scored.length?(scored.reduce((s,l)=>s+(+l.icpScore||0),0)/scored.length).toFixed(1):'–';
 const contacted=plCount(l=>l.contacted),replied=plCount(l=>l.replied),won=plCount(l=>l.won||l.pipelineStage==='Gewonnen');
 const replyPct=contacted?(Math.round(replied/contacted*1000)/10).toLocaleString('de-DE')+' %':'–';
 document.getElementById('pl-stats').innerHTML=[
  ['Kontakte',LEADS.length,'gesamt',''],['Kontaktiert',contacted,'angeschrieben',''],['Geantwortet',replied,'Reply '+replyPct,'up'],
  ['Setting / Closing',plCount(l=>l.settingBooked)+' / '+plCount(l=>l.closingBooked),'gebucht',''],
  ['Gewonnen',won,won?'🎉 Closed':'noch 0',won?'up':'warn'],['Ø ICP-Score',avg,'Skala 1–10','up']
 ].map(a=>'<div class="stat"><div class="lbl">'+a[0]+'</div><div class="big">'+a[1]+'</div><div class="chg '+a[3]+'">'+a[2]+'</div></div>').join('');
 const cats={};LEADS.forEach(l=>{const k=(l.category||'').trim()||'(ohne Kategorie)';cats[k]=(cats[k]||0)+1;});
 const top=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,10);const max=top.length?top[0][1]:1;
 document.getElementById('pl-buckets').innerHTML=top.map(e=>'<div class="fbar"><i style="width:'+Math.round(e[1]/max*100)+'%"></i><span>'+e[0]+' — '+e[1]+'</span></div>').join('');
 const stat={};LEADS.forEach(l=>{const k=l.status||'—';stat[k]=(stat[k]||0)+1;});
 plFill('pl-cat','Kategorie',cats);plFill('pl-status','Status',stat);plFill('pl-acc','Account',acc);
 renderLeads();}
function plFill(id,label,obj){const s=document.getElementById(id);if(!s)return;const cur=s.value;
 s.innerHTML='<option value="">'+label+': alle</option>'+Object.keys(obj).sort().map(k=>'<option>'+k+'</option>').join('');if(cur)s.value=cur;}
function esc(t){return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
var PLVIEW='board';
// CRM v2: schlanke 6-Stufen-Pipeline. Follow-ups sind KEINE eigenen Stufen mehr (nur Zähler auf der Karte),
// Gewonnen/Verloren liegen terminal unter dem Board (ausklappbar). Event-Status läuft über Tags, nicht Stufen.
var PLSTAGES=['Vernetzt','Kontaktiert','Geantwortet','Call','Setting','Closing'];
var PLDONE=['Gewonnen','Verloren'];
var PLSHOWDONE=false;
var PLLATER=false;
var DEAL_VALUE=5000;
function fmtEur(n){return '€ '+(n||0).toLocaleString('de-DE');}
function stageOf(l){var all=PLSTAGES.concat(PLDONE);if(l.pipelineStage&&all.indexOf(l.pipelineStage)>=0)return l.pipelineStage;
 if(l.closed||l.won||l.lost)return (l.lost||l.won===false)?'Verloren':'Gewonnen';
 const sg=((l.stage||'')+' '+(l.status||'')).toLowerCase();
 if(l.closingBooked||/closing/.test(sg))return'Closing';
 if(l.settingBooked||/setting/.test(sg))return'Setting';
 if(l.callProposed||l.callResult||/\bcall\b/.test(sg))return'Call';
 if(l.replied||/geantwortet|replied/.test(sg))return'Geantwortet';
 if(l.contacted||/inmail|kontaktiert|erstkontakt|follow/.test(sg))return'Kontaktiert';
 return'Vernetzt';}
function setPlView(v){PLVIEW=v;document.getElementById('plv-board').classList.toggle('on',v==='board');document.getElementById('plv-list').classList.toggle('on',v==='list');document.getElementById('pl-board').style.display=v==='board'?'flex':'none';document.getElementById('pl-table').style.display=v==='list'?'block':'none';renderLeads();}
function togglePlDone(){PLSHOWDONE=!PLSHOWDONE;renderLeads();}
function togglePlLater(){PLLATER=!PLLATER;var b=document.getElementById('pl-later');if(b)b.classList.toggle('on',PLLATER);renderLeads();}
function plFilteredRows(){const q=(document.getElementById('pl-search').value||'').toLowerCase();
 const fc=document.getElementById('pl-cat').value,fst=document.getElementById('pl-status').value,fa=document.getElementById('pl-acc').value;
 let rows=LEADS.filter(l=>(!PLLATER||l.followUpLater)&&(!fc||(l.category||'')===fc)&&(!fst||(l.status||'')===fst)&&(!fa||(l.account||'')===fa)&&(!q||((l.name||'')+' '+(l.company||'')+' '+(l.category||'')+' '+(l.location||'')).toLowerCase().includes(q)));
 rows.sort((a,b)=>(+b.icpScore||0)-(+a.icpScore||0));return rows;}
function plSrc(l){return '🔗 '+esc(l.platform||'LinkedIn')+' · '+esc(l.account||'—');}
function plCard(l){var fu=(Array.isArray(l.followups)?l.followups.filter(function(x){return x&&x.trim();}).length:0);var b='';
 if(l.followUpLater)b+='<span class="pltag later">⏰ Später'+(l.followUpDate?' '+esc(l.followUpDate):'')+'</span>';
 if(fu)b+='<span class="pltag">↪ '+fu+' Follow-up'+(fu>1?'s':'')+'</span>';
 if(l.callResult==='ja')b+='<span class="pltag ok">📞 Call ✓</span>';else if(l.callResult==='nein')b+='<span class="pltag no">📞 Call ✗</span>';
 return '<div class="plcard" draggable="true" ondragstart="plDragStart(event,'+l._i+')" onclick="openLead('+l._i+')"><div class="nm">'+esc(l.name||'?')+(l.icpScore?'<span class="icp">⭐'+l.icpScore+'</span>':'')+'</div><div class="co">'+esc(l.company||'')+(l.category?' · '+esc(l.category):'')+'</div><span class="src">'+plSrc(l)+'</span>'+(b?'<div class="pltags">'+b+'</div>':'')+(l.icebreaker?'<div class="ice">'+esc(String(l.icebreaker).replace(/\\s*\\n+\\s*/g,' '))+'</div>':'')+'</div>';}
function renderLeads(){if(!LEADS.length)return;const rows=plFilteredRows();
 if(PLVIEW==='board'){const c=document.getElementById('pl-board');if(!c)return;
  const stgs=PLSTAGES.concat(PLSHOWDONE?PLDONE:[]);
  let html=stgs.map(st=>{const items=rows.filter(l=>stageOf(l)===st);const done=PLDONE.indexOf(st)>=0;
   return '<div class="plcol'+(done?' done':'')+'" ondragover="plDragOver(event)" ondragleave="plDragLeave(event)" ondrop="plDrop(event,\\''+st+'\\')"><h4>'+st+'<span>'+items.length+'</span></h4>'+(done?'':'<div class="plval">'+fmtEur(items.length*DEAL_VALUE)+'</div>')+items.slice(0,60).map(plCard).join('')+(items.length>60?'<div class="muted" style="font-size:11px">+'+(items.length-60)+' mehr</div>':(items.length?'':'<div class="muted" style="font-size:11px">—</div>'))+'</div>';}).join('');
  const doneN=rows.filter(l=>PLDONE.indexOf(stageOf(l))>=0).length;
  html+='<div class="plcol donetoggle" onclick="togglePlDone()"><h4>'+(PLSHOWDONE?'▸ einklappen':'✅ Abgeschlossen')+'<span>'+doneN+'</span></h4><div class="muted" style="font-size:11px">'+(PLSHOWDONE?'Gewonnen + Verloren sichtbar':'klick zum Ausklappen')+'</div></div>';
  c.innerHTML=html;
 }else{const t=document.getElementById('pl-table');if(!t)return;
  const head='<tr><th>Name</th><th>Unternehmen</th><th>Kategorie</th><th>Quelle</th><th>Stage</th><th>ICP</th><th>Status</th><th>Eisbrecher</th></tr>';
  const body=rows.slice(0,300).map(l=>'<tr style="cursor:pointer" onclick="openLead('+l._i+')"><td>'+esc(l.name||'?')+'</td><td>'+esc(l.company)+'</td><td>'+esc(l.category)+'</td><td>'+plSrc(l)+'</td><td>'+esc(stageOf(l))+'</td><td>'+(l.icpScore||'')+'</td><td>'+esc(l.status)+'</td><td>'+esc(String(l.icebreaker||'').replace(/\\s*\\n+\\s*/g,' ').slice(0,70))+'</td></tr>').join('');
  t.innerHTML='<table>'+head+body+'</table><div class="muted">'+rows.length+' Treffer'+(rows.length>300?' · erste 300 gezeigt':'')+'</div>';}}
let curLead=null;
function leadPayload(l){var o=Object.assign({},l);delete o._i;delete o._origId;return o;}
// Tag-Chips im Detail (feeden Statistik): Booleans + Call-Ja/Nein + Gewonnen/Verloren + „Später dran".
function tagsHtml(l){function t(f,lab){return '<span class="pltag click'+(l[f]?' on':'')+'" onclick="plToggle(\\''+f+'\\',this)">'+lab+'</span>';}
 var call='<span class="pltag click'+(l.callResult==='ja'?' on ok':'')+'" onclick="plCall(\\'ja\\')">📞 Call: Ja</span><span class="pltag click'+(l.callResult==='nein'?' on no':'')+'" onclick="plCall(\\'nein\\')">📞 Call: Nein</span>';
 var out=t('replied','💬 Geantwortet')+t('callProposed','📞 Call vorgeschlagen')+call+t('settingBooked','📅 Setting')+t('closingBooked','🤝 Closing');
 var oc='<span class="pltag click'+(l.won?' on ok':'')+'" onclick="plOutcome(\\'Gewonnen\\')">✅ Gewonnen</span><span class="pltag click'+(l.lost?' on no':'')+'" onclick="plOutcome(\\'Verloren\\')">❌ Verloren</span>';
 var later='<span class="pltag click later'+(l.followUpLater?' on':'')+'" onclick="plLater(this)">⏰ Später dran</span><input id="pl-later-date" type="date" class="pldate" value="'+esc(l.followUpDate||'')+'" onchange="plLaterDate(this.value)">';
 var reason=(l.callResult==='nein')?'<div class="callno"><label>Grund (kein Call)</label><textarea id="pl-callno" rows="2" onblur="if(curLead)curLead.callNoReason=this.value" placeholder="Warum kein Call? …">'+esc(l.callNoReason||'')+'</textarea></div>':'';
 return '<div class="pltagrow">'+out+'</div><div class="pltagrow">'+oc+later+'</div>'+reason;}
function refreshTags(){var e=document.getElementById('pl-tags');if(e&&curLead)e.innerHTML=tagsHtml(curLead);}
function plPersist(fields){if(!curLead)return;fetch('/api/lead-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:leadId(curLead),fields:fields,lead:leadPayload(curLead)})}).then(r=>r.json()).then(()=>loadKpis()).catch(()=>{});}
function plToggle(f,el){if(!curLead)return;var nv=!curLead[f];curLead[f]=nv;if(el)el.classList.toggle('on',nv);plPersist(defObj(f,nv));}
function plCall(res){if(!curLead)return;var nv=(curLead.callResult===res)?'':res;curLead.callResult=nv;if(nv)curLead.callProposed=true;plPersist({callResult:nv,callProposed:curLead.callProposed});refreshTags();}
function plOutcome(kind){if(!curLead)return;var isWon=kind==='Gewonnen';var already=isWon?curLead.won:curLead.lost;var f=already?{closed:false,won:false,lost:false,pipelineStage:''}:{closed:true,won:isWon,lost:!isWon,pipelineStage:kind};Object.assign(curLead,f);plPersist(f);refreshTags();}
function plLater(el){if(!curLead)return;var nv=!curLead.followUpLater;curLead.followUpLater=nv;if(el)el.classList.toggle('on',nv);plPersist({followUpLater:nv});}
function plLaterDate(v){if(!curLead)return;curLead.followUpDate=v;plPersist({followUpDate:v});}
// Konversation: Erstkontakt + Follow-ups + Antwort chronologisch als Bubbles (Überblick über alle Nachrichten).
function plConvo(l){var out=[];
 if(l.icebreaker)out.push(['🧊 Eisbrecher','',l.icebreaker]);
 if(l.message)out.push(['✉️ Erstkontakt',l.contactDate||'',l.message]);
 (Array.isArray(l.followups)?l.followups:[]).forEach(function(m,n){if(m&&m.trim())out.push(['↪ Follow-up '+(n+1),(l.followupDates&&l.followupDates[n])||'',m]);});
 if(l.replied)out.push(['💬 '+esc(l.name||'Kontakt')+' hat geantwortet','','']);
 if(!out.length)return '<div class="muted">Noch keine Nachrichten erfasst.</div>';
 return '<div class="convo">'+out.map(function(e){return '<div class="cvb"><div class="cvh">'+e[0]+(e[1]?' · '+esc(e[1]):'')+'</div>'+(e[2]?'<div class="cvt">'+esc(String(e[2]).replace(/\\s*\\n+\\s*/g,' '))+'</div>':'')+'</div>';}).join('')+'</div>';}
// Activity-Timeline (CRM-Inbox-Ausbau Punkt 3, Teilstück): Ablauf aus den vorhandenen Funnel-Feldern
// + lead.history (Zeitstempel schreibt /api/lead-save ab jetzt bei jeder Funnel-Änderung mit).
function leadTimeline(l){var ev=[],hf={};(Array.isArray(l.history)?l.history:[]).forEach(function(h){hf[h.field]=1;});
 if(l.addedAt)ev.push([l.addedAt,'📌 Ins CRM aufgenommen ('+esc(l.account||'—')+')']);
 if(l.contacted||l.contactDate)ev.push([l.contactDate||'','✉️ Erstkontakt'+(l.platform?' via '+esc(l.platform):'')]);
 if(l.replied&&!hf.replied)ev.push(['','💬 Hat geantwortet']);
 if(l.callProposed&&!hf.callProposed)ev.push(['','📞 Call vorgeschlagen']);
 if(l.settingBooked&&!hf.settingBooked)ev.push(['','📅 Setting gebucht']);
 if(l.closingBooked&&!hf.closingBooked)ev.push(['','🤝 Closing gebucht']);
 if(l.closed&&!hf.closed)ev.push(['','✅ Closed']);
 (Array.isArray(l.history)?l.history:[]).forEach(function(h){
  var lbl=h.field==='pipelineStage'?'🧭 Stage → '+esc(String(h.value)):esc(h.field)+' → '+esc(String(h.value));
  ev.push([h.ts||'',lbl]);});
 if(!ev.length)return '<div class="muted">Noch keine Aktivität erfasst — Zeitstempel entstehen ab jetzt bei jeder Funnel-Änderung.</div>';
 return ev.map(function(e){return '<div class="tlrow"><small>'+esc(e[0]||'—')+'</small><span>'+e[1]+'</span></div>';}).join('');}
// Drag&Drop: Karte zwischen Board-Spalten ziehen → schreibt pipelineStage (Vorrang in stageOf) sofort ins CRM.
function plDragStart(e,i){e.dataTransfer.setData('text/plain',String(i));e.dataTransfer.effectAllowed='move';}
function plDragOver(e){e.preventDefault();e.dataTransfer.dropEffect='move';e.currentTarget.classList.add('dragover');}
function plDragLeave(e){e.currentTarget.classList.remove('dragover');}
function plDrop(e,stage){e.preventDefault();e.currentTarget.classList.remove('dragover');const i=+e.dataTransfer.getData('text/plain');const l=LEADS[i];if(!l||stageOf(l)===stage)return;l.pipelineStage=stage;renderLeads();fetch('/api/lead-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:leadId(l),fields:{pipelineStage:stage},lead:leadPayload(l)})}).then(r=>r.json()).then(()=>loadKpis()).catch(()=>{});}
function plSetStage(st,el){if(!curLead)return;curLead.pipelineStage=st;var r=el.parentNode;if(r)r.querySelectorAll('.fstep').forEach(x=>x.classList.remove('on'));el.classList.add('on');fetch('/api/lead-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:leadId(curLead),fields:{pipelineStage:st},lead:leadPayload(curLead)})}).then(r=>r.json()).then(()=>loadKpis()).catch(()=>{});}
function openLead(i){const l=LEADS[i];if(!l)return;curLead=l;
 document.getElementById('pl-table').style.display='none';document.getElementById('pl-board').style.display='none';const d=document.getElementById('pl-detail');d.style.display='block';
 const isInmail=/inmail/i.test(l.stage||'');
 const links='<div class="pl-links">'+(l.url?'<a href="'+esc(l.url)+'" target="_blank" rel="noopener">🔗 LinkedIn-Profil</a>':'<span class="muted">kein Profil-Link</span>')+(l.website?' · <a href="'+esc(l.website)+'" target="_blank" rel="noopener">🌐 Website</a>':'')+'</div>';
 const curStg=stageOf(l);
 const funnel='<div class="funnelrow">'+PLSTAGES.map(st=>'<span class="fstep'+(st===curStg?' on':'')+'" onclick="plSetStage(\\''+st+'\\',this)">'+st+'</span>').join('')+'</div>';
 const fups=isInmail?'<div class="muted">InMail → keine Follow-ups.</div>':[0,1,2].map(n=>'<label>Follow-up '+(n+1)+'</label><textarea id="pl-fu'+n+'" rows="2">'+esc((l.followups&&l.followups[n])||'')+'</textarea>').join('');
 d.innerHTML='<button class="pop plback" onclick="closeLead()">✕ zurück zur Liste</button>'+
  '<div class="card"><div class="pl-head"><input id="pl-name" class="pl-nameinp" value="'+esc(l.name||'')+'" placeholder="Name"><input id="pl-company" class="pl-coinp" value="'+esc(l.company||'')+'" placeholder="Unternehmen"></div>'+
   links+
   '<div class="pl-meta"><span>📅 '+(esc(l.contactDate)||'kein Datum')+'</span><span>👤 '+(esc(l.account)||'—')+'</span><span>🏷 '+(esc(l.category)||'—')+'</span><span>⭐ ICP '+(l.icpScore||'—')+'</span></div>'+
   '<div class="pl-meta"><span>🔗 Quelle: '+esc(l.platform||'LinkedIn')+' · '+esc(l.account||'—')+'</span></div>'+
   '<label>Pipeline-Stufe</label>'+funnel+
   '<label>Status-Tags <span class="muted" style="text-transform:none;font-weight:400">(anklicken → fließt in die Statistik)</span></label><div id="pl-tags">'+tagsHtml(l)+'</div>'+
   '<label>Konversation</label><div style="margin:2px 0 6px">'+plConvo(l)+'</div>'+
   '<label>Verlauf</label><div style="margin:2px 0 6px">'+leadTimeline(l)+'</div>'+
   '<label>🧊 Eisbrecher</label><textarea id="pl-ice" rows="3" placeholder="Eisbrecher-Satz (personalisierter Einstieg) …">'+esc(l.icebreaker||'')+'</textarea>'+
   '<label>Outreach-Message (Erstkontakt)</label><textarea id="pl-msg" rows="4" placeholder="ICP-Outreach-Message …">'+esc(l.message||'')+'</textarea>'+
   '<label>Follow-ups</label>'+fups+
   '<label>Notizen</label><textarea id="pl-notes" rows="2">'+esc(l.notes||'')+'</textarea>'+
   '<label>Kontaktinfos</label><textarea id="pl-cinfo" rows="2">'+esc(l.contactInfo||'')+'</textarea>'+
   '<div><button onclick="saveLead()">💾 Speichern</button> <button class="pldel" onclick="delLead()">🗑 Lead löschen</button> <span id="pl-saved" class="muted"></span></div></div>';}
function delLead(){if(!curLead)return;if(!confirm('Lead „'+(curLead.name||'?')+'" wirklich aus dem CRM löschen?'))return;
 const sv=document.getElementById('pl-saved');if(sv)sv.textContent='… löscht';
 fetch('/api/lead-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:leadId(curLead)})}).then(r=>r.json()).then(d=>{if(d.ok){closeLead();loadLeads();}else if(sv)sv.textContent='⚠ Fehler';}).catch(()=>{if(sv)sv.textContent='⚠ Fehler';});}
function closeLead(){curLead=null;document.getElementById('pl-detail').style.display='none';setPlView(PLVIEW);}
function saveLead(){if(!curLead)return;const isInmail=/inmail/i.test(curLead.stage||'');
 const nm=document.getElementById('pl-name'),co=document.getElementById('pl-company'),ice=document.getElementById('pl-ice'),callno=document.getElementById('pl-callno');
 const fields={name:nm?nm.value.trim():curLead.name,company:co?co.value.trim():curLead.company,icebreaker:ice?ice.value:(curLead.icebreaker||''),message:document.getElementById('pl-msg').value,notes:document.getElementById('pl-notes').value,contactInfo:document.getElementById('pl-cinfo').value};
 if(callno)fields.callNoReason=callno.value;
 if(curLead.pipelineStage)fields.pipelineStage=curLead.pipelineStage;
 if(!isInmail)fields.followups=[0,1,2].map(n=>{const e=document.getElementById('pl-fu'+n);return e?e.value:'';});
 const sv=document.getElementById('pl-saved');sv.textContent='… speichert';
 fetch('/api/lead-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:leadId(curLead),fields:fields,lead:leadPayload(curLead)})}).then(r=>r.json()).then(d=>{Object.assign(curLead,fields);sv.textContent=d.ok?'✓ gespeichert':'⚠ Fehler';}).catch(()=>{sv.textContent='⚠ Fehler';});}
/* ===== Projekt-Pipeline (PM-Board) — Kundenprojekte durch die Delivery-Stufen ziehen =====
   Stufe 1 = Onboarding (Übergabe aus Sales), danach die 6 Delivery-Stufen aus coding-pipeline-runbook.md.
   Karten liegen in data/projekte.json, Stage-Wechsel schreibt /api/projekt-save (Zeitstempel in history). */
var PMSTAGES=['Onboarding','Planung','Architektur','Bauen','Review','Verify','Ship'];
var PMDONE=['Abgeschlossen'];
var PMSHOWDONE=false;
var PMTYP='kunde'; // aktive Pipeline: 'kunde' oder 'eigen'
var PROJEKTE=[];
var curProj=null;
function pmTyp(p){return (p&&p.typ==='eigen')?'eigen':'kunde';} // Default = Kundenprojekt (Altkarten)
function pmSetTyp(t){PMTYP=t;PMSHOWDONE=false;document.querySelectorAll('.pmtab').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-typ')===t);});if(curProj&&pmTyp(curProj)!==t)closeProj();else renderPmBoard();}
// Alt-/Synonym-Stages auf die Board-Spalten normalisieren, damit bestehende Karten nicht verschwinden.
var PMALIAS={backlog:'Backlog',pool:'Backlog',idee:'Backlog',neu:'Backlog',warteschlange:'Backlog',onboarding:'Onboarding',kickoff:'Onboarding',scoping:'Planung',planung:'Planung',planning:'Planung',discovery:'Planung',architektur:'Architektur',architecture:'Architektur',design:'Architektur',bauen:'Bauen',build:'Bauen',building:'Bauen',dev:'Bauen',review:'Review',verify:'Verify',test:'Verify',testing:'Verify',qa:'Verify',ship:'Ship','live':'Ship',launch:'Ship',deploy:'Ship',fertig:'Abgeschlossen',done:'Abgeschlossen',abgeschlossen:'Abgeschlossen',abgeschossen:'Abgeschlossen'};
function pmStage(p){var s=(p&&p.stage||'').trim();if(s==='Backlog')return 'Backlog';if(PMSTAGES.indexOf(s)>=0||PMDONE.indexOf(s)>=0)return s;var a=PMALIAS[s.toLowerCase()];return a||'Onboarding';}
// Deadline-Status: 'late' = im Verzug, 'soon' = fällig in ≤3 Tagen, 'ok' = Luft, null = keine Deadline / abgeschlossen.
function pmDue(p){if(!p||!p.deadline||pmStage(p)==='Abgeschlossen')return null;
 var now=new Date();var today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 var dl=new Date(p.deadline+'T00:00:00');if(isNaN(dl))return null;
 var days=Math.round((dl-today)/86400000);
 return days<0?'late':(days<=3?'soon':'ok');}
function pmDlFmt(d){return d?d.slice(8,10)+'.'+d.slice(5,7)+'.':'';}
function pmCard(p){var b='';
 var due=pmDue(p);
 if(due)b+='<span class="pltag'+(due==='late'?' od':(due==='soon'?' ds':''))+'">'+(due==='late'?'⚠ fällig war ':'📅 bis ')+pmDlFmt(p.deadline)+'</span>';
 if(p.retainer)b+='<span class="pltag">🔁 Retainer</span>';
 if(p.rechnung&&p.rechnung.anzahlung)b+='<span class="pltag ok">💰 Anzahlung</span>';
 if(p.rechnung&&p.rechnung.rest)b+='<span class="pltag ok">💰 Rest</span>';
 return '<div class="plcard'+(due==='late'?' late':'')+'" draggable="true" ondragstart="pmDragStart(event,'+p._i+')" onclick="openProj('+p._i+')"><div class="nm">'+esc(p.kunde||p.projekt||'?')+'</div><div class="co">'+esc(p.firma||'')+(p.projekt?(p.firma?' · ':'')+esc(p.projekt):'')+'</div>'+(p.wert?'<div class="pmval">'+fmtEur(p.wert)+'</div>':'')+(b?'<div class="pmbadges">'+b+'</div>':'')+'</div>';}
function renderPmBoard(){var c=document.getElementById('pm-board');if(!c)return;
 var pool=PROJEKTE.filter(function(p){return pmTyp(p)===PMTYP&&pmStage(p)!=='Backlog';}); // aktive Pipeline, Backlog raus (liegt im Pool unten)
 var stgs=PMSTAGES.concat(PMSHOWDONE?PMDONE:[]);
 var html=stgs.map(function(st,idx){var items=pool.filter(function(p){return pmStage(p)===st;});var done=PMDONE.indexOf(st)>=0;var sum=items.reduce(function(a,p){return a+(+p.wert||0);},0);
  return '<div class="plcol'+(done?' done':'')+'" ondragover="pmDragOver(event)" ondragleave="pmDragLeave(event)" ondrop="pmDrop(event,\\''+st+'\\')"><h4>'+(idx<PMSTAGES.length?(idx+1)+'· ':'')+st+'<span>'+items.length+'</span></h4>'+(sum?'<div class="plval pm">'+fmtEur(sum)+'</div>':'')+items.map(pmCard).join('')+(items.length?'':'<div class="muted" style="font-size:11px">—</div>')+'</div>';}).join('');
 var doneN=pool.filter(function(p){return PMDONE.indexOf(pmStage(p))>=0;}).length;
 html+='<div class="plcol donetoggle" onclick="togglePmDone()"><h4>'+(PMSHOWDONE?'▸ einklappen':'✅ Abgeschlossen')+'<span>'+doneN+'</span></h4><div class="muted" style="font-size:11px">'+(PMSHOWDONE?'sichtbar':'klick zum Ausklappen')+'</div></div>';
 c.innerHTML=html;
 var st=document.getElementById('pm-stand');if(st){var active=pool.filter(function(p){return PMDONE.indexOf(pmStage(p))<0;});var val=active.reduce(function(a,p){return a+(+p.wert||0);},0);var lbl=PMTYP==='eigen'?'eigene':'Kunden-';st.textContent=active.length+' aktive '+lbl+'Projekte · '+fmtEur(val)+' Volumen'+(doneN?' · '+doneN+' abgeschlossen':'');}
 renderProjNotes();}
function pmDocKey(s){return (s||'').replace(/^brain\\//,'');}
// Eisenhower-Prio umschalten (1→2→3→1): Karte → projekte.json, sonst Notiz-Frontmatter (prio:).
function pmPrio(rel,cardIdx,cur){var nv=cur>=3?1:cur+1;
 if(cardIdx!==null&&PROJEKTE[cardIdx]){var p=PROJEKTE[cardIdx];p.prio=nv;
  fetch('/api/projekt-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:p.id,fields:{prio:nv}})}).catch(function(){});}
 else if(rel){var nn=(NOTES['Projekte']||[]).find(function(x){return x.rel===rel;});if(nn)nn.prio=nv;
  fetch('/api/note-prio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:rel,prio:nv})}).catch(function(){});}
 renderProjNotes();}
function renderProjNotes(){var c=document.getElementById('proj-list');if(!c)return;
 var notes=(NOTES['Projekte']||[]).filter(function(n){return n.pool!=='aus';}); // Dauerläufer/Kanäle (pool: aus) sind keine abarbeitbaren Projekte
 var seen={};
 // Läuft auch VOR der PROJEKTE-Initialisierung (Top-Level-Aufruf im Brain-Abschnitt) — sonst stirbt das ganze Script.
 var PJ=window.PROJEKTE||[];
 var items=notes.map(function(n){var card=PJ.find(function(p){return pmDocKey(p.doc)===n.rel;});if(card)seen[card.id]=true;return {title:n.title||'?',status:n.status||'',rel:n.rel,card:card,prio:+((card&&card.prio)||n.prio||2)};});
 PJ.forEach(function(p){if(pmTyp(p)===PMTYP&&pmStage(p)==='Backlog'&&!seen[p.id]){seen[p.id]=true;items.push({title:p.kunde||p.projekt||'?',status:'📥 geparkt',rel:pmDocKey(p.doc)||'',card:p,prio:+(p.prio||2)});}});
 if(!items.length){c.innerHTML='<span class="muted" style="font-size:12px">— keine geparkten Projekte oder Projekt-Notizen.</span>';return;}
 var PLBL={1:'🔥 Wichtig',2:'· Normal',3:'⏸ Später'}; // lokal — renderProjNotes läuft schon VOR den globalen var-Zuweisungen (Top-Level-Aufruf im Brain-Abschnitt)
 items.forEach(function(it){it.started=(!!it.card&&pmStage(it.card)!=='Backlog')?1:0;});
 // Sortierung: Eisenhower-Prio zuerst (🔥 oben), bereits gestartete ans Ende, dann alphabetisch.
 items.sort(function(a,b){return (a.started-b.started)||(a.prio-b.prio)||a.title.localeCompare(b.title);});
 c.innerHTML='<div class="pmpool">'+items.map(function(n){
  var card=n.card;
  var started=!!n.started;
  var btn=started
   ?'<button class="pmstart on" onclick="openProj('+card._i+')">✓ im Board · öffnen</button>'
   :(card
     ?'<button class="pmstart" onclick="pmStart(null,'+card._i+')">▶ Projekt starten</button>'
     :'<button class="pmstart" onclick="pmStartFromNote(\\''+esc(n.rel)+'\\',\\''+esc((n.title||'').replace(/\\x27/g,\"\"))+'\\')">▶ Projekt starten</button>');
  var pb='<span class="pmprio p'+n.prio+'" title="Priorität (Eisenhower) — klicken zum Umschalten" onclick="event.stopPropagation();pmPrio(\\''+esc(n.rel)+'\\','+(card?card._i:'null')+','+n.prio+')">'+(PLBL[n.prio]||PLBL[2])+'</span>';
  var oc=n.rel?' onclick="openNote(\\''+esc(n.rel)+'\\')"':'';
  return '<div class="plcard pool'+(started?' done':'')+'"'+oc+'>'+pb+'<div class="nm">'+esc(n.title||'?')+'</div>'+(n.status?'<span class="co">'+esc(n.status)+'</span>':'')+'<div class="poolbtn" onclick="event.stopPropagation()">'+btn+'</div></div>';
 }).join('')+'</div>';}
function pmStartFromNote(rel,title){var ex=PROJEKTE.find(function(p){return pmDocKey(p.doc)===rel;});if(ex){openProj(ex._i);return;}
 var id=((title||'projekt').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'projekt').slice(0,50)+'-'+String(PROJEKTE.length+1);
 var np={id:id,typ:PMTYP,kunde:title||'Projekt',firma:'',projekt:'',stage:'Onboarding',wert:0,rechnung:{anzahlung:false,rest:false},retainer:false,doc:'brain/'+rel,notiz:'',history:[]};
 fetch('/api/projekt-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,projekt:np})}).then(function(r){return r.json();}).then(function(){loadProjekte();});}
function pmStart(e,i){if(e)e.stopPropagation();var p=PROJEKTE[i];if(!p)return;p.stage='Onboarding';renderPmBoard();pmPersist(p,{stage:'Onboarding'});}
function pmPark(){if(!curProj)return;curProj.stage='Backlog';pmPersist(curProj,{stage:'Backlog'});closeProj();}
function togglePmDone(){PMSHOWDONE=!PMSHOWDONE;renderPmBoard();}
function loadProjekte(){fetch('/api/projekte').then(function(r){return r.json();}).then(function(d){PROJEKTE=(d&&d.projekte)||[];PROJEKTE.forEach(function(p,i){p._i=i;});if(curProj){var f=PROJEKTE.find(function(p){return p.id===curProj.id;});if(f){openProj(f._i);}else{closeProj();}}renderPmBoard();}).catch(function(){var st=document.getElementById('pm-stand');if(st)st.textContent='⚠ konnte Projekte nicht laden';});}
function pmDragStart(e,i){e.dataTransfer.setData('text/plain',String(i));e.dataTransfer.effectAllowed='move';}
function pmDragOver(e){e.preventDefault();e.dataTransfer.dropEffect='move';e.currentTarget.classList.add('dragover');}
function pmDragLeave(e){e.currentTarget.classList.remove('dragover');}
function pmDrop(e,stage){e.preventDefault();e.currentTarget.classList.remove('dragover');var i=+e.dataTransfer.getData('text/plain');var p=PROJEKTE[i];if(!p||pmStage(p)===stage)return;p.stage=stage;renderPmBoard();pmPersist(p,{stage:stage});}
function pmPersist(p,fields){return fetch('/api/projekt-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:p.id,fields:fields,projekt:p})}).then(function(r){return r.json();}).catch(function(){});}
function pmTimeline(p){var ev=(Array.isArray(p.history)?p.history:[]).map(function(h){return [h.ts||'','🧭 Stufe → '+esc(String(h.value))];});
 if(!ev.length)return '<div class="muted">Noch keine Stufen-Wechsel erfasst — Zeitstempel entstehen ab jetzt bei jedem Zug.</div>';
 return ev.map(function(e){return '<div class="tlrow"><small>'+esc(e[0]||'—')+'</small><span>'+e[1]+'</span></div>';}).join('');}
function openProj(i){var p=PROJEKTE[i];if(!p)return;curProj=p;
 document.getElementById('pm-board').style.display='none';var stnd=document.getElementById('pm-stand');if(stnd)stnd.style.display='none';var bw=document.getElementById('pm-backlog-wrap');if(bw)bw.style.display='none';
 var d=document.getElementById('pm-detail');d.style.display='block';
 var cur=pmStage(p);
 var funnel='<div class="funnelrow">'+PMSTAGES.concat(PMDONE).map(function(st){return '<span class="fstep'+(st===cur?' on':'')+'" onclick="pmSetStage(\\''+st+'\\',this)">'+st+'</span>';}).join('')+'</div>';
 var r=p.rechnung||{};
 var badges='<div class="pltagrow"><span class="pltag click'+(r.anzahlung?' on ok':'')+'" onclick="pmToggleRe(\\'anzahlung\\',this)">💰 Anzahlung</span><span class="pltag click'+(r.rest?' on ok':'')+'" onclick="pmToggleRe(\\'rest\\',this)">💰 Rest</span><span class="pltag click'+(p.retainer?' on':'')+'" onclick="pmToggleRetainer(this)">🔁 Retainer</span></div>';
 var docRel=(p.doc||'').replace(/^brain\\//,'');var doclink=p.doc?'<div class="pl-meta"><a href="#" onclick="openNote(\\''+esc(docRel)+'\\');return false;">📄 '+esc(p.doc)+'</a></div>':'';
 d.innerHTML='<button class="pop plback" onclick="closeProj()">✕ zurück zum Board</button>'+
  '<div class="card"><div class="pl-head"><input id="pm-kunde" class="pl-nameinp" value="'+esc(p.kunde||'')+'" placeholder="Kunde"><input id="pm-firma" class="pl-coinp" value="'+esc(p.firma||'')+'" placeholder="Firma"></div>'+
   '<label>Projekt</label><input id="pm-projekt" class="pminp" value="'+esc(p.projekt||'')+'" placeholder="Projektname">'+
   '<label>Wert (€)</label><input id="pm-wert" class="pminp" type="number" value="'+(p.wert||0)+'">'+
   '<label>Deadline (fertig bis)</label><input id="pm-deadline" class="pminp" type="date" value="'+esc(p.deadline||'')+'">'+(pmDue(p)==='late'?'<div class="pltag od" style="margin:2px 0 6px;display:inline-block">⚠ im Verzug</div>':'')+
   doclink+
   '<label>Pipeline</label><div class="pmtabs sm"><button class="pmtab'+(pmTyp(p)==='kunde'?' on':'')+'" onclick="pmSetProjTyp(\\'kunde\\',this)">👥 Kundenprojekt</button><button class="pmtab'+(pmTyp(p)==='eigen'?' on':'')+'" onclick="pmSetProjTyp(\\'eigen\\',this)">🚀 Eigenes</button></div>'+
   (cur==='Backlog'?'<label>Status</label><div style="margin:2px 0 8px"><span class="pltag">📥 im Backlog · noch nicht gestartet</span> <button class="pmstart" onclick="pmStart(null,'+p._i+');closeProj();">▶ Projekt starten</button></div>':'')+
   '<label>Delivery-Stufe</label>'+funnel+
   '<label>Rechnung &amp; Retainer</label>'+badges+
   '<label>Notiz</label><textarea id="pm-notiz" rows="3" placeholder="Notiz …">'+esc(p.notiz||'')+'</textarea>'+
   '<label>Verlauf</label><div style="margin:2px 0 6px">'+pmTimeline(p)+'</div>'+
   '<div style="margin-top:12px"><button onclick="saveProj()">💾 Speichern</button> '+(cur!=='Backlog'?'<button class="pop" onclick="pmPark()">⏸ Parken</button> ':'')+'<button class="pldel" onclick="delProj()">🗑 Projekt löschen</button> <span id="pm-saved" class="muted"></span></div></div>';}
function closeProj(){curProj=null;var d=document.getElementById('pm-detail');if(d)d.style.display='none';document.getElementById('pm-board').style.display='flex';var st=document.getElementById('pm-stand');if(st)st.style.display='block';var bw=document.getElementById('pm-backlog-wrap');if(bw)bw.style.display='';renderPmBoard();}
function pmSetStage(st,el){if(!curProj)return;curProj.stage=st;var row=el.parentNode;if(row)row.querySelectorAll('.fstep').forEach(function(x){x.classList.remove('on');});el.classList.add('on');pmPersist(curProj,{stage:st});}
function pmToggleRe(k,el){if(!curProj)return;var r=curProj.rechnung||(curProj.rechnung={});r[k]=!r[k];if(el)el.classList.toggle('on',r[k]);pmPersist(curProj,{rechnung:r});}
function pmToggleRetainer(el){if(!curProj)return;curProj.retainer=!curProj.retainer;if(el)el.classList.toggle('on',curProj.retainer);pmPersist(curProj,{retainer:curProj.retainer});}
function pmSetProjTyp(t,el){if(!curProj||pmTyp(curProj)===t)return;curProj.typ=t;var row=el.parentNode;if(row)row.querySelectorAll('.pmtab').forEach(function(x){x.classList.remove('on');});el.classList.add('on');pmPersist(curProj,{typ:t}).then(function(){PMTYP=t;pmSetTyp(t);closeProj();});}
function saveProj(){if(!curProj)return;var fields={kunde:(document.getElementById('pm-kunde').value||'').trim(),firma:(document.getElementById('pm-firma').value||'').trim(),projekt:(document.getElementById('pm-projekt').value||'').trim(),wert:+document.getElementById('pm-wert').value||0,deadline:(document.getElementById('pm-deadline').value||''),notiz:document.getElementById('pm-notiz').value};
 Object.assign(curProj,fields);var sv=document.getElementById('pm-saved');sv.textContent='… speichert';
 pmPersist(curProj,fields).then(function(d){sv.textContent=(d&&d.ok)?'✓ gespeichert':'⚠ Fehler';renderPmBoard();});}
function delProj(){if(!curProj)return;if(!confirm('Projekt „'+(curProj.kunde||curProj.projekt||'?')+'" wirklich löschen?'))return;
 fetch('/api/projekt-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:curProj.id})}).then(function(r){return r.json();}).then(function(d){if(d&&d.ok){curProj=null;closeProj();loadProjekte();}});}
function addProjekt(){var eigen=PMTYP==='eigen';var kunde=prompt(eigen?'Projekt-Name / für wen?':'Kunde / Firma?');if(!kunde)return;var projekt=prompt('Projekt (kurz)?')||'';
 var id=(kunde+'-'+projekt).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)+'-'+String(PROJEKTE.length+1);
 var np={id:id,typ:PMTYP,kunde:kunde,firma:'',projekt:projekt,stage:'Onboarding',wert:0,rechnung:{anzahlung:false,rest:false},retainer:false,doc:'',notiz:'',history:[]};
 fetch('/api/projekt-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,projekt:np})}).then(function(r){return r.json();}).then(function(){loadProjekte();});}
const _initHash=location.hash.slice(1);
loadLeads();loadStreak();loadKpis();loadAktionen();
fetch('/api/note?path=01_Identity/now.md').then(r=>r.json()).then(n=>{document.getElementById('d-now').innerHTML=marked.parse(n.markdown||'');});
(function(){var r=titleToRel('now');if(r)openRel(r);})(); // now.md in den Brain-Viewer vorladen — openRel wechselt den View nicht (kein Overlay beim Boot)
// ================= WhatsApp (Client) =================
window.WATAB='inbox'; window.WACUR=null; window.WATPLS=[]; window.WACAMPS=[]; window.WACAMP=null; window.WACAMPTAB='analytics';
window.WAIN={box:'auto',scope:'all',label:''};
function waTab(t){window.WATAB=t;['camp','inbox','tpl'].forEach(function(k){var el=document.getElementById('wa-'+k);if(el)el.style.display=(k===t)?'':'none';var tb=document.getElementById('watab-'+k);if(tb)tb.classList.toggle('on',k===t);});
 if(t==='camp')waLoadCamps();
 if(t==='inbox'){var lw=document.getElementById('wain-label-wrap');if(lw&&!lw.dataset.init){lw.dataset.init='1';lw.innerHTML=waDropHtml('waInLabelDrop',window.WAIN.label,[['','Alle Labels'],['interested','interested'],['meeting-booked','meeting-booked'],['not-interested','not-interested'],['auto-reply','auto-reply'],['ooo','ooo']]);}waLoadThreads();}
 if(t==='tpl')waLoadTpls(false);}
function waInLabelDrop(val){window.WAIN.label=val;waLoadThreads();}
function waRefresh(){waLoadTpls(false);waTab(window.WATAB||'inbox');}
function waTickNow(btn){btn.disabled=true;btn.textContent='… läuft';fetch('/api/wa/tick',{method:'POST'}).then(r=>r.json()).then(function(d){btn.disabled=false;btn.textContent='▶ Tick jetzt';alert(d.ok?('Tick: '+(d.sent||0)+' gesendet, '+(d.scheduled||0)+' geplant'+(d.waitingApproval?(', '+d.waitingApproval+' warten auf Approval'):'')+((d.skipped&&d.skipped.length)?('\\nÜbersprungen: '+d.skipped.join(' · ')):'')):('Fehler: '+(d.error||d.reason)));waRefresh();}).catch(function(){btn.disabled=false;btn.textContent='▶ Tick jetzt';});}
function waFmtTs(ts){if(!ts)return'';return new Date(ts).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}
// ---- Custom-Dropdown (macOS-native Selects sehen grau aus; dieses ist im Theme) ----
// opts=[[value,label],...]; cb = Name einer globalen Funktion, aufgerufen als cb(value)
function waDropHtml(cb,current,opts,full,extra){var cur=opts.find(function(o){return String(o[0])===String(current);})||opts[0]||['',''];
 return '<div class="wadrop'+(full?' full':'')+'" data-val="'+esc(String(current))+'"'+(extra?(' '+extra):'')+'><div class="wadrop-cur" onclick="waDropToggle(this)"><span>'+esc(cur[1])+'</span><span class="cv">▾</span></div><div class="wadrop-menu">'+opts.map(function(o){return '<div class="wadrop-opt'+(String(o[0])===String(current)?' on':'')+'" onclick="waDropPick(this,\\''+cb+'\\')" data-v="'+esc(String(o[0]))+'">'+esc(o[1])+'</div>';}).join('')+'</div></div>';}
function waDropToggle(el){var m=el.parentNode.querySelector('.wadrop-menu');var open=m.classList.contains('open');document.querySelectorAll('.wadrop-menu.open').forEach(function(x){x.classList.remove('open');});if(!open)m.classList.add('open');}
function waDropPick(el,cb){var d=el.closest('.wadrop');var val=el.getAttribute('data-v');d.dataset.val=val;var cur=d.querySelector('.wadrop-cur span');if(cur)cur.textContent=el.textContent;d.querySelectorAll('.wadrop-opt').forEach(function(o){o.classList.toggle('on',o===el);});d.querySelector('.wadrop-menu').classList.remove('open');if(cb&&window[cb])window[cb](val,d);}
function waDropVal(id){var d=document.getElementById(id);return d?(d.dataset.val||''):'';}
function waDropSet(id,val){var d=document.getElementById(id);if(!d)return;d.dataset.val=String(val);var cur=d.querySelector('.wadrop-cur span');var opt=[].find.call(d.querySelectorAll('.wadrop-opt'),function(o){return o.getAttribute('data-v')===String(val);});if(cur&&opt)cur.textContent=opt.textContent;d.querySelectorAll('.wadrop-opt').forEach(function(o){o.classList.toggle('on',o.getAttribute('data-v')===String(val));});}
document.addEventListener('click',function(e){if(!e.target.closest('.wadrop'))document.querySelectorAll('.wadrop-menu.open').forEach(function(x){x.classList.remove('open');});});
// ---- Sprach-Eingabe (Diktieren) + Brief-Overlay ----
function waMic(ta,btn){var SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){alert('Spracherkennung wird von diesem Browser nicht unterstützt. Tipp einfach.');return;}
 if(window.__waRec){window.__waRec.stop();window.__waRec=null;btn.textContent='🎙 Diktieren';return;}
 var rec=new SR();rec.lang='de-DE';rec.continuous=true;rec.interimResults=false;window.__waRec=rec;btn.textContent='⏹ Stop';
 rec.onresult=function(e){for(var i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)ta.value=(ta.value+' '+e.results[i][0].transcript).trim();}};
 rec.onend=function(){window.__waRec=null;btn.textContent='🎙 Diktieren';};
 rec.onerror=function(){window.__waRec=null;btn.textContent='🎙 Diktieren';};
 rec.start();}
function waBrief(title,cb){var ov=document.createElement('div');ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center';
 ov.innerHTML='<div class="card" style="width:min(560px,92vw)"><h3 style="margin:0 0 8px">'+esc(title)+'</h3><textarea id="wa-brief-t" rows="5" style="width:100%;background:rgba(3,12,22,.7);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:9px;font:14px Inter" placeholder="Sag oder schreib, was du willst …"></textarea><div style="display:flex;gap:8px;margin-top:10px"><button class="pop" id="wa-brief-mic" type="button">🎙 Diktieren</button><span style="flex:1"></span><button class="offbtn" id="wa-brief-x">Abbrechen</button><button id="wa-brief-go">Weiter</button></div></div>';
 document.body.appendChild(ov);var ta=ov.querySelector('#wa-brief-t');ta.focus();
 ov.querySelector('#wa-brief-mic').onclick=function(){waMic(ta,this);};
 ov.querySelector('#wa-brief-x').onclick=function(){if(window.__waRec){window.__waRec.stop();window.__waRec=null;}document.body.removeChild(ov);};
 ov.querySelector('#wa-brief-go').onclick=function(){var v=ta.value.trim();if(!v)return;if(window.__waRec){window.__waRec.stop();window.__waRec=null;}document.body.removeChild(ov);cb(v);};}
// ================= KAMPAGNEN =================
function waLoadCamps(){fetch('/api/wa/campaigns').then(r=>r.json()).then(function(d){window.WACAMPS=d.campaigns||[];var box=document.getElementById('wa-camplist');if(!box)return;var cs=window.WACAMPS;
 if(!cs.length){box.innerHTML='<span class="muted">Noch keine Kampagne. „+ Add New" → Namen geben → Sequence + Leads + Start. Oder „🎙 Per Sprache anlegen".</span>';}
 else box.innerHTML='<div class="watbl"><table><tr><th>Kampagne</th><th>Status</th><th>Leads</th><th>Gesendet</th><th>Geantwortet</th><th>Termine</th><th></th></tr>'+cs.map(function(c){var k=c.contacts||[];var st=c.stats||{};
  var sent=k.filter(function(x){return ['sent','scheduled','replied','booked','optout','no'].indexOf(x.status)>=0;}).length;
  return '<tr class="warow" onclick="waCampOpen(\\''+c.id+'\\')"><td><b>'+esc(c.name||c.id)+'</b></td><td><span class="wapill '+esc(c.status||'draft')+'">'+esc(c.status||'draft')+'</span></td><td>'+k.length+'</td><td>'+sent+'</td><td>'+(st.replied||0)+'</td><td>'+(st.booked||0)+'</td><td><span class="muted">›</span></td></tr>';
 }).join('')+'</table></div>';
 if(window.WACAMP)waCampRender();});}
function waCampCur(){return (window.WACAMPS||[]).find(function(x){return x.id===window.WACAMP;});}
function waCampNew(){var name=prompt('Name der Kampagne:');if(!name)return;
 fetch('/api/wa/campaign-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaign:{name:name}})}).then(r=>r.json()).then(function(d){waLoadCamps();setTimeout(function(){waCampOpen(d.id);},250);});}
function waCampVoice(){waBrief('Kampagne per Sprache anlegen',function(brief){var ld=document.getElementById('wa-camplist');ld.innerHTML='<span class="muted">🤖 KI entwirft die Kampagne … (dauert ~1 Min)</span>';
 fetch('/api/wa/campaign-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brief:brief})}).then(r=>r.json()).then(function(d){
  if(!d.ok){alert('Fehler: '+d.error);waLoadCamps();return;}
  var seq=(d.steps||[]).map(function(s){return {templateName:'',draftBody:s.bodyText||'',waitDays:s.waitDays||0};});
  var camp={name:d.name||'Neue Kampagne',agent:{goal:d.agentGoal||'',promptExtra:'',skills:[]},sequence:seq,notes:d.audience||''};
  fetch('/api/wa/campaign-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaign:camp})}).then(r=>r.json()).then(function(x){waLoadCamps();setTimeout(function(){waCampOpen(x.id);waCampTab('sequence');},300);});
 }).catch(function(){alert('Fehler beim KI-Entwurf.');waLoadCamps();});});}
function waCampOpen(id){window.WACAMP=id;window.WACAMPTAB=window.WACAMPTAB||'analytics';
 document.getElementById('wa-camp-list-wrap').style.display='none';document.getElementById('wa-camp-detail').style.display='';waCampRender();}
function waCampBack(){window.WACAMP=null;document.getElementById('wa-camp-detail').style.display='none';document.getElementById('wa-camp-list-wrap').style.display='';waLoadCamps();}
function waCampAct(id,action){fetch('/api/wa/campaign-action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,action:action})}).then(function(){waLoadCamps();});}
function waCampSaveObj(c){fetch('/api/wa/campaign-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaign:c})}).then(function(){waLoadCamps();});}
function waCampTab(t){window.WACAMPTAB=t;waCampRender();}
function waCampRender(){var c=waCampCur();var box=document.getElementById('wa-camp-detail');if(!c||!box)return;
 var tabs=[['analytics','Analytics'],['leads','Leads'],['sequence','Sequence'],['schedule','Schedule'],['options','Options'],['agent','Agent']];
 box.innerHTML='<div class="card"><div class="row"><button class="pop" onclick="waCampBack()">‹ Zurück</button><h3 style="margin:0 0 0 6px">'+esc(c.name||c.id)+'</h3><span class="wapill '+esc(c.status||'draft')+'">'+esc(c.status||'draft')+'</span>'+
  '<span style="margin-left:auto;display:flex;gap:7px">'+(c.status==='active'?'<button class="pop" onclick="waCampAct(\\''+c.id+'\\',\\'pause\\')">⏸ Pause</button>':'<button class="pop" onclick="waCampAct(\\''+c.id+'\\',\\'start\\')">▶ Start</button>')+'<button class="pop" onclick="waCampAct(\\''+c.id+'\\',\\'archive\\')">🗄 Archiv</button></span></div>'+
  '<div class="pmtabs sm" style="margin:10px 0 12px">'+tabs.map(function(t){return '<button class="pmtab'+(window.WACAMPTAB===t[0]?' on':'')+'" onclick="waCampTab(\\''+t[0]+'\\')">'+t[1]+'</button>';}).join('')+'</div>'+
  '<div id="wa-cd-body"></div></div>';
 var f={analytics:waCdAnalytics,leads:waCdLeads,sequence:waCdSequence,schedule:waCdSchedule,options:waCdOptions,agent:waCdAgent}[window.WACAMPTAB];if(f)f();}
function waCdAnalytics(){var c=waCampCur();var b=document.getElementById('wa-cd-body');b.innerHTML='<span class="muted">… lädt</span>';
 function tile(v,l){return '<div class="wastat"><b>'+v+'</b><span>'+l+'</span></div>';}
 fetch('/api/wa/campaign-stats?id='+encodeURIComponent(c.id)).then(r=>r.json()).then(function(d){if(!d.ok){b.innerHTML='<span class="muted">Keine Daten.</span>';return;}
  var rr=d.contacted?Math.round(100*d.replied/d.contacted):0;
  b.innerHTML='<div class="wastats">'+tile(d.leads,'Leads')+tile(d.contacted,'Kontaktiert')+tile(d.delivered,'Zugestellt')+tile(d.read,'Gelesen')+tile(d.replied+' · '+rr+'%','Antworten')+tile(d.booked,'Termine')+tile(d.queued,'In Queue')+tile(d.optout,'Opt-outs')+'</div>'+
   (d.blocked?('<div class="muted">'+d.blocked+' Kontakte durch Schutzfilter geblockt (Opt-out/Freunde/Dubletten).</div>'):'')+
   '<div class="muted" style="margin-top:8px">Zugestellt/Gelesen kommt aus WhatsApp-Read-Receipts (nur wenn Zustellung läuft). Tiefere Analytics + A/Z-Test sind Phase 2.</div>';
 });}
function waCdLeads(){var c=waCampCur();var b=document.getElementById('wa-cd-body');var k=c.contacts||[];
 b.innerHTML='<div class="row" style="margin-bottom:8px"><button class="pop" onclick="waCsvPick(\\''+c.id+'\\')">📄 CSV-Upload</button><button class="pop" onclick="waCrmImport(\\''+c.id+'\\',this)">👥 Aus CRM importieren</button><input type="file" id="cf-file" accept=".csv,text/csv" style="display:none" onchange="waCsvUpload(this)"><span class="muted" style="margin-left:auto">'+k.length+' Kontakte</span></div>'+
  (k.length?('<div class="watbl"><table><tr><th>Name</th><th>Nummer</th><th>Firma</th><th>Status</th></tr>'+k.slice(0,400).map(function(x){return '<tr><td>'+esc(x.name||'')+'</td><td>+'+esc(x.phone)+'</td><td>'+esc(x.company||'')+'</td><td>'+esc(x.status)+'</td></tr>';}).join('')+'</table></div>'+(k.length>400?('<div class="muted">… und '+(k.length-400)+' weitere</div>'):'')):'<span class="muted">Noch keine Kontakte. CSV hochladen oder aus dem CRM importieren. Achtung: im CRM haben aktuell fast keine Leads eine Telefonnummer, der Import zeigt dir, wie viele übersprungen werden.</span>');}
function waCsvPick(id){window.__waCsvCid=id;document.getElementById('cf-file').click();}
function waCsvUpload(inp){var file=inp.files[0];if(!file)return;var id=window.__waCsvCid;
 var rd=new FileReader();rd.onload=function(){fetch('/api/wa/campaign-import-csv',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,csv:rd.result})}).then(r=>r.json()).then(function(d){
  alert(d.ok?('Import: '+d.added+' übernommen, '+d.blocked+' geblockt (Opt-out/Freunde/Dubletten bleiben sichtbar).'):('Fehler: '+d.error));waLoadCamps();});};rd.readAsText(file);}
function waCrmImport(id,btn){var status=prompt('CRM-Import — nur Leads MIT Telefonnummer werden übernommen.\\n\\nStatus-Filter (leer = alle):','');if(status===null)return;
 var cat=prompt('Kategorie-Filter (leer = alle):','');if(cat===null)return;
 var plat=prompt('Plattform-Filter (z.B. whatsapp; leer = alle):','');if(plat===null)return;
 btn.disabled=true;var f={};if(status)f.status=status;if(cat)f.category=cat;if(plat)f.platform=plat;
 fetch('/api/wa/campaign-import-crm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,filter:f})}).then(r=>r.json()).then(function(d){btn.disabled=false;
  alert(d.ok?('CRM: '+d.candidates+' Kandidaten, davon '+(d.noPhone||0)+' OHNE Nummer (übersprungen). '+d.added+' übernommen, '+d.blocked+' geblockt.'):('Fehler: '+d.error));waLoadCamps();});}
function waTplBody(t){try{return (t.components||[]).filter(function(c){return (c.type||'').toUpperCase()==='BODY';}).map(function(c){return c.text;}).join(' ');}catch(e){return '';}}
function waCdSequence(){var c=waCampCur();var b=document.getElementById('wa-cd-body');var seq=c.sequence||[];var apr=window.WATPLS.filter(function(t){return t.status==='APPROVED';});
 var h='<div class="muted" style="margin-bottom:8px">Schritte laufen nacheinander. Step 1 = Erstkontakt, danach Follow-ups mit Wartetagen. Jeder Schritt ist ein Meta-Template (nach Genehmigung nicht mehr editierbar).</div>';
 if(!seq.length)h+='<div class="waseq"><span class="muted">Noch keine Schritte. Lege den Erstkontakt an.</span></div>';
 seq.forEach(function(s,i){var tplBadge='';if(s.templateName){var t0=window.WATPLS.find(function(x){return x.name===s.templateName;});tplBadge=' <span class="wast '+(t0?esc(t0.status):'PENDING')+'">'+(t0?esc(t0.status):'wartet/unbekannt')+'</span>';}
  if(i>0)h+='<div class="wawait">⏱ '+(s.waitDays||0)+' Tage warten <button class="pop" style="padding:1px 7px" onclick="waSeqWait('+i+')">✎</button></div>';
  h+='<div class="waseq"><div class="sh"><b>Step '+(i+1)+(i===0?' · Erstkontakt':' · Follow-up '+i)+'</b>'+tplBadge+'<button class="pop" style="margin-left:auto;padding:1px 8px" onclick="waSeqDel('+i+')">✕</button></div>';
  if(s.templateName){var tt=window.WATPLS.find(function(x){return x.name===s.templateName;});h+='<div class="muted" style="font-size:12.5px">'+esc(s.templateName)+'</div><div style="font-size:13px;margin-top:4px">'+esc(tt?waTplBody(tt):'')+'</div>';}
  else h+='<label style="font:600 10px Rajdhani;letter-spacing:1px;text-transform:uppercase;color:var(--cyan)">Template-Text (Draft, {{1}}=Vorname)</label><textarea id="seq-body-'+i+'" rows="3" style="width:100%;background:rgba(3,12,22,.7);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:8px">'+esc(s.draftBody||'')+'</textarea>'+
   '<div style="display:flex;gap:7px;margin-top:7px;flex-wrap:wrap"><button class="pop" onclick="waSeqSubmit('+i+',this)">📤 Bei Meta einreichen</button><button class="pop" onclick="waSeqDraft('+i+',this)">🤖 KI-Vorschlag</button>'+
   waDropHtml('waSeqPickDrop','',[['','… oder APPROVED-Template wählen']].concat(apr.map(function(t){return [t.name,t.name];})),false,'data-step="'+i+'"')+'</div>';
  h+='</div>';});
 h+='<div style="display:flex;gap:7px;margin-top:6px"><button class="pop" onclick="waSeqAdd()">+ Add Step</button></div>';
 b.innerHTML=h;}
function waSeqPatch(fn){var c=waCampCur();if(!c)return;c.sequence=c.sequence||[];fn(c.sequence);waCampSaveObj(c);}
function waSeqAdd(){waSeqPatch(function(s){s.push({templateName:'',draftBody:'',waitDays:s.length?2:0});});}
function waSeqDel(i){waSeqPatch(function(s){s.splice(i,1);});}
function waSeqWait(i){var cur=(waCampCur().sequence[i]||{}).waitDays||2;var v=prompt('Wartetage vor diesem Schritt:',String(cur));if(v===null)return;waSeqPatch(function(s){s[i].waitDays=Math.max(0,+v||0);});}
function waSeqPick(i,name){if(!name)return;waSeqPatch(function(s){s[i].templateName=name;s[i].draftBody='';});}
function waSeqPickDrop(val,d){if(!val)return;waSeqPick(+d.getAttribute('data-step'),val);}
function waSeqDraft(i,btn){var body=document.getElementById('seq-body-'+i);var brief=(body&&body.value.trim())||prompt('Worum soll es im Template gehen?');if(!brief)return;btn.disabled=true;btn.textContent='… KI';
 fetch('/api/wa/template-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brief:brief})}).then(r=>r.json()).then(function(d){btn.disabled=false;btn.textContent='🤖 KI-Vorschlag';if(!d.ok){alert('Fehler: '+d.error);return;}if(body)body.value=d.bodyText||'';}).catch(function(){btn.disabled=false;btn.textContent='🤖 KI-Vorschlag';});}
function waSeqSubmit(i,btn){var body=document.getElementById('seq-body-'+i);var txt=body?body.value.trim():'';if(!txt){alert('Text fehlt.');return;}
 var name=prompt('Template-Name (klein, snake_case):','seq_'+(i+1)+'_'+Date.now().toString(36));if(!name)return;btn.disabled=true;
 fetch('/api/wa/template-create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,category:'MARKETING',language:'de',bodyText:txt,exampleParams:['Max'],footer:'Antworte STOP, wenn du keine Nachrichten mehr willst.'})}).then(r=>r.json()).then(function(d){btn.disabled=false;if(!d.ok){alert('Fehler: '+d.error);return;}
  var clean=name.toLowerCase().replace(/[^a-z0-9_]/g,'_');waSeqPatch(function(s){s[i].templateName=clean;s[i].draftBody='';});waLoadTpls(true);alert('Eingereicht (Status '+(d.status||'PENDING')+'). Approval kommt automatisch per Webhook.');});}
function waCdSchedule(){var c=waCampCur();var b=document.getElementById('wa-cd-body');var s=c.schedule||{days:[1,2,3,4,5],from:9,to:19,tz:'Europe/Berlin'};window.__waSched=JSON.parse(JSON.stringify(s));
 var days=[['Mo',1],['Di',2],['Mi',3],['Do',4],['Fr',5],['Sa',6],['So',0]];
 b.innerHTML='<div class="muted" style="margin-bottom:8px">Zusätzlich zu den globalen Quiet-Hours. Leer = immer (nur globale Regel greift).</div>'+
  '<label style="font:600 10px Rajdhani;letter-spacing:1px;text-transform:uppercase;color:var(--cyan)">Wochentage</label><div class="wadays" style="margin:6px 0 12px">'+days.map(function(d){return '<div class="wady'+((s.days||[]).indexOf(d[1])>=0?' on':'')+'" onclick="waSchDay('+d[1]+',this)">'+d[0]+'</div>';}).join('')+'</div>'+
  '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="muted">Von</span><input id="sch-from" type="number" min="0" max="23" value="'+(s.from!=null?s.from:9)+'" style="width:80px;background:rgba(3,12,22,.7);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:6px"><span class="muted">bis</span><input id="sch-to" type="number" min="1" max="24" value="'+(s.to!=null?s.to:19)+'" style="width:80px;background:rgba(3,12,22,.7);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:6px"><span class="muted">Uhr · Europe/Berlin</span></div>'+
  '<div style="margin-top:12px"><button onclick="waSchSave(this)">💾 Speichern</button></div>';}
function waSchDay(d,el){el.classList.toggle('on');var s=window.__waSched;s.days=s.days||[];var i=s.days.indexOf(d);if(i>=0)s.days.splice(i,1);else s.days.push(d);}
function waSchSave(btn){var c=waCampCur();var s=window.__waSched||{};s.from=+document.getElementById('sch-from').value||0;s.to=+document.getElementById('sch-to').value||24;s.tz='Europe/Berlin';c.schedule=s;btn.disabled=true;waCampSaveObj(c);setTimeout(function(){btn.disabled=false;},500);}
function waCdOptions(){var c=waCampCur();var b=document.getElementById('wa-cd-body');
 b.innerHTML='<div class="wagrid"><div><label>Tägliches Limit (Erstkontakte/Tag)</label><input id="opt-daily" type="number" min="1" max="250" value="'+(c.dailyLimit||10)+'"></div>'+
  '<div><label>Verbundene Nummer</label><input value="deine WhatsApp-Nummer" disabled></div></div>'+
  '<div class="muted" style="margin:8px 0">Mehrere Nummern / kombiniertes Limit (z.B. 240 über 8 Accounts), A/Z-Test, Auto-Optimizer und Behavior-Agent sind Phase 2.</div>'+
  '<label>Opt-out-Liste (STOP)</label><div id="opt-optout" class="muted">… lädt</div>'+
  '<div style="margin-top:12px"><button onclick="waOptSave(this)">💾 Limit speichern</button></div>';
 fetch('/api/wa/optout').then(r=>r.json()).then(function(d){var el=document.getElementById('opt-optout');if(!el)return;var l=(d&&d.list)||[];el.innerHTML=l.length?l.map(function(x){return '+'+esc(x);}).join(' · '):'Niemand hat sich abgemeldet.';}).catch(function(){});}
function waOptSave(btn){var c=waCampCur();c.dailyLimit=+document.getElementById('opt-daily').value||10;btn.disabled=true;waCampSaveObj(c);setTimeout(function(){btn.disabled=false;},500);}
function waCdAgent(){var c=waCampCur();var b=document.getElementById('wa-cd-body');var a=c.agent||{};
 window.__waNudge=(a.nudgeStepsHours||[]).slice(); window.__waGoalType=a.goalType||'termin';
 var isT=window.__waGoalType==='termin';
 b.innerHTML='<div class="waform">'+
  '<div class="muted" style="margin-bottom:16px">Die Basis (harte Setter-Regeln + die Nachrichten aus deiner Sequenz) ist schon vorgefüllt. Du gibst hier nur ein paar Zusatz-Sachen vor, nicht den ganzen Prompt.</div>'+
  '<div class="fld"><label>Ziel dieses Agenten</label><div id="ag-goaltype" class="waseg"><button type="button" class="'+(isT?'on':'')+'" onclick="waGoalType(\\'termin\\')">📅 Termin legen</button><button type="button" class="'+(isT?'':'on')+'" onclick="waGoalType(\\'verkauf\\')">💰 Direkt verkaufen</button></div>'+
   '<input id="ag-goal" style="margin-top:9px" value="'+esc(a.goal||'')+'" placeholder="'+(isT?'z.B. 15-Min-Call vereinbaren':'z.B. Website-Paket 2k verkaufen')+'">'+
   '<div class="hint" id="ag-goalhint">'+(isT?'Nutzt automatisch die DM-Setter-Skills (Zwei-Optionen-Terminfrage, Einwandbehandlung).':'Führt das Gespräch direkt zum Angebot/Abschluss des Produkts.')+'</div></div>'+
  '<div class="fld"><label>Zusätzliche Instructions (optional)</label><textarea id="ag-extra" rows="3" placeholder="Nur Zusatz. z.B. Ton, was er betonen oder vermeiden soll …">'+esc(a.promptExtra||'')+'</textarea></div>'+
  '<div class="fld"><label>Wann an dich übergeben und anpingen</label><textarea id="ag-ho" rows="2" placeholder="z.B. bei Preisfragen, Beschwerden, oder wenn der Lead einen Menschen will">'+esc(a.handoverRules||'')+'</textarea></div>'+
  '<div class="wasec"><h5>Terminbuchung <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">· Kalender-Anbindung ist Phase 2</span></h5>'+
   '<div class="two"><div class="fld" style="margin:0"><label>Kalender-ID</label><input id="ag-cal" value="'+esc(a.calendarId||'')+'" placeholder="primary / mail@…"></div>'+
   '<div class="fld" style="margin:0"><label>Termine annehmen (Zeitfenster)</label><input id="ag-hours" value="'+esc(a.acceptHours||'')+'" placeholder="Mo-Fr 10-17 Uhr"></div></div></div>'+
  '<div class="wasec"><h5>Nachfassen im 24h-Fenster (Nudges)</h5>'+
   '<div class="muted" style="font-size:12px;margin-bottom:9px">Lead hat geantwortet und wird still → der Agent hakt zu diesen Zeitpunkten je einmal nach (Stunden nach deiner letzten Nachricht).</div>'+
   '<div class="wachips" id="ag-nudgechips"></div>'+
   '<label class="wachk" style="margin-top:14px"><input type="checkbox" id="ag-react" '+(a.reactivateAfterWindow?'checked':'')+'> <span>Nach 24h-Fensterschluss automatisch ein Reaktivierungs-Template einplanen (personalisiert aus dem Verlauf, wird vorab bei Meta eingereicht, weil die Freigabe dauern kann).</span></label></div>'+
  '<div class="wasec"><label class="wachk"><input type="checkbox" id="ag-auto" '+(c.autoReply===false?'':'checked')+'> <span>KI antwortet automatisch (aus = der Chat landet direkt bei dir zum Übernehmen).</span></label>'+
   '<div style="margin-top:14px"><button onclick="waAgentSave(this)">💾 Speichern</button></div></div>'+
  '</div>';
 waRenderNudge();}
function waGoalType(t){window.__waGoalType=t;document.querySelectorAll('#ag-goaltype button').forEach(function(x){x.classList.toggle('on',(t==='termin')===/Termin/.test(x.textContent));});
 var g=document.getElementById('ag-goal');if(g)g.placeholder=(t==='termin'?'z.B. 15-Min-Call vereinbaren':'z.B. Website-Paket 2k verkaufen');
 var h=document.getElementById('ag-goalhint');if(h)h.textContent=(t==='termin'?'Nutzt automatisch die DM-Setter-Skills (Zwei-Optionen-Terminfrage, Einwandbehandlung).':'Führt das Gespräch direkt zum Angebot/Abschluss des Produkts.');}
function waRenderNudge(){var el=document.getElementById('ag-nudgechips');if(!el)return;var arr=(window.__waNudge||[]).slice().sort(function(a,b){return a-b;});
 el.innerHTML=arr.map(function(h,i){return '<span class="wachip">+<b>'+h+'</b>&nbsp;h <x onclick="waNudgeDel('+i+')">✕</x></span>';}).join('')+
  '<input id="ag-nudgeadd" type="number" min="0.5" step="0.5" placeholder="Std" style="width:74px;background:rgba(3,12,22,.7);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:6px 9px" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();waNudgeAdd();}"><button class="pop" onclick="waNudgeAdd()">+ Nudge</button>'+
  (arr.length?'':' <span class="muted" style="font-size:12px">leer = zurückhaltender Standard (1 Nudge kurz vor Fensterschluss)</span>');}
function waNudgeAdd(){var inp=document.getElementById('ag-nudgeadd');var v=parseFloat(inp.value);if(isNaN(v)||v<=0){inp.focus();return;}window.__waNudge=(window.__waNudge||[]);if(window.__waNudge.indexOf(v)<0)window.__waNudge.push(v);inp.value='';waRenderNudge();var n=document.getElementById('ag-nudgeadd');if(n)n.focus();}
function waNudgeDel(i){var arr=(window.__waNudge||[]).slice().sort(function(a,b){return a-b;});arr.splice(i,1);window.__waNudge=arr;waRenderNudge();}
function waAgentSave(btn){var c=waCampCur();c.agent={goalType:window.__waGoalType||'termin',goal:document.getElementById('ag-goal').value.trim(),promptExtra:document.getElementById('ag-extra').value.trim(),handoverRules:document.getElementById('ag-ho').value.trim(),calendarId:document.getElementById('ag-cal').value.trim(),acceptHours:document.getElementById('ag-hours').value.trim(),nudgeStepsHours:(window.__waNudge||[]).slice().sort(function(a,b){return a-b;}),reactivateAfterWindow:document.getElementById('ag-react').checked};
 c.autoReply=document.getElementById('ag-auto').checked;btn.disabled=true;waCampSaveObj(c);setTimeout(function(){btn.disabled=false;},500);}
// ================= INBOX (zwei Inboxen) =================
function waInSet(k,v){window.WAIN[k]=v;
 if(k==='box'){document.getElementById('wain-auto').classList.toggle('sel',v==='auto');document.getElementById('wain-human').classList.toggle('sel',v==='human');}
 if(k==='scope'){['all','inbound','camp'].forEach(function(s){var el=document.getElementById('wain-scope-'+s);if(el)el.classList.toggle('sel',s===(v==='campaign'?'camp':v));});}
 waLoadThreads();}
function waMatchInbox(t){var isHuman=t.needsHuman||t.mode==='manual';var isAuto=t.mode==='ai'&&!t.needsHuman;
 if(window.WAIN.box==='auto'&&!isAuto)return false;
 if(window.WAIN.box==='human'&&!isHuman)return false;
 if(window.WAIN.scope==='inbound'&&t.campaignId)return false;
 if(window.WAIN.scope==='campaign'&&!t.campaignId)return false;
 if(window.WAIN.label&&t.label!==window.WAIN.label)return false;
 return true;}
function waLoadThreads(){fetch('/api/wa/threads').then(r=>r.json()).then(function(d){var box=document.getElementById('wa-threads');if(!box)return;
 var sub=document.getElementById('wa-sub');if(sub&&d.sentToday)sub.textContent='Heute gesendet: '+d.sentToday.total+' an '+d.sentToday.unique+' Kontakte (Cap '+d.cap+'). Inbox: 🤖 automatisch vs 🖐 du übernimmst.';
 var list=(d.threads||[]).filter(waMatchInbox);
 if(!list.length){box.innerHTML='<div class="wat"><span class="muted">Keine Chats in dieser Ansicht.</span></div>';return;}
 box.innerHTML=list.map(function(t){var badges='';
  if(t.needsHuman)badges+=' <span class="wabadge hot">🖐 du</span>';else if(t.mode==='ai')badges+=' <span class="wabadge ai">AI</span>';
  if(t.optOut)badges+=' <span class="wabadge red">STOP</span>';
  if(t.windowOpen)badges+=' <span class="wabadge">24h</span>';
  if(t.label)badges+=' <span class="walbl '+t.label.replace(/-/g,'')+'">'+esc(t.label)+'</span>';
  var un=t.unread?(' <span class="wabadge hot">'+t.unread+'</span>'):'';
  return '<div class="wat'+(window.WACUR===t.waId?' on':'')+'" onclick="waOpen(\\''+t.waId+'\\')"><div class="wn">'+esc(t.name||('+'+t.waId))+badges+un+'</div><div class="wl">'+(t.lastDir==='out'?'→ ':'')+esc(t.lastText||'')+'</div><div class="wl">'+waFmtTs(t.lastTs)+'</div></div>';
 }).join('');}).catch(function(){});}
function waOpen(waId){window.WACUR=waId;
 fetch('/api/wa/thread?waId='+encodeURIComponent(waId)).then(r=>r.json()).then(function(d){if(!d.ok)return;var t=d.thread;
  var head=document.getElementById('wa-chathead');
  var labelSel=waDropHtml('waLabelDrop',t.label||'',[['','kein Label'],['interested','interested'],['meeting-booked','meeting-booked'],['not-interested','not-interested'],['auto-reply','auto-reply'],['ooo','ooo']],false,'data-wa="'+t.waId+'" style="min-width:150px"');
  head.innerHTML='<b>'+esc(t.name||('+'+t.waId))+'</b><span class="muted">+'+t.waId+(t.campaignId?(' · '+esc(t.campaignId)):'')+'</span>'+
   '<span class="wabadge '+(t.mode==='ai'?'ai':'')+'" style="cursor:pointer" onclick="waToggleMode(\\''+t.waId+'\\',\\''+(t.mode==='ai'?'manual':'ai')+'\\')" title="AI-Setter für diesen Chat an/aus">'+(t.mode==='ai'?'🤖 AI antwortet':'✋ manuell')+'</span>'+
   (d.windowOpen?'<span class="wabadge">Fenster offen</span>':'<span class="wabadge red">Fenster zu</span>')+labelSel+
   '<button class="pop" style="margin-left:auto" onclick="waOptout(\\''+t.waId+'\\')">🚫 Opt-out</button>';
  var box=document.getElementById('wa-msgs');
  box.innerHTML=(t.messages||[]).map(function(m){var cls='wam'+(m.dir==='out'?' out':'')+(m.type==='template'?' tpl':'');
   var tick=m.dir==='out'?(m.status==='read'?' ✓✓':m.status==='delivered'?' ✓✓':m.status==='sent'?' ✓':m.status==='failed'?' ⚠':''):'';
   return '<div class="'+cls+'">'+esc(m.text||'')+'<small>'+waFmtTs(m.ts)+tick+(m.by==='ai'?' · 🤖':'')+'</small></div>';}).join('');
  box.scrollTop=box.scrollHeight;
  document.getElementById('wa-bar').style.display=d.windowOpen?'':'none';
  document.getElementById('wa-closedbar').style.display=d.windowOpen?'none':'';
  waLeadPanel(t,d.lead,d.nextAction);
  waLoadThreads();
 });}
function waLeadPanel(t,lead,next){var el=document.getElementById('wa-leadp');if(!el)return;var h='<h4>Lead</h4>';
 h+='<div class="lk">Name</div><div class="lv">'+esc(t.name||'—')+'</div><div class="lk">Nummer</div><div class="lv">+'+esc(t.waId)+'</div>';
 if(lead){if(lead.company)h+='<div class="lk">Firma</div><div class="lv">'+esc(lead.company)+'</div>';
  if(lead.location)h+='<div class="lk">Ort</div><div class="lv">'+esc(lead.location)+'</div>';
  if(lead.category)h+='<div class="lk">Kategorie</div><div class="lv">'+esc(lead.category)+'</div>';
  if(lead.status)h+='<div class="lk">CRM-Status</div><div class="lv">'+esc(lead.status)+'</div>';}
 if(t.label)h+='<div class="lk">Label</div><div class="lv"><span class="walbl '+t.label.replace(/-/g,'')+'">'+esc(t.label)+'</span></div>';
 h+='<h4 style="margin-top:12px">Nächstes Action-Item</h4>';
 if(next){var kn={first_contact:'Erstkontakt',followup_template:'Follow-up',nudge:'Nudge'}[next.kind]||next.kind;var due=next.dueAt?waFmtTs(next.dueAt):'sofort';h+='<div class="lv">'+esc(kn)+' · '+due+(next.waitingApproval?' (wartet auf Template-Approval)':'')+'</div>';}
 else h+='<div class="muted">Kein geplantes Item. '+(t.mode==='ai'?'AI-Setter reagiert auf Antworten.':'Du bist am Zug.')+'</div>';
 if(lead&&lead.history&&lead.history.length){h+='<h4 style="margin-top:12px">Verlauf</h4>'+lead.history.slice().reverse().map(function(x){return '<div class="lk">'+esc(String(x.ts||'').slice(0,10))+' · '+esc(x.field||'')+' = '+esc(String(x.value))+'</div>';}).join('');}
 el.innerHTML=h;}
function waSetLabel(waId,label){fetch('/api/wa/thread-label',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({waId:waId,label:label})}).then(function(){waLoadThreads();});}
function waLabelDrop(val,d){waSetLabel(d.getAttribute('data-wa'),val);}
function waSendMsg(){var inp=document.getElementById('wa-input');var txt=inp.value.trim();if(!txt||!window.WACUR)return;inp.value='';
 fetch('/api/wa/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({waId:window.WACUR,text:txt})}).then(r=>r.json()).then(function(d){if(!d.ok)alert(d.error||'Fehler');waOpen(window.WACUR);});}
function waToggleMode(waId,mode){fetch('/api/wa/thread-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({waId:waId,mode:mode})}).then(function(){waOpen(waId);});}
function waOptout(waId){if(!confirm('Diesen Kontakt dauerhaft auf die Opt-out-Liste? Er wird NIE wieder angeschrieben.'))return;
 fetch('/api/wa/thread-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({waId:waId,optOut:true})}).then(function(){waOpen(waId);});}
function waGenFu(btn){if(!window.WACUR)return;btn.disabled=true;btn.textContent='… generiert (~1 Min)';
 fetch('/api/wa/generate-followup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({waId:window.WACUR})}).then(r=>r.json()).then(function(d){
  btn.disabled=false;btn.textContent='✨ Follow-up-Template';alert(d.ok?('Template "'+d.template+'" bei Meta eingereicht.\\n\\n"'+d.body+'"\\n\\nGeplant in '+d.dueInDays+' Tagen, sobald genehmigt.'):('Fehler: '+d.error));
 }).catch(function(){btn.disabled=false;btn.textContent='✨ Follow-up-Template';});}
function waNewChat(){var apr=window.WATPLS.filter(function(t){return t.status==='APPROVED';});
 if(!apr.length){alert('Kein genehmigtes Template vorhanden. Erst unter Templates eins anlegen und genehmigen lassen.');return;}
 var phone=prompt('Telefonnummer (mit oder ohne +49):');if(!phone)return;
 var name=prompt('Name:')||'';
 var tpl=prompt('Template-Name:\\n'+apr.map(function(t){return '· '+t.name;}).join('\\n'),apr[0].name);if(!tpl)return;
 var params=prompt('Parameter (kommagetrennt):',name.split(' ')[0]||'');
 fetch('/api/wa/start-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:phone,name:name,templateName:tpl,params:params?params.split(',').map(function(s){return s.trim();}):[]})}).then(r=>r.json()).then(function(d){alert(d.ok?'Gesendet.':('Fehler: '+d.error));waLoadThreads();});}
// ================= TEMPLATES =================
function waLoadTpls(sync){fetch('/api/wa/templates'+(sync?'?sync=1':'')).then(r=>r.json()).then(function(d){window.WATPLS=d.templates||[];var box=document.getElementById('wa-tpllist');if(!box)return;
 if(d.error)box.innerHTML='<span class="muted">⚠ '+esc(d.error)+'</span>';
 if(!window.WATPLS.length){if(!d.error)box.innerHTML='<span class="muted">Keine Templates. Lege das erste an.</span>';return;}
 box.innerHTML='<table><tr><th>Name</th><th>Status</th><th>Kategorie</th><th>Sprache</th><th>Template-ID</th><th>Body</th><th></th></tr>'+window.WATPLS.map(function(t){
  var body='';try{body=(t.components||[]).filter(function(c){return (c.type||'').toUpperCase()==='BODY';}).map(function(c){return c.text;}).join(' ');}catch(e){}
  return '<tr><td>'+esc(t.name)+'</td><td><span class="wast '+esc(t.status||'')+'">'+esc(t.status||'?')+'</span>'+(t.rejectedReason?('<div class="muted" style="font-size:10px">'+esc(t.rejectedReason)+'</div>'):'')+'</td><td>'+esc(t.category||'')+'</td><td>'+esc(t.language||'')+'</td><td style="font-family:monospace;font-size:11px">'+esc(String(t.id||''))+'</td><td title="'+esc(body)+'">'+esc(body.slice(0,60))+'</td><td><button class="pldel" onclick="waTplDel(\\''+esc(t.name)+'\\')">✕</button></td></tr>';
 }).join('')+'</table>';});}
function waTplSync(btn){btn.disabled=true;btn.textContent='… synct';waLoadTpls(true);setTimeout(function(){btn.disabled=false;btn.textContent='↻ Mit Meta syncen';},1500);}
function waTplAI(){waBrief('Template per Sprache',function(brief){
 fetch('/api/wa/template-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brief:brief})}).then(r=>r.json()).then(function(d){if(!d.ok){alert('Fehler: '+d.error);return;}
  waTplNew();document.getElementById('tf-name').value=d.name||'';document.getElementById('tf-body').value=d.bodyText||'';document.getElementById('tf-ex').value=(d.exampleParams||[]).join(', ');if(d.footer)document.getElementById('tf-footer').value=d.footer;if(d.category)waDropSet('tf-cat',d.category);
 }).catch(function(){alert('Fehler beim KI-Entwurf.');});});}
function waTplNew(){var f=document.getElementById('wa-tplform');f.style.display='';
 f.innerHTML='<h3 style="margin:0 0 4px">Neues Template</h3><div class="muted">Meta prüft MARKETING-Templates streng: konkreter Business-Kontext, keine reine Werbefloskel. Genehmigung: Minuten bis ~48h. Nach Genehmigung nicht mehr editierbar.</div>'+
 '<div class="wagrid"><div><label>Name (klein, unterstriche)</label><input id="tf-name" placeholder="erstkontakt_agentur_v1"></div>'+
 '<div><label>Kategorie</label>'+waDropHtml('','MARKETING',[['MARKETING','MARKETING'],['UTILITY','UTILITY']],true,'id="tf-cat"')+'</div>'+
 '<div><label>Sprache</label>'+waDropHtml('','de',[['de','de'],['en_US','en_US']],true,'id="tf-lang"')+'</div>'+
 '<div><label>Beispiel-Werte für {{1}},{{2}}… (kommagetrennt)</label><input id="tf-ex" placeholder="Max, Mustermann GmbH"></div></div>'+
 '<label>Body (Variablen als {{1}}, {{2}} …)</label><textarea id="tf-body" rows="5" placeholder="Hey {{1}}, du hattest dich bei uns eingetragen …"></textarea>'+
 '<label>Footer (optional, empfohlen für Opt-out)</label><input id="tf-footer" value="Antworte STOP, wenn du keine Nachrichten mehr willst.">'+
 '<div style="display:flex;gap:9px;margin-top:12px"><button onclick="waTplCreate(this)">📤 Bei Meta einreichen</button><button class="offbtn" onclick="document.getElementById(\\'wa-tplform\\').style.display=\\'none\\'">Abbrechen</button></div>';}
function waTplCreate(btn){btn.disabled=true;
 var ex=document.getElementById('tf-ex').value.split(',').map(function(s){return s.trim();}).filter(Boolean);
 fetch('/api/wa/template-create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('tf-name').value,category:waDropVal('tf-cat'),language:waDropVal('tf-lang'),bodyText:document.getElementById('tf-body').value,exampleParams:ex,footer:document.getElementById('tf-footer').value})}).then(r=>r.json()).then(function(d){btn.disabled=false;
  if(d.ok){document.getElementById('wa-tplform').style.display='none';waLoadTpls(true);alert('Eingereicht (Status: '+(d.status||'PENDING')+'). Approval kommt per Webhook automatisch rein.');}else alert('Fehler: '+d.error);});}
function waTplDel(name){if(!confirm('Template "'+name+'" bei Meta löschen?'))return;
 fetch('/api/wa/template-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})}).then(r=>r.json()).then(function(d){if(!d.ok)alert('Fehler: '+d.error);waLoadTpls(false);});}
var SETKEYS=['WA_ACCESS_TOKEN','WA_APP_SECRET','WA_VERIFY_TOKEN','DEEPGRAM_API_KEY','ELEVENLABS_API_KEY','TELEGRAM_BOT_TOKEN','SMTP_PASS','APIFY_TOKEN'];
function loadSettings(){fetch('/api/settings').then(r=>r.json()).then(function(d){if(!d.ok)return;var w=d.settings.whatsapp||{};var sm=d.settings.smtp||{};
 SETKEYS.forEach(function(k){var el=document.getElementById('set-'+k);if(el)el.value=d.secrets[k]||'';});
 document.getElementById('set-phoneNumberId').value=w.phoneNumberId||'';document.getElementById('set-wabaId').value=w.wabaId||'';
 document.getElementById('set-webhookHost').value=w.webhookHost||'';document.getElementById('set-globalDailyCap').value=w.globalDailyCap||50;
 document.getElementById('set-qFrom').value=(w.quietHours||{}).from!=null?w.quietHours.from:9;document.getElementById('set-qTo').value=(w.quietHours||{}).to!=null?w.quietHours.to:19;
 document.getElementById('set-webhookUrl').textContent=w.webhookHost?('https://'+w.webhookHost+'/webhooks/wa'):'— Webhook-Host eintragen —';
 document.getElementById('set-smtpHost').value=sm.host||'';document.getElementById('set-smtpPort').value=sm.port||587;
 document.getElementById('set-smtpUser').value=sm.user||'';document.getElementById('set-smtpFrom').value=sm.from||'';
 var st=document.getElementById('set-wa-status');st.textContent=(d.secrets.WA_ACCESS_TOKEN?'Token ✓':'Token fehlt')+' · '+(w.phoneNumberId?'Nummer ✓':'Nummer fehlt');});}
function saveSettings(btn){btn.disabled=true;
 var secrets={};SETKEYS.forEach(function(k){var el=document.getElementById('set-'+k);if(el)secrets[k]=el.value;});
 var wsett={phoneNumberId:document.getElementById('set-phoneNumberId').value.trim(),wabaId:document.getElementById('set-wabaId').value.trim(),
  webhookHost:document.getElementById('set-webhookHost').value.trim().replace('https://','').replace('http://','').split('/')[0],
  globalDailyCap:+document.getElementById('set-globalDailyCap').value||50,
  quietHours:{from:+document.getElementById('set-qFrom').value||9,to:+document.getElementById('set-qTo').value||19}};
 var smtp={host:document.getElementById('set-smtpHost').value.trim(),port:+document.getElementById('set-smtpPort').value||587,
  user:document.getElementById('set-smtpUser').value.trim(),from:document.getElementById('set-smtpFrom').value.trim()};
 fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secrets:secrets,settings:{whatsapp:wsett,smtp:smtp}})}).then(r=>r.json()).then(function(d){btn.disabled=false;if(!d.ok)return alert('Fehler: '+d.error);loadSettings();});}
function waTest(btn){btn.disabled=true;var out=document.getElementById('set-testresult');out.innerHTML='<span class="muted">… teste gegen Graph API</span>';
 fetch('/api/wa/test-connection').then(r=>r.json()).then(function(d){btn.disabled=false;
  if(!d.ok){out.innerHTML='<span style="color:#ff6b6b">✗ '+esc(d.error||'Fehler')+'</span>';return;}
  var n=d.number||{};out.innerHTML='<span style="color:var(--green)">✓ Verbunden:</span> '+esc(n.display_phone_number||'?')+' ('+esc(n.verified_name||'')+') · Qualität: '+esc(n.quality_rating||'?')+' · Tier: '+esc(n.messaging_limit_tier||'?')+(d.waba?(' · WABA: '+esc(d.waba.name||'')):'');
 }).catch(function(){btn.disabled=false;out.innerHTML='<span style="color:#ff6b6b">✗ Server-Fehler</span>';});}
setInterval(function(){if(window.CUR==='whatsapp'&&window.WATAB==='inbox'){waLoadThreads();if(window.WACUR)waOpen(window.WACUR);}},20000);
initChat();
loadHeartbeat(true);setInterval(loadHeartbeat,30000);
// --- Meeting-/Fokus-Modus (manueller Schalter ganz oben) ---
function mmPaint(on){var b=document.getElementById('mmbtn'),l=document.getElementById('mmlabel'),s=document.getElementById('mmsub');window.__mmOn=!!on;if(!b)return;b.classList.toggle('on',!!on);if(l)l.textContent=on?'Fokus AN · klick = weiter':'Meeting-Modus';if(s)s.classList.toggle('on',!!on);}
function loadMeetingStatus(){fetch('/api/meeting-mode').then(r=>r.json()).then(d=>mmPaint(d&&d.on)).catch(function(){});}
function toggleMeeting(){var on=!window.__mmOn;var b=document.getElementById('mmbtn');if(b)b.disabled=true;
 fetch('/api/meeting-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:on,source:'manual'})})
  .then(r=>r.json()).then(function(){mmPaint(on);if(b)b.disabled=false;}).catch(function(){if(b)b.disabled=false;});}
loadMeetingStatus();setInterval(loadMeetingStatus,15000);
show(_initHash||'dashboard'); // zuletzt: zur ursprünglich offenen Seite zurück (oder Command Center)
</script></body></html>`;
}
