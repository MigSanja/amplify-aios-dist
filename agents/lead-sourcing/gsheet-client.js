#!/usr/bin/env node
// Minimaler Google-Sheets-Client für das Lead-Sheet (Makler-Kunden-Leads).
// Nutzt des Nutzers bestehende OAuth-Creds aus dem Jarvis-Repo (config/.gcreds/*.json) — refresht den Token selbst.
// Kein n8n, keine gcloud-CLI. Zweck: Header setzen + Zeilen ins Lead-Sheet schreiben/lesen.

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");

const GCRED_DIR = path.join(os.homedir(), "AIOS/config/.gcreds");
// Ziel-Sheet via LEAD_SHEET_ID (leer = kein Sheet-Export).
const SHEET_ID = process.env.LEAD_SHEET_ID || "";

function credFile() {
  const f = fs.readdirSync(GCRED_DIR).find((x) => x.endsWith(".json"));
  if (!f) throw new Error("keine gcreds-Datei in " + GCRED_DIR);
  return path.join(GCRED_DIR, f);
}
function loadCreds() { return JSON.parse(fs.readFileSync(credFile(), "utf8")); }
function saveCreds(c) { fs.writeFileSync(credFile(), JSON.stringify(c, null, 2)); }

function post(host, pathName, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path: pathName, method: "POST", headers }, (r) => {
      let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => resolve({ status: r.statusCode, body: d }));
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}
function reqJson(method, url, token, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { Authorization: "Bearer " + token };
    let body = null;
    if (payload) { body = JSON.stringify(payload); headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(body); }
    const req = https.request({ host: u.host, path: u.pathname + u.search, method, headers }, (r) => {
      let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => {
        if (r.statusCode >= 400) return reject(new Error(`${method} ${u.pathname} -> ${r.statusCode}: ${d.slice(0, 300)}`));
        try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); }
      });
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}

async function getToken() {
  const c = loadCreds();
  const exp = c.expiry ? Date.parse(c.expiry) : 0;
  if (c.token && exp && exp - Date.now() > 120000) return c.token;
  const form = `client_id=${encodeURIComponent(c.client_id)}&client_secret=${encodeURIComponent(c.client_secret)}&refresh_token=${encodeURIComponent(c.refresh_token)}&grant_type=refresh_token`;
  const r = await post("oauth2.googleapis.com", "/token", { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(form) }, form);
  if (r.status >= 400) throw new Error("Token-Refresh fehlgeschlagen: " + r.body.slice(0, 200));
  const j = JSON.parse(r.body);
  c.token = j.access_token; c.expiry = new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString();
  saveCreds(c); return c.token;
}

const base = (rng) => `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(rng)}`;

// Schreibt eine Matrix ab A1 (überschreibt vorhandene Zellen im Bereich).
async function writeMatrix(tab, rows) {
  const token = await getToken();
  const endCol = String.fromCharCode(64 + Math.max(1, rows[0].length)); // A..Z (unsere Spaltenzahl < 26)
  const rng = `${tab}!A1:${endCol}${rows.length}`;
  // RAW, damit Telefonnummern mit führendem "+" nicht als Formel interpretiert werden (#ERROR!).
  await reqJson("PUT", base(rng) + "?valueInputOption=RAW", token, { values: rows });
  return rows.length;
}

// Schreibt eine Matrix in einen expliziten A1-Bereich (z.B. "K2:M120"), RAW.
async function writeRange(tab, a1, rows) {
  const token = await getToken();
  await reqJson("PUT", base(`${tab}!${a1}`) + "?valueInputOption=RAW", token, { values: rows });
  return rows.length;
}

async function readRange(tab, rng) {
  const token = await getToken();
  const r = await reqJson("GET", base(`${tab}!${rng}`), token);
  return r.values || [];
}

module.exports = { getToken, reqJson, base, writeMatrix, writeRange, readRange, SHEET_ID };

// CLI: node gsheet-client.js read "<Tab>" "<A1:K10>"
if (require.main === module) {
  const [cmd, tab, rng] = process.argv.slice(2);
  (async () => {
    if (cmd === "read") console.log(JSON.stringify(await readRange(tab, rng || "A1:Z10"), null, 2));
    else console.error("Nutzung: node gsheet-client.js read <Tab> <A1:Range>");
  })().catch((e) => { console.error("gsheet-Fehler:", e.message); process.exit(1); });
}
