#!/usr/bin/env node
// starmap-model.js — aggregiert den ECHTEN AIOS-Systemzustand zu einem kuratierten
// Modell für die Star-Map-UI (Synapse-Look, "Nervensystem von oben"):
//   Jarvis (CEO, oben, dominant) · Second Brain (glühender Kern) · Abteilungen darunter.
// Gehirn-Zugriff SCOPED: jede Abteilung zieht nur ihre Wissens-Scheibe (farbige Kante).
//
// Kuratierte Topologie (feste Knoten) + LIVE-Anreicherung aus dashboard/data + agents/.
// Layout (x/y) macht das Frontend — hier nur Daten/Status/KPIs/Kanten.
//
// Nutzung:
//   node dashboard/starmap-model.js        → JSON auf stdout (Test/curl-Ersatz)
//   const { buildStarmap } = require("./starmap-model")   → server.js: GET /api/starmap
// Nur Node-Stdlib.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(__dirname, "data");
const AGENTS = path.join(ROOT, "agents");
const BRAIN = path.join(ROOT, "brain");

// Synapse-Palette (aus der Designprobe v2-synapse).
const C = {
  jarvis: "#ffcf6b", brain: "#b98bff",
  backoffice: "#3fd0c9", vertrieb: "#ffb454", marketing: "#a78bfa",
  fulfillment: "#f472b6", finanzen: "#67e8b9", technik: "#8ab6ff",
};

