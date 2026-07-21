// Jarvis — Rechnungsmodul (AIOS).
// PDF-Erzeugung headless über Chrome CLI (keine npm-Dependency), Gmail-Entwürfe
// über das workspace-mcp-OAuth-Token (config/.gcreds), Wise-Zahlungsabgleich,
// Auto-Reminder (Stufe 1 nach 14 Tagen, Stufe 2 nach 21 Tagen, danach Schluss —
// siehe Memory jarvis-outreach-followup-backlash). Reminder werden IMMER nur als
// Gmail-ENTWURF angelegt (Freigabe durch der Nutzer), nie automatisch versendet.
// Genutzt von server.js (Routen /api/rechnung/*) und watcher.js (10-Min-Takt).

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const { writeJsonAtomic } = require("./atomic-write");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(__dirname, "data");
const RECH_DIR = path.join(DATA, "rechnungen");
const INVOICES = path.join(DATA, "invoices.json");
const KUNDEN = path.join(DATA, "rechnung-kunden.json");
const CREDS_FILE = path.join(ROOT, "config", ".gcreds", (process.env.GOOGLE_CREDS_FILE || "credentials.json"));
const TOOL_HTML = path.join(__dirname, "rechnungstool.html");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const DEFAULT_KUNDEN = [];

function envVal(name) {
  try { const e = fs.readFileSync(path.join(ROOT, ".env"), "utf8"); const m = e.match(new RegExp("^" + name + "=(.+)$", "m")); return m ? m[1].trim() : null; } catch { return null; }
}
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

// ---- Kunden ----
function loadKunden() {
  const d = loadJson(KUNDEN, null);
  if (d && Array.isArray(d.kunden) && d.kunden.length) return d;
  return { kunden: DEFAULT_KUNDEN };
}
function saveKunden(kunden) {
  const data = { kunden: Array.isArray(kunden) ? kunden : [] };
  fs.mkdirSync(DATA, { recursive: true });
  writeJsonAtomic(KUNDEN, data, 2);
  return data;
}

// ---- Rechnungen (invoices.json) ----
function loadInvoices() { return loadJson(INVOICES, { invoices: [] }); }
function saveInvoices(data) { fs.mkdirSync(DATA, { recursive: true }); writeJsonAtomic(INVOICES, data, 2); }

