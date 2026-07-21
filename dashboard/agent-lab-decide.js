#!/usr/bin/env node
// agent-lab-decide.js — des Nutzers Freigabe für eine Agent-Lab-Empfehlung.
// Wird vom Dashboard (/api/agent-lab/decide) und vom Telegram-Bot (Button-Klick) benutzt.
//
// Nutzung:  node dashboard/agent-lab-decide.js <rec-id|"alle"> <ja|nein>
//
// ja   → status 'freigegeben' + der Fix wandert als '- [ ] 🤖'-Punkt nach
//        brain/03_Projects/aios-audit-fixes.md. Von dort holt ihn der Nacht-Werker (23:30)
//        als Prio-1-Punkt und führt ihn aus. Bewusst kein eigener Executor.
// nein → status 'abgelehnt'. Der key bleibt in der Datei liegen, damit agent-lab-add.js
//        denselben Vorschlag nie wieder anlegt.
const fs = require("fs");
const path = require("path");
const { writeJsonAtomic, writeFileAtomic } = require("./atomic-write");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(__dirname, "data", "agent-lab-recs.json");
const FIXES = path.join(ROOT, "brain", "03_Projects", "aios-audit-fixes.md");

const [idArg, entscheid] = process.argv.slice(2);
if (!idArg || !["ja", "nein"].includes(entscheid)) {
  console.error('usage: agent-lab-decide.js <rec-id|"alle"> <ja|nein>');
  process.exit(1);
}

let db;
try { db = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { console.error("FEHLER: keine Empfehlungen vorhanden"); process.exit(1); }
const recs = Array.isArray(db.recs) ? db.recs : [];

const ziel = idArg === "alle" ? recs.filter((r) => r.status === "offen") : recs.filter((r) => r.id === idArg && r.status === "offen");
if (!ziel.length) { console.log("SKIP: nichts Offenes zu entscheiden"); process.exit(0); }

const dat = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
const neueTasks = [];
for (const r of ziel) {
  r.status = entscheid === "ja" ? "freigegeben" : "abgelehnt";
  r.entschieden = new Date().toISOString();
  if (entscheid === "ja") {
    neueTasks.push(`- [ ] 🤖 **Agent-Lab: ${r.titel}** (Agent \`${r.agent}\`) — ${r.fix} _Befund: ${r.befund}_ (freigegeben ${dat})`);
  }
}

// Freigegebene Punkte ans Ende der Task-Liste, VOR der '## Verifiziert'-Sektion.
// Der Nacht-Werker liest aios-audit-fixes.md als Prio 1 und nimmt den ersten offenen 🤖-Punkt.
if (neueTasks.length) {
  const md = fs.readFileSync(FIXES, "utf8").split("\n");
  let i = md.findIndex((l) => l.startsWith("## ") && !l.startsWith("## 🔧"));
  if (i < 0) i = md.length;
  // hinter den letzten Task VOR der nächsten Überschrift einfügen
  let ins = i;
  while (ins > 0 && !md[ins - 1].trim()) ins--;
  md.splice(ins, 0, ...neueTasks);
  writeFileAtomic(FIXES, md.join("\n"));
}

writeJsonAtomic(FILE, db, 2);
console.log(`OK: ${ziel.length} ${entscheid === "ja" ? "freigegeben (→ aios-audit-fixes.md, Nacht-Werker führt aus)" : "abgelehnt"}`);
