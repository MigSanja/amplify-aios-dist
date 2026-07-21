#!/usr/bin/env node
// Google Sheet Helper — direkter Zugriff über des Nutzers Google-Cloud-Credentials (OAuth), OHNE n8n, OHNE gcloud-CLI.
// Nutzt config/.gcreds/*.json (client_id, client_secret, refresh_token). Refresht den access_token selbst.
//
// Nutzung (der Outreach-Agent ruft das per Bash auf):
//   node dashboard/gsheet.js append "<Blatt>" "<Name>" "<Profil-URL>" "<Source>" "<TT.MM.JJJJ>"   -> hängt eine Kontakt-Zeile an (Spalten F–M)
//   node dashboard/gsheet.js count  "<Blatt>"                                                       -> zählt befüllte Kontakte (Spalte F, ohne Header)
//   node dashboard/gsheet.js sheets                                                                 -> listet alle Blätter
//   node dashboard/gsheet.js read   "<Blatt>" "<A1:K50>"                                            -> liest einen Bereich (JSON)
//
// Spalten-Layout des Erstkontakt-Blatts (bestätigt): F=Lead Name (Name + URL), G=Contacted On ("der Nutzer LinkedIn"),
// H=Source ("Erstkontakt "/"InMail "/"Follow-up "), I=Date (TT.MM.JJJJ), J=Contaced? ("Yes"), K=Replied?, L=Call Proposed?, M=Setting.
// WICHTIG: values.append verschiebt Daten (Google ankert an Spalte F) — deshalb schreiben wir mit values.update in einen EXPLIZITEN F..M-Bereich.

const https = require("https");
const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("./atomic-write");

const ROOT = path.resolve(__dirname, "..");
const SHEET_ID = process.env.OUTREACH_SHEET_ID || "";
const GCRED_DIR = path.join(ROOT, "config", ".gcreds");

function credFile() {
  const f = fs.readdirSync(GCRED_DIR).find((x) => x.endsWith(".json"));
  if (!f) throw new Error("keine gcreds-Datei in config/.gcreds/");
  return path.join(GCRED_DIR, f);
}
function loadCreds() { return JSON.parse(fs.readFileSync(credFile(), "utf8")); }
function saveCreds(c) { writeJsonAtomic(credFile(), c); }

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
  if (c.token && exp && exp - Date.now() > 120000) return c.token; // noch >2min gültig
  const form = `client_id=${encodeURIComponent(c.client_id)}&client_secret=${encodeURIComponent(c.client_secret)}&refresh_token=${encodeURIComponent(c.refresh_token)}&grant_type=refresh_token`;
  const r = await post("oauth2.googleapis.com", "/token", { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(form) }, form);
  if (r.status >= 400) throw new Error("Token-Refresh fehlgeschlagen: " + r.body.slice(0, 200));
  const j = JSON.parse(r.body);
  c.token = j.access_token; c.expiry = new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString();
  saveCreds(c); return c.token;
}

const base = (rng) => `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(rng)}`;

