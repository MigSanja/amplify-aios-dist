#!/usr/bin/env node
// agent-lab-add.js — einziger Schreibweg für Agent-Lab-Empfehlungen (Single-Writer-Regel).
// Der Agent-Lab-Lauf (dashboard/agent-lab.sh) ruft das hier pro Fund auf; er fasst
// dashboard/data/agent-lab-recs.json NIE direkt an.
//
// Nutzung:
//   node dashboard/agent-lab-add.js '{"agent":"outreach-alex","titel":"…","befund":"…","fix":"…","schwere":"hoch"}'
//
// De-Dupe: key = agent + normalisierter Titel. Existiert der key schon (egal welcher Status,
// auch 'abgelehnt'), wird NICHT neu angelegt → einmal abgelehnt heißt für immer abgelehnt.
// Exit 0 = angelegt, Exit 0 + "SKIP" = Dublette, Exit 1 = ungültig.
const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("./atomic-write");

const FILE = path.join(__dirname, "data", "agent-lab-recs.json");
const SCHWERE = ["hoch", "mittel", "niedrig"];

function load() {
  try { const d = JSON.parse(fs.readFileSync(FILE, "utf8")); return Array.isArray(d.recs) ? d : { recs: [] }; }
  catch { return { recs: [] }; }
}
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

let input;
try { input = JSON.parse(process.argv[2] || ""); } catch { console.error("FEHLER: kein gültiges JSON als Argument"); process.exit(1); }

for (const f of ["agent", "titel", "befund", "fix"]) {
  if (!String(input[f] || "").trim()) { console.error("FEHLER: Feld fehlt oder leer: " + f); process.exit(1); }
}
const schwere = SCHWERE.includes(input.schwere) ? input.schwere : "mittel";
// Beleg-Pflicht (agents/agent-lab/agent.md): der Befund muss eine Fundstelle nennen.
if (String(input.befund).trim().length < 40) { console.error("FEHLER: befund zu dünn — Fundstelle (Datei + Datum) nennen"); process.exit(1); }

const db = load();
const key = norm(input.agent) + "::" + norm(input.titel);
if (db.recs.some((r) => r.key === key)) { console.log("SKIP: Empfehlung existiert schon (" + key + ")"); process.exit(0); }

db.recs.push({
  id: "rec-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e4).toString(36),
  key,
  agent: String(input.agent).trim(),
  titel: String(input.titel).trim().slice(0, 160),
  befund: String(input.befund).trim().slice(0, 1200),
  fix: String(input.fix).trim().slice(0, 1200),
  schwere,
  status: "offen",
  erstellt: new Date().toISOString(),
  entschieden: null,
});
writeJsonAtomic(FILE, db, 2);
console.log("OK: angelegt (" + key + ")");
