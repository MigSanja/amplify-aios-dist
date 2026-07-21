// wa.js — WhatsApp DM-Setter Modul (Meta Cloud API). Läuft IM Server-Prozess (server.js required
// dieses Modul) → Single-Writer: NUR dieser Prozess schreibt wa-*.json (immer atomar).
// Externe Akteure (launchd, claude -p) reden nur über die /api/wa/*-Routen.
// Secrets (.env): WA_ACCESS_TOKEN (System-User-Token, läuft nie ab), WA_APP_SECRET, WA_VERIFY_TOKEN.
// Nicht-Secrets: dashboard/data/settings.json (phoneNumberId, wabaId, quietHours, Caps …).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile, execSync } = require("child_process");
const { writeJsonAtomic, writeFileAtomic } = require("./atomic-write");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(__dirname, "data");
const AGENT = path.join(ROOT, "agents", "whatsapp-setter");
const PORT = process.env.PORT || 4321;
const MASK = "•".repeat(24);
// Alle über die Einstellungen-UI pflegbaren Secrets (Connections-Zentrale). Merge-on-change: Maske überschreibt nie.
const SECRET_KEYS = ["WA_ACCESS_TOKEN", "WA_APP_SECRET", "WA_VERIFY_TOKEN", "DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY", "TELEGRAM_BOT_TOKEN", "SMTP_PASS", "APIFY_TOKEN"];

const F = {
  settings: path.join(DATA, "settings.json"),
  threads: path.join(DATA, "wa-threads.json"),
  optout: path.join(DATA, "wa-optout.json"),
  templates: path.join(DATA, "wa-templates.json"),
  campaigns: path.join(DATA, "wa-campaigns.json"),
  outbox: path.join(DATA, "wa-outbox.json"),
  events: path.join(DATA, "wa-events.jsonl"),
};

// ---------- .env (lesen + gezielt schreiben; envSet = die EINE sanktionierte .env-Schreibstelle) ----------
function envVal(name) { try { const e = fs.readFileSync(path.join(ROOT, ".env"), "utf8"); const m = e.match(new RegExp("^" + name + "=(.+)$", "m")); return m ? m[1].trim() : null; } catch { return null; } }
function envSet(name, val) {
  let e = ""; try { e = fs.readFileSync(path.join(ROOT, ".env"), "utf8"); } catch {}
  const line = name + "=" + String(val).trim();
  if (new RegExp("^" + name + "=", "m").test(e)) e = e.replace(new RegExp("^" + name + "=.*$", "m"), line);
  else e = e.replace(/\n*$/, "\n") + line + "\n";
  writeFileAtomic(path.join(ROOT, ".env"), e);
}

// ---------- JSON-Dateien ----------
function loadJ(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function saveJ(file, obj) { writeJsonAtomic(file, obj, 2); }

const DEFAULTS = {
  whatsapp: {
    phoneNumberId: "", wabaId: "", graphVersion: "v25.0",
    webhookHost: "", // z. B. deine statische ngrok-Domain (xxx.ngrok-free.app)
    quietHours: { from: 9, to: 19 }, globalDailyCap: 50, defaultLanguage: "de",
  },
  smtp: { host: "", port: 587, user: "", from: "" }, // E-Mail-Versand (später); Passwort = SMTP_PASS in .env
};
function settings() {
  const s = loadJ(F.settings, {});
  return { whatsapp: Object.assign({}, DEFAULTS.whatsapp, s.whatsapp || {}), smtp: Object.assign({}, DEFAULTS.smtp, s.smtp || {}) };
}
function wcfg() { return settings().whatsapp; }

// ---------- Kleinkram ----------
const now = () => Date.now();
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
function berlinHour() { return +new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }); }
function e164(raw) {
  let d = String(raw || "").replace(/[^0-9+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "49" + d.slice(1); // DE-Default
  return /^[1-9][0-9]{7,14}$/.test(d) ? d : null;
}
function appendEvent(obj) { try { fs.appendFileSync(F.events, JSON.stringify(Object.assign({ ts: new Date().toISOString() }, obj)) + "\n"); } catch {} }
function notify(title, msg) { try { spawn("node", [path.join(__dirname, "notify.js"), "--title", title, String(msg).slice(0, 500)], { detached: true, stdio: "ignore" }).unref(); } catch {} }
function bumpStat(key, n) {
  const f = path.join(AGENT, "stats.json"); const s = loadJ(f, {}); const d = today();
  if (!s[d]) s[d] = {}; s[d][key] = (+s[d][key] || 0) + (n || 1);
  try { writeJsonAtomic(f, s, 2); } catch {}
}
function isPaused() { try { return fs.existsSync(path.join(AGENT, ".paused")); } catch { return false; } }
function agentCfg() { return loadJ(path.join(AGENT, "config.json"), { model: "claude-sonnet-4-6", limits: { messagesPerDay: 50, delaySecMin: 60, delaySecMax: 180 } }); }

// ---------- HTTP-Helper (lokal, wie server.js) ----------
// Alle Helper geben true zurück → jedes "return sendJ(...)" in handle() signalisiert "Route bedient".
function send(res, status, type, body) { res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body); return true; }
function sendJ(res, status, obj) { return send(res, status, "application/json", JSON.stringify(obj)); }
function readRaw(req, cb) { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => cb(b)); return true; }
function readBody(req, cb) { return readRaw(req, (b) => { try { cb(JSON.parse(b)); } catch { cb({}); } }); }

