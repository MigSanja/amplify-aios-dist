// renderer.js — läuft im Fenster.
// Aufgaben:
//  1) Skript anzeigen
//  2) Audio-Eingang (Kunden-Ton) auswählen und mitschneiden
//  3) Audio live an Deepgram schicken -> Text zurückbekommen
//  4) Bei jeder fertigen Kunden-Aussage Claude um einen Tipp bitten

const $ = (id) => document.getElementById(id);
const dbg = (m) => {
  try {
    window.copilot.log(m);
  } catch {}
};

const statusEl = $("status");
const statusText = $("status-text");
const scriptEl = $("script");
const tipEl = $("tip");
const tipCard = $("tip-card");
const transcriptEl = $("transcript");
const micSelect = $("mic-select");
const sysSelect = $("sys-select");
const scriptSelect = $("script-select");
const listenBtn = $("listen-btn");
const warnEl = $("warn");

let config = null;
let currentScript = ""; // Text des aktuell gewählten Skripts (Setting/Closing)
let currentScriptName = ""; // Name des aktuell gewählten Skripts
let editingOldName = null; // beim Bearbeiten: bisheriger Name (für Umbenennen)
let noteTaker = false; // Note-Taker-Modus: keine Skripte, keine Tipps — nur zuhören
let listening = false;
// aktive Tonquellen: je { speaker, stream, recorder, socket }
let sources = [];

// Live-Tipps: laufen über die CODEX-CLI (OpenAI, ChatGPT-Subscription) — ~6-7s/Tipp (gemessen 11.07.).
// Claude-CLI war mit 13-30s zu langsam, API-pay-per-use unerwünscht. Auswertung nach dem Call = Claude-CLI.
const LIVE_TIPPS = true;

// Letzte Aussagen für den Coaching-Kontext
const transcriptHistory = [];

// Puffer für den aktuell gestreamten Tipp
let tipBuffer = "";
let tipShown = false;

function setStatus(text, live) {
  statusText.textContent = text;
  statusEl.classList.toggle("live", !!live);
}

function showWarn(msg) {
  warnEl.style.display = "block";
  warnEl.textContent = msg;
}
function clearWarn() {
  warnEl.style.display = "none";
}

// Pegel-Balken je Quelle: "Ich" -> Mikro, "Kunde" -> System/BlackHole
function meterTrack(speaker) {
  return document.getElementById(speaker === "Kunde" ? "sys-lvl" : "mic-lvl");
}
function meterFill(speaker) {
  const t = meterTrack(speaker);
  return t ? t.querySelector("i") : null;
}
// alle Balken auf null + Warn-Rahmen weg (beim Start und Stopp)
function resetMeters() {
  for (const id of ["mic-lvl", "sys-lvl"]) {
    const t = document.getElementById(id);
    if (!t) continue;
    t.classList.remove("silent");
    const i = t.querySelector("i");
    if (i) i.style.width = "0%";
  }
}

// --- Start ---
async function init() {
  config = await window.copilot.getConfig();
  dbg(
    "init: hasClaude=" +
      config.hasClaude +
      " deepgram=" +
      (config.deepgramKey ? config.deepgramKey.length + " Zeichen" : "FEHLT") +
      " skripte=" +
      (config.scripts || []).length
  );

  setupSettings();
  setupKeys();
  buildScriptSelector();
  setupScripts();

  // Claude läuft über die Subscription (CLI) — kein API-Key mehr nötig, keine Warnung.

  await loadDevices();

  // Coaching-Streaming-Events (genau einmal registrieren)
  window.copilot.onCoachDelta((delta) => {
    tipBuffer += delta;
    const t = tipBuffer.trim();
    // Reiner Bindestrich = "kein Tipp nötig" -> noch nichts anzeigen
    if (t === "" || /^[-–—]$/.test(t)) return;
    if (!tipShown) {
      tipShown = true;
      tipEl.classList.remove("muted");
      tipCard.classList.remove("active");
      void tipCard.offsetWidth; // Reflow erzwingen
      tipCard.classList.add("active");
    }
    tipEl.textContent = tipBuffer;
  });
  window.copilot.onCoachDone(() => {
    const t = tipBuffer.trim();
    // Kein nützlicher Tipp gekommen -> dezent zurücksetzen (alten Tipp nicht überschreiben)
    if (!tipShown || t === "" || /^[-–—.\s]*$/.test(t)) {
      if (!tipShown) {
        tipEl.classList.add("muted");
        tipEl.textContent = "—";
        tipCard.classList.remove("active");
      }
    }
  });
  window.copilot.onCoachError((m) => showWarn("Claude-Fehler: " + m));

  window.copilot.onClickThroughChanged((on) => {
    setStatus(
      on ? (listening ? "Live · Durchklick" : "Durchklick") : listening ? "Live" : "Bereit",
      listening
    );
  });
}

