#!/usr/bin/env node
// kunden-index.js — baut aus dem CRM (dashboard/data/leads.json) + den qualitativen
// Brain-Notizen (brain/02_People, brain/03_Projects) EINEN kompakten Markdown-Index:
// dashboard/data/kunden-index.md. Zweck: Jarvis (Telegram + Web-Copilot) lädt EINE Datei
// und kennt sofort alle Kunden/Leads mit Namen, Firma, Pipeline-Stufe und Detail-Verweis —
// statt raten zu müssen, wo jemand liegt. Kein RAG nötig (Datenmenge klein).
//
// Nutzung:  node dashboard/kunden-index.js
// Trigger:  on-demand (CLI) + einmal pro Tag am Anfang von daily-run.sh.
// Nur Node-Stdlib. Schreiben atomar (atomic-write.js).

const fs = require("fs");
const path = require("path");
const { writeFileAtomic } = require("./atomic-write");

const ROOT = path.join(__dirname, "..");
const LEADS = path.join(__dirname, "data", "leads.json");
const PEOPLE = path.join(ROOT, "brain", "02_People");
const PROJECTS = path.join(ROOT, "brain", "03_Projects");
const OUT = path.join(__dirname, "data", "kunden-index.md");

// --- Helfer ---------------------------------------------------------------
function readJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } }
function clip(s, n) { s = (s || "").toString().replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function esc(s) { return (s || "").toString().replace(/\|/g, "/").replace(/\n/g, " ").trim(); }

// Frontmatter + erste Sinn-Zeile aus einer Brain-Notiz ziehen.
function parseNote(file) {
  let raw = ""; try { raw = fs.readFileSync(file, "utf8"); } catch { return null; }
  const fm = {};
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  let body = raw;
  if (m) {
    body = raw.slice(m[0].length);
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
      if (kv) fm[kv[1].toLowerCase()] = kv[2].trim();
    }
  }
  // Titel: H1 > frontmatter title > Dateiname
  let title = "";
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) title = h1[1].trim();
  else if (fm.title) title = fm.title.replace(/^["']|["']$/g, "");
  else title = path.basename(file, ".md");
  // Erste inhaltliche Zeile (kein Heading, kein Callout, keine Leerzeile)
  let hint = "";
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith(">") || t.startsWith("---") || t.startsWith("![")) continue;
    hint = t.replace(/^[-*]\s*/, ""); break;
  }
  const tags = (fm.tags || "").toLowerCase();
  return { title, hint, tags, company: fm.company || fm.firma || "", raw: body, file };
}

function listNotes(dir) {
  let out = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md") || f.startsWith("_")) continue;
      const n = parseNote(path.join(dir, f));
      if (n) { n.slug = f.replace(/\.md$/, ""); out.push(n); }
    }
  } catch {}
  return out;
}

// --- Daten laden ----------------------------------------------------------
const crm = readJson(LEADS, { leads: [], count: 0 });
const leads = Array.isArray(crm.leads) ? crm.leads : [];
const people = listNotes(PEOPLE);
const projects = listNotes(PROJECTS);

// „Heiße" Pipeline: alles ab echter Reaktion (geantwortet / Termin / Closing / Deal).
const HOT = new Set(["Geantwortet", "Call proposed", "Closing", "Closing Follow-up", "Closed", "Gewonnen"]);
function isHot(l) {
  return l.replied || l.callProposed || l.settingBooked || l.closingBooked || l.closed ||
    HOT.has(l.status) || HOT.has(l.pipelineStage);
}
function stageOf(l) { return l.pipelineStage && l.pipelineStage !== "—" ? l.pipelineStage : (l.status || l.stage || "—"); }
function lastTouch(l) {
  return l.geantwortetAm || l.followup3Am || l.followup2Am || l.followup1Am || l.kontaktiertAm ||
    l.vernetzungAngenommenAm || l.contactDate || l.addedAt || "";
}

