// einwand-bib.js — WACHSENDE Einwand-Bibliothek (Einwand -> beste Antwort).
// Ergänzt die feste MMS-Methodik (einwand.js) um konkrete, im echten Call bewährte
// Antworten. Wird nach jedem Call von Opus befüllt (Nachverarbeitung) und in den
// Live-Tipp-Prompt eingespeist, damit das schnelle Modell die Antwort NACHSCHLAGEN
// statt selbst herleiten muss (schneller + konsistenter).
//
// Speicher: data/einwand-bibliothek.json  { eintraege: [{ einwand, antwort, kategorie, quelle, datum }] }

const fs = require("fs");
const path = require("path");

const BIB_FILE = path.join(__dirname, "data", "einwand-bibliothek.json");

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(BIB_FILE, "utf8"));
    return Array.isArray(j.eintraege) ? j.eintraege : [];
  } catch {
    return [];
  }
}

// Dedupe-Schlüssel: Kern des Einwands, klein + entkernt (Interpunktion/Leerzeichen raus).
function normKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-zäöüß0-9]+/g, " ")
    .trim()
    .slice(0, 80);
}

// Für den (gecachten) Live-Prompt: kompakte Liste Einwand -> beste Antwort.
// Neueste zuletzt gelernte zuerst begrenzen, damit der Prompt nicht unbegrenzt wächst.
function formatForPrompt(max = 40) {
  const e = load();
  if (!e.length) return "";
  return e
    .slice(-max)
    .map((x) => `- Einwand: ${x.einwand}\n  Beste Antwort: ${x.antwort}`)
    .join("\n");
}

// Neue Paare (aus der Opus-Nachverarbeitung) mergen. Dedupe über den Einwand-Kern.
// Gibt die Anzahl der neu aufgenommenen Einwände zurück.
function mergeNew(pairs, meta = {}) {
  if (!Array.isArray(pairs) || !pairs.length) return 0;
  const e = load();
  const seen = new Set(e.map((x) => normKey(x.einwand)));
  let added = 0;
  for (const p of pairs) {
    const einwand = String((p && p.einwand) || "").trim();
    const antwort = String((p && p.antwort) || "").trim();
    if (!einwand || !antwort) continue;
    const k = normKey(einwand);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const entry = { einwand, antwort };
    const kat = String((p && p.kategorie) || "").trim();
    if (kat) entry.kategorie = kat;
    if (meta.quelle) entry.quelle = meta.quelle;
    if (meta.datum) entry.datum = meta.datum;
    e.push(entry);
    added++;
  }
  if (added) {
    try {
      fs.mkdirSync(path.dirname(BIB_FILE), { recursive: true });
      fs.writeFileSync(BIB_FILE, JSON.stringify({ eintraege: e }, null, 2));
    } catch {
      return 0;
    }
  }
  return added;
}

module.exports = { load, formatForPrompt, mergeNew, normKey, BIB_FILE };