// ---------- Einstellungen (Schriftgröße, Farben, Transparenz) ----------
const SETTINGS_DEFAULTS = {
  size: 17,
  alpha: 60,
  text: "#d8fff2",
  accent: "#2dffb0",
  tip: "#ffe14d",
  bg: "#0e0f16",
};
let settings = loadSettings();

// "#112233" -> "17, 34, 51"
function hexToRgb(hex) {
  const m = (hex || "").replace("#", "").match(/.{2}/g);
  if (!m || m.length < 3) return "14, 15, 22";
  return m.slice(0, 3).map((h) => parseInt(h, 16)).join(", ");
}

function loadSettings() {
  try {
    return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem("sc-settings") || "{}") };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}
function saveSettings() {
  localStorage.setItem("sc-settings", JSON.stringify(settings));
}

function applySettings() {
  const root = document.documentElement.style;
  root.setProperty("--base-size", settings.size + "px");
  root.setProperty("--bg-alpha", (settings.alpha / 100).toFixed(2));
  root.setProperty("--bg-rgb", hexToRgb(settings.bg));
  root.setProperty("--col-text", settings.text);
  root.setProperty("--col-tip", settings.tip);
  // Eigene Akzentfarbe = einfarbig; Standard = der ursprüngliche Verlauf
  if (settings.accent.toLowerCase() !== SETTINGS_DEFAULTS.accent.toLowerCase()) {
    root.setProperty("--col-accent", settings.accent);
    root.setProperty("--col-accent-2", settings.accent);
  } else {
    root.setProperty("--col-accent", "#2dffb0");
    root.setProperty("--col-accent-2", "#29e0ff");
  }
}

function setupSettings() {
  const gear = $("gear");
  const panel = $("settings");
  const sizeI = $("set-size");
  const alphaI = $("set-alpha");
  const textI = $("set-text");
  const accentI = $("set-accent");
  const tipI = $("set-tip");
  const bgI = $("set-bg");
  const sizeV = $("set-size-val");
  const alphaV = $("set-alpha-val");

  function syncInputs() {
    sizeI.value = settings.size;
    alphaI.value = settings.alpha;
    textI.value = settings.text;
    accentI.value = settings.accent;
    tipI.value = settings.tip;
    bgI.value = settings.bg;
    sizeV.textContent = settings.size + "px";
    alphaV.textContent = settings.alpha + "%";
  }

  syncInputs();
  applySettings();

  gear.addEventListener("click", () => panel.classList.toggle("hidden"));

  sizeI.addEventListener("input", () => {
    settings.size = +sizeI.value;
    sizeV.textContent = settings.size + "px";
    applySettings();
    saveSettings();
  });
  alphaI.addEventListener("input", () => {
    settings.alpha = +alphaI.value;
    alphaV.textContent = settings.alpha + "%";
    applySettings();
    saveSettings();
  });
  textI.addEventListener("input", () => {
    settings.text = textI.value;
    applySettings();
    saveSettings();
  });
  accentI.addEventListener("input", () => {
    settings.accent = accentI.value;
    applySettings();
    saveSettings();
  });
  tipI.addEventListener("input", () => {
    settings.tip = tipI.value;
    applySettings();
    saveSettings();
  });
  bgI.addEventListener("input", () => {
    settings.bg = bgI.value;
    applySettings();
    saveSettings();
  });
  $("set-reset").addEventListener("click", () => {
    settings = { ...SETTINGS_DEFAULTS };
    syncInputs();
    applySettings();
    saveSettings();
  });

  $("set-quit").addEventListener("click", () => {
    window.copilot.quitApp();
  });

  $("set-calls").addEventListener("click", () => {
    window.copilot.openCallsFolder();
  });
}

// ✕-Knopf oben rechts -> App beenden
$("closebtn").addEventListener("click", () => window.copilot.quitApp());