// ---------- Graph API ----------
async function graph(method, p, body) {
  const c = wcfg(); const tok = envVal("WA_ACCESS_TOKEN");
  if (!tok) throw new Error("WA_ACCESS_TOKEN fehlt (Einstellungen)");
  const r = await fetch("https://graph.facebook.com/" + c.graphVersion + "/" + p, {
    method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const msg = (j.error && (j.error.message + (j.error.error_data ? " · " + JSON.stringify(j.error.error_data) : ""))) || ("HTTP " + r.status); const e = new Error(msg); e.graph = j.error; throw e; }
  return j;
}

// ---------- Freunde-Blocklist (read-only; Namen aus agents/*/runs/.blocklist.json) ----------
function blockNames() {
  const names = new Set(); const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  let dirs = []; try { dirs = fs.readdirSync(path.join(ROOT, "agents")); } catch {}
  for (const d of dirs) {
    const bl = loadJ(path.join(ROOT, "agents", d, "runs", ".blocklist.json"), []);
    for (const b of (Array.isArray(bl) ? bl : [])) if (b.name) names.add(norm(b.name));
  }
  return names;
}

// ---------- Threads ----------
function threadsAll() { return loadJ(F.threads, { threads: [] }); }
function getThread(waId) { return threadsAll().threads.find((t) => t.waId === waId) || null; }
function upsertThread(waId, patch) {
  const d = threadsAll(); let t = d.threads.find((x) => x.waId === waId);
  if (!t) { t = { waId, name: "", leadUrl: "wa:" + waId, campaignId: null, mode: "manual", windowOpenedAt: 0, optOut: false, needsHuman: false, label: "", followupsSent: 0, nudgedWindow: 0, unread: 0, messages: [] }; d.threads.push(t); }
  Object.assign(t, patch || {});
  saveJ(F.threads, d); return t;
}
function pushMsg(waId, msg) {
  const d = threadsAll(); let t = d.threads.find((x) => x.waId === waId);
  if (!t) { upsertThread(waId, {}); return pushMsg(waId, msg); }
  if (msg.id && t.messages.some((m) => m.id === msg.id)) return t; // Webhook-Retry-Dedupe
  t.messages.push(msg); if (t.messages.length > 500) t.messages = t.messages.slice(-500);
  if (msg.dir === "in") { t.windowOpenedAt = msg.ts; t.unread = (t.unread || 0) + 1; }
  saveJ(F.threads, d); return t;
}
function windowOpen(t) { return t && t.windowOpenedAt && (now() - t.windowOpenedAt) < 24 * 3600 * 1000; }

// ---------- Opt-out ----------
function optedOut(waId) { return loadJ(F.optout, []).includes(waId); }
function addOptOut(waId) {
  const l = loadJ(F.optout, []); if (!l.includes(waId)) { l.push(waId); saveJ(F.optout, l); }
  upsertThread(waId, { optOut: true, mode: "manual" }); cancelPending(waId);
  campaignMark(waId, "optout"); bumpStat("optouts");
}

// ---------- Guardrail-Gate (vor JEDEM Send) ----------
function sentToday() {
  const d = threadsAll(); let total = 0; const uniq = new Set(); const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  for (const t of d.threads) for (const m of t.messages) if (m.dir === "out" && m.ts >= t0.getTime()) { total++; uniq.add(t.waId); }
  return { total, unique: uniq.size };
}
function gate(waId, kind) {
  const c = wcfg();
  if (optedOut(waId)) return { ok: false, reason: "optout" };
  const t = getThread(waId);
  if (t && t.optOut) return { ok: false, reason: "optout" };
  if (t && t.name) { const bn = blockNames(); if (bn.has(String(t.name).toLowerCase().replace(/\s+/g, " ").trim())) return { ok: false, reason: "freunde-blocklist" }; }
  if (kind !== "manual") {
    const h = berlinHour(); const q = c.quietHours || { from: 9, to: 19 };
    if (h < q.from || h >= q.to) return { ok: false, reason: "quiet-hours" };
    const s = sentToday(); if (s.total >= (c.globalDailyCap || 50)) return { ok: false, reason: "daily-cap" };
  }
  return { ok: true };
}
// Per-Kampagne Sendefenster (Wochentage + Uhrzeit). Leer/unkonfiguriert = immer offen (nur globale Quiet-Hours greifen dann).
function campaignScheduleOpen(cp) {
  const s = cp && cp.schedule; if (!s) return true;
  const tz = s.tz || "Europe/Berlin";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(new Date());
  const wd = (parts.find((p) => p.type === "weekday") || {}).value || "";
  const hr = +((parts.find((p) => p.type === "hour") || {}).value || 0);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  if (Array.isArray(s.days) && s.days.length && !s.days.includes(map[wd])) return false;
  const from = s.from != null ? s.from : 0, to = s.to != null ? s.to : 24;
  if (hr < from || hr >= to) return false;
  return true;
}

// ---------- Senden ----------
async function waSend(waId, payload, record) {
  const c = wcfg(); if (!c.phoneNumberId) throw new Error("phoneNumberId fehlt (Einstellungen)");
  const j = await graph("POST", c.phoneNumberId + "/messages", Object.assign({ messaging_product: "whatsapp", to: waId }, payload));
  const id = j.messages && j.messages[0] && j.messages[0].id;
  pushMsg(waId, Object.assign({ id, dir: "out", ts: now(), status: "sent" }, record || {}));
  bumpStat("sent");
  return id;
}
async function sendText(waId, text, extra) { return waSend(waId, { type: "text", text: { body: text } }, Object.assign({ type: "text", text }, extra || {})); }
async function sendTemplate(waId, name, lang, params, extra) {
  const comps = (params && params.length) ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p) })) }] : [];
  return waSend(waId, { type: "template", template: { name, language: { code: lang || wcfg().defaultLanguage }, components: comps } },
    Object.assign({ type: "template", templateName: name, text: "📋 Template: " + name + (params && params.length ? " · " + params.join(", ") : "") }, extra || {}));
}
async function markRead(msgId) { try { await graph("POST", wcfg().phoneNumberId + "/messages", { messaging_product: "whatsapp", status: "read", message_id: msgId }); } catch {} }

// ---------- CRM-Brücke (Self-Call auf /api/lead-save → History/Blocklist-Logik bleibt an EINER Stelle) ----------
async function crmUpsert(waId, name, fields) {
  try {
    const tok = envVal("AIOS_API_TOKEN"); const H = { "Content-Type": "application/json" }; if (tok) H.Authorization = "Bearer " + tok;
    const id = "wa:" + waId;
    const lead = { name: name || ("WhatsApp " + waId), url: id, platform: "whatsapp", status: "WhatsApp", addedAt: today(), contactInfo: "+" + waId };
    await fetch("http://127.0.0.1:" + PORT + "/api/lead-save", { method: "POST", headers: H, body: JSON.stringify({ id, lead, fields: fields || {} }) });
  } catch {}
}

// ---------- Kampagnen ----------
function campaignsAll() { return loadJ(F.campaigns, { campaigns: [] }); }
function campaignById(id) { return campaignsAll().campaigns.find((c) => c.id === id) || null; }
function saveCampaign(c) {
  const d = campaignsAll(); const i = d.campaigns.findIndex((x) => x.id === c.id);
  if (i < 0) d.campaigns.push(c); else d.campaigns[i] = Object.assign(d.campaigns[i], c);
  saveJ(F.campaigns, d);
}
function campaignMark(waId, status) {
  const d = campaignsAll(); let hit = false;
  for (const c of d.campaigns) for (const k of (c.contacts || [])) if (k.phone === waId && k.status !== status) {
    if (status === "replied" && !["queued", "sent"].includes(k.status)) continue; // booked/optout nicht zurückstufen
    k.status = status; hit = true;
    if (!c.stats) c.stats = {}; c.stats[status] = (+c.stats[status] || 0) + 1;
  }
  if (hit) saveJ(F.campaigns, d);
}
// Kontakt-Intake mit Gate: Opt-out → Freunde → known-contacts/CRM-Dedupe → Kampagnen-Dedupe. Geblockte bleiben SICHTBAR (kein Silent-Drop).
function intakeContacts(camp, rows) {
  const bn = blockNames(); const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const known = loadJ(path.join(ROOT, "agents", "outreach-alex", "runs", ".known-contacts.json"), []);
  const knownNames = new Set((Array.isArray(known) ? known : []).map((k) => norm(k.name)).filter(Boolean));
  const crm = loadJ(path.join(DATA, "leads.json"), { leads: [] });
  const crmPhones = new Set(); const crmNames = new Set();
  for (const l of (crm.leads || [])) { crmNames.add(norm(l.name)); const m = String(l.contactInfo || "").match(/\+?[0-9][0-9 \/-]{7,}/); if (m) { const p = e164(m[0]); if (p) crmPhones.add(p); } }
  const inCamp = new Set((camp.contacts || []).map((k) => k.phone));
  const out = [];
  for (const r of rows) {
    const phone = e164(r.phone);
    const k = { phone: phone || String(r.phone || ""), name: r.name || "", company: r.company || "", vars: r.vars || {}, status: "queued", sentAt: null, followupsSent: 0 };
    if (!phone) k.status = "blocked_badphone";
    else if (optedOut(phone)) k.status = "blocked_optout";
    else if (bn.has(norm(k.name))) k.status = "blocked_friend";
    else if (knownNames.has(norm(k.name)) && norm(k.name)) k.status = "blocked_dedup";
    else if (crmPhones.has(phone)) k.status = "blocked_dedup";
    else if (inCamp.has(phone)) k.status = "blocked_duplicate";
    if (phone) inCamp.add(phone);
    out.push(k);
  }
  camp.contacts = (camp.contacts || []).concat(out);
  saveCampaign(camp);
  return { added: out.filter((x) => x.status === "queued").length, blocked: out.filter((x) => x.status.startsWith("blocked")).length, total: out.length };
}
function parseCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim()); if (!lines.length) return [];
  const delim = (lines[0].split(";").length > lines[0].split(",").length) ? ";" : ",";
  const split = (line) => { const out = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else { if (ch === '"') q = true; else if (ch === delim) { out.push(cur); cur = ""; } else cur += ch; } } out.push(cur); return out; };
  const head = split(lines[0]).map((h) => h.toLowerCase().trim());
  const col = (rx) => head.findIndex((h) => rx.test(h));
  const ci = { phone: col(/phone|telefon|nummer|number|handy|mobil/), name: col(/^name|vorname|kontakt/), company: col(/firma|company|unternehmen/) };
  const hasHeader = ci.phone >= 0 || ci.name >= 0;
  if (ci.phone < 0) ci.phone = 0; if (ci.name < 0) ci.name = 1; if (ci.company < 0) ci.company = 2;
  const rows = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const c = split(lines[i]); if (!c.length) continue;
    const vars = {}; head.forEach((h, j) => { if (hasHeader && h) vars[h] = (c[j] || "").trim(); });
    rows.push({ phone: (c[ci.phone] || "").trim(), name: (c[ci.name] || "").trim(), company: (c[ci.company] || "").trim(), vars });
  }
  return rows;
}

