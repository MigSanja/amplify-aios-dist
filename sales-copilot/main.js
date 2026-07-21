// main.js — Electron-Hauptprozess
// Erzeugt das transparente, immer-im-Vordergrund liegende Overlay-Fenster
// und kümmert sich um die Claude-Anfragen (API-Key bleibt hier im Hauptprozess,
// landet NIE im sichtbaren Fenster).

// .env immer neben main.js laden — beim Start via `open` (LaunchServices) ist cwd "/",
// ein nacktes config() fände die Datei dann nicht.
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  shell,
  session,
  systemPreferences,
  Tray,
  Menu,
  nativeImage,
  Notification,
} = require("electron");
const path = require("path");
const fs = require("fs");
// Claude läuft komplett über die Subscription (claude-CLI via notetaker.runClaude) — kein API-Key mehr nötig (11.07.).

// Feste Einwandbehandlungs-Methodik (im Code verankert, nicht editierbar)
const EINWAND_WISSEN = require("./einwand");
// Wachsende Einwand-Bibliothek (Opus befüllt sie nach jedem Call). Wird live in den
// Tipp-Prompt gezogen, damit das Modell gelernte Antworten rausgreift statt neu zu denken.
const einwandBib = require("./einwand-bib");
// Nachverarbeitung nach Call-Ende: Recap via Claude-CLI (Note Taker) bzw.
// Sales-Auswertung (Sales-Modus) → Kunden-Erkennung über den Google-Kalender,
// EINE Notiz + Tasks ins Jarvis-Brain. KEINE PDFs mehr (Brain ist lesbar genug).
const notetaker = require("./notetaker");

// Status-Datei fürs AIOS-Dashboard: damit der Nutzer sieht, ob gerade AUFGENOMMEN
// wird (und den laufenden Call nicht vergisst zu stoppen). Liegt im Dashboard-Datenordner.
const STATUS_FILE = path.join(
  require("os").homedir(),
  "AIOS/dashboard/data/salescopilot-status.json"
);
function writeStatus(obj) {
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    fs.writeFileSync(
      STATUS_FILE,
      JSON.stringify({ ...obj, updated: Math.floor(Date.now() / 1000) })
    );
  } catch {}
}

// --- Meeting-Modus: "Mithören" AN → Dashboard friert Outreach + Watcher ein, damit
// der Call flüssig bleibt; AUS → alles läuft wieder an. Fire-and-forget, blockt nie den
// Call, wenn das Dashboard gerade nicht läuft (Copilot funktioniert auch ohne).
function setMeetingMode(on) {
  try {
    const body = JSON.stringify({ on: !!on });
    const req = require("http").request(
      { host: "127.0.0.1", port: 4321, path: "/api/meeting-mode", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: 3000 },
      (res) => res.resume()
    );
    req.on("error", () => {});
    req.on("timeout", () => req.destroy());
    req.write(body); req.end();
  } catch {}
}

