#!/usr/bin/env node
// known-contacts.js — sichere Pflege der Outreach-De-Dupe-Liste.
// Grund: der Agent hat die Datei früher per truncate/append zerschossen (ungültiges JSON
// -> De-Dupe fiel aus -> ein Doppelkontakt). Dieser Helper liest TOLERANT (auch aus
// kaputtem Stand), dedupt und schreibt IMMER valides JSON-Array (atomar via tmp+rename).
//
// Nutzung:
//   node dashboard/known-contacts.js has  "<Name>" "<URL>"   -> "yes"/"no" (Match per NORMALISIERTEM NAME ODER URL, kanalübergreifend)
//   node dashboard/known-contacts.js add  "<Name>" "<URL>"   -> fügt hinzu (idempotent), Ausgabe "added"/"exists"
//   node dashboard/known-contacts.js count                    -> Anzahl
// WICHTIG: NIE mit truncate/sed/Edit an .known-contacts.json schreiben — immer diesen Helper.
const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "..", "agents", "outreach-alex", "runs", ".known-contacts.json");

const norm = s => (s || "").toString().toLowerCase().replace(/\s+/g, " ").trim();
const normUrl = s => (s || "").toString().trim().replace(/\?.*$/, "").replace(/\/+$/, "").toLowerCase();

// Tolerant lesen: erst echtes JSON, sonst per Regex alle {name,url} + lose "Name","URL"-Paare rausziehen.
function load() {
  let raw = ""; try { raw = fs.readFileSync(FILE, "utf8"); } catch { return []; }
  try { const a = JSON.parse(raw); if (Array.isArray(a)) return a; } catch {}
  const out = [], seen = new Set();
  const push = (name, url) => {
    name = (name || "").trim(); url = (url || "").trim();
    if (!name && !url) return;
    const k = norm(name) + "|" + normUrl(url);
    if (seen.has(k)) return; seen.add(k); out.push({ name, url });
  };
  let m;
  const reObj = /"name"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"url"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  while ((m = reObj.exec(raw)) !== null) push(m[1], m[2]);
  const reLoose = /"([^"]+)"\s*,\s*"(https?:\/\/[^"\s]+)"/g;
  while ((m = reLoose.exec(raw)) !== null) { if (!/^https?:/i.test(m[1])) push(m[1], m[2]); }
  return out;
}
function save(list) {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list));
  JSON.parse(fs.readFileSync(tmp, "utf8")); // Validierung
  fs.renameSync(tmp, FILE);
}
function matches(list, name, url) {
  const n = norm(name), u = normUrl(url);
  return list.some(x => (n && norm(x.name) === n) || (u && normUrl(x.url) === u));
}
// CRM (leads.json) zusätzlich prüfen — ACCOUNT-ÜBERGREIFEND (Alex + Paul teilen das CRM).
// ein früherer Fall: Paul-InMail + der Nutzer-Vernetzung = Doppelkontakt über zwei Accounts.
function crmMatches(name, url) {
  const n = norm(name), u = normUrl(url);
  let leads = [];
  try { leads = (JSON.parse(fs.readFileSync(path.join(__dirname, "data", "leads.json"), "utf8")).leads) || []; } catch { return false; }
  return leads.some(l => (n && norm(l.name) === n) || (u && (normUrl(l.url) === u || normUrl(l.salesNavUrl) === u)));
}

const [cmd, name, url] = process.argv.slice(2);
const list = load();
if (cmd === "has") {
  process.stdout.write((matches(list, name, url) || crmMatches(name, url)) ? "yes\n" : "no\n");
} else if (cmd === "add") {
  if (!name && !url) { console.error("usage: add <name> <url>"); process.exit(1); }
  if (matches(list, name, url)) { save(list); console.log("exists"); }
  else { list.push({ name: (name || "").trim(), url: (url || "").trim() }); save(list); console.log("added"); }
} else if (cmd === "count") {
  console.log(list.length);
} else {
  console.error('usage: known-contacts.js has|add "<Name>" "<URL>"  |  count');
  process.exit(1);
}