// –-Knopf oben rechts -> Fenster verstecken (läuft im Tray weiter, gleich wie ⌘⇧H)
$("minbtn").addEventListener("click", () => window.copilot.hideWindow());

// Modus-Dropdown füllen: alle Skripte (Setting, Closing, …) + „Note Taker"
function buildScriptSelector() {
  scriptSelect.innerHTML = "";
  (config.scripts || []).forEach((s, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = s.name;
    scriptSelect.appendChild(opt);
  });
  const nt = document.createElement("option");
  nt.value = "nt";
  nt.textContent = "📝 Note Taker";
  scriptSelect.appendChild(nt);

  // zuletzt gewählten Modus wiederherstellen; ohne Skripte direkt Note Taker
  const saved = localStorage.getItem("sc-mode");
  if (saved === "nt" || !(config.scripts || []).length) {
    scriptSelect.value = "nt";
    enterNoteTaker();
  } else {
    selectScript(0);
  }
}

// Note-Taker-Modus: kein Skript, keine Tipps, nichts Sichtbares — hört nur zu
function enterNoteTaker() {
  noteTaker = true;
  currentScript = "";
  currentScriptName = "Note Taker";
  // Kein Live-Tipp (der soll nur bei Setting/Closing soufflieren) — aber die Mitschrift
  // läuft sichtbar mit, damit man SIEHT, dass wirklich aufgezeichnet wird.
  $("tip-section").style.display = "none";
  $("transcript-section").style.display = "";
  transcriptEl.classList.add("muted");
  transcriptEl.textContent = "—";
  scriptEl.innerHTML =
    '<div class="sublabel">📝 Note-Taker-Modus</div>' +
    '<div class="line">Keine Skripte, keine Live-Tipps — aber die Mitschrift läuft sichtbar mit, damit du siehst, dass aufgezeichnet wird.</div>' +
    '<div class="sp"></div>' +
    '<div class="line">Ablauf: „Mithören" klicken → Fenster minimieren (– oder ⌘⇧H). Nach dem Stoppen entstehen Recap + Action-Items automatisch im Jarvis-Brain, die Notiz geht direkt auf.</div>';
  document.getElementById("script-section").scrollTop = 0;
}

function selectScript(i) {
  const s = config.scripts[i];
  if (!s) return;
  noteTaker = false;
  $("tip-section").style.display = "";
  $("transcript-section").style.display = "";
  currentScript = s.content;
  currentScriptName = s.name;
  scriptEl.innerHTML = renderScript(s.content);
  // nach oben scrollen, wenn man das Skript wechselt
  document.getElementById("script-section").scrollTop = 0;
}

// ---------- API-Keys im Setup-Menü ----------
function setupKeys() {
  const dI = $("set-deepgram");
  const lI = $("set-lang");
  const fL = $("foot-lang");
  const hint = $("keys-hint");

  dI.value = config.deepgramKey || "";

  // Sprach-Auswahl: gibt es zweimal (Fußleiste + Settings) — beide immer synchron.
  function paintLang() {
    const v = config.sttLanguage || "de";
    if (lI) lI.value = v;
    if (fL) fL.value = v;
  }
  paintLang();
  async function setLang(val) {
    config.sttLanguage = val;
    paintLang();
    await window.copilot.saveKeys({ sttLanguage: val });
    dbg(`Call-Sprache gesetzt: ${val}`);
  }
  if (lI) lI.addEventListener("change", () => setLang(lI.value));
  if (fL) fL.addEventListener("change", () => setLang(fL.value));

  function refreshHint() {
    const c = "Claude via Subscription ✓"; // läuft über die CLI, kein Key nötig
    const d = config.deepgramKey ? "Deepgram ✓" : "Deepgram fehlt";
    hint.textContent = `${c} · ${d}`;
  }
  refreshHint();

  let t;
  const save = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const res = await window.copilot.saveKeys({
        deepgram: dI.value,
      });
      config.deepgramKey = res.deepgramKey;
      refreshHint();
    }, 400);
  };
  dI.addEventListener("input", save);
}

