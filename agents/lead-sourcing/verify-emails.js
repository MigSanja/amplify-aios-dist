#!/usr/bin/env node
// MillionVerifier-Verify: prüft je Lead die BESTE persönliche E-Mail und schreibt den
// Verifizierungs-Status in die Spalte "Verified" (grün bei ok, rot bei invalid).
//
// "Beste persönliche Mail" = AnyMailFinder-Mail (Spalte L) wenn vorhanden, sonst eine
// persönliche Mail aus den Maps-Mails (Spalte I), die NICHT generisch ist (kein info@,
// kontakt@, office@ ...). So sparen wir AnyMailFinder-Credits, wenn wir schon eine
// persönliche Mail haben, und haben trotzdem überall einen Verified-Check.
//
// Nutzung:
//   node leads/verify-emails.js --limit 20      # Testbatch
//   node leads/verify-emails.js                 # alle offenen Zeilen
//   node leads/verify-emails.js --tab Tabellenblatt1
//
// API-Key: MILLIONVERIFIER_API_KEY aus der .env.

const fs = require("fs");
const path = require("path");
const https = require("https");
const { getToken, reqJson, base, readRange, writeRange, SHEET_ID } = require("./gsheet-client");

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LIMIT = parseInt(getArg("--limit", "0"), 10) || 0;
const TAB = getArg("--tab", "Tabellenblatt1");
const VERIFIED_COL = "P"; // neue Spalte

// Spalten-Index (0-basiert): I=Maps-Mails=8, L=AnyMail-Mail=11, P=Verified=15
const COL = { mapsMail: 8, anymail: 11, verified: 15 };

const GENERIC = /^(info|kontakt|contact|office|mail|post|team|service|empfang|zentrale|hallo|willkommen|buero|b[uü]ro|sekretariat|immobilien|verwaltung|anfrage|kundenservice|no-?reply|newsletter)@/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function apiKey() {
  if (process.env.MILLIONVERIFIER_API_KEY) return process.env.MILLIONVERIFIER_API_KEY;
  const p = path.join(__dirname, ".env");
  const m = fs.existsSync(p) && fs.readFileSync(p, "utf8").match(/MILLIONVERIFIER_API_KEY=(.+)/);
  if (!m || !m[1].trim()) throw new Error("MILLIONVERIFIER_API_KEY fehlt in der .env");
  return m[1].trim();
}

function bestEmail(row) {
  const anymail = (row[COL.anymail] || "").trim();
  if (EMAIL.test(anymail)) return anymail.match(EMAIL)[0];
  // Maps-Mails: erste NICHT-generische
  const maps = (row[COL.mapsMail] || "").split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  const personal = maps.find(e => EMAIL.test(e) && !GENERIC.test(e));
  return personal || null;
}

function mvVerify(email, key) {
  const url = `https://api.millionverifier.com/api/v3/?api=${key}&email=${encodeURIComponent(email)}&timeout=10`;
  return new Promise((resolve) => {
    https.get(url, (r) => {
      let d = ""; r.on("data", c => d += c);
      r.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({ result: "error" }); } });
    }).on("error", () => resolve({ result: "error" }));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ensureHeaderAndFormat() {
  const token = await getToken();
  // Header setzen
  await reqJson("PUT", base(`${TAB}!${VERIFIED_COL}1`) + "?valueInputOption=RAW", token, { values: [["Verified"]] });
  // gid holen
  const meta = await reqJson("GET", `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`, token);
  const sheet = (meta.sheets || []).find(s => s.properties.title === TAB);
  const sheetId = sheet.properties.sheetId;
  const colIdx = VERIFIED_COL.charCodeAt(0) - 65;
  const range = { sheetId, startRowIndex: 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 };
  await reqJson("POST", `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, token, {
    requests: [
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.13, green: 0.55, blue: 0.33 }, horizontalAlignment: "CENTER",
          textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } },
        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)" } },
      // grün bei "ok"
      { addConditionalFormatRule: { rule: { ranges: [range], booleanRule: {
        condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "ok" }] },
        format: { backgroundColor: { red: 0.72, green: 0.88, blue: 0.75 } } } }, index: 0 } },
      // rot bei "invalid"
      { addConditionalFormatRule: { rule: { ranges: [range], booleanRule: {
        condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "invalid" }] },
        format: { backgroundColor: { red: 0.96, green: 0.76, blue: 0.76 } } } }, index: 0 } },
    ],
  });
}

(async () => {
  const key = apiKey();
  await ensureHeaderAndFormat();

  const grid = await readRange(TAB, "A1:P100000");
  const rows = grid.slice(1);

  const targets = [];
  rows.forEach((row, i) => {
    if ((row[COL.verified] || "").trim()) return; // schon geprüft
    const email = bestEmail(row);
    targets.push({ sheetRow: i + 2, email });
  });
  const open = targets.filter(t => t.email);
  const batch = LIMIT ? open.slice(0, LIMIT) : open;
  console.log(`Zeilen ohne Verified: ${targets.length} | mit persönl. Mail zu prüfen: ${open.length} | jetzt: ${batch.length}${LIMIT ? " (Testbatch)" : ""}`);

  // P-Spalte als eine Matrix aufbauen (ein einziger Sheet-Write am Ende = schnell).
  // Bestehende Werte behalten, nur neu Verifiziertes/Offenes setzen.
  const lastRow = rows.length + 1;                       // inkl. Header
  const colVals = rows.map(r => [ (r[COL.verified] || "").trim() ]); // Ausgangszustand P2..
  const counts = {};
  let done = 0;
  // Parallel mit Concurrency-Pool (MV verträgt gleichzeitige Requests) = deutlich schneller.
  const CONC = 12;
  let idx = 0;
  async function worker() {
    while (idx < batch.length) {
      const t = batch[idx++];
      const res = await mvVerify(t.email, key);
      const status = res.result || "error";
      counts[status] = (counts[status] || 0) + 1;
      colVals[t.sheetRow - 2] = [status];
      done++;
      if (done % 25 === 0) process.stdout.write(` ${done}/${batch.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  // Zeilen ohne persönliche Mail markieren (brauchen AnyMailFinder) — nur wenn noch leer
  const noMail = targets.filter(t => !t.email);
  for (const t of noMail) if (!colVals[t.sheetRow - 2][0]) colVals[t.sheetRow - 2] = [["offen (keine pers. Mail)"][0]];

  await writeRange(TAB, `${VERIFIED_COL}2:${VERIFIED_COL}${lastRow}`, colVals);
  console.log(`\n\nFertig. Verifiziert: ${JSON.stringify(counts)} | ${noMail.length} Zeilen offen (brauchen AnyMailFinder).`);
})().catch((e) => { console.error("verify-Fehler:", e.message); process.exit(1); });