async function nextRow(token, blatt) {
  const r = await reqJson("GET", base(`${blatt}!F2:F100000`), token);
  const rows = r.values || [];
  let last = 1; // Header = Zeile 1
  rows.forEach((row, i) => { if (row && String(row[0] || "").trim()) last = i + 2; });
  return last + 1;
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  const token = await getToken();

  if (cmd === "sheets") {
    const r = await reqJson("GET", `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`, token);
    console.log((r.sheets || []).map((s) => s.properties.title).join("\n")); return;
  }
  if (cmd === "count") {
    const blatt = a[0]; const r = await reqJson("GET", base(`${blatt}!F2:F100000`), token);
    console.log((r.values || []).filter((x) => x && x[0] != null && String(x[0]).trim()).length); return;
  }
  if (cmd === "read") {
    const [blatt, rng] = a; const r = await reqJson("GET", base(`${blatt}!${rng}`), token);
    console.log(JSON.stringify(r.values || [])); return;
  }
  if (cmd === "append") {
    const [blatt, name, url, source, date] = a;
    if (!blatt || !name || !source || !date) { console.error('Nutzung: append "<Blatt>" "<Name>" "<URL>" "<Source>" "<TT.MM.JJJJ>"'); process.exit(1); }
    const row = [`${name} ${url || ""}`.trim(), "der Nutzer LinkedIn", source, date, "Yes", "", "", ""]; // F..M
    const n = await nextRow(token, blatt);
    await reqJson("PUT", base(`${blatt}!F${n}:M${n}`) + "?valueInputOption=USER_ENTERED", token, { values: [row] });
    console.log(`ok Zeile ${n}: ${name} (${source.trim()})`); return;
  }
  if (cmd === "update") {
    // Bestehende Zeile(n) finden und Spalten setzen. MATCH PER PROFIL-URL BEVORZUGT (ein früherer Vorfall 10.07.:
    // Name-Match traf die falsche von zwei Namens-Dubletten → Stufe lief auf der falschen Zeile hoch,
    // die gelesene Zeile blieb ewig "Erstkontakt" → Duplikat-Nachricht). URL identifiziert die Person
    // eindeutig; bei mehreren Zeilen mit derselben URL werden ALLE aktualisiert (hält Dubletten synchron
    // statt eine stale zurückzulassen). Name-Match bleibt als Fallback, warnt aber.
    const [blatt, matchF, ...pairs] = a;
    if (!blatt || !matchF || pairs.length < 2 || pairs.length % 2 !== 0) { console.error('Nutzung: update "<Blatt>" "<Profil-URL oder Name>" <Spalte> <Wert> [<Spalte> <Wert>...]  (z.B. H "Follow Up 1" I "02.07.2026" K "Yes") — IMMER die Profil-URL als Match nutzen!'); process.exit(1); }
    const norm = (s) => String(s || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").trim();
    const isUrl = /linkedin\.com\//i.test(matchF);
    const needle = isUrl ? norm(matchF) : matchF;
    const r = await reqJson("GET", base(`${blatt}!F2:F100000`), token);
    const rows = r.values || []; const hits = [];
    for (let i = 0; i < rows.length; i++) {
      const f = String((rows[i] && rows[i][0]) || ""); if (!f) continue;
      if (isUrl ? norm(f).includes(needle) : f.includes(matchF)) hits.push(i + 2);
    }
    if (!hits.length) { console.error("kein Treffer in Spalte F für: " + matchF); process.exit(1); }
    if (!isUrl && hits.length > 1) console.error(`WARNUNG: ${hits.length} Zeilen matchen den NAMEN (${hits.join(", ")}) — nutze künftig die Profil-URL! Aktualisiere alle.`);
    for (const rownum of hits) {
      for (let k = 0; k < pairs.length; k += 2) {
        const col = pairs[k].toUpperCase(), val = pairs[k + 1];
        await reqJson("PUT", base(`${blatt}!${col}${rownum}`) + "?valueInputOption=USER_ENTERED", token, { values: [[val]] });
      }
    }
    console.log(`ok Zeile(n) ${hits.join(", ")} aktualisiert (${matchF.slice(0, 60)})`); return;
  }
  if (cmd === "clearrow") {
    // Dubletten-Hygiene: leert F..M einer Zeile (Zeile bleibt bestehen, kein Verschieben der Indizes).
    const [blatt, n] = a; const rn = parseInt(n, 10);
    if (!blatt || !rn || rn < 2) { console.error('Nutzung: clearrow "<Blatt>" <Zeilennummer≥2>'); process.exit(1); }
    await reqJson("PUT", base(`${blatt}!F${rn}:M${rn}`) + "?valueInputOption=USER_ENTERED", token, { values: [["", "", "", "", "", "", "", ""]] });
    console.log(`ok Zeile ${rn} geleert (F..M)`); return;
  }
  console.error('Unbekannter Befehl. Erlaubt: append | update | clearrow | count | read | sheets'); process.exit(1);
}
main().catch((e) => { console.error("gsheet-Fehler:", e.message); process.exit(1); });