function fmtDE(iso) { if (!iso) return ""; const [y, m, d] = String(iso).split("-"); return `${d}.${m}.${y}`; }
function eur(n) { return (Number(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
function vorname(iv) { return String(iv.ansprechpartner || iv.kunde || "").trim().split(/\s+/)[0] || ""; }
function anrede(iv) { const v = vorname(iv); return v ? `Hi ${v},` : "Hallo,"; }

// ---- PDF: Chrome headless druckt das Rechnungstool mit ?data=-Prefill ----
function generatePdf(data, outPath) {
  const b64 = Buffer.from(JSON.stringify(data), "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const url = "file://" + TOOL_HTML + "?data=" + b64;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  try { fs.unlinkSync(outPath); } catch {}
  const profile = path.join(os.tmpdir(), "jarvis-chrome-pdf");
  const r = spawnSync(CHROME, [
    "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=" + profile, "--virtual-time-budget=4000",
    "--no-pdf-header-footer", "--print-to-pdf=" + outPath, url,
  ], { encoding: "utf8", timeout: 60000 });
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) {
    throw new Error("PDF-Erzeugung fehlgeschlagen: " + ((r.stderr || r.stdout || "Chrome ohne Output").trim().slice(-200)));
  }
  return outPath;
}

// ---- Google OAuth (gleiches Token wie watcher.js) ----
async function googleToken() {
  const c = JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
  const body = new URLSearchParams({
    client_id: c.client_id, client_secret: c.client_secret,
    refresh_token: c.refresh_token, grant_type: "refresh_token",
  });
  const r = await fetch(c.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("kein Google access_token");
  return j.access_token;
}

async function gmailDraft({ to, subject, text, attachPath }) {
  const tok = await googleToken();
  const subj = "=?UTF-8?B?" + Buffer.from(subject, "utf8").toString("base64") + "?=";
  let mime = `To: ${to}\r\nSubject: ${subj}\r\nMIME-Version: 1.0\r\n`;
  if (attachPath && fs.existsSync(attachPath)) {
    const boundary = "jarvis" + Date.now();
    const pdfB64 = fs.readFileSync(attachPath).toString("base64").replace(/(.{76})/g, "$1\r\n");
    const name = path.basename(attachPath);
    mime += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
      Buffer.from(text, "utf8").toString("base64") + `\r\n` +
      `--${boundary}\r\nContent-Type: application/pdf; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
      pdfB64 + `\r\n--${boundary}--`;
  } else {
    mime += `Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n` + Buffer.from(text, "utf8").toString("base64");
  }
  const raw = Buffer.from(mime, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!r.ok) throw new Error("Gmail Draft HTTP " + r.status + ": " + (await r.text()).slice(0, 200));
  return (await r.json()).id;
}

// ---- Mail-Texte (des Nutzers Stil: Fließtext, keine Gedankenstriche, weicher Ton) ----
function invoiceMailText(iv) {
  const desc = (iv.positionen && iv.positionen[0] && iv.positionen[0].desc) || "";
  return `${anrede(iv)}\n\nanbei die Rechnung ${iv.nr} über ${eur(iv.betrag)}${desc ? " (" + desc.split("\n")[0] + ")" : ""}. Zahlungsziel ist der ${fmtDE(iv.faellig)}, die Bankverbindung steht auf der Rechnung.\n\nWenn was unklar ist, sag einfach Bescheid.\n\nBeste Grüße\n<DEIN_NAME>`;
}
function reminderMail(iv, stufe) {
  if (stufe <= 1) return {
    subject: `Kurze Erinnerung: Rechnung ${iv.nr}`,
    text: `${anrede(iv)}\n\nich wollte nur kurz an die Rechnung ${iv.nr} über ${eur(iv.betrag)} vom ${fmtDE(iv.datum)} erinnern, die ist bei mir noch als offen markiert. Kann gut sein, dass die einfach untergegangen ist, deshalb hänge ich sie nochmal an.\n\nWenn die Zahlung schon unterwegs ist, kannst du diese Mail ignorieren.\n\nBeste Grüße\n<DEIN_NAME>`,
  };
  return {
    subject: `Rechnung ${iv.nr} ist noch offen`,
    text: `${anrede(iv)}\n\ndie Rechnung ${iv.nr} über ${eur(iv.betrag)} vom ${fmtDE(iv.datum)} ist immer noch offen. Magst du kurz schauen, dass die Überweisung rausgeht? Die PDF hänge ich nochmal an.\n\nFalls es irgendeinen Grund gibt oder was unklar ist, sag mir einfach kurz Bescheid.\n\nBeste Grüße\n<DEIN_NAME>`,
  };
}

// ---- Rechnung speichern: PDF erzeugen + invoices.json + optional Gmail-Entwurf ----
async function saveInvoice(data, opts = {}) {
  const d = data || {};
  const nr = String(d.r_nr || "").trim();
  if (!nr) throw new Error("Rechnungsnr. fehlt");
  if (!String(d.k_firma || "").trim()) throw new Error("Kunde fehlt");
  const positionen = (Array.isArray(d.positions) ? d.positions : [])
    .map((p) => ({ desc: String(p.desc || ""), qty: String(p.qty || "1"), price: String(p.price || "0"), total: String(p.total || "0") }))
    .filter((p) => p.desc.trim() || parseFloat(p.total));
  const betrag = positionen.reduce((s, p) => s + (parseFloat(p.total) || 0), 0);
  const datum = d.r_datum || new Date().toISOString().slice(0, 10);
  const faellig = d.r_faellig || new Date(new Date(datum).getTime() + 14 * 86400000).toISOString().slice(0, 10);

  const pdfName = "Rechnung_" + nr.replace(/[^A-Za-z0-9._-]+/g, "-") + ".pdf";
  generatePdf({ ...d, r_datum: datum, positions: positionen }, path.join(RECH_DIR, pdfName));

  const store = loadInvoices();
  store.invoices = store.invoices.filter((iv) => iv.nr !== nr);
  const iv = {
    nr, knr: d.r_knr || "", kunde: d.k_firma, ansprechpartner: d.k_name || "",
    email: (d.k_email || "").trim(), betrag: Math.round(betrag * 100) / 100,
    datum, faellig, status: "offen", pdf: pdfName, positionen, reminders: [],
  };
  store.invoices.push(iv);
  store.invoices.sort((a, b) => String(b.datum).localeCompare(String(a.datum)));

  let draftId = null;
  if (opts.draft) {
    if (!iv.email) throw new Error("Kunden-E-Mail fehlt für den Gmail-Entwurf");
    const desc = (positionen[0] && positionen[0].desc.split("\n")[0]) || "";
    draftId = await gmailDraft({
      to: iv.email,
      subject: desc ? `Rechnung ${nr}: ${desc}` : `Rechnung ${nr}`,
      text: invoiceMailText(iv),
      attachPath: path.join(RECH_DIR, pdfName),
    });
    iv.draftId = draftId;
  }
  saveInvoices(store);
  return { ok: true, nr, betrag: iv.betrag, faellig, pdf: "/rechnungen/" + encodeURIComponent(pdfName), draftId };
}

// ---- Wise: Zahlungseingänge (CREDIT, EUR) gegen offene Rechnungen matchen ----
async function wiseCredits(days = 180) {
  const token = envVal("WISE_API_TOKEN");
  if (!token) throw new Error("kein WISE_API_TOKEN in .env");
  const base = "https://api.transferwise.com", H = { Authorization: "Bearer " + token };
  const end = new Date(), start = new Date(Date.now() - days * 86400000);
  const pr = await fetch(base + "/v1/profiles", { headers: H });
  if (!pr.ok) throw new Error("Wise Profiles HTTP " + pr.status);
  const profiles = await pr.json(), out = [];
  for (const p of profiles) {
    let bals = [];
    try { const br = await fetch(base + "/v4/profiles/" + p.id + "/balances?types=STANDARD", { headers: H }); if (br.ok) bals = await br.json(); } catch {}
    for (const bal of bals) {
      const cur = bal.amount && bal.amount.currency;
      if (cur !== "EUR" || !bal.id) continue;
      const url = base + "/v1/profiles/" + p.id + "/balance-statements/" + bal.id + "/statement.json?currency=EUR&intervalStart=" + start.toISOString() + "&intervalEnd=" + end.toISOString() + "&type=COMPACT";
      try {
        const r = await fetch(url, { headers: H });
        if (!r.ok) continue;
        const dd = await r.json();
        for (const t of (dd.transactions || [])) {
          if (t.type !== "CREDIT") continue;
          const val = t.amount && t.amount.value;
          if (val == null) continue;
          out.push({ datum: String(t.date || "").slice(0, 10), betrag: Math.abs(val), beschreibung: String(t.details && t.details.description || "").slice(0, 120), konto: p.type });
        }
      } catch {}
    }
  }
  return out;
}

async function matchWise() {
  const store = loadInvoices();
  const open = store.invoices.filter((iv) => iv.status !== "bezahlt" && Number(iv.betrag) > 0);
  if (!open.length) return { matched: [] };
  const credits = await wiseCredits();
  const matched = [];
  for (const iv of open) {
    const idx = credits.findIndex((c) => Math.abs(c.betrag - Number(iv.betrag)) < 0.01 && (!iv.datum || c.datum >= iv.datum));
    if (idx === -1) continue;
    const hit = credits.splice(idx, 1)[0];
    iv.status = "bezahlt";
    iv.bezahltAm = hit.datum;
    iv.zahlungsQuelle = "wise: " + (hit.beschreibung || "").slice(0, 80);
    matched.push({ nr: iv.nr, kunde: iv.kunde, betrag: iv.betrag, datum: hit.datum });
  }
  if (matched.length) saveInvoices(store);
  return { matched };
}

// ---- Reminder: als Gmail-ENTWURF (Freigabe), Stufe 1 = 14 Tage, Stufe 2 = 21 Tage ----
async function createReminderDraft(store, iv, stufe) {
  if (!iv.email) throw new Error("Rechnung " + iv.nr + " hat keine Kunden-E-Mail");
  const m = reminderMail(iv, stufe);
  const attach = iv.pdf ? path.join(RECH_DIR, iv.pdf) : null;
  const draftId = await gmailDraft({ to: iv.email, subject: m.subject, text: m.text, attachPath: attach });
  iv.reminders = iv.reminders || [];
  iv.reminders.push({ datum: new Date().toISOString().slice(0, 10), stufe, draftId });
  saveInvoices(store);
  return { ok: true, nr: iv.nr, kunde: iv.kunde, stufe, draftId };
}

async function manualReminder(nr) {
  const store = loadInvoices();
  const iv = store.invoices.find((x) => x.nr === nr);
  if (!iv) throw new Error("Rechnung nicht gefunden: " + nr);
  const stufe = Math.min(((iv.reminders || []).length) + 1, 2);
  return createReminderDraft(store, iv, stufe);
}

async function autoReminders() {
  const store = loadInvoices();
  const today = new Date().toISOString().slice(0, 10);
  const created = [], skipped = [];
  for (const iv of store.invoices) {
    if (iv.status === "bezahlt" || !iv.datum) continue;
    const days = Math.floor((new Date(today) - new Date(iv.datum)) / 86400000);
    const rem = iv.reminders || [];
    if (rem.some((r) => r.datum === today)) continue; // heute schon erinnert
    let stufe = 0;
    if (rem.length === 0 && days >= 14) stufe = 1;
    else if (rem.length === 1 && days >= 21) stufe = 2;
    if (!stufe) continue;
    if (!iv.email) { skipped.push({ nr: iv.nr, grund: "keine E-Mail" }); continue; }
    try { created.push(await createReminderDraft(store, iv, stufe)); }
    catch (e) { skipped.push({ nr: iv.nr, grund: String(e.message).slice(0, 120) }); }
  }
  return { created, skipped };
}

module.exports = {
  RECH_DIR, loadKunden, saveKunden, loadInvoices, saveInvoices,
  saveInvoice, matchWise, manualReminder, autoReminders, gmailDraft,
};
