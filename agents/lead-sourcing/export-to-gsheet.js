#!/usr/bin/env node
// Legt ein SEPARATES Google Sheet nur mit den versendbaren Top-Leads (ok + Briefanrede) an
// und gibt es per Link frei (anyone reader) für den CSV-Import. Gibt die URL aus.
//
//   LEAD_SHEET_ID=<quell-sheet> node export-to-gsheet.js

const { readRange, getToken, reqJson } = require("./gsheet-client");

const SRC_TAB = "Tabellenblatt1";
const LEAD_SCRAPING_FOLDER = process.env.LEAD_SCRAPING_FOLDER_ID || "";
const C = { firma: 0, mail: 11, verified: 15, vor: 16, nach: 17, brief: 19, ice: 20 };
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

(async () => {
  const token = await getToken();
  const g = await readRange(SRC_TAB, "A2:U100000");
  const rows = g.filter(r =>
    EMAIL.test(r[C.mail] || "") && (r[C.verified] || "").trim() === "ok" && (r[C.brief] || "").trim());

  const values = [["email", "first_name", "last_name", "company", "briefanrede", "icebreaker"]];
  for (const r of rows) values.push([r[C.mail], r[C.vor], r[C.nach], r[C.firma], r[C.brief], r[C.ice]]);

  // Neues Spreadsheet
  const ss = await reqJson("POST", "https://sheets.googleapis.com/v4/spreadsheets", token, {
    properties: { title: "Lead-Export" },
    sheets: [{ properties: { title: "Leads" } }],
  });
  const id = ss.spreadsheetId;

  // In Batch-Ordner verschieben
  await reqJson("PATCH", `https://www.googleapis.com/drive/v3/files/${id}?addParents=${LEAD_SCRAPING_FOLDER}&removeParents=root&fields=id`, token, {});
  // Werte schreiben
  await reqJson("PUT", `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/Leads!A1?valueInputOption=RAW`, token, { values });
  // Link-Freigabe: anyone reader
  await reqJson("POST", `https://www.googleapis.com/drive/v3/files/${id}/permissions`, token, { role: "reader", type: "anyone" });

  console.log(`${rows.length} Leads -> https://docs.google.com/spreadsheets/d/${id}`);
  console.log(`URL_ONLY=https://docs.google.com/spreadsheets/d/${id}`);
})().catch(e => { console.error("export-gsheet-Fehler:", e.message); process.exit(1); });