// --- Helfer ---------------------------------------------------------------
function readJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function tailJsonl(f, n) {
  try {
    const lines = fs.readFileSync(f, "utf8").trim().split("\n");
    return lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function today() { const d = new Date(); return d.toISOString().slice(0, 10); }
function hhmm(epochSec) {
  if (!epochSec) return null;
  return new Date(epochSec * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
function clip(s, n) { s = (s || "").toString().replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function agentStatus(id) {
  const cfg = readJson(path.join(AGENTS, id, "config.json"), {});
  const trail = path.join(AGENTS, id, "runs", `.live-${today()}.jsonl`);
  let running = false, ranToday = false;
  try { const st = fs.statSync(trail); ranToday = true; running = (Date.now() - st.mtimeMs) / 1000 < 180; } catch {}
  const enabled = cfg.enabled !== false;
  let status, activity;
  if (!enabled) { status = "aus"; activity = 0.08; }
  else if (running) { status = "läuft"; activity = 1; }
  else if (ranToday) { status = "heute gelaufen"; activity = 0.55; }
  else { status = "bereit"; activity = 0.35; }
  return { cfg, enabled, running, ranToday, status, activity };
}
function statsToday(id) { const s = readJson(path.join(AGENTS, id, "stats.json"), {}); return s[today()] || {}; }
function countMd(dir) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) n += countMd(p); else if (e.name.endsWith(".md")) n++;
    }
  } catch {}
  return n;
}
function kundenProjekte() {
  // aktive Kundenprojekte = brain/03_Projects mit Frontmatter-Tag "kunde"
  let n = 0;
  try {
    for (const f of fs.readdirSync(path.join(BRAIN, "03_Projects"))) {
      if (!f.endsWith(".md")) continue;
      const raw = fs.readFileSync(path.join(BRAIN, "03_Projects", f), "utf8");
      if (/^tags:.*\bkunde\b/m.test(raw)) n++;
    }
  } catch {}
  return n;
}

// --- Aggregation ----------------------------------------------------------
function buildStarmap() {
  const hb = readJson(path.join(DATA, "heartbeat-status.json"), {});
  const nightRuns = tailJsonl(path.join(DATA, "nightwork-runs.jsonl"), 6);
  const hbRuns = tailJsonl(path.join(DATA, "heartbeat-runs.jsonl"), 20);
  const watcher = readJson(path.join(DATA, "watcher-state.json"), {});
  const leadsRaw = readJson(path.join(DATA, "leads.json"), { leads: [] });
  const leads = Array.isArray(leadsRaw.leads) ? leadsRaw.leads : [];
  const streak = readJson(path.join(DATA, "streak.json"), {});
  const invRaw = readJson(path.join(DATA, "invoices.json"), {});
  const invoices = Array.isArray(invRaw) ? invRaw : (invRaw.invoices || []);
  const openInv = invoices.filter((i) => i && i.status && !/bezahlt|paid/i.test(i.status));

  const alex = agentStatus("outreach-alex");
  const paul = agentStatus("outreach-paul");
  const aSt = statsToday("outreach-alex"), pSt = statsToday("outreach-paul");
  const sumToday = (k) => (aSt[k] || 0) + (pSt[k] || 0);
  const nightLast = nightRuns[nightRuns.length - 1] || null;
  const hotLeads = leads.filter((l) => l.replied || l.callProposed || l.settingBooked || l.closed ||
    ["Geantwortet", "Closing", "Closed", "Call proposed"].includes(l.status)).length;
  const projekte = kundenProjekte();

  const nodes = [];
  const push = (n) => { n.color = n.color || C[n.id] || "#9fc2ff"; nodes.push(n); };

  // KERN: Jarvis (CEO, oben) + Gehirn (denkendes Zentrum)
  push({
    id: "jarvis", type: "core", label: "Jarvis", sub: "CEO · Koordination", color: C.jarvis,
    status: "online", activity: 0.65,
    kpis: [["Streak", (streak.streak || 0) + " Tage"], ["Leads", leads.length], ["Heiße Leads", hotLeads]],
    deepLink: "/#dashboard",
  });
  push({
    id: "brain", type: "brain", label: "Second Brain", sub: "das gemeinsame Wissen", color: C.brain,
    status: "gepflegt", activity: 0.6,
    kpis: [["Notizen", countMd(BRAIN)], ["Zugriff", "alle Agenten"], ["Kundenprojekte", projekte]],
    deepLink: "/#brain",
  });

  // ABTEILUNGEN (unter dem Gehirn). slice = Wissens-Scheibe (scoped).
  push({
    id: "backoffice", type: "dept", label: "Backoffice", sub: "Mail & CRM", slice: "Mails & CRM",
    status: "aktiv", activity: 0.5,
    kpis: [["Mail zuletzt", hhmm(watcher.lastMailEpoch) || "—"], ["Watcher", "alle 10 Min"]],
    deepLink: "/#inbox",
  });
  push({ id: "u-mailtriage", type: "unit", parent: "backoffice", label: "Mail-Triage", sub: "Watcher", color: C.backoffice, status: "aktiv", activity: 0.4, kpis: [["Takt", "alle 10 Min"], ["Wichtig", "→ Ping"]], deepLink: "/#inbox" });
  push({ id: "u-crminbox", type: "unit", parent: "backoffice", label: "CRM-Inbox", sub: "Mail → Lead", color: C.backoffice, status: "bereit", activity: 0.3, kpis: [["Zuordnung", "auto"], ["Quelle", "Gmail"]], deepLink: "/#inbox" });
  push({
    id: "vertrieb", type: "dept", label: "Vertrieb & Outreach", sub: "LinkedIn", slice: "Kunden & CRM",
    status: alex.running || paul.running ? "läuft" : "bereit", activity: Math.max(alex.activity, paul.activity),
    kpis: [["Erstnachr. heute", sumToday("erstnachrichten")], ["Vernetzt heute", sumToday("vernetzt")], ["InMails heute", sumToday("inmails")]],
    deepLink: "/#agents",
  });
  push({
    id: "u-alex", type: "unit", parent: "vertrieb", label: "LinkedIn · Konto A", sub: "Alex", color: C.vertrieb,
    status: alex.status, activity: alex.activity,
    kpis: [["Vernetzt heute", aSt.vernetzt || 0], ["M1 heute", aSt.erstnachrichten || 0]], deepLink: "/#agents",
  });
  push({
    id: "u-paul", type: "unit", parent: "vertrieb", label: "LinkedIn · Konto B", sub: "Paul · Warmup", color: C.vertrieb,
    status: paul.enabled ? paul.status : "aufgesetzt · aus", activity: paul.activity,
    kpis: [["Warmup", "10/5 pro Tag"], ["Status", paul.enabled ? "aktiv" : "wartet auf ICP"]], deepLink: "/#agents",
  });
  push({
    id: "marketing", type: "dept", label: "Marketing", sub: "Content & Ads", slice: "Content & Kampagnen",
    status: "bereit", activity: 0.4,
    kpis: [["Fokus", "Agenturen"], ["Kanäle", "Content · Ads"]], deepLink: "/#agents",
  });
  push({ id: "u-content", type: "unit", parent: "marketing", label: "Content", sub: "Posts & Video", color: C.marketing, status: "bereit", activity: 0.3, kpis: [["Modus", "Content-Agent"], ["Takt", "wiederkehrend"]], deepLink: "/#agents" });
  push({ id: "u-ads", type: "unit", parent: "marketing", label: "Ads", sub: "Paid", color: C.marketing, status: "bereit", activity: 0.25, kpis: [["Modus", "Ads-Agent"], ["Ziel", "Leads"]], deepLink: "/#agents" });
  push({
    id: "fulfillment", type: "dept", label: "Fulfillment", sub: "Kundenprojekte", slice: "Projekte & Doku",
    status: projekte ? projekte + " aktiv" : "bereit", activity: projekte ? 0.45 : 0.2,
    kpis: [["Aktive Projekte", projekte], ["Modus", "Done-for-you"]], deepLink: "/#projekte",
  });
  push({ id: "u-onboarding", type: "unit", parent: "fulfillment", label: "Onboarding", sub: "Kunden-Setup", color: C.fulfillment, status: "bereit", activity: 0.3, kpis: [["Skill", "kunden-onboarding"], ["Ziel", "Brain je Kunde"]], deepLink: "/#projekte" });
  push({ id: "u-recaps", type: "unit", parent: "fulfillment", label: "Call-Recaps", sub: "Transkripte → Output", color: C.fulfillment, status: "live", activity: 0.4, kpis: [["Quelle", "Sales Copilot"], ["Output", "Notiz + Tasks"]], deepLink: "/#salescopilot" });
  push({ id: "u-kpi", type: "unit", parent: "fulfillment", label: "KPI-Dashboards", sub: "Reporting", color: C.fulfillment, status: "geplant", activity: 0.2, kpis: [["Für", "Agenturen"], ["Modus", "auto"]], deepLink: "/#projekte" });
  push({
    id: "finanzen", type: "dept", label: "Finanzen", sub: "Zahlen & Rechnungen", slice: "Zahlen",
    status: openInv.length ? "offen: " + openInv.length : "ok", activity: 0.4,
    kpis: [["Rechnungen", invoices.length], ["Offen", openInv.length], ["Streak", streak.streak || 0]], deepLink: "/#finanzen",
  });
  push({ id: "u-rechnungen", type: "unit", parent: "finanzen", label: "Rechnungen", sub: "Faktura", color: C.finanzen, status: "bereit", activity: 0.3, kpis: [["Modul", "Finance-Cockpit"], ["Offen", openInv.length]], deepLink: "/#rechnungen" });
  push({ id: "u-zahlungen", type: "unit", parent: "finanzen", label: "Zahlungen", sub: "Konten + Reminder", color: C.finanzen, status: "aktiv", activity: 0.35, kpis: [["Abgleich", "auto"], ["Mahnwesen", "Mailbox"]], deepLink: "/#finanzen" });
  push({
    id: "technik", type: "dept", label: "Technik & Nacht", sub: "System · CTO", slice: "System & Doku",
    status: hb.running ? "arbeitet" : "bereit", activity: hb.running ? 0.9 : 0.4,
    kpis: [["Heartbeat", hb.running ? "läuft" : "idle"], ["Nachtläufe", nightRuns.length + " zuletzt"]], deepLink: "/#copilot",
  });
  push({
    id: "u-nightwork", type: "unit", parent: "technik", label: "Nacht-Werker", sub: "23:30", color: C.technik,
    status: nightLast ? (nightLast.ok ? "letzte Nacht ok" : "letzte Nacht Fehler") : "geplant 23:30", activity: 0.25,
    kpis: [["Plan", "23:30"], ["Budget", "90 Min"]],
    last: nightLast ? [clip(nightLast.task, 90), clip(nightLast.report, 90)] : [], deepLink: "/#copilot",
  });
  push({
    id: "u-heartbeat", type: "unit", parent: "technik", label: "Heartbeat", sub: "stündlich 09–19", color: C.technik,
    status: hb.running ? "läuft" : "idle", activity: hb.running ? 0.9 : 0.4,
    kpis: [["Zuletzt", hhmm(hb.last) || "—"], ["Status", hb.ok ? "ok" : "Fehler"]],
    last: hb.note ? [clip(hb.note, 120)] : [], deepLink: "/#copilot",
  });

  // KANTEN
  const links = [];
  const depts = nodes.filter((n) => n.type === "dept");
  // Jarvis "denkt mit" dem Gehirn (Kern-Kante)
  links.push({ source: "jarvis", target: "brain", kind: "core", color: C.jarvis, particles: 3, speed: 0.010 });
  for (const d of depts) {
    // Command: Jarvis → Abteilung (dünn, gold, von oben herab)
    links.push({ source: "jarvis", target: d.id, kind: "command", color: C.jarvis, particles: 1, speed: 0.006 });
    // Knowledge (scoped): Gehirn → Abteilung, in der Abteilungsfarbe, mit Wissens-Scheibe
    links.push({
      source: "brain", target: d.id, kind: "knowledge", color: d.color, slice: d.slice,
      particles: Math.max(1, Math.round(1 + d.activity * 3)), speed: 0.004 + d.activity * 0.010,
    });
  }
  // Units unter ihrer Abteilung
  for (const u of nodes.filter((n) => n.type === "unit")) {
    links.push({ source: u.parent, target: u.id, kind: "unit", color: u.color, particles: Math.max(1, Math.round(1 + u.activity * 3)), speed: 0.004 + u.activity * 0.010 });
  }

  // FEED (links): Heartbeat- + Nacht-Läufe, nach Zeit.
  const feed = [];
  for (const r of hbRuns) feed.push({ ts: r.end || r.start, dept: "technik", ok: r.ok !== false, text: "Heartbeat: " + clip(r.report || "Lauf", 110) });
  for (const r of nightRuns) feed.push({ ts: r.end || r.start, dept: "technik", ok: r.ok !== false, text: "Nacht-Werker: " + clip(r.report || r.task || "Lauf", 110) });
  feed.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  return { generated: Math.floor(Date.now() / 1000), nodes, links, feed: feed.slice(0, 40) };
}

module.exports = { buildStarmap };

if (require.main === module) {
  process.stdout.write(JSON.stringify(buildStarmap(), null, 2) + "\n");
}
