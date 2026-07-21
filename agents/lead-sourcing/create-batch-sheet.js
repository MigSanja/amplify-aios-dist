#!/usr/bin/env node
// Legt für einen Lead-Batch einen eigenen Unterordner unter "Lead Scraping" (Drive) an
// und darin ein frisches Google Sheet. Gibt die Spreadsheet-ID auf STDOUT aus (Logs auf
// STDERR), damit der Orchestrator sie als LEAD_SHEET_ID an die Pipeline weiterreicht.
//
//   node leads/create-batch-sheet.js "Beispiel-Batch"
//   -> STDOUT: <spreadsheetId>   STDERR: Ordner-/Sheet-Links
//
// Nutzt die Google-OAuth-Creds aus dem Jarvis-Repo (Drive- + Sheets-Scope vorhanden).

const { getToken, reqJson } = require("./gsheet-client");

const LEAD_SCRAPING_FOLDER = process.env.LEAD_SCRAPING_FOLDER_ID || "";
const NAME = process.argv[2] || "Makler Leads";
const TAB = "Tabellenblatt1";
const log = (...a) => console.error(...a);

(async () => {
  const token = await getToken();
  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (echtes Datum)
  const folderName = `${NAME} ${stamp}`;

  // 1) Unterordner unter "Lead Scraping" anlegen
  const folder = await reqJson("POST", "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink", token, {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
    parents: [LEAD_SCRAPING_FOLDER],
  });
  log(`Ordner: ${folderName}  ->  https://drive.google.com/drive/folders/${folder.id}`);

  // 2) Spreadsheet anlegen (mit Tab "Tabellenblatt1")
  const ss = await reqJson("POST", "https://sheets.googleapis.com/v4/spreadsheets", token, {
    properties: { title: folderName },
    sheets: [{ properties: { title: TAB } }],
  });
  const ssId = ss.spreadsheetId;

  // 3) Spreadsheet in den Batch-Ordner verschieben (aus dem Drive-Root raus)
  await reqJson("PATCH",
    `https://www.googleapis.com/drive/v3/files/${ssId}?addParents=${folder.id}&removeParents=root&fields=id,parents`,
    token, {});

  log(`Sheet:  ${folderName}  ->  https://docs.google.com/spreadsheets/d/${ssId}`);
  process.stdout.write(ssId); // NUR die ID auf STDOUT
})().catch((e) => { console.error("create-batch-sheet-Fehler:", e.message); process.exit(1); });
