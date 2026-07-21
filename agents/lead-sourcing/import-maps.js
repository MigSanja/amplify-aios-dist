#!/usr/bin/env node
// Import: Apify-Google-Maps-Dataset -> Lead-Sheet.
// Zieht die gescrapten Makler aus einem Apify-Dataset, filtert auf ICP (Verkaufs-Makler,
// keine Behörden/Banken/Notare/reine Verwaltung), setzt Header + Zeilen ins Google Sheet.
//
// Nutzung:
//   node leads/import-maps.js <APIFY_DATASET_ID> [Tab]
//   (Tab default: "Tabellenblatt1")
//
// APIFY_TOKEN wird aus der lokalen .env gelesen (oder aus process.env.APIFY_TOKEN).

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { writeMatrix } = require("./gsheet-client");

const DATASET_ID = process.argv[2];
const TAB = process.argv[3] || "Tabellenblatt1";
if (!DATASET_ID) { console.error("Nutzung: node leads/import-maps.js <APIFY_DATASET_ID> [Tab]"); process.exit(1); }

function apifyToken() {
  if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN;
  const envPath = path.join(__dirname, ".env");
  const m = fs.readFileSync(envPath, "utf8").match(/APIFY_TOKEN=(.+)/);
  if (!m) throw new Error("APIFY_TOKEN nicht gefunden (Jarvis/.env)");
  return m[1].trim();
}

function fetchDataset(datasetId, token) {
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json&token=${token}`;
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let d = ""; r.on("data", (c) => (d += c));
      r.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error("Dataset-Parse: " + d.slice(0, 200))); } });
    }).on("error", reject);
  });
}

// ICP-Filter: Verkaufs-Makler klein/mittel. Raus: Behörden, Banken, Notare, Gutachter, reine Verwaltung.
const KEEP = /immobilien|makler|estate|grundst/i;
const DROP = /beh(ö|oe)rde|amt|gewerbe|bank|sparkasse|notar|gutachter|sachverst|hausverwalt|verwaltung|versicherung|architekt|bautr|handwerk|reinigung/i;

function isICP(item) {
  const cat = String(item.categoryName || "");
  const title = String(item.title || "");
  const hay = cat + " " + title;
  if (DROP.test(hay)) return false;
  return KEEP.test(hay);
}

const HEADER = [
  "Firma", "Kategorie", "Adresse", "PLZ", "Ort", "Telefon",
  "Website", "Domain", "E-Mail (Maps)", "Google Maps",
  "GF Name", "AnyMail for Any E-Mail", "E-Mail Status", "Quelle", "Datum",
];

function rowFrom(item) {
  const emails = Array.isArray(item.emails) ? item.emails.join(", ") : "";
  return [
    item.title || "",
    item.categoryName || "",
    item.address || "",
    item.postalCode || "",
    item.city || "",
    item.phone || "",
    item.website || "",
    item.domain || "",
    emails,
    item.url || "",
    "", "", "",              // GF Name / GF E-Mail / Status (AnyMailFinder füllt später)
    "Google Maps (Apify)",   // Quelle
    "18.07.2026",            // Datum
  ];
}

(async () => {
  const token = apifyToken();
  const items = await fetchDataset(DATASET_ID, token);
  const icp = items.filter(isICP);
  // Dedup per Domain bzw. Titel
  const seen = new Set();
  const uniq = icp.filter((it) => {
    const k = (it.domain || it.title || "").toLowerCase().trim();
    if (!k || seen.has(k)) return false; seen.add(k); return true;
  });
  const rows = [HEADER, ...uniq.map(rowFrom)];
  const n = await writeMatrix(TAB, rows);
  const withMail = uniq.filter((it) => (it.emails || []).length).length;
  console.log(`Gesamt gescraped: ${items.length}`);
  console.log(`Nach ICP-Filter:  ${icp.length}`);
  console.log(`Nach Dedup:       ${uniq.length}  (davon ${withMail} mit E-Mail vom Maps-Scrape)`);
  console.log(`Ins Sheet:        ${n - 1} Zeilen + Header  ->  Tab "${TAB}"`);
})().catch((e) => { console.error("Import-Fehler:", e.message); process.exit(1); });