// ---------- Templates ----------
async function syncTemplates() {
  const c = wcfg(); if (!c.wabaId) throw new Error("wabaId fehlt (Einstellungen)");
  const j = await graph("GET", c.wabaId + "/message_templates?fields=id,name,status,category,language,components,rejected_reason&limit=200");
  const cache = loadJ(F.templates, { templates: [] });
  const byName = {}; for (const t of cache.templates) byName[t.name + "|" + t.language] = t;
  for (const t of (j.data || [])) {
    const k = t.name + "|" + t.language; const prev = byName[k] || {};
    byName[k] = Object.assign(prev, { id: t.id, name: t.name, language: t.language, category: t.category, status: t.status, components: t.components, rejectedReason: t.rejected_reason || "", lastSyncedAt: now() });
  }
  cache.templates = Object.values(byName); cache.lastSyncAt = now();
  saveJ(F.templates, cache); return cache;
}
function templateByName(name) { return loadJ(F.templates, { templates: [] }).templates.find((t) => t.name === name) || null; }
async function createTemplate({ name, language, category, bodyText, exampleParams, footer }) {
  const c = wcfg();
  const comps = [{ type: "BODY", text: bodyText }];
  const nParams = (bodyText.match(/\{\{\d+\}\}/g) || []).length;
  if (nParams) comps[0].example = { body_text: [Array.from({ length: nParams }, (_, i) => (exampleParams && exampleParams[i]) || "Beispiel" + (i + 1))] };
  if (footer) comps.push({ type: "FOOTER", text: footer });
  const j = await graph("POST", c.wabaId + "/message_templates", { name, language: language || c.defaultLanguage, category: category || "MARKETING", components: comps });
  const cache = loadJ(F.templates, { templates: [] });
  cache.templates.push({ id: j.id, name, language: language || c.defaultLanguage, category: category || "MARKETING", status: j.status || "PENDING", components: comps, rejectedReason: "", lastSyncedAt: now() });
  saveJ(F.templates, cache); return j;
}

// ---------- Outbox ----------
function outboxAll() { return loadJ(F.outbox, { queue: [] }); }
function enqueue(entry) {
  const d = outboxAll();
  d.queue.push(Object.assign({ id: "ob-" + crypto.randomBytes(5).toString("hex"), status: "pending", attempts: 0, lastError: "", createdAt: now() }, entry));
  saveJ(F.outbox, d);
}
function cancelPending(waId, kinds) {
  const d = outboxAll(); let hit = false;
  for (const q of d.queue) if (q.waId === waId && q.status === "pending" && (!kinds || kinds.includes(q.kind))) { q.status = "canceled"; hit = true; }
  if (hit) saveJ(F.outbox, d);
}

// ---------- Webhook ----------
function hmacOk(raw, sig) {
  const secret = envVal("WA_APP_SECRET"); if (!secret || !sig) return false;
  const exp = "sha256=" + crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(sig)); } catch { return false; }
}
function onInbound(msg, contact) {
  const waId = msg.from;
  const name = (contact && contact.profile && contact.profile.name) || "";
  const text = msg.text ? msg.text.body : (msg.button ? msg.button.text : (msg.interactive ? JSON.stringify(msg.interactive).slice(0, 200) : "[" + msg.type + "]"));
  const t0 = getThread(waId);
  const t = pushMsg(waId, { id: msg.id, dir: "in", type: msg.type, text, ts: (+msg.timestamp || Math.floor(now() / 1000)) * 1000, status: "read" });
  if (name && !t.name) upsertThread(waId, { name });
  bumpStat("replies");
  // STOP/Abmelden → permanenter Opt-out
  if (/^\s*(stop+|stopp+|abmelden|abbestellen|unsubscribe|keine?\s+(nachrichten|werbung))\s*[.!]*\s*$/i.test(String(text))) {
    addOptOut(waId); notify("🟢 WA Opt-out", (name || "+" + waId) + " hat sich abgemeldet.");
    return;
  }
  cancelPending(waId, ["followup_template", "nudge", "first_contact"]); // Cancel-on-Reply
  campaignMark(waId, "replied");
  crmUpsert(waId, name || (t0 && t0.name), { replied: true, geantwortetAm: today() });
  markRead(msg.id);
  const th = getThread(waId);
  if (th && th.mode === "ai" && th.campaignId && !isPaused()) queueReply(waId);
  else if (!t0 || !(t0.messages || []).some((m) => m.dir === "in")) notify("💬 WhatsApp-Antwort", (name || "+" + waId) + ": " + String(text).slice(0, 120));
}
function onStatus(st) {
  const d = threadsAll(); let hit = false;
  for (const t of d.threads) { if (t.waId !== st.recipient_id) continue; for (const m of t.messages) if (m.id === st.id && m.status !== st.status) { m.status = st.status; if (st.errors) m.error = JSON.stringify(st.errors).slice(0, 300); hit = true; } }
  if (hit) saveJ(F.threads, d);
  if (st.status === "failed") notify("🟢 WA Zustellfehler", "+" + st.recipient_id + ": " + JSON.stringify(st.errors || {}).slice(0, 200));
}
function onTemplateUpdate(v) {
  const cache = loadJ(F.templates, { templates: [] });
  const t = cache.templates.find((x) => x.name === v.message_template_name || String(x.id) === String(v.message_template_id));
  if (t) { t.status = v.event === "APPROVED" ? "APPROVED" : v.event === "REJECTED" ? "REJECTED" : (v.event || t.status); t.rejectedReason = v.reason || t.rejectedReason || ""; saveJ(F.templates, cache); }
  if (v.event === "REJECTED") notify("🟢 WA Template abgelehnt", (v.message_template_name || "?") + " · Grund: " + (v.reason || "unbekannt"));
  if (v.event === "APPROVED") tick("template-approved").catch(() => {});
}
function handleWebhookPost(req, res) {
  return readRaw(req, (raw) => {
    if (!hmacOk(raw, req.headers["x-hub-signature-256"])) return send(res, 403, "text/plain", "bad signature");
    sendJ(res, 200, { ok: true }); // sofort 200 — alles Weitere asynchron
    let body; try { body = JSON.parse(raw); } catch { return; }
    appendEvent({ webhook: body });
    try {
      for (const entry of (body.entry || [])) for (const ch of (entry.changes || [])) {
        const v = ch.value || {};
        if (ch.field === "message_template_status_update") { onTemplateUpdate(v); continue; }
        const contacts = v.contacts || [];
        for (const m of (v.messages || [])) onInbound(m, contacts.find((c) => c.wa_id === m.from) || contacts[0]);
        for (const s of (v.statuses || [])) onStatus(s);
      }
    } catch (e) { appendEvent({ error: String(e) }); }
  });
}