// --- Markdown bauen -------------------------------------------------------
const now = new Date();
const stamp = now.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const L = [];
L.push(`# Kunden-Index — auto-generiert ${stamp}`);
L.push(`> Kompakter Einstieg für Jarvis. Bei jeder Kunden-/Lead-Frage ZUERST hier schauen.`);
L.push(`> Details & alle Felder: \`dashboard/data/leads.json\` (CRM, grepbar nach Name). Qualitatives Wissen: \`brain/02_People/\`, \`brain/03_Projects/\`.`);
L.push("");

// 1) Aktive Kundenprojekte (kunde-getaggt)
const kundenProjekte = projects.filter(p => /\bkunde\b/.test(p.tags));
if (kundenProjekte.length) {
  L.push(`## Aktive Kundenprojekte (${kundenProjekte.length}) — brain/03_Projects/`);
  for (const p of kundenProjekte.sort((a, b) => a.title.localeCompare(b.title)))
    L.push(`- **${esc(p.title)}** — ${clip(p.hint, 120) || "(siehe Notiz)"}  ·  \`brain/03_Projects/${p.slug}.md\``);
  L.push("");
}

// 2) Personen-Notizen (Menschen, die Jarvis kennen sollte — Kunden, Leads, Kontakte)
if (people.length) {
  L.push(`## Personen-Notizen (${people.length}) — brain/02_People/`);
  for (const p of people.sort((a, b) => a.title.localeCompare(b.title))) {
    const co = p.company ? ` (${esc(p.company)})` : "";
    L.push(`- **${esc(p.title)}**${co} — ${clip(p.hint, 100) || "Notiz vorhanden"}  ·  \`brain/02_People/${p.slug}.md\``);
  }
  L.push("");
}

// 3) Heiße Pipeline (voll ausgeschrieben)
const hot = leads.filter(isHot);
if (hot.length) {
  L.push(`## 🔥 Heiße Pipeline (${hot.length}) — geantwortet / Termin / Closing / Deal`);
  for (const l of hot.sort((a, b) => (lastTouch(b)).localeCompare(lastTouch(a)))) {
    const parts = [`**${esc(l.name) || "?"}**`];
    if (l.company) parts.push(esc(l.company));
    parts.push(stageOf(l));
    parts.push(l.account || "?");
    const lt = lastTouch(l); if (lt) parts.push("zuletzt " + lt);
    let line = "- " + parts.join(" · ");
    if (l.notes) line += `\n  ↳ ${clip(l.notes, 160)}`;
    L.push(line);
  }
  L.push("");
}

// 4) Gesamt-Roster (jede Person findbar nach Name; kompakt, eine Zeile)
L.push(`## CRM-Gesamtroster (${leads.length}) — jeder Kontakt nach Name findbar; Details in leads.json`);
const byAcc = {};
for (const l of leads) { const a = l.account || "—"; (byAcc[a] = byAcc[a] || []).push(l); }
for (const acc of Object.keys(byAcc).sort((a, b) => byAcc[b].length - byAcc[a].length)) {
  const arr = byAcc[acc].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  L.push(`### ${acc} (${arr.length})`);
  for (const l of arr) {
    const co = l.company ? " · " + clip(l.company, 38) : "";
    L.push(`- ${esc(l.name) || "?"}${co} · ${stageOf(l)}`);
  }
  L.push("");
}

// 5) Kennzahlen
const byStatus = {};
for (const l of leads) { const s = stageOf(l); byStatus[s] = (byStatus[s] || 0) + 1; }
L.push(`## Kennzahlen`);
L.push(`- Gesamt: **${leads.length}**  ·  ` + Object.keys(byAcc).sort().map(a => `${a}: ${byAcc[a].length}`).join("  ·  "));
L.push(`- Nach Stufe: ` + Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "));
L.push("");
L.push(`_Regenerieren: \`node dashboard/kunden-index.js\`_`);

const md = L.join("\n") + "\n";
writeFileAtomic(OUT, md);
const kb = (Buffer.byteLength(md, "utf8") / 1024).toFixed(1);
console.log(`kunden-index.md geschrieben: ${leads.length} Leads, ${people.length} Personen, ${kundenProjekte.length} Kundenprojekte, ${hot.length} heiß · ${kb} KB`);
