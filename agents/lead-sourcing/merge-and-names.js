#!/usr/bin/env node
// Ergänzt die Makler-Tabelle um Vorname/Nachname/Anrede/Briefanrede (Spalten Q-U) und
// merged die echten Makler-Kontakte aus der einer externen Kontakt-Tabelle dazu (Person + Mail,
// dedupliziert per Mail, ICP-gefiltert: große AGs/Banken/Bauträger raus).
//
//   LEAD_SHEET_ID=<unser Sheet> node merge-and-names.js
//
// Schreibt A1:U in EINEM Bulk-Write (Sheets-Ratelimit). Verify der neuen Mails danach separat.

const { readRange, writeMatrix, getToken, reqJson } = require("./gsheet-client");

const TAB = "Tabellenblatt1";
const MERGE_ID = process.env.MERGE_SHEET_ID || "";
const MERGE_TAB = process.env.MERGE_SHEET_TAB || "Tabelle1";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// „Team/GmbH/Ihr…" = kein echter Personenname
const NOTNAME = /team|vertrieb|gmbh|mbh|\bihr\b|service|immobilien|verwaltung|development|wohnen|\bbau\b|gruppe|group|kontakt/i;
// Nicht-ICP-Firmen (große Player) raus
const NONICP = /\bbank\b|bausparkasse|versicherung|\bAG\b|bautr(ä|ae)ger|development|wohnungsbau|genossenschaft|\bSE\b|sparkasse/i;

const NEW_HEADERS = ["Vorname", "Nachname", "Anrede", "Briefanrede", "Icebreaker"]; // Q..U

function splitName(full) {
  const namePart = String(full || "").split(",")[0].trim(); // "Max Müller, GF" -> "Max Müller"
  const toks = namePart.split(/\s+/).filter(Boolean);
  if (!toks.length) return { first: "", last: "" };
  if (toks.length === 1) return { first: "", last: toks[0] };
  return { first: toks[0], last: toks[toks.length - 1] };
}
function briefanrede(anrede, nach) {
  const a = String(anrede || "").trim().toLowerCase();
  if (a.startsWith("herr") && nach) return `Sehr geehrter Herr ${nach}`;
  if (a.startsWith("frau") && nach) return `Sehr geehrte Frau ${nach}`;
  return "Sehr geehrte Damen und Herren"; // ohne sichere Anrede -> neutral, nie Geschlecht raten
}

async function main() {
  // 1) Unser Sheet lesen (A1:U)
  const grid = await readRange(TAB, "A1:U100000");
  const header = grid[0] || [];
  const rows = grid.slice(1);
  // Header auf 21 Spalten (A..U) bringen
  const H = header.slice(0, 16);
  while (H.length < 16) H.push("");
  H.push(...NEW_HEADERS); // Q..U

  // bestehende Mails (Spalte L=11) für Dedup
  const seen = new Set();
  rows.forEach(r => { const m = (r[11] || "").trim().toLowerCase(); if (EMAIL.test(m)) seen.add(m); });

  // 2) Bestehende Zeilen: Vorname/Nachname aus GF Name (K=10) ableiten, Q..U füllen
  const out = rows.map(r => {
    const row = r.slice(0, 16); while (row.length < 16) row.push("");
    const { first, last } = splitName(row[10]);        // K = GF Name
    const anrede = "";                                  // Maps/AnyMailFinder liefert keine Anrede
    row.push(first, last, anrede, first || last ? briefanrede(anrede, last) : "", row[20] || "");
    return row;
  });

  // 3) Merge-Kontakte lesen + mergen
  const token = await getToken();
  async function readWithRetry(url, tries = 5) {
    for (let i = 0; i < tries; i++) {
      try { return await reqJson("GET", url, token); }
      catch (e) { if (i === tries - 1) throw e; await new Promise(r => setTimeout(r, 2000 * (i + 1))); }
    }
  }
  const eh = await readWithRetry(`https://sheets.googleapis.com/v4/spreadsheets/${MERGE_ID}/values/${MERGE_TAB}!V2:AF13000`);
  const ehRows = eh.values || [];
  let merged = 0, skippedDupe = 0, skippedIcp = 0, skippedName = 0;
  for (const er of ehRows) {
    const firma = (er[0] || "").trim();   // V
    const vor = (er[1] || "").trim();     // W
    const nach = (er[2] || "").trim();    // X
    const anrede = (er[3] || "").trim();  // Y
    const tel = (er[4] || "").trim();     // Z
    const mail = (er[10] || "").trim();   // AF
    if (!EMAIL.test(mail)) continue;
    const key = mail.toLowerCase();
    if (seen.has(key)) { skippedDupe++; continue; }
    if (!vor || !nach || NOTNAME.test(vor) || NOTNAME.test(nach)) { skippedName++; continue; }
    if (NONICP.test(firma)) { skippedIcp++; continue; }
    seen.add(key);
    const domain = key.split("@")[1] || "";
    // Schema A..U
    const row = [
      firma, "Makler (Merge)", "", "", "Berlin", tel,
      domain ? `https://${domain}` : "", domain, "", "",
      `${vor} ${nach}`.trim(), mail, "AnyMail", "ImmoScout", "18.07.2026", "",
      vor, nach, anrede, briefanrede(anrede, nach), "",
    ];
    out.push(row);
    merged++;
  }

  const matrix = [H, ...out];
  await writeMatrix(TAB, matrix);
  console.log(`Bestehende Zeilen: ${rows.length} (Vorname/Nachname ergänzt)`);
  console.log(`gemerged: ${merged}  |  übersprungen -> Dupe: ${skippedDupe}, kein echter Name: ${skippedName}, Nicht-ICP: ${skippedIcp}`);
  console.log(`Neue Gesamtzahl: ${out.length} Leads`);
}
main().catch(e => { console.error("merge-Fehler:", e.message); process.exit(1); });