// ---------- Skripte verwalten (anlegen / bearbeiten / löschen) ----------
function setupScripts() {
  const editor = $("editor");
  const nameI = $("ed-name");
  const contentI = $("ed-content");
  const titleEl = $("ed-title");

  const openEditor = (mode) => {
    if (mode === "new") {
      editingOldName = null;
      titleEl.textContent = "Neues Skript";
      nameI.value = "";
      contentI.value = "";
    } else {
      editingOldName = currentScriptName;
      titleEl.textContent = "Skript bearbeiten";
      nameI.value = currentScriptName;
      contentI.value = currentScript;
    }
    editor.classList.remove("hidden");
    nameI.focus();
  };

  $("script-new").addEventListener("click", () => openEditor("new"));
  $("script-edit").addEventListener("click", () => {
    if (!noteTaker && config.scripts && config.scripts.length) openEditor("edit");
  });
  $("script-del").addEventListener("click", async () => {
    if (noteTaker || !currentScriptName) return;
    if (!confirm(`Skript "${currentScriptName}" wirklich löschen?`)) return;
    const res = await window.copilot.deleteScript({ name: currentScriptName });
    config.scripts = res.scripts;
    buildScriptSelector();
  });

  $("ed-cancel").addEventListener("click", () => editor.classList.add("hidden"));
  $("ed-save").addEventListener("click", async () => {
    const name = nameI.value.trim();
    if (!name) {
      nameI.focus();
      return;
    }
    const res = await window.copilot.saveScript({
      name,
      content: contentI.value,
      oldName: editingOldName,
    });
    config.scripts = res.scripts;
    buildScriptSelector();
    // das gerade gespeicherte Skript auswählen
    const idx = config.scripts.findIndex((s) => s.name === name);
    if (idx >= 0) {
      scriptSelect.value = String(idx);
      selectScript(idx);
    }
    editor.classList.add("hidden");
  });
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Wandelt den reinen Skript-Text in farbig formatiertes HTML um:
// Stages (A/B/C…), nummerierte Abschnitte, Unter-Überschriften,
// Wartepausen [..] und Aufzählungen.
function renderScript(text) {
  const lines = text.split(/\r?\n/);
  let html = "";

  for (const raw of lines) {
    const t = raw.trim();

    if (t === "") {
      html += '<div class="sp"></div>';
      continue;
    }

    const e = escapeHtml(t);

    // Wartepause: ganze Zeile in eckigen Klammern
    if (/^\[.*\]$/.test(t)) {
      html += `<div class="pause">⏳ ${escapeHtml(t.replace(/^\[|\]$/g, ""))}</div>`;
      continue;
    }

    // Titelzeile
    if (/skript/i.test(t) && /(MMS|Setting|Closing)/i.test(t)) {
      html += `<div class="title">${e}</div>`;
      continue;
    }

    // Stage: "A) …" bis "E) …"
    let m = t.match(/^([A-E])\)\s*(.*)$/);
    if (m) {
      html += `<div class="stage">${escapeHtml(m[1])} · ${escapeHtml(m[2])}</div>`;
      continue;
    }

    // Nummerierter Abschnitt: "5. …"
    m = t.match(/^(\d+)\.\s+(.*)$/);
    if (m) {
      html += `<div class="snum">${escapeHtml(m[1])}. ${escapeHtml(m[2])}</div>`;
      continue;
    }

    // Aufzählung: "- …" oder "• …"
    if (/^[-•]\s+/.test(t)) {
      html += `<div class="bullet">${escapeHtml(t.replace(/^[-•]\s+/, ""))}</div>`;
      continue;
    }

    // Unter-Überschrift: endet mit ":" und ist kurz
    if (/:$/.test(t) && t.length <= 60) {
      html += `<div class="sublabel">${e}</div>`;
      continue;
    }

    // Kurze, überschriftartige Zeile (ohne Satzende, beginnt groß)
    if (t.length <= 42 && !/[.?!"]$/.test(t) && /^[A-ZÄÖÜ0-9]/.test(t)) {
      html += `<div class="sublabel">${e}</div>`;
      continue;
    }

    // normale Textzeile
    html += `<div class="line">${e}</div>`;
  }

  return html;
}

scriptSelect.addEventListener("change", () => {
  if (scriptSelect.value === "nt") enterNoteTaker();
  else selectScript(Number(scriptSelect.value));
  localStorage.setItem("sc-mode", scriptSelect.value);
});

// Audio-Eingänge in beide Dropdowns laden.
// Mikrofon = "Ich", System-Audio (BlackHole) = "Kunde".
async function loadDevices() {
  try {
    // Einmal Zugriff anfragen, damit die Gerätenamen sichtbar werden
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch (e) {
    showWarn("Kein Mikrofon-Zugriff. Bitte in den Mac-Systemeinstellungen erlauben.");
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((d) => d.kind === "audioinput");
  dbg("Audio-Eingänge gefunden: " + inputs.map((d) => d.label || "(ohne Label)").join(" | "));

  const fill = (sel, preferBlackhole) => {
    sel.innerHTML = "";
    const off = document.createElement("option");
    off.value = "";
    off.textContent = "— aus —";
    sel.appendChild(off);

    inputs.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || "Eingang";
      const isBH = /blackhole|loopback|aggregate|soundflower/i.test(d.label);
      if (preferBlackhole && isBH) opt.selected = true;
      if (!preferBlackhole && d.deviceId === "default" && !isBH) opt.selected = true;
      sel.appendChild(opt);
    });
  };

  fill(micSelect, false); // Mikrofon (Ich)
  fill(sysSelect, true); // System-Audio / Kunde (BlackHole)

  restoreDevices(); // zuletzt gewählte Geräte wiederherstellen
}

// Geräteauswahl merken (per Label, da deviceId sich ändern kann)
function rememberDevices() {
  try {
    localStorage.setItem(
      "sc-devices",
      JSON.stringify({
        mic: micSelect.selectedOptions[0] ? micSelect.selectedOptions[0].textContent : "",
        sys: sysSelect.selectedOptions[0] ? sysSelect.selectedOptions[0].textContent : "",
      })
    );
  } catch {}
}
function restoreDevices() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem("sc-devices") || "{}");
  } catch {}
  const pick = (sel, label) => {
    if (!label) return;
    for (const o of sel.options) {
      if (o.textContent === label) {
        sel.value = o.value;
        return;
      }
    }
  };
  pick(micSelect, s.mic);
  pick(sysSelect, s.sys);
}
micSelect.addEventListener("change", rememberDevices);
sysSelect.addEventListener("change", rememberDevices);