// ---------- AI-Setter (Antwort-Queue mit Debounce, ein Claude-Prozess seriell) ----------
const aiTimers = {}; const aiQueue = []; let aiBusy = false;
function queueReply(waId) {
  clearTimeout(aiTimers[waId]);
  aiTimers[waId] = setTimeout(() => { delete aiTimers[waId]; if (!aiQueue.includes(waId)) aiQueue.push(waId); pumpAi(); }, 90 * 1000);
}
function findClaude() {
  const HOME = process.env.HOME || "";
  const c = [process.env.CLAUDE_BIN, path.join(HOME, ".claude/local/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch {} }
  try { const dir = path.join(HOME, "Library/Application Support/Claude/claude-code"); const vers = fs.readdirSync(dir).sort().reverse(); for (const v of vers) { const p = path.join(dir, v, "claude.app/Contents/MacOS/claude"); if (fs.existsSync(p)) return p; } } catch {}
  try { return execSync("command -v claude", { shell: "/bin/zsh" }).toString().trim() || null; } catch { return null; }
}
function claudeText(prompt, opts, cb) {
  const bin = findClaude(); if (!bin) return cb(new Error("claude CLI nicht gefunden"));
  const args = ["-p", prompt, "--model", (opts && opts.model) || agentCfg().model || "claude-sonnet-4-6", "--max-turns", "4"];
  execFile(bin, args, { timeout: (opts && opts.timeout) || 180000, maxBuffer: 4 * 1024 * 1024, cwd: ROOT }, (err, stdout) => cb(err, String(stdout || "").trim()));
}
function transcript(t, limit) {
  return (t.messages || []).slice(-(limit || 40)).map((m) => {
    const when = new Date(m.ts).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
    return (m.dir === "in" ? "LEAD" : "ICH") + " [" + when + "]: " + (m.text || "[" + (m.type || "?") + "]");
  }).join("\n");
}
// Pro-Kampagne konfigurierbare Agent-Felder (aus der Agent-Tab-UI) in einen Prompt-Block gießen.
function agentBlock(camp) {
  const a = (camp && camp.agent) || {}; const lines = [];
  if (a.goalType === "verkauf") lines.push("Ziel-Typ: DIREKTVERKAUF. Führe das Gespräch zum Angebot/Abschluss von: " + (a.goal || "dem Produkt") + ". Kein Termin nötig, wenn der Lead direkt kaufen will.");
  else lines.push("Ziel-Typ: TERMIN. Ziel = " + (a.goal || "einen kurzen Call vereinbaren") + ". Nutze die DM-Setter-Skills (Zwei-Optionen-Terminfrage mit konkreten Slots, saubere Einwandbehandlung).");
  if (a.promptExtra) lines.push("Zusätzliche Instructions: " + a.promptExtra);
  if (a.calendarId) lines.push("Kalender für Terminbuchung: " + a.calendarId + " (Buchung erfolgt aktuell manuell nach Übergabe — schlage konkrete Slots vor).");
  if (a.acceptHours) lines.push("Termine nur in diesem Zeitfenster anbieten: " + a.acceptHours);
  if (a.handoverRules) lines.push("Übergabe an der Nutzer (action=handoff) wenn: " + a.handoverRules);
  return "\n\n---\n## Agent-Konfiguration dieser Kampagne\n" + lines.map((l) => "- " + l).join("\n");
}
function buildSetterPrompt(t, camp) {
  let base = ""; try { base = fs.readFileSync(path.join(AGENT, "agent.md"), "utf8"); } catch {}
  let playbook = ""; if (camp && camp.agentPlaybook) { try { playbook = fs.readFileSync(path.join(ROOT, camp.agentPlaybook), "utf8"); } catch {} }
  return base +
    "\n\n---\n## Kampagnen-Playbook\n" + (playbook || "(kein Playbook — Standard-Setter-Verhalten)") +
    agentBlock(camp) +
    "\n\n---\n## Lead\nName: " + (t.name || "unbekannt") + "\nNummer: +" + t.waId + (camp ? "\nKampagne: " + camp.name : "") +
    "\n\n## Chat-Verlauf (CHAT = WAHRHEIT — antworte NUR auf das, was hier steht)\n" + transcript(t) +
    "\n\n---\nAntworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Markdown drumherum:\n" +
    '{"action":"reply|handoff|stop","text":"<deine WhatsApp-Antwort, locker, kurz, klingt nach der Nutzer, KEINE Gedankenstriche>","classification":"A|B|C|D|E","label":"interested|meeting-booked|not-interested|auto-reply|ooo","booked":false}\n' +
    'action=handoff wenn du unsicher bist, der Lead sauer ist oder etwas Komplexes will. action=stop wenn der Lead klar NEIN sagt. booked=true nur wenn ein konkreter Termin fix vereinbart wurde. label = deine Einschätzung, wo der Lead gerade steht.';
}
function pumpAi() {
  if (aiBusy || !aiQueue.length) return;
  const waId = aiQueue.shift(); aiBusy = true;
  const finish = () => { aiBusy = false; setTimeout(pumpAi, 1000); };
  try {
    const t = getThread(waId); if (!t || t.mode !== "ai" || t.optOut || isPaused()) return finish();
    const last = t.messages[t.messages.length - 1]; if (!last || last.dir !== "in") return finish(); // schon beantwortet
    const camp = t.campaignId ? campaignById(t.campaignId) : null;
    claudeText(buildSetterPrompt(t, camp), { model: agentCfg().model, timeout: 180000 }, async (err, out) => {
      try {
        if (err) throw new Error("claude: " + String(err.message || err).slice(0, 200));
        const m = out.match(/\{[\s\S]*\}/); if (!m) throw new Error("kein JSON in Antwort");
        const r = JSON.parse(m[0]);
        logRun(waId, t.name, r);
        if (r.label) upsertThread(waId, { label: String(r.label).slice(0, 40) });
        if (r.action === "stop") { upsertThread(waId, { mode: "manual", needsHuman: false, label: "not-interested" }); campaignMark(waId, "no"); crmUpsert(waId, t.name, { lost: true }); }
        else if (r.action === "handoff" || !r.text) { upsertThread(waId, { needsHuman: true }); notify("🖐 WA Übergabe", (t.name || "+" + waId) + " braucht dich: " + String((t.messages.slice(-1)[0] || {}).text || "").slice(0, 120)); }
        else {
          const g = gate(waId, "ai"); if (!g.ok) { upsertThread(waId, { needsHuman: true }); notify("🖐 WA Übergabe", "+" + waId + " — Gate: " + g.reason); }
          else {
            const clean = String(r.text).replace(/[—–]/g, ",").trim(); // Nie Gedankenstriche in Outbound
            await sendText(waId, clean, { by: "ai" });
            if (r.booked) { upsertThread(waId, { label: "meeting-booked" }); campaignMark(waId, "booked"); crmUpsert(waId, t.name, { settingBooked: true, terminAm: today() }); bumpStat("booked"); notify("🎉 WA Termin!", (t.name || "+" + waId) + " hat einen Termin vereinbart 🔔"); }
          }
        }
      } catch (e) {
        upsertThread(waId, { needsHuman: true });
        notify("🖐 WA Übergabe", "+" + waId + " — AI-Fehler: " + String(e.message || e).slice(0, 150));
      }
      finish();
    });
  } catch (e) { appendEvent({ aiError: String(e) }); finish(); }
}
function logRun(waId, name, r) {
  try {
    const f = path.join(AGENT, "runs", today() + ".md");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, "- " + new Date().toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin" }) + " · " + (name || "+" + waId) + " · " + (r.classification || "?") + " · " + (r.action || "?") + (r.booked ? " · 🎉 TERMIN" : "") + "\n");
  } catch {}
}

// ---------- Dynamische Follow-up-Templates (Phase 6) ----------
function fuTemplateName(campaignId, waId) {
  const h = crypto.createHash("sha1").update(waId).digest("hex").slice(0, 6);
  return ("fu_" + (campaignId || "solo").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 18) + "_" + h + "_" + today().replace(/-/g, "")).slice(0, 512);
}
function generateFollowup(waId, cb) {
  const t = getThread(waId); if (!t) return cb(new Error("Thread fehlt"));
  if ((t.followupsSent || 0) >= maxFu(t)) return cb(new Error("Follow-up-Budget (max " + maxFu(t) + ") ausgeschöpft"));
  const camp = t.campaignId ? campaignById(t.campaignId) : null;
  const prompt = "Du schreibst für der Nutzer (dein Business) ein WhatsApp-Reaktivierungs-Follow-up als Meta-Template.\n" +
    "Kontext-Chat:\n" + transcript(t, 20) + "\n\n" +
    (camp && camp.agentPlaybook ? "Kampagne: " + camp.name + "\n" : "") +
    "Regeln: locker, kurz (2-3 Sätze), knüpft KONKRET an das letzte Thema im Chat an, weicher CTA, KEINE Gedankenstriche, keine Bullets. " +
    "{{1}} = Vorname des Leads. Antworte NUR mit JSON: {\"body\":\"...{{1}}...\",\"example\":[\"" + ((t.name || "Max").split(" ")[0]) + "\"]}";
  claudeText(prompt, { model: "claude-haiku-4-5", timeout: 120000 }, async (err, out) => {
    if (err) return cb(err);
    try {
      const m = out.match(/\{[\s\S]*\}/); if (!m) throw new Error("kein JSON");
      const r = JSON.parse(m[0]);
      const body = String(r.body || "").replace(/[—–]/g, ",").trim(); if (!body) throw new Error("leerer Body");
      const name = fuTemplateName(t.campaignId, waId);
      await createTemplate({ name, language: wcfg().defaultLanguage, category: "MARKETING", bodyText: body, exampleParams: r.example || [(t.name || "Max").split(" ")[0]], footer: "Antworte STOP, wenn du keine Nachrichten mehr willst." });
      enqueue({ waId, campaignId: t.campaignId, kind: "followup_template", templateName: name, params: [(t.name || "").split(" ")[0] || "du"], dueAt: now() + 2 * 86400000, requiresTemplateApproved: true });
      cb(null, { template: name, body, dueInDays: 2 });
    } catch (e) { cb(e); }
  });
}
function maxFu(t) {
  const c = t.campaignId ? campaignById(t.campaignId) : null;
  if (c && Array.isArray(c.sequence) && c.sequence.length > 1) return c.sequence.length - 1; // Step 0 = Erstkontakt, Rest = Follow-ups
  return (c && c.maxFollowups) || 2;
}
// Erstkontakt-Template einer Kampagne (Sequence-Step 0 hat Vorrang, sonst legacy c.template.name)
function firstTpl(cp) { return (cp && Array.isArray(cp.sequence) && cp.sequence[0] && cp.sequence[0].templateName) || (cp && cp.template && cp.template.name) || ""; }
// Nächster Follow-up-Step aus der Sequence (idx = wieviele Follow-ups schon raus). Rückgabe {templateName, waitDays} oder null.
function seqFollowup(cp, followupsSent) { const step = cp && Array.isArray(cp.sequence) && cp.sequence[(followupsSent || 0) + 1]; return step && step.templateName ? { templateName: step.templateName, waitDays: step.waitDays != null ? step.waitDays : 2 } : null; }

// ---------- Scheduler-Tick ----------
let tickRunning = false, lastTemplateSync = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tick(trigger) {
  if (tickRunning) return { ok: false, reason: "running" };
  tickRunning = true;
  const rep = { trigger: trigger || "interval", sent: 0, scheduled: 0, skipped: [], waitingApproval: 0 };
  try {
    const c = wcfg(); const cfgA = agentCfg();
    if (!c.phoneNumberId || !envVal("WA_ACCESS_TOKEN")) { rep.skipped.push("nicht konfiguriert"); return rep; }
    const ob = outboxAll();
    const needSync = ob.queue.some((q) => q.status === "pending" && q.requiresTemplateApproved) || loadJ(F.templates, { templates: [] }).templates.some((t) => t.status === "PENDING");
    if (needSync && now() - lastTemplateSync > 10 * 60 * 1000) { try { await syncTemplates(); lastTemplateSync = now(); } catch (e) { rep.skipped.push("template-sync: " + e.message); } }

    // 1) Fällige Outbox-Entries senden (max 5 pro Tick, 60-180s Spacing)
    const due = outboxAll().queue.filter((q) => q.status === "pending" && q.dueAt <= now()).slice(0, 5);
    for (const q of due) {
      const fresh = outboxAll().queue.find((x) => x.id === q.id); if (!fresh || fresh.status !== "pending") continue;
      if (q.requiresTemplateApproved) {
        const tpl = templateByName(q.templateName);
        if (!tpl || tpl.status === "PENDING") { rep.waitingApproval++; continue; }
        if (tpl.status === "REJECTED") { markOutbox(q.id, "failed", "Template REJECTED: " + (tpl.rejectedReason || "")); if (q.kind === "followup_template" && !q.retried) { markOutboxField(q.id, "retried", true); generateFollowup(q.waId, (e) => { if (e) notify("🟢 WA Follow-up", "+" + q.waId + " Regeneration fehlgeschlagen: " + e.message); }); } continue; }
      }
      const th = getThread(q.waId);
      if (q.kind !== "first_contact" && th && th.messages.length && th.messages[th.messages.length - 1].dir === "in") { markOutbox(q.id, "canceled", "Lead hat geantwortet"); continue; }
      const g = gate(q.waId, q.kind); if (!g.ok) { if (["optout", "freunde-blocklist"].includes(g.reason)) markOutbox(q.id, "canceled", g.reason); else rep.skipped.push(q.id + ":" + g.reason); continue; }
      try {
        if (q.templateName) await sendTemplate(q.waId, q.templateName, null, q.params || [], { by: "campaign", kind: q.kind, campaignId: q.campaignId });
        else await sendText(q.waId, q.text || "", { by: "campaign", kind: q.kind, campaignId: q.campaignId });
        markOutbox(q.id, "sent");
        rep.sent++;
        if (q.kind === "first_contact") { campaignMark(q.waId, "sent"); crmUpsert(q.waId, (getThread(q.waId) || {}).name, { contacted: true, kontaktiertAm: today() }); addKnown(q.waId); }
        if (q.kind === "followup_template" || q.kind === "nudge") { const t2 = getThread(q.waId); upsertThread(q.waId, { followupsSent: (t2 && t2.followupsSent || 0) + 1 }); bumpStat("followups"); }
        const [a, b] = [cfgA.limits.delaySecMin || 60, cfgA.limits.delaySecMax || 180];
        await sleep((a + Math.random() * (b - a)) * 1000);
      } catch (e) {
        const fresh2 = outboxAll(); const qq = fresh2.queue.find((x) => x.id === q.id);
        if (qq) { qq.attempts = (qq.attempts || 0) + 1; qq.lastError = String(e.message || e).slice(0, 250); if (qq.attempts >= 3) { qq.status = "failed"; notify("🟢 WA Sendefehler", "+" + q.waId + ": " + qq.lastError); } saveJ(F.outbox, fresh2); }
      }
    }

    // 2) Refill: aktive Kampagnen → Tagesquote in die Outbox
    const camps = campaignsAll();
    for (const cp of camps.campaigns) {
      if (cp.status !== "active") continue;
      if (!campaignScheduleOpen(cp)) { rep.skipped.push(cp.id + ": außerhalb Kampagnen-Sendefenster"); continue; }
      const firstName = firstTpl(cp);
      const tpl = firstName && templateByName(firstName);
      if (!tpl || tpl.status !== "APPROVED") { rep.skipped.push(cp.id + ": Erstkontakt-Template nicht APPROVED"); continue; }
      const sentTodayN = (cp.contacts || []).filter((k) => k.sentAt && String(k.sentAt).slice(0, 10) === today()).length;
      const pendingN = outboxAll().queue.filter((q) => q.campaignId === cp.id && q.kind === "first_contact" && q.status === "pending").length;
      let slots = Math.max(0, (cp.dailyLimit || 10) - sentTodayN - pendingN);
      const pmap = (cp.template && cp.template.paramMap) || ["name"];
      for (const k of (cp.contacts || [])) {
        if (!slots) break; if (k.status !== "queued") continue;
        const params = pmap.map((field) => field === "name" ? (k.name.split(" ")[0] || "du") : field === "company" ? (k.company || "") : (k.vars && k.vars[field]) || "");
        enqueue({ waId: k.phone, campaignId: cp.id, kind: "first_contact", templateName: firstName, params, dueAt: now(), requiresTemplateApproved: true });
        k.status = "scheduled"; k.sentAt = new Date().toISOString(); slots--; rep.scheduled++;
        upsertThread(k.phone, { name: k.name || "", campaignId: cp.id, mode: cp.autoReply === false ? "manual" : "ai" });
      }
      saveCampaign(cp);
    }

    // 3) Follow-ups planen: Erstkontakt gesendet, keine Antwort, Fenster zu, Budget frei, nichts pending
    const thr = threadsAll();
    for (const t of thr.threads) {
      if (!t.campaignId || t.optOut) continue;
      const lastOut = [...t.messages].reverse().find((m) => m.dir === "out");
      const everIn = t.messages.some((m) => m.dir === "in");
      if (!lastOut || everIn) continue; // Antworten laufen über den AI-Setter, nicht über Kalt-Follow-ups
      if ((t.followupsSent || 0) >= maxFu(t)) continue;
      const camp = campaignById(t.campaignId);
      if (camp && !campaignScheduleOpen(camp)) continue;
      // Sequence-Step hat Vorrang (mit eigenen Wartetagen); sonst legacy followupTemplates/AI-Follow-up (2 Tage).
      const seq = camp && seqFollowup(camp, t.followupsSent || 0);
      const staticFu = !seq && camp && Array.isArray(camp.followupTemplates) && camp.followupTemplates[t.followupsSent || 0];
      const waitMs = (seq ? seq.waitDays : 2) * 86400000;
      if (now() - lastOut.ts < waitMs) continue;
      const pend = outboxAll().queue.some((q) => q.waId === t.waId && q.status === "pending");
      if (pend) continue;
      const fuName = seq ? seq.templateName : staticFu;
      if (fuName) enqueue({ waId: t.waId, campaignId: t.campaignId, kind: "followup_template", templateName: fuName, params: [(t.name || "").split(" ")[0] || "du"], dueAt: now(), requiresTemplateApproved: true });
      else generateFollowup(t.waId, (e, r) => { if (e) appendEvent({ fuError: t.waId + ": " + e.message }); else appendEvent({ fuScheduled: r }); });
      rep.scheduled++;
      await sleep(500);
    }

    // 4) Nudges im 24h-Fenster: Lead hat geantwortet, ist jetzt still. Kadenz pro Kampagne
    //    (agent.nudgeStepsHours = Stunden nach UNSERER letzten Nachricht, je Step ein Nudge),
    //    sonst Fallback: 1 Nudge, wenn >6h still UND Fenster schließt in <4h.
    for (const t of threadsAll().threads) {
      if (t.mode !== "ai" || t.optOut || !t.windowOpenedAt || !windowOpen(t)) continue;
      const last = t.messages[t.messages.length - 1];
      if (!last || last.dir !== "out") continue; // nur wenn WIR zuletzt geschrieben haben (Lead ist still)
      const camp = t.campaignId ? campaignById(t.campaignId) : null;
      const steps = (camp && camp.agent && Array.isArray(camp.agent.nudgeStepsHours) && camp.agent.nudgeStepsHours.length) ? camp.agent.nudgeStepsHours.slice().sort((a, b) => a - b) : null;
      if (t.nudgeWindow !== t.windowOpenedAt) { upsertThread(t.waId, { nudgeWindow: t.windowOpenedAt, windowNudges: 0 }); t.windowNudges = 0; } // neues Fenster → Zähler zurücksetzen
      const hoursSilent = (now() - last.ts) / 3600000;
      let due;
      if (steps) due = steps.filter((h) => hoursSilent >= h).length;
      else { const rest = t.windowOpenedAt + 24 * 3600000 - now(); due = (hoursSilent >= 6 && rest <= 4 * 3600000) ? 1 : 0; }
      const already = t.windowNudges || 0;
      if (already >= due) continue;
      if (steps && already >= steps.length) continue;
      const g = gate(t.waId, "nudge"); if (!g.ok) continue;
      const vn = (t.name || "").split(" ")[0];
      const lines = ["Hey" + (vn ? " " + vn : "") + ", wie siehts aus bei dir? 🙂", "Hey" + (vn ? " " + vn : "") + ", kurz nachgehakt: passt das Thema für dich?", (vn || "Hey") + ", noch Interesse? Dann machen wir kurz was aus."];
      try {
        await sendText(t.waId, lines[already % lines.length], { by: "nudge" });
        upsertThread(t.waId, { windowNudges: already + 1, nudgeWindow: t.windowOpenedAt });
        bumpStat("followups"); rep.sent++;
      } catch (e) { appendEvent({ nudgeError: t.waId + ": " + String(e.message || e) }); }
    }

    // 5) Reaktivierung nach Fensterschluss: Lead hat geantwortet, wurde still, 24h-Fenster ist ZU →
    //    optional (agent.reactivateAfterWindow) ein personalisiertes Template aus dem Verlauf einreichen
    //    und senden, sobald genehmigt (nutzt generateFollowup, +2 Tage Approval-Puffer).
    for (const t of threadsAll().threads) {
      if (t.mode !== "ai" || t.optOut || !t.campaignId || windowOpen(t)) continue;
      const camp = campaignById(t.campaignId);
      if (!camp || !camp.agent || !camp.agent.reactivateAfterWindow) continue;
      if (!t.messages.some((m) => m.dir === "in")) continue; // nur Leads, die mal geantwortet haben
      const last = t.messages[t.messages.length - 1];
      if (!last || last.dir !== "out") continue;
      if ((t.followupsSent || 0) >= maxFu(t)) continue;
      if (t.reactivatedWindow === t.windowOpenedAt) continue; // pro Fenster nur einmal
      if (outboxAll().queue.some((q) => q.waId === t.waId && q.status === "pending")) continue;
      upsertThread(t.waId, { reactivatedWindow: t.windowOpenedAt });
      generateFollowup(t.waId, (e, r) => { if (e) appendEvent({ reactError: t.waId + ": " + e.message }); else appendEvent({ reactScheduled: r }); });
      rep.scheduled++;
      await sleep(500);
    }
  } catch (e) { rep.error = String(e.message || e); appendEvent({ tickError: rep.error }); }
  finally { tickRunning = false; }
  return rep;
}
function markOutbox(id, status, err) { const d = outboxAll(); const q = d.queue.find((x) => x.id === id); if (q) { q.status = status; if (err) q.lastError = err; saveJ(F.outbox, d); } }
function markOutboxField(id, k, v) { const d = outboxAll(); const q = d.queue.find((x) => x.id === id); if (q) { q[k] = v; saveJ(F.outbox, d); } }
function addKnown(waId) {
  const t = getThread(waId); if (!t || !t.name) return;
  try { spawn("node", [path.join(__dirname, "known-contacts.js"), "add", t.name, "wa:" + waId], { detached: true, stdio: "ignore" }).unref(); } catch {}
}
function startTick() { setInterval(() => { tick("interval").catch(() => {}); }, 5 * 60 * 1000); }

// ---------- Lead-Panel-Daten (für die Inbox-Detailansicht) ----------
function leadByWaId(waId) {
  const crm = loadJ(path.join(DATA, "leads.json"), { leads: [] });
  const id = "wa:" + waId;
  let l = (crm.leads || []).find((x) => x.url === id);
  if (!l) l = (crm.leads || []).find((x) => { const m = String(x.contactInfo || "").match(/\+?[0-9][0-9 \/-]{7,}/); return m && e164(m[0]) === waId; });
  if (!l) return null;
  return { name: l.name || "", company: l.company || "", location: l.location || "", category: l.category || "", status: l.status || "", icebreaker: l.icebreaker || "", contactInfo: l.contactInfo || "", history: Array.isArray(l.history) ? l.history.slice(-12) : [] };
}
function nextActionFor(waId) {
  const q = outboxAll().queue.filter((x) => x.waId === waId && x.status === "pending").sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0))[0];
  if (!q) return null;
  return { kind: q.kind, templateName: q.templateName || "", dueAt: q.dueAt || 0, waitingApproval: !!q.requiresTemplateApproved };
}