// --- Telegram-Ping (fire-and-forget) über das bestehende dashboard/notify.js. Nur für harte Fälle
// (z.B. Recap fehlgeschlagen), damit nie still ein Call verloren geht. Blockt den Call nie. ---
function pingTelegram(title, text) {
  try {
    const notify = path.join(require("os").homedir(), "AIOS/dashboard/notify.js");
    const child = require("child_process").spawn("node", [notify, "--title", title, text], {
      detached: true, stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  } catch {}
}

// --- Steuerkanal Dashboard -> App: Befehls-Datei (Pendant zur Status-Datei) ---
// Das Dashboard schreibt hier z.B. {cmd:"shutdown"} rein, um die App aus der Ferne
// sauber herunterzufahren. Läuft gerade eine Aufnahme, wird ERST die Notiz fertig
// erstellt und DANN beendet — es geht nie ein Mitschnitt verloren.
const CMD_FILE = path.join(
  require("os").homedir(),
  "AIOS/dashboard/data/salescopilot-command.json"
);
let quitAfterProcessing = false;
let processing = false; // true, solange call-end die Notiz erstellt (call ist dann schon null)
let shutdownTimer = null;

function clearCommandFile() {
  try { fs.unlinkSync(CMD_FILE); } catch {}
}

// Sicherheitsnetz: hängt die Verarbeitung, nach 5 Min trotzdem beenden (Recap braucht real ~50-90s).
function armShutdownTimer() {
  if (shutdownTimer) clearTimeout(shutdownTimer);
  shutdownTimer = setTimeout(() => { quitAfterProcessing = false; app.quit(); }, 300000);
}

// Am Ende der Notiz-Verarbeitung aufrufen (in JEDEM Rückgabepfad von call-end):
// markiert die Verarbeitung als fertig und beendet, falls ein Fern-Shutdown wartete.
function finishProcessing() {
  processing = false;
  if (!quitAfterProcessing) return;
  quitAfterProcessing = false;
  if (shutdownTimer) { clearTimeout(shutdownTimer); shutdownTimer = null; }
  setTimeout(() => app.quit(), 800); // kurzer Puffer, damit die Notiz sicher geschrieben ist
}

// Sauber herunterfahren, ohne je einen Mitschnitt zu verlieren:
// - Notiz wird gerade erstellt -> nur vormerken, finishProcessing() beendet danach.
// - Aufnahme läuft noch -> erst stoppen (wie Tray-"Stoppen"), dann via call-end beenden.
// - sonst -> direkt beenden.
function gracefulShutdown() {
  if (quitAfterProcessing) return; // Shutdown läuft bereits
  if (processing) { quitAfterProcessing = true; armShutdownTimer(); return; }
  if (call && win && !win.isDestroyed()) {
    quitAfterProcessing = true;
    armShutdownTimer();
    win.webContents.send("tray-toggle-listen"); // Renderer stoppt -> call-end -> Notiz
  } else {
    app.quit();
  }
}

function pollCommands() {
  let cmd = null;
  try {
    if (!fs.existsSync(CMD_FILE)) return;
    cmd = JSON.parse(fs.readFileSync(CMD_FILE, "utf-8"));
  } catch { clearCommandFile(); return; }
  clearCommandFile(); // Befehl nur einmal ausführen
  if (cmd && cmd.cmd === "shutdown") gracefulShutdown();
}

// Name in der Dock-Leiste / im Menü
app.setName("Sales Copilot");

let win;
let clickThrough = false; // Start: interaktiv/beweglich — Durchklick erst per Cmd+Shift+K

// ---------- App-Speicher: Keys + Skripte (statt .env/Dateien bearbeiten) ----------
function userDir() {
  return app.getPath("userData");
}
function configPath() {
  return path.join(userDir(), "config.json");
}
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf-8"));
  } catch {
    return {};
  }
}
function saveConfig(c) {
  fs.mkdirSync(userDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2));
}
// Keys: erst App-Speicher, sonst .env (für den Übergang).
// KEIN Anthropic-Key mehr (17.07.): Claude läuft ausschließlich über die Subscription
// (claude-CLI via notetaker.runClaude); ein gesetzter Key würde den Login sogar kaputt machen.
function getKeys() {
  const c = loadConfig();
  return {
    deepgram: c.deepgramKey || process.env.DEEPGRAM_API_KEY || "",
    sttLanguage: c.sttLanguage || process.env.STT_LANGUAGE || "de",
  };
}

// Skripte liegen im App-Speicher: ~/Library/Application Support/Sales Copilot/scripts
function scriptsDir() {
  return path.join(userDir(), "scripts");
}
function ensureScripts() {
  const d = scriptsDir();
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
    // beim ersten Start die mitgelieferten Skripte übernehmen
    const bundled = path.join(__dirname, "scripts");
    if (fs.existsSync(bundled)) {
      for (const f of fs.readdirSync(bundled)) {
        if (/\.(txt|md)$/i.test(f)) {
          fs.copyFileSync(path.join(bundled, f), path.join(d, f));
        }
      }
    }
  }
}
function listScripts() {
  ensureScripts();
  const d = scriptsDir();
  const out = [];
  for (const f of fs.readdirSync(d).sort()) {
    if (/\.(txt|md)$/i.test(f)) {
      out.push({
        name: f.replace(/\.(txt|md)$/i, ""),
        content: fs.readFileSync(path.join(d, f), "utf-8"),
      });
    }
  }
  return out;
}
function safeName(name) {
  return (name || "").replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "Skript";
}