// --- Mithören starten/stoppen ---
listenBtn.addEventListener("click", () => {
  if (listening) stopListening();
  else startListening();
});

// Tray-Menü ("Mithören starten/stoppen") -> gleicher Weg wie der Button im Fenster
window.copilot.onTrayToggleListen(() => listenBtn.click());

async function startListening() {
  clearWarn();
  resetMeters();

  if (!config.deepgramKey) {
    showWarn("Kein DEEPGRAM_API_KEY in .env — Live-Transkription ist nicht möglich.");
    return;
  }

  const wanted = [
    { speaker: "Ich", deviceId: micSelect.value },
    { speaker: "Kunde", deviceId: sysSelect.value },
  ].filter((s) => s.deviceId); // nur ausgewählte Quellen

  if (wanted.length === 0) {
    showWarn("Bitte mindestens eine Tonquelle wählen (Ich oder Kunde).");
    return;
  }

  const selLabel = (sel) => (sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "(aus)");
  dbg(`startListening: Ich="${selLabel(micSelect)}" Kunde="${selLabel(sysSelect)}"`);
  for (const w of wanted) {
    await openSource(w.deviceId, w.speaker);
  }

  if (sources.length > 0) {
    listening = true;
    listenBtn.textContent = "Stoppen";
    listenBtn.classList.add("stop");
    setStatus("Live", true);
    // Call-Aufzeichnung starten (Transkript-Datei anlegen)
    window.copilot.callStart({
      scriptName: currentScriptName,
      mode: noteTaker ? "notetaker" : "sales",
    });
  }
}

