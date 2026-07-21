#!/usr/bin/env node
// save-lead.js — EINZIGER erlaubter Weg, einen vernetzten Lead ins CRM zu schreiben.
// Erzwingt das kanonische Schema (kein Agent darf Feldnamen mehr erfinden) und schreibt
// GENAU EINE valide JSONL-Zeile (JSON.stringify escaped Umbrüche automatisch) + known-contacts add.
//
// Aufruf (alle Werte als Flags, Reihenfolge egal):
//   node dashboard/save-lead.js --agent outreach-alex \
//     --name "Vorname Nachname" --company "Firma" --category "Agentur|Dienstleister|Makler" \
//     --location "Ort" --score 8 --icebreaker "Hey Vorname, ... (kurz, der Nutzer-Stil)" \
//     --url "https://www.linkedin.com/in/slug" [--account der Nutzer|Paul] [--stage "Vernetzt"]
//
// Pflichtfelder: agent, name, category, score, url. Fehlt eins → Fehler (nichts wird geschrieben).
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { args[a.slice(2)] = process.argv[i + 1]; i++; }
}

const agent = (args.agent || "").replace(/[^a-zA-Z0-9_-]/g, "");
const req = { agent, name: args.name, category: args.category, score: args.score, url: args.url };
const missing = Object.entries(req).filter(([, v]) => !v || !String(v).trim()).map(([k]) => k);
if (missing.length) { console.error("FEHLER save-lead: Pflichtfeld(er) fehlen: " + missing.join(", ")); process.exit(1); }

const CATS = ["Agentur", "Dienstleister", "Makler"];
if (!CATS.includes(args.category)) { console.error("FEHLER save-lead: category muss eine ZIELGRUPPE sein (Agentur|Dienstleister|Makler), nicht: " + args.category); process.exit(1); }

const file = path.join(ROOT, "agents", agent, "runs", ".crm-inbox.jsonl");
const account = args.account || (agent.includes("paul") ? "Paul" : "der Nutzer");
const stage = args.stage || (agent.includes("paul") ? "Vernetzt-Paul" : "Vernetzt");
const today = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 10);

// De-Dupe: URL schon in der Datei? Dann nicht doppelt anhängen.
let existing = "";
try { existing = fs.readFileSync(file, "utf8"); } catch {}
if (args.url && existing.includes(String(args.url).trim())) { console.log("skip (url schon im CRM): " + args.name); process.exit(0); }

// Kanonisches Schema — feste Feldnamen, Reihenfolge fix.
const lead = {
  name: String(args.name).trim(),
  company: String(args.company || "").trim(),
  category: args.category,
  location: String(args.location || "").trim(),
  icpScore: Number(args.score) || 0,
  icebreaker: String(args.icebreaker || "").trim(),
  url: String(args.url).trim(),
  account,
  status: "Vernetzt",
  stage,
  addedAt: today,
};

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.appendFileSync(file, JSON.stringify(lead) + "\n"); // JSON.stringify => immer valides Single-Line-JSONL

// known-contacts sauber über den Helper (nie die Datei direkt anfassen)
try { execFileSync("node", [path.join(__dirname, "known-contacts.js"), "add", lead.name, lead.url], { cwd: ROOT }); } catch {}

console.log("saved: " + lead.name + " [" + lead.category + " · ICP " + lead.icpScore + "] -> " + agent);