function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 420,
    height: 640,
    x: width - 440,
    y: 60,
    frame: false, // kein Fensterrahmen
    transparent: true, // durchscheinender Hintergrund
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Immer ganz oben — auch über Vollbild-Apps wie Zoom
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // WICHTIG: versteckt das Fenster vor Bildschirmaufnahmen / Screen-Sharing,
  // damit der Kunde das Overlay NICHT sieht, wenn du deinen Screen teilst.
  win.setContentProtection(true);

  // Start interaktiv (Fenster ist beweglich/klickbar); den transparenten
  // Durchklick-Modus schaltet Cmd+Shift+K erst bei Bedarf an.
  win.setIgnoreMouseEvents(clickThrough, { forward: true });

  win.loadFile("index.html");
}

// ---------- Menübar-Tray: schlichter weißer Punkt (○), immer gleich ----------
// Bewusst KEIN rotes REC-Symbol und kein "Copilot"-Text mehr (Wunsch 07.07.):
// nur ein kleiner weißer Punkt oben rechts, damit man sieht/erinnert wird, dass
// die App noch läuft (v.a. minimiert), und ihn anklicken kann (Fenster/Beenden).
// Aufnahme-Status/An-Aus sieht der Nutzer im Dashboard, nicht in der Menüleiste.
let tray = null;

function buildTrayMenu() {
  const recording = !!call;
  const visible = win && !win.isDestroyed() && win.isVisible();
  return Menu.buildFromTemplate([
    { label: recording ? "● Aufnahme läuft" : "Bereit", enabled: false },
    { type: "separator" },
    {
      label: visible ? "Fenster verstecken" : "Fenster anzeigen",
      click: () => {
        if (!win || win.isDestroyed()) return;
        if (win.isVisible()) hideWithHint();
        else {
          win.show();
          updateTray();
        }
      },
    },
    {
      label: recording ? "Mithören stoppen" : "Mithören starten",
      click: () => {
        if (win && !win.isDestroyed()) win.webContents.send("tray-toggle-listen");
      },
    },
    { type: "separator" },
    { label: "Beenden", click: () => app.quit() },
  ]);
}

function updateTray() {
  if (!tray) return;
  // Immer derselbe weiße Punkt — rendert in Menüleisten-Textfarbe (weiß), nie rot.
  tray.setTitle("○");
  tray.setToolTip(call ? "Sales Copilot — Aufnahme läuft" : "Sales Copilot — bereit");
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  updateTray();
}

// Fenster verstecken + einmalige Erinnerung, wie man's zurückholt — der Nutzer
// vergisst sonst den Shortcut, wenn er den Hinweis im Overlay selbst nicht mehr sieht.
function hideWithHint() {
  if (!win || win.isDestroyed()) return;
  win.hide();
  updateTray();
  try {
    new Notification({
      title: "Sales Copilot minimiert",
      body: "Zurückholen: weißen Punkt (○) oben rechts anklicken, oder ⌘⇧H.",
      silent: true,
    }).show();
  } catch {}
}

app.whenReady().then(async () => {
  // Natives Mikrofon-Erlaubnisfenster ZUERST anzeigen — bevor das immer-oben
  // Overlay aufgeht und es verdecken könnte.
  try {
    if (process.platform === "darwin" && systemPreferences.askForMediaAccess) {
      await systemPreferences.askForMediaAccess("microphone");
    }
  } catch {}

  // Medien-Berechtigungen (Mikrofon) im Code erlauben.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
  try {
    session.defaultSession.setPermissionCheckHandler(() => true);
  } catch {}

  createWindow();
  createTray();

  // Kein Dock-Icon (Wunsch 07.07.): App läuft als reines Menüleisten-/Overlay-
  // Tool. Zurückholen/Beenden über den weißen Tray-Punkt oder ⌘⇧H.
  if (process.platform === "darwin" && app.dock) app.dock.hide();

  // Steuerkanal Dashboard->App: evtl. alten Befehl vom letzten Lauf verwerfen,
  // dann regelmäßig auf Fern-Befehle (z.B. Ausschalten) prüfen.
  clearCommandFile();
  setInterval(pollCommands, 2000);

  // --- Globale Tastenkürzel (funktionieren auch während des Calls) ---

  // Cmd+Shift+H: Overlay ein-/ausblenden
  globalShortcut.register("CommandOrControl+Shift+H", () => {
    if (!win) return;
    if (win.isVisible()) hideWithHint();
    else {
      win.show();
      updateTray();
    }
  });

  // Cmd+Shift+K: Maus-Durchklick an/aus (zum Bearbeiten/Scrollen im Overlay)
  globalShortcut.register("CommandOrControl+Shift+K", () => {
    if (!win) return;
    clickThrough = !clickThrough;
    win.setIgnoreMouseEvents(clickThrough, { forward: true });
    win.webContents.send("clickthrough-changed", clickThrough);
  });

  // Cmd+Shift+Q: Overlay zuverlässig beenden (egal welche App Fokus hat)
  globalShortcut.register("CommandOrControl+Shift+Q", () => {
    app.quit();
  });

  // Dock-Icon-Klick: verstecktes Fenster wieder zeigen (statt nur bei 0 Fenstern
  // ein neues zu erzeugen — sonst bleibt es nach "Minimieren" für den Dock-Klick tot).
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (win && !win.isDestroyed()) win.show();
    updateTray();
  });
});

