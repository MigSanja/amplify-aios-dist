#!/usr/bin/env node
// GF-Enrichment: füllt je Makler-Lead die persönliche Geschäftsführer-Mail (Spalte L).
// Zwei Wege, in dieser Reihenfolge (spart AnyMailFinder-Credits):
//   1. Haben wir schon eine PERSÖNLICHE Mail vom Maps-Scrape (Spalte I, kein info@/kontakt@)?
//      -> die nehmen, L = diese Mail, M = "Maps (persönlich)". KEIN AnyMailFinder-Call.
//   2. Sonst AnyMailFinder Decision-Maker (Kategorie "ceo") über die Domain -> K/L/M.
//      Credits: nur bei VALID-Treffer 2 Credits (risky/not_found gratis, Re-Run <30 Tage gratis).
//
// WICHTIG: schreibt K:M in EINEM Bulk-Write am Ende (Google-Sheets-Limit ~60 Writes/Minute).
//
// Nutzung:
//   node find-gf.js --limit 10     # Testbatch
//   node find-gf.js                # alle offenen
//   node find-gf.js --tab Tabellenblatt1
//
// API-Key: ANYMAILFINDER_API_KEY aus lokaler .env (NICHT im Code, NICHT im Chat).

const fs = require("fs");
const path = require("path");
const https = require("https");
const { readRange, writeRange } = require("./gsheet-client");

const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const LIMIT = parseInt(getArg("--limit", "0"), 10) || 0;
const TAB = getArg("--tab", "Tabellenblatt1");

// Spalten-Index (0-basiert): I=Maps-Mails=8, H=Domain=7, K=GF Name=10, L=GF Mail=11, M=Status=12
const COL = { firma: 0, domain: 7, mapsMail: 8, gfName: 10, gfMail: 11, status: 12 };
const GENERIC = /^(info|kontakt|contact|office|mail|post|team|service|empfang|zentrale|hallo|willkommen|buero|b[uü]ro|sekretariat|immobilien|verwaltung|anfrage|kundenservice|no-?reply|newsletter)@/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function apiKey() {
  if (process.env.ANYMAILFINDER_API_KEY) return process.env.ANYMAILFINDER_API_KEY;
  const envPath = path.join(__dirname, ".env");
  const m = fs.existsSync(envPath) && fs.readFileSync(envPath, "utf8").match(/ANYMAILFINDER_API_KEY=(.+)/);
  if (!m || !m[1].trim()) throw new Error("ANYMAILFINDER_API_KEY fehlt in der .env");
  return m[1].trim();
}

function personalMapsMail(row) {
  const maps = (row[COL.mapsMail] || "").split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  return maps.find(e => EMAIL.test(e) && !GENERIC.test(e)) || null;
}

function amf(domain, companyName, key) {
  const payload = JSON.stringify({ decision_maker_category: ["ceo"], domain: domain || undefined, company_name: companyName || undefined });
  return new Promise((resolve) => {
    const req = https.request({
      host: "api.anymailfinder.com", path: "/v5.1/find-email/decision-maker", method: "POST",
      headers: { "Authorization": key, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    }, (r) => {
      let d = ""; r.on("data", (c) => (d += c));
      r.on("end", () => { try { resolve({ status: r.statusCode, json: JSON.parse(d || "{}") }); } catch { resolve({ status: r.statusCode, json: {} }); } });
    });
    req.on("error", () => resolve({ status: 0, json: {} })); req.write(payload); req.end();
  });
}

(async () => {
  const key = apiKey();
  const grid = await readRange(TAB, "A1:P100000");
  const dataRows = grid.slice(1);

  // K:M-Matrix aus dem Ist-Zustand aufbauen (bestehende Werte behalten), am Ende EIN Bulk-Write.
  const kmm = dataRows.map(r => [r[COL.gfName] || "", r[COL.gfMail] || "", r[COL.status] || ""]);

  const fromMaps = [];  // schon persönliche Maps-Mail -> ohne AnyMailFinder
  const needAmf = [];   // brauchen AnyMailFinder
  dataRows.forEach((row, i) => {
    if ((row[COL.gfMail] || "").trim()) return;          // L schon gefüllt -> fertig
    const pm = personalMapsMail(row);
    if (pm) { kmm[i][1] = pm; kmm[i][2] = "Maps (persönlich)"; fromMaps.push(i); return; }
    const domain = (row[COL.domain] || "").trim();
    const company = (row[COL.firma] || "").trim();
    if (domain || company) needAmf.push({ i, domain, company, name: company });
  });
  console.log(`Persönliche Maps-Mails übernommen (ohne Credits): ${fromMaps.length}`);

  const batch = LIMIT ? needAmf.slice(0, LIMIT) : needAmf;
  console.log(`AnyMailFinder nötig: ${needAmf.length}  |  bearbeite jetzt: ${batch.length}${LIMIT ? " (Testbatch)" : ""}`);

  const counts = { valid: 0, risky: 0, none: 0 };
  let creditsSpent = 0, done = 0, idx = 0;
  const CONC = 8;
  async function worker() {
    while (idx < batch.length) {
      const t = batch[idx++];
      const res = await amf(t.domain, t.domain ? "" : t.company, key);
      const j = res.json || {};
      const status = j.email_status || (res.status >= 400 ? `err_${res.status}` : "not_found");
      const email = j.valid_email || j.email || "";
      const gfName = [j.person_full_name, j.person_job_title].filter(Boolean).join(", ");
      creditsSpent += j.credits_charged || 0;
      kmm[t.i] = [gfName, email, status];
      if (status === "valid") counts.valid++; else if (status === "risky") counts.risky++; else counts.none++;
      if (++done % 50 === 0) process.stdout.write(` ${done}/${batch.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  // EIN Bulk-Write für den ganzen K:M-Block (statt pro Zeile -> kein 429-Ratelimit).
  const lastRow = dataRows.length + 1;
  await writeRange(TAB, `K2:M${lastRow}`, kmm);

  console.log(`\n\nFertig. Maps-persönlich: ${fromMaps.length} | AnyMailFinder valid: ${counts.valid}, risky: ${counts.risky}, none: ${counts.none} | Credits: ${creditsSpent}`);
})().catch((e) => { console.error("find-gf-Fehler:", e.message); process.exit(1); });