// Eine einzelne Tonquelle öffnen + an Deepgram streamen
async function openSource(deviceId, speaker) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
      },
    });
  } catch (e) {
    dbg(`getUserMedia FEHLER (${speaker}): ` + e.name + " " + e.message);
    showWarn(`Tonquelle "${speaker}" konnte nicht geöffnet werden: ` + e.message);
    return;
  }
  dbg(`getUserMedia ok (${speaker})`);

  // Diagnose: WELCHES Gerät wurde wirklich geöffnet, und meldet macOS den Track als stumm?
  // (Log landet in debug.log — zum Nachvollziehen, wenn "kein Ton" gemeldet wird.)
  try {
    const tr = stream.getAudioTracks()[0];
    const st = tr.getSettings();
    dbg(`Track (${speaker}): label="${tr.label}" muted=${tr.muted} enabled=${tr.enabled} state=${tr.readyState} sr=${st.sampleRate} ec=${st.echoCancellation}`);
    tr.onmute = () => dbg(`Track (${speaker}) MUTED von macOS!`);
    tr.onunmute = () => dbg(`Track (${speaker}) wieder unmuted`);
    tr.onended = () => dbg(`Track (${speaker}) ENDED!`);
  } catch (e) { dbg("Track-Diagnose Fehler: " + e.message); }

  // Quelle sofort registrieren (socket/recorder kommen unten dazu); so kann der
  // Pegel-Block direkt src.ac/src.meter setzen und stopListening räumt sicher auf.
  const src = { speaker, stream, recorder: null, socket: null, ac: null, meter: null };
  sources.push(src);

  // Pegel-Messung: zeigt LIVE im Fenster (Balken pro Quelle), ob wirklich Schall vom
  // Gerät kommt. Ohne das merkt man Stille (falsches Gerät / BlackHole ohne Routing)
  // erst am leeren Transkript nach dem Call. Läuft die ganze Session, auch im Note Taker.
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    // Chromium startet den AudioContext nach dem await teils "suspended" (User-Geste weg);
    // ohne resume() liefert der Analyser nur 128er (Stille) und der Balken bliebe auf 0.
    if (ac.state === "suspended") {
      try { await ac.resume(); } catch {}
    }
    const node = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser();
    an.fftSize = 512;
    node.connect(an);
    const buf = new Uint8Array(an.fftSize);
    const bar = meterFill(speaker);
    const track = meterTrack(speaker);
    let silentTicks = 0;
    let hadSignal = false;
    let warnedSilent = false; // Stille-Warnung wurde gezeigt → beim ersten Ton wieder wegräumen
    let logPeak = 0;
    let ticks = 0;
    src.ac = ac;
    src.meter = setInterval(() => {
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) {
        const d = Math.abs(v - 128);
        if (d > peak) peak = d;
      }
      logPeak = Math.max(logPeak, peak);
      // 0..~90 (Sprache ist selten am Anschlag) -> 0..100 %
      if (bar) bar.style.width = Math.min(100, Math.round((peak / 90) * 100)) + "%";

      if (peak < 3) {
        silentTicks++;
        // Nur die eigene Mikro-Quelle zeitbasiert warnen: ~8 s still und nie Signal =
        // wahrscheinlich Gerät/Rechte kaputt. Kunde/BlackHole ist am Call-Anfang normal
        // still (Gegenüber redet noch nicht) -> dort keine Zeit-Warnung, nur der Balken.
        if (speaker === "Ich" && !hadSignal && silentTicks === 80) {
          warnedSilent = true;
          showWarn(`Quelle "Ich" (Mikro) liefert keinen Ton — Mikrofon-Gerät und macOS-Mikrofonrechte prüfen.`);
          if (track) track.classList.add("silent");
        }
      } else {
        // Erster echter Ton nach einer Stille-Warnung → Fehlalarm, Warnung wegräumen
        // (vorher blieb der rote Text die ganze Session kleben, ein früherer Fall).
        if (warnedSilent) { warnedSilent = false; clearWarn(); }
        hadSignal = true;
        silentTicks = 0;
        if (track) track.classList.remove("silent");
      }

      // sparsam ins Debug-Log (alle 2 s) — für spätere Fehlersuche
      if (++ticks % 20 === 0) {
        dbg(`Pegel (${speaker}): ${logPeak}/128 ${logPeak < 3 ? "(STILL!)" : "(Ton ok)"}`);
        logPeak = 0;
      }
    }, 100);
  } catch (e) {
    dbg("Pegelmessung Fehler: " + e.message);
  }

  // Sprach-Wahl aus den Settings: "de"/"en" → dediziertes Modell (genauer pro
  // Sprache), "multi" → Auto/Code-Switching. Default "de".
  const lang = config.sttLanguage || "de";
  const model = lang === "multi" ? "nova-3" : "nova-2";
  dbg(`Deepgram Sprache=${lang} Modell=${model} (${speaker})`);
  const url =
    "wss://api.deepgram.com/v1/listen" +
    "?model=" + model +
    "&smart_format=true&interim_results=true&punctuate=true" +
    "&language=" + encodeURIComponent(lang);

  const socket = new WebSocket(url, ["token", config.deepgramKey]);
  src.socket = socket;

  socket.onopen = () => {
    dbg(`Deepgram WS offen (${speaker})`);
    let mime = "audio/webm";
    if (!MediaRecorder.isTypeSupported(mime)) {
      mime = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      dbg(`audio/webm nicht unterstützt -> nutze "${mime || "Standard"}"`);
    }
    const recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    src.recorder = recorder;
    recorder.addEventListener("dataavailable", (ev) => {
      if (ev.data.size > 0 && socket.readyState === WebSocket.OPEN) {
        socket.send(ev.data);
      }
    });
    recorder.start(250);
    dbg(`Recorder gestartet (${speaker})`);
  };

  socket.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    const alt = data.channel && data.channel.alternatives && data.channel.alternatives[0];
    if (!alt || !alt.transcript) return;
    if (data.is_final) {
      dbg(`final (${speaker}): ${alt.transcript}`);
      handleFinalTranscript(alt.transcript, speaker);
    } else {
      showInterim(alt.transcript, speaker);
    }
  };

  socket.onerror = () => {
    dbg(`Deepgram WS FEHLER (${speaker})`);
    showWarn(`Deepgram-Fehler (${speaker}). API-Key prüfen.`);
  };
  socket.onclose = (ev) => dbg(`Deepgram WS zu (${speaker}) code=${ev.code}`);
}

