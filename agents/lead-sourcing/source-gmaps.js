#!/usr/bin/env node
// Quelle: Google Maps (Apify Actor lukaskrivka/google-maps-with-contact-details).
// Startet den Scrape für eine Stadt + Suchbegriffe, wartet auf Abschluss und gibt die
// Apify-Dataset-ID auf STDOUT aus (Logs gehen auf STDERR, damit STDOUT nur die ID ist).
// Der Orchestrator pipet die ID direkt in import-maps.js.
//
//   node leads/source-gmaps.js "Berlin"                 # Default-Suchbegriffe
//   node leads/source-gmaps.js "München" "Immobilienmakler,Immobilienbüro"
//
// APIFY_TOKEN aus der .env.

const fs = require("fs");
const path = require("path");
const https = require("https");

const CITY = process.argv[2] || "Berlin";
const TERMS = (process.argv[3] || "Immobilienmakler,Immobilienbüro,Immobilienvermittlung")
  .split(",").map(s => s.trim()).filter(Boolean);
const MAX_PER_SEARCH = parseInt(process.argv[4] || "250", 10);
const ACTOR = "lukaskrivka~google-maps-with-contact-details";

const log = (...a) => console.error(...a);

function token() {
  if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN;
  const p = path.join(__dirname, ".env");
  const m = fs.existsSync(p) && fs.readFileSync(p, "utf8").match(/APIFY_TOKEN=(.+)/);
  if (!m) throw new Error("APIFY_TOKEN fehlt (.env)");
  return m[1].trim();
}

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const headers = {};
    if (data) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(data); }
    const r = https.request({ host: u.host, path: u.pathname + u.search, method, headers }, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } });
    });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const tok = token();
  const input = {
    searchStringsArray: TERMS,
    locationQuery: `${CITY}, Germany`,
    maxCrawledPlacesPerSearch: MAX_PER_SEARCH,
    language: "de",
    skipClosedPlaces: true,
  };
  log(`Sourcing: ${TERMS.join(" / ")} in ${CITY} (max ${MAX_PER_SEARCH}/Suche) ...`);
  const start = await req("POST", `https://api.apify.com/v2/acts/${ACTOR}/runs?token=${tok}`, input);
  const runId = start.data && start.data.id;
  if (!runId) throw new Error("Actor-Start fehlgeschlagen: " + JSON.stringify(start).slice(0, 200));
  log(`Run ${runId} gestartet, warte auf Abschluss ...`);

  let status = "RUNNING", datasetId = null, n = 0;
  for (let i = 0; i < 80; i++) {          // bis ~20 min
    await sleep(15000);
    const r = await req("GET", `https://api.apify.com/v2/actor-runs/${runId}?token=${tok}`);
    status = r.data.status;
    datasetId = r.data.defaultDatasetId;
    n = (r.data.stats && r.data.stats.itemCount) || n;
    log(`  [${i}] ${status} — ${n} Treffer`);
    if (status !== "RUNNING" && status !== "READY") break;
  }
  if (status !== "SUCCEEDED") throw new Error(`Run endete mit Status ${status}`);
  log(`Fertig: ${n} Rohtreffer, Dataset ${datasetId}`);
  process.stdout.write(datasetId); // NUR die ID auf STDOUT
})().catch(e => { console.error("source-gmaps-Fehler:", e.message); process.exit(1); });