// ---------- Routen ----------
function handle(req, res, u) {
  const p = u.pathname;
  // Webhook (öffentlich über Tunnel; HMAC statt Bearer)
  if (p === "/webhooks/wa") {
    if (req.method === "GET") {
      const mode = u.searchParams.get("hub.mode"), tok = u.searchParams.get("hub.verify_token"), ch = u.searchParams.get("hub.challenge");
      if (mode === "subscribe" && tok && tok === envVal("WA_VERIFY_TOKEN")) return send(res, 200, "text/plain", ch || "");
      return send(res, 403, "text/plain", "forbidden");
    }
    if (req.method === "POST") return handleWebhookPost(req, res);
    return send(res, 405, "text/plain", "method");
  }
  // Einstellungen (generisch, erweiterbar)
  if (p === "/api/settings" && req.method === "GET") {
    const s = settings(); const secrets = {};
    for (const k of SECRET_KEYS) secrets[k] = envVal(k) ? MASK : "";
    return sendJ(res, 200, { ok: true, settings: s, secrets });
  }
  if (p === "/api/settings" && req.method === "POST") {
    return readBody(req, (b) => {
      try {
        for (const k of SECRET_KEYS) { const v = b.secrets && b.secrets[k]; if (v && v !== MASK && !/^[•*]+$/.test(v)) envSet(k, v); } // merge-on-change: Maske/leer überschreibt NIE
        if (b.settings && (b.settings.whatsapp || b.settings.smtp)) {
          const s = loadJ(F.settings, {});
          if (b.settings.whatsapp) s.whatsapp = Object.assign({}, DEFAULTS.whatsapp, s.whatsapp || {}, b.settings.whatsapp);
          if (b.settings.smtp) s.smtp = Object.assign({}, DEFAULTS.smtp, s.smtp || {}, b.settings.smtp);
          saveJ(F.settings, s);
        }
        sendJ(res, 200, { ok: true });
      } catch (e) { sendJ(res, 500, { ok: false, error: String(e.message || e) }); }
    });
  }
  if (p === "/api/wa/test-connection") {
    (async () => {
      const c = wcfg();
      const num = await graph("GET", c.phoneNumberId + "?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,code_verification_status");
      let waba = null; try { waba = await graph("GET", c.wabaId + "?fields=name,account_review_status"); } catch {}
      sendJ(res, 200, { ok: true, number: num, waba });
    })().catch((e) => sendJ(res, 200, { ok: false, error: String(e.message || e) }));
    return true;
  }
  // Inbox
  if (p === "/api/wa/threads") {
    const d = threadsAll();
    const list = d.threads.map((t) => {
      const last = t.messages[t.messages.length - 1] || {};
      return { waId: t.waId, name: t.name, campaignId: t.campaignId, mode: t.mode, optOut: t.optOut, needsHuman: t.needsHuman, label: t.label || "", unread: t.unread || 0, windowOpenedAt: t.windowOpenedAt, windowOpen: windowOpen(t), lastText: (last.text || "").slice(0, 90), lastTs: last.ts || 0, lastDir: last.dir || "" };
    }).sort((a, b) => b.lastTs - a.lastTs);
    return sendJ(res, 200, { ok: true, threads: list, sentToday: sentToday(), cap: wcfg().globalDailyCap });
  }
  if (p === "/api/wa/thread") {
    const waId = u.searchParams.get("waId"); const t = getThread(waId);
    if (!t) return sendJ(res, 404, { ok: false });
    upsertThread(waId, { unread: 0, needsHuman: false });
    return sendJ(res, 200, { ok: true, thread: t, windowOpen: windowOpen(t), maxFollowups: maxFu(t), lead: leadByWaId(waId), nextAction: nextActionFor(waId) });
  }
  if (p === "/api/wa/send" && req.method === "POST") {
    return readBody(req, (b) => {
      (async () => {
        const waId = e164(b.waId) || String(b.waId || "");
        const t = getThread(waId);
        if (!windowOpen(t)) return sendJ(res, 409, { ok: false, error: "24h-Fenster zu. Nutze ein Follow-up-Template (Button im Thread)." });
        const g = gate(waId, "manual"); if (!g.ok) return sendJ(res, 409, { ok: false, error: "Gate: " + g.reason });
        const id = await sendText(waId, String(b.text || "").slice(0, 4000), { by: "manual" });
        sendJ(res, 200, { ok: true, id });
      })().catch((e) => sendJ(res, 500, { ok: false, error: String(e.message || e) }));
    });
  }
  if (p === "/api/wa/thread-update" && req.method === "POST") {
    return readBody(req, (b) => {
      const t = getThread(String(b.waId || "")); if (!t) return sendJ(res, 404, { ok: false });
      const patch = {};
      if (b.mode === "ai" || b.mode === "manual") patch.mode = b.mode;
      if (typeof b.name === "string") patch.name = b.name;
      if (typeof b.campaignId === "string" || b.campaignId === null) patch.campaignId = b.campaignId || null;
      if (b.optOut === true) { addOptOut(t.waId); return sendJ(res, 200, { ok: true, optOut: true }); }
      upsertThread(t.waId, patch);
      return sendJ(res, 200, { ok: true });
    });
  }
  // Neuen Chat manuell starten (nur Template möglich, wenn kein Fenster offen)
  if (p === "/api/wa/start-chat" && req.method === "POST") {
    return readBody(req, (b) => {
      (async () => {
        const waId = e164(b.phone); if (!waId) return sendJ(res, 400, { ok: false, error: "Ungültige Nummer" });
        const g = gate(waId, "manual"); if (!g.ok) return sendJ(res, 409, { ok: false, error: "Gate: " + g.reason });
        upsertThread(waId, { name: b.name || "" });
        const id = await sendTemplate(waId, b.templateName, b.language, b.params || [], { by: "manual" });
        crmUpsert(waId, b.name, { contacted: true, kontaktiertAm: today() });
        sendJ(res, 200, { ok: true, id });
      })().catch((e) => sendJ(res, 500, { ok: false, error: String(e.message || e) }));
    });
  }
  // Templates
  if (p === "/api/wa/templates") {
    if (u.searchParams.get("sync") === "1") { syncTemplates().then((c) => sendJ(res, 200, { ok: true, templates: c.templates })).catch((e) => sendJ(res, 200, { ok: false, error: String(e.message || e), templates: loadJ(F.templates, { templates: [] }).templates })); return true; }
    return sendJ(res, 200, { ok: true, templates: loadJ(F.templates, { templates: [] }).templates });
  }
  if (p === "/api/wa/template-create" && req.method === "POST") {
    return readBody(req, (b) => {
      createTemplate({ name: String(b.name || "").toLowerCase().replace(/[^a-z0-9_]/g, "_"), language: b.language, category: b.category, bodyText: String(b.bodyText || ""), exampleParams: b.exampleParams, footer: b.footer })
        .then((j) => sendJ(res, 200, { ok: true, id: j.id, status: j.status }))
        .catch((e) => sendJ(res, 500, { ok: false, error: String(e.message || e) }));
    });
  }
  if (p === "/api/wa/template-delete" && req.method === "POST") {
    return readBody(req, (b) => {
      graph("DELETE", wcfg().wabaId + "/message_templates?name=" + encodeURIComponent(b.name))
        .then(() => { const c = loadJ(F.templates, { templates: [] }); c.templates = c.templates.filter((t) => t.name !== b.name); saveJ(F.templates, c); sendJ(res, 200, { ok: true }); })
        .catch((e) => sendJ(res, 500, { ok: false, error: String(e.message || e) }));
    });
  }
  // Kampagnen
  if (p === "/api/wa/campaigns") return sendJ(res, 200, Object.assign({ ok: true }, campaignsAll()));
  if (p === "/api/wa/campaign-save" && req.method === "POST") {
    return readBody(req, (b) => {
      const c = b.campaign || {};
      if (!c.id) c.id = "cmp-" + today() + "-" + crypto.randomBytes(3).toString("hex");
      if (!c.createdAt) c.createdAt = new Date().toISOString();
      if (!c.status) c.status = "draft";
      if (c.maxFollowups == null) c.maxFollowups = 2;
      saveCampaign(c); sendJ(res, 200, { ok: true, id: c.id });
    });
  }
  if (p === "/api/wa/campaign-action" && req.method === "POST") {
    return readBody(req, (b) => {
      const c = campaignById(String(b.id || "")); if (!c) return sendJ(res, 404, { ok: false });
      if (b.action === "start") c.status = "active";
      else if (b.action === "pause") c.status = "paused";
      else if (b.action === "archive") c.status = "done";
      saveCampaign(c);
      if (b.action === "start") tick("campaign-start").catch(() => {});
      sendJ(res, 200, { ok: true, status: c.status });
    });
  }
  if (p === "/api/wa/campaign-import-csv" && req.method === "POST") {
    return readBody(req, (b) => {
      const c = campaignById(String(b.id || "")); if (!c) return sendJ(res, 404, { ok: false, error: "Kampagne fehlt" });
      const rows = parseCsv(String(b.csv || "")); if (!rows.length) return sendJ(res, 400, { ok: false, error: "CSV leer / nicht lesbar" });
      sendJ(res, 200, Object.assign({ ok: true }, intakeContacts(c, rows)));
    });
  }
  if (p === "/api/wa/campaign-import-crm" && req.method === "POST") {
    return readBody(req, (b) => {
      const c = campaignById(String(b.id || "")); if (!c) return sendJ(res, 404, { ok: false, error: "Kampagne fehlt" });
      const crm = loadJ(path.join(DATA, "leads.json"), { leads: [] });
      const f = b.filter || {};
      let cand = (crm.leads || []).filter((l) => (!f.status || l.status === f.status) && (!f.category || l.category === f.category) && (!f.platform || l.platform === f.platform));
      const rows = [];
      let noPhone = 0;
      for (const l of cand) {
        const m = String(l.contactInfo || "").match(/\+?[0-9][0-9 \/-]{7,}/);
        if (!m || !e164(m[0])) { noPhone++; continue; }
        rows.push({ phone: m[0], name: l.name || "", company: l.company || "", vars: {} });
      }
      const r = rows.length ? intakeContacts(c, rows) : { added: 0, blocked: 0, total: 0 };
      sendJ(res, 200, Object.assign({ ok: true, candidates: cand.length, noPhone }, r));
    });
  }
  // Kampagnen-Statistik (Analytics-Tab)
  if (p === "/api/wa/campaign-stats") {
    const c = campaignById(u.searchParams.get("id") || ""); if (!c) return sendJ(res, 404, { ok: false });
    const contacts = c.contacts || [];
    const contacted = contacts.filter((k) => ["sent", "scheduled", "replied", "booked", "optout", "no"].includes(k.status)).length;
    const thr = threadsAll().threads.filter((t) => t.campaignId === c.id);
    let delivered = 0, read = 0, replied = 0, booked = 0;
    for (const t of thr) {
      if (t.messages.some((m) => m.dir === "in")) replied++;
      if (t.label === "meeting-booked") booked++;
      for (const m of t.messages) if (m.dir === "out") { if (m.status === "delivered" || m.status === "read") delivered++; if (m.status === "read") read++; }
    }
    const st = c.stats || {};
    return sendJ(res, 200, { ok: true, leads: contacts.length, contacted, replied: Math.max(replied, +st.replied || 0), booked: Math.max(booked, +st.booked || 0), optout: +st.optout || 0, delivered, read, blocked: contacts.filter((k) => String(k.status).startsWith("blocked")).length, queued: contacts.filter((k) => k.status === "queued").length });
  }
  // Label eines Threads manuell setzen (Inbox)
  if (p === "/api/wa/thread-label" && req.method === "POST") {
    return readBody(req, (b) => {
      const t = getThread(String(b.waId || "")); if (!t) return sendJ(res, 404, { ok: false });
      upsertThread(t.waId, { label: String(b.label || "").slice(0, 40) });
      return sendJ(res, 200, { ok: true });
    });
  }
  // KI entwirft ein Template aus einem (gesprochenen/getippten) Brief — nur Draft, kein Meta-Submit
  if (p === "/api/wa/template-draft" && req.method === "POST") {
    return readBody(req, (b) => {
      const brief = String(b.brief || "").slice(0, 2000); if (!brief) return sendJ(res, 400, { ok: false, error: "Brief fehlt" });
      const prompt = "Du entwirfst ein WhatsApp-Marketing-Template für Meta (dein Business, Absender der Nutzer).\n" +
        "Brief von der Nutzer (frei gesprochen oder getippt): \"" + brief + "\"\n\n" +
        "Regeln: Deutsch, locker, klingt nach einem echten Menschen, KEINE Gedankenstriche, keine Bullets, 2-4 Sätze. {{1}} = Vorname des Leads (immer einbauen). Weicher CTA. Meta lehnt reine Werbefloskeln ab, also konkreter Business-Kontext.\n" +
        'Antworte NUR mit JSON: {"name":"kurz_snake_case","category":"MARKETING","bodyText":"Hey {{1}}, ...","exampleParams":["Max"],"footer":"Antworte STOP, wenn du keine Nachrichten mehr willst."}';
      claudeText(prompt, { model: "claude-haiku-4-5", timeout: 120000 }, (err, out) => {
        if (err) return sendJ(res, 500, { ok: false, error: String(err.message || err) });
        try { const m = out.match(/\{[\s\S]*\}/); const r = JSON.parse(m[0]); r.bodyText = String(r.bodyText || "").replace(/[—–]/g, ","); sendJ(res, 200, Object.assign({ ok: true }, r)); }
        catch (e) { sendJ(res, 500, { ok: false, error: "Draft nicht lesbar: " + String(e.message || e) }); }
      });
    });
  }
  // KI entwirft ein ganzes Kampagnengerüst aus einem Brief (Name, Zielgruppe, Sequence, Agent-Ziel)
  if (p === "/api/wa/campaign-draft" && req.method === "POST") {
    return readBody(req, (b) => {
      const brief = String(b.brief || "").slice(0, 2000); if (!brief) return sendJ(res, 400, { ok: false, error: "Brief fehlt" });
      const prompt = "Du entwirfst eine WhatsApp-Kampagne für dein Business (Absender der Nutzer) aus diesem Brief:\n\"" + brief + "\"\n\n" +
        "Liefere: Kampagnenname, Zielgruppen-Idee, eine Sequence aus Erstkontakt + bis zu 2 Follow-ups (je Template-Body mit {{1}}=Vorname, plus Wartetage bis zum Schritt), und ein Agent-Ziel (was der KI-Setter im Gespräch erreichen soll).\n" +
        "Regeln für die Bodies: Deutsch, locker, KEINE Gedankenstriche, keine Bullets, kurz, weicher CTA.\n" +
        'Antworte NUR mit JSON: {"name":"...","audience":"...","agentGoal":"...","steps":[{"bodyText":"Hey {{1}}, ...","waitDays":0},{"bodyText":"...","waitDays":2}]}';
      claudeText(prompt, { model: "claude-sonnet-4-6", timeout: 150000 }, (err, out) => {
        if (err) return sendJ(res, 500, { ok: false, error: String(err.message || err) });
        try { const m = out.match(/\{[\s\S]*\}/); const r = JSON.parse(m[0]); (r.steps || []).forEach((s) => { s.bodyText = String(s.bodyText || "").replace(/[—–]/g, ","); }); sendJ(res, 200, Object.assign({ ok: true }, r)); }
        catch (e) { sendJ(res, 500, { ok: false, error: "Draft nicht lesbar: " + String(e.message || e) }); }
      });
    });
  }
  // Opt-out-Liste (Options-Tab)
  if (p === "/api/wa/optout") return sendJ(res, 200, { ok: true, list: loadJ(F.optout, []) });
  // Outbox + Tick + Follow-up
  if (p === "/api/wa/outbox") return sendJ(res, 200, Object.assign({ ok: true }, outboxAll()));
  if (p === "/api/wa/tick" && req.method === "POST") { tick("manual").then((r) => sendJ(res, 200, Object.assign({ ok: true }, r))).catch((e) => sendJ(res, 500, { ok: false, error: String(e) })); return true; }
  if (p === "/api/wa/generate-followup" && req.method === "POST") {
    return readBody(req, (b) => {
      generateFollowup(String(b.waId || ""), (e, r) => e ? sendJ(res, 500, { ok: false, error: String(e.message || e) }) : sendJ(res, 200, Object.assign({ ok: true }, r)));
    });
  }
  return false; // nicht unsere Route
}

module.exports = { handle, startTick, tick };
