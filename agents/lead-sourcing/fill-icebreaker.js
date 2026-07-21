#!/usr/bin/env node
// Füllt die Icebreaker-Spalte (U) mit einem SIMPLEN, ehrlichen quellen-basierten Opener.
// Kein Website-Scrape, kein Fake-Lob. Der eigentliche Pitch kommt später im Mail-Body.
//   LEAD_SHEET_ID=<sheet> node fill-icebreaker.js

const { readRange, writeRange } = require("./gsheet-client");
const TAB = "Tabellenblatt1";
const COL = { ort: 4, quelle: 13, icebreaker: 20 }; // E, N, U

function opener(quelle, ort) {
  const stadt = (ort || "Berlin").trim() || "Berlin";
  if (/portal|inserat/i.test(quelle)) {
    return "Ich bin über eins Ihrer Inserate auf Sie gestoßen.";
  }
  return `Ich hab mich online nach Maklern in ${stadt} umgeschaut und bin dabei auf Sie gekommen.`;
}

(async () => {
  const grid = await readRange(TAB, "A1:U100000");
  const rows = grid.slice(1);
  const col = rows.map(r => [opener(r[COL.quelle] || "", r[COL.ort] || "")]);
  await writeRange(TAB, `U2:U${rows.length + 1}`, col);
  console.log(`Icebreaker gefüllt: ${col.length} Zeilen.`);
})().catch(e => { console.error("icebreaker-Fehler:", e.message); process.exit(1); });
