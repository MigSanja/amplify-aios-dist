#!/usr/bin/env node
// Setzt in Spalte L (GF-/AnyMailFinder-E-Mail) den Header-Text "AnyMail for Any E-Mail"
// und färbt die Header-Zelle blau (weiße, fette Schrift). Macht die AnyMailFinder-Spalte
// im Sheet visuell klar erkennbar.
//
//   node leads/format-header.js [Tab] [SpaltenBuchstabe]   (Default: Tabellenblatt1 L)

const { getToken, reqJson, base, SHEET_ID } = require("./gsheet-client");

const TAB = process.argv[2] || "Tabellenblatt1";
const COL_LETTER = (process.argv[3] || "L").toUpperCase();
const COL_IDX = COL_LETTER.charCodeAt(0) - 65; // A=0
const HEADER_TEXT = "AnyMail for Any E-Mail";

(async () => {
  const token = await getToken();

  // gid des Tabs holen
  const meta = await reqJson("GET", `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`, token);
  const sheet = (meta.sheets || []).find((s) => s.properties.title === TAB);
  if (!sheet) throw new Error(`Tab "${TAB}" nicht gefunden`);
  const sheetId = sheet.properties.sheetId;

  // 1) Header-Text setzen
  await reqJson("PUT", base(`${TAB}!${COL_LETTER}1`) + "?valueInputOption=RAW", token, { values: [[HEADER_TEXT]] });

  // 2) Header-Zelle blau formatieren (weiße, fette Schrift)
  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`;
  await reqJson("POST", batchUrl, token, {
    requests: [{
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: COL_IDX, endColumnIndex: COL_IDX + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.11, green: 0.42, blue: 0.85 }, // kräftiges Blau
            horizontalAlignment: "CENTER",
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
          },
        },
        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)",
      },
    }],
  });

  console.log(`ok: Spalte ${COL_LETTER} -> "${HEADER_TEXT}", Header blau.`);
})().catch((e) => { console.error("format-header-Fehler:", e.message); process.exit(1); });