// ⌘Q während die Notiz noch erstellt wird (processing) → Quit aufschieben, Notiz fertig
// schreiben, dann automatisch beenden (Fall 15.07.: Recap starb beim sofortigen Beenden
// nach Stopp, Transkript blieb ohne Brain-Notiz). Gleiches Muster wie der Fern-Shutdown.
app.on("before-quit", (e) => {
  if (quitAfterProcessing) return; // Shutdown läuft schon → finishProcessing beendet gleich selbst.
  // (1) Notiz wird gerade erstellt → Quit aufschieben, bis sie fertig ist.
  if (processing) {
    e.preventDefault();
    quitAfterProcessing = true;
    armShutdownTimer(); // Notbremse: irgendwann trotzdem beenden, nie ewig hängen
    return;
  }
  // (2) Aufnahme läuft noch → NICHT einfach verwerfen. Erst stoppen (Renderer → call-end →
  //     Notiz), DANN beenden. Sonst geht der Mitschnitt beim Ausschalten verloren — genau der
  //     Fall 20.07.: Note Taker aus, während die Aufnahme lief = keine Notiz. Vorher fing dieser
  //     Guard nur den Fall ab, dass der Recap SCHON lief; das Ausschalten mitten in der Aufnahme
  //     ging an ihm vorbei und rief direkt app.quit().
  if (call && win && !win.isDestroyed()) {
    e.preventDefault();
    quitAfterProcessing = true;
    armShutdownTimer();
    win.webContents.send("tray-toggle-listen"); // stoppt Aufnahme → call-end setzt processing=true → finishProcessing beendet danach
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --- IPC: Konfiguration an das Fenster geben ---
// Gibt dem Renderer u.a. den Deepgram-Key (für die Live-Transkription per WebSocket)
// und ob der Claude-Key vorhanden ist.
ipcMain.handle("get-config", () => {
  const keys = getKeys();
  return {
    hasClaude: true, // Claude via Subscription (CLI), kein Key
    deepgramKey: keys.deepgram,
    sttLanguage: keys.sttLanguage,
    scripts: listScripts(),
  };
});

// --- IPC: API-Keys speichern (aus dem Setup-Menü) ---
ipcMain.handle("save-keys", (_e, { deepgram, sttLanguage }) => {
  const c = loadConfig();
  delete c.anthropicKey; // Alt-Bestand aufräumen: es gibt keinen Anthropic-Key mehr
  if (typeof deepgram === "string") c.deepgramKey = deepgram.trim();
  if (typeof sttLanguage === "string") c.sttLanguage = sttLanguage;
  saveConfig(c);
  const keys = getKeys();
  return { hasClaude: true, deepgramKey: keys.deepgram };
});

// --- IPC: Skript anlegen/bearbeiten ---
ipcMain.handle("save-script", (_e, { name, content, oldName }) => {
  ensureScripts();
  const newFile = path.join(scriptsDir(), safeName(name) + ".txt");
  if (oldName && safeName(oldName) !== safeName(name)) {
    const old = path.join(scriptsDir(), safeName(oldName) + ".txt");
    if (fs.existsSync(old)) fs.rmSync(old);
  }
  fs.writeFileSync(newFile, content || "");
  return { scripts: listScripts() };
});

// --- IPC: Skript löschen ---
ipcMain.handle("delete-script", (_e, { name }) => {
  const f = path.join(scriptsDir(), safeName(name) + ".txt");
  if (fs.existsSync(f)) fs.rmSync(f);
  return { scripts: listScripts() };
});

// ---------- Call-Aufzeichnung + Auswertung ----------
let call = null; // aktiver Call: { dir, transcriptPath, scriptName, startDate }

function callsDir() {
  return path.join(userDir(), "calls");
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function stampName(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function clock(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Call starten: Ordner anlegen, Transkript-Datei initialisieren.
// mode: "sales" (Skript + Live-Tipps) oder "notetaker" (nur zuhören).
ipcMain.handle("call-start", (_e, { scriptName, mode }) => {
  const d = new Date();
  const dir = path.join(callsDir(), `${stampName(d)}_${safeName(scriptName || "Call")}`);
  fs.mkdirSync(dir, { recursive: true });
  const transcriptPath = path.join(dir, "transcript.txt");
  fs.writeFileSync(
    transcriptPath,
    `${mode === "notetaker" ? "Call" : "Sales Call"} — ${scriptName || ""}\nStart: ${d.toLocaleString("de-DE")}\n\n`
  );
  call = { dir, transcriptPath, scriptName: scriptName || "", startDate: d, mode: mode || "sales" };
  updateTray();
  writeStatus({
    recording: true,
    mode: mode === "notetaker" ? "Note Taker" : scriptName || "Sales",
    project: "",
    since: Math.floor(d.getTime() / 1000),
  });
  setMeetingMode(true); // Call läuft → Störendes im Hintergrund einfrieren
  return { ok: true };
});

// Jede fertige Aussage live ins Transkript schreiben (lokal, kostenlos)
ipcMain.on("transcript-line", (_e, { speaker, text }) => {
  if (!call) return;
  try {
    fs.appendFileSync(call.transcriptPath, `[${clock(new Date())}] ${speaker}: ${text}\n`);
  } catch {}
});

// Call beenden. EINE Notiz pro Call ins Jarvis-Brain, KEINE PDFs mehr.
// Note Taker: neutraler Recap via Claude-CLI (Subscription).
// Sales-Modus: Sales-Auswertung (Skript-Treue, Einwände, Demo-Todo) via API —
//   wird als fertiger Recap-Text an notetaker.run übergeben, das die Kunden-Erkennung,
//   Notiz-Ablage und Task-Verteilung übernimmt (gleiche Infrastruktur wie Note Taker).
// Minimaler, gültiger Recap-Text (Format wie buildPrompt es erwartet) als Fallback: leerer Call
// oder Recap gescheitert. notetaker.run bekommt ihn als recapText → überspringt die Claude-CLI und
// schreibt TROTZDEM eine echte Notiz. So landet nach dem Ausschalten IMMER etwas im Brain + in der Liste.
function rawRecapText(satz) {
  return ["PROJEKT: -", "TEILNEHMER: -", "TITEL: Note-Taker-Mitschnitt", "CALLTYP: notiz", "", "# Recap", satz || "Roh-Mitschnitt ohne automatische Zusammenfassung. Transkript siehe unten."].join("\n");
}

ipcMain.handle("call-end", async (_e, { scriptContext }) => {
  if (!call) { finishProcessing(); return { ok: false, reason: "no-call" }; }
  const c = call;
  call = null;
  processing = true; // ab hier läuft die Notiz-Erstellung; Fern-Shutdown wartet darauf
  updateTray();
  writeStatus({ recording: false, mode: "", project: "", since: 0 });
  setMeetingMode(false); // Call vorbei → Outreach + Watcher wieder wecken

  let transcript = "";
  try {
    transcript = fs.readFileSync(c.transcriptPath, "utf-8");
  } catch {}

  const spoken = transcript.split("\n").filter((l) => /\]\s+(Ich|Kunde):/.test(l));
  if (spoken.length < 2) {
    // Fast leer (z.B. aus Versehen an/aus) → NICHT still verwerfen. der Nutzer will, dass JEDE
    // Notiz landet, damit er die Müll-Ausreißer selbst sieht und wegklicken kann (Regel 20.07.).
    try {
      const rn = await notetaker.run({ transcript, startDate: c.startDate, endDate: new Date(), scriptName: c.scriptName, recapText: rawRecapText("Sehr kurzer Mitschnitt, kein verwertbarer Inhalt (evtl. aus Versehen gestartet). Kann gelöscht werden.") });
      try { if (rn && fs.existsSync(rn.notePath)) shell.openPath(rn.notePath); } catch {}
    } catch (err) {
      try { fs.appendFileSync(path.join(userDir(), "debug.log"), `Leer-Notiz-Fehler: ${err && err.message}\n`); } catch {}
    }
    finishProcessing();
    return { ok: true, reason: "leer-notiz" };
  }

  // Sales-Modus: Sales-Auswertung über die Claude-CLI (Subscription) erzeugen und als recapText durchreichen.
  // Sonst (Note Taker): notetaker macht den neutralen CLI-Recap selbst.
  let recapText = null;
  if (c.mode !== "notetaker") {
    const projects = notetaker.listProjects();
    const sys = `Du bist ein erfahrener, ehrlicher Sales-Coach. Du analysierst das Transkript eines gerade beendeten Verkaufsgesprächs ([Ich] = Verkäufer, [Kunde] = Gesprächspartner).

Verkaufsskript des Verkäufers:
"""
${scriptContext || ""}
"""

Einwandbehandlungs-Methodik (Maßstab für die Bewertung):
"""
${EINWAND_WISSEN}
"""

Bekannte Projekte/Kunden im Brain (Datei-Slugs in 03_Projects): ${projects.join(", ") || "(keine)"}

Antworte auf Deutsch, GENAU in diesem Format (Markdown, keine weiteren Vor-/Nachbemerkungen):
PROJEKT: <exakt passender Slug aus der Liste oben, oder "-" wenn keiner sicher passt>
TEILNEHMER: <Vorname(n) des Kunden aus dem Gespräch, kommagetrennt, oder "-">
TITEL: <Thema des Calls in 3-6 Wörtern>
CALLTYP: <setting = Discovery/Erstgespräch · closing = Angebot/Abschluss · demo = Vorführung · sonstiges · kurz-kalt = kein echtes Gespräch (<3 Min, niemand erreicht)>

# Sales-Auswertung
## Zusammenfassung
3-5 Sätze: Wer war der Kunde, was war das Anliegen, was wurde am Ende vereinbart.

## Skript-Treue
Geh die Skript-Phasen durch, je mit ✅ / ⚠️ / ❌ und einem kurzen Halbsatz. Schließe mit einer Gesamt-Einschätzung in Prozent ab (z.B. "Gesamt: ~80% abgedeckt").

## Verpasste Einwände & Chancen
Wo wurde ein Einwand nicht sauber (nach der Methodik) behandelt oder ein Kaufsignal überhört? Konkret mit kurzem Zitat-Bezug.

## Konkrete Verbesserungstipps
2-4 umsetzbare Punkte fürs nächste Gespräch.

## Entscheidungen
- <konkret getroffene Entscheidungen/Vereinbarungen aus dem Call, oder "keine">

## Action Items
- [ ] 👤 <konkrete Aufgabe für der Nutzer>
(Zuständigkeits-Emojis: 👤 = der Nutzer selbst · 👥 = Mitarbeiter · 🧑‍💻 = mit Claude ausarbeiten · 🤖 = Agent macht es selbstständig. Nur ECHTE To-Dos aus dem Gespräch. Wenn keine: "- keine".)

## Next Steps
Der EINE nächste Schritt, der den Deal in die nächste Pipeline-Stufe trägt (nicht bloß beschreiben). Checkbox mit Zuständigkeits-Emoji, ausgerichtet am Call-Typ:
- setting → "- [ ] 🧑‍💻 Demo aufsetzen für <Name>: <konkret was gebaut/gezeigt wird>". So präzise formulieren, dass es direkt als Ticket in Cursor umsetzbar ist: größter Pain Point / Prozess, der sich am schnellsten als KI-Automatisierung/KI-Mitarbeiter bauen lässt (Quick-Win der Demo) + konkrete Bausteine.
- closing (gewonnen) → "- [ ] 🧑‍💻 Projekt-Setup starten für <Name>: <was zuerst aufgesetzt wird>".
- demo → "- [ ] 👤 Angebot/Close nachziehen: <nächster Schritt zum Abschluss>".
- sonstiges → sinnvollster nächster Schritt, oder "- keine".

Bei CALLTYP = kurz-kalt: nur PROJEKT/TEILNEHMER/TITEL/CALLTYP + ein kurzes "# Recap" (1-2 Sätze) ausgeben, KEINE Skript-Treue/Einwände/Tipps/Entscheidungen/Action Items/Next Steps.`;

    try {
      recapText = await notetaker.runClaude(`${sys}\n\nTranskript:\n${transcript}`);
    } catch (err) {
      try {
        fs.appendFileSync(path.join(userDir(), "debug.log"), `Sales-Auswertung-Fehler: ${err && err.message}\n`);
      } catch {}
      recapText = null; // Fallback: notetaker macht den neutralen CLI-Recap
    }
  }

  // Nachverarbeitung mit Retry: die Notiz-Erstellung ist der kritische Schritt. Schlägt sie fehl
  // (z.B. CLI-Zicke), einmal erneut versuchen und im Fehlerfall NICHT still sterben, sondern per
  // Telegram anpingen MIT Transkript-Pfad — so verschwindet nie wieder ein Call unbemerkt (Regel:
  // Outreach/Jarvis überspringt nie still). Das rohe Transkript liegt ohnehin schon sicher auf Platte.
  let res, lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      res = await notetaker.run({
        transcript,
        startDate: c.startDate,
        endDate: new Date(),
        scriptName: c.scriptName,
        recapText,
        recapTimeoutMs: 120000, // pro Versuch max 2 Min; 2 Versuche + Fallback < 5-Min-Notbremse → Notiz landet immer
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      try {
        fs.appendFileSync(path.join(userDir(), "debug.log"), `Nachverarbeitung-Fehler (Versuch ${attempt}/2): ${err && err.message}\n`);
      } catch {}
    }
  }
  if (lastErr) {
    // Recap endgültig gescheitert → trotzdem eine Roh-Notiz schreiben (fertiger recapText umgeht die
    // CLI, kann also nicht am selben Fehler scheitern), damit der Mitschnitt IMMER landet und nie verschwindet.
    try {
      res = await notetaker.run({ transcript, startDate: c.startDate, endDate: new Date(), scriptName: c.scriptName, recapText: rawRecapText("Automatische Zusammenfassung ist fehlgeschlagen. Roh-Transkript siehe unten; bei Bedarf manuell verdichten.") });
    } catch (err2) {
      try { fs.appendFileSync(path.join(userDir(), "debug.log"), `Roh-Notiz-Fehler: ${err2 && err2.message}\n`); } catch {}
    }
    pingTelegram("🎙️ Sales Copilot", `Recap für den letzten Call konnte nicht automatisch erstellt werden (${(lastErr.message || "").slice(0, 120)}). Roh-Notiz mit Transkript angelegt${res && res.notePath ? ": " + path.basename(res.notePath) : ""}. Transkript: ${c.transcriptPath}`);
    try { if (res && fs.existsSync(res.notePath)) shell.openPath(res.notePath); } catch {}
    finishProcessing();
    return { ok: true, reason: "roh-notiz-fallback" };
  }

  // Notiz direkt aufmachen — der Nutzer will das Ergebnis sofort sehen (Brain-Markdown, kein PDF).
  try {
    if (res && fs.existsSync(res.notePath)) shell.openPath(res.notePath);
  } catch {}
  finishProcessing();
  return { ok: true, note: res.notePath, projekt: res.projekt, tasks: res.tasks };
});

// Diagnose-Log (zum Fehlersuchen)
ipcMain.on("debug-log", (_e, msg) => {
  try {
    fs.appendFileSync(
      path.join(userDir(), "debug.log"),
      `[${new Date().toLocaleTimeString("de-DE")}] ${msg}\n`
    );
  } catch {}
});

// Auswertungs-Ordner im Finder öffnen
ipcMain.on("open-calls-folder", () => {
  const d = callsDir();
  fs.mkdirSync(d, { recursive: true });
  shell.openPath(d);
});

// Feste Coaching-Anweisungen (konstant -> gut cachebar)
const COACH_INSTRUCTIONS = `Du bist ein stiller Souffleur für ein laufendes deutsches Verkaufsgespräch. Der Verkäufer liest deine Ausgabe live mit und sagt sie ggf. direkt so.

Das Transkript ist nach Sprecher beschriftet:
- [Kunde] = der Gesprächspartner
- [Ich] = der Verkäufer selbst

WICHTIGSTE REGEL — Ausgabeformat:
- Gib AUSSCHLIESSLICH die Worte aus, die der Verkäufer JETZT sagen kann — als fertige, direkte wörtliche Rede.
- KEINE Einleitung, KEIN "Tipp:", KEIN "Du könntest sagen:", KEINE Doppelpunkt-Vorrede.
- KEINE Meinung, KEINE Erklärung, KEINE Begründung, KEINE Meta-Kommentare über die Lage.
- KEINE Anführungszeichen, KEINE Klammern, KEINE Sternchen.
- Wenn der Verkäufer es versehentlich 1:1 vorliest, muss es als natürlicher Gesprächssatz klingen.

Inhalt — je nachdem, wer zuletzt gesprochen hat:
- Zuletzt [Kunde]: Reagiere auf die Kundenaussage. Bei einem Einwand die konkrete Entgegnung. Nutze dafür die unten stehende Einwandbehandlungs-Methodik (MMS): meist eine gute Frage oder ein Reframe, kein plumpes Gegenargument.
- Zuletzt [Ich]: Prüfe, ob der Verkäufer noch auf dem Skript ist. Ist er abgekommen oder hat eine Stelle übersprungen, gib ihm den NÄCHSTEN sinnvollen Satz/Schritt aus dem Skript als sagbaren Satz. Läuft er ohnehin sauber im Skript, antworte mit "-".
- Antworte auf Deutsch, sehr kurz: 1-2 Sätze, sofort sagbar.

WANN du etwas ausgibst (sei sparsam):
- Nur wenn es WIRKLICH hilft: Einwand, schwierige/unerwartete Frage, Kaufsignal, Verkäufer kommt ins Stocken oder vom Skript ab.
- Sonst (Smalltalk, belanglos, Verkäufer ist auf Kurs): antworte AUSSCHLIESSLICH mit einem einzigen Bindestrich: -
- Wiederhole nicht wortwörtlich, was schon sichtbar im Skript steht; formuliere den sagbaren nächsten Satz.
- Im Zweifel lieber "-" als ein überflüssiger Tipp.

Beispiel — [Kunde] Das ist mir zu teuer.
FALSCH: "Tipp: Frag nach dem Vergleich, z.B.: Im Vergleich wozu?"
RICHTIG: Meinst du zu teuer im Sinne von Budget, oder siehst du den Wert noch nicht ganz?`;

// --- IPC: Live-Coaching-Tipp über die CODEX-CLI (OpenAI, ChatGPT-Subscription) ---
// Gemessen 11.07.: Codex ~6-7s/Tipp, Claude-CLI 13-30s → Codex gewinnt („nimm das, was schneller ist").
// Kein Streaming: der Tipp kommt am Stück. Bremsen gegen Prozess-Spam: Renderer triggert nur nach
// Kunden-Sätzen, hier läuft nie mehr als ein Tipp gleichzeitig, und nach 2 Fehlern in Folge schalten
// die Tipps für den Rest der Session ab (eine Warnung statt Fehler-Spam; Recap ist nicht betroffen).
let coachBusy = false;
let coachFails = 0;
ipcMain.on("coach", async (event, { transcript, scriptContext, lastSpeaker }) => {
  if (coachBusy || coachFails >= 2) return;
  coachBusy = true;
  const gelernt = einwandBib.formatForPrompt();
  const prompt =
    COACH_INSTRUCTIONS +
    "\n\n=== EINWANDBEHANDLUNGS-METHODIK (fest, danach handeln) ===\n" + EINWAND_WISSEN +
    (gelernt
      ? "\n\n=== GELERNTE EINWÄNDE (aus früheren Calls, bevorzugt nutzen wenn passend) ===\n" + gelernt
      : "") +
    `\n\nAktuelles Verkaufsskript des Verkäufers:\n"""\n${scriptContext}\n"""` +
    `\n\nGesprächsverlauf (nach Sprecher beschriftet):\n${transcript}\n\nZuletzt gesprochen hat: ${lastSpeaker || "Kunde"}.\nGib jetzt den nächsten sagbaren Satz – oder "-", wenn nichts nötig ist. Antworte NUR mit diesem Satz, nichts davor oder danach.`;
  try {
    const text = (await notetaker.runCodex(prompt, { timeoutMs: 45000 })).trim();
    coachFails = 0;
    event.sender.send("coach-delta", text);
    event.sender.send("coach-done");
  } catch (err) {
    coachFails++;
    if (coachFails >= 2)
      event.sender.send("coach-error", "Live-Tipps für diese Session aus (Codex-CLI antwortet nicht): " + String(err && err.message ? err.message : err));
  } finally {
    coachBusy = false;
  }
});

// --- IPC: App komplett beenden (vom Beenden-Knopf im Menü) ---
ipcMain.on("quit-app", () => {
  app.quit();
});

// --- IPC: Fenster minimieren (Minimieren-Button im Header) — läuft im Tray weiter ---
ipcMain.on("hide-window", () => {
  hideWithHint();
});