function stopListening() {
  if (!listening && sources.length === 0) return; // mehrfach-Aufruf abfangen
  listening = false;
  for (const s of sources) {
    if (s.meter) clearInterval(s.meter);
    if (s.ac) { try { s.ac.close(); } catch {} }
    if (s.recorder && s.recorder.state !== "inactive") s.recorder.stop();
    if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
    if (s.socket && s.socket.readyState === WebSocket.OPEN) s.socket.close();
  }
  sources = [];
  resetMeters();
  listenBtn.textContent = "Mithören";
  listenBtn.classList.remove("stop");
  finalizeCall();
}

// Nach dem Stoppen: Nachverarbeitung anstoßen, Status zeigen.
// Note Taker: Recap + Action-Items via Claude-CLI ins Brain (kann 1-2 Min dauern).
// Sales: bisherige Auswertung (PDF), Brain-Notiz läuft im Hintergrund mit.
async function finalizeCall() {
  setStatus(noteTaker ? "Recap läuft …" : "Auswertung …", false);
  try {
    const res = await window.copilot.callEnd({ scriptContext: currentScript });
    setStatus(res && res.ok ? (noteTaker ? "Notiz im Brain ✓" : "Auswertung ✓") : "Bereit", false);
  } catch {
    setStatus("Bereit", false);
  }
}

const whoClass = (speaker) => (speaker === "Kunde" ? "tx-kunde" : "tx-ich");

// Zwischenergebnis live anzeigen (mit Sprecher-Label)
function showInterim(text, speaker) {
  transcriptEl.classList.remove("muted");
  transcriptEl.innerHTML =
    `<span class="tx-who ${whoClass(speaker)}">${speaker}:</span> ` + escapeHtml(text);
}

// Eine fertige Aussage -> beschriftet anzeigen + (bei Bedarf) Claude fragen
function handleFinalTranscript(text, speaker) {
  const clean = text.trim();
  if (!clean) return;

  transcriptEl.classList.remove("muted");
  transcriptEl.innerHTML =
    `<span class="tx-who ${whoClass(speaker)}">${speaker}:</span> ` + escapeHtml(clean);

  transcriptHistory.push(`[${speaker}] ${clean}`);
  if (transcriptHistory.length > 14) transcriptHistory.shift();

  // komplettes Transkript lokal mitschreiben (kostet keine Claude-Tokens)
  window.copilot.transcriptLine({ speaker, text: clean });

  // Note Taker oder Live-Tipps geparkt: kein Coaching-Aufruf während des Calls
  if (noteTaker || !LIVE_TIPPS) return;
  // Falls reaktiviert: nur nach KUNDEN-Sätzen triggern (da entstehen Einwände) — spart Läufe.
  if (speaker !== "Kunde") return;

  // Neuer Durchlauf: Puffer leeren, alten Tipp stehen lassen (kein Flackern)
  tipBuffer = "";
  tipShown = false;

  window.copilot.coach({
    transcript: transcriptHistory.join("\n"),
    scriptContext: currentScript || "",
    lastSpeaker: speaker,
  });
}

init();
