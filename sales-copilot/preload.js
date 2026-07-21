// preload.js — sichere Brücke zwischen Fenster (Renderer) und Hauptprozess.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("copilot", {
  getConfig: () => ipcRenderer.invoke("get-config"),

  // Coaching anfragen + Streaming-Antwort empfangen
  coach: (payload) => ipcRenderer.send("coach", payload),
  onCoachDelta: (cb) => ipcRenderer.on("coach-delta", (_e, t) => cb(t)),
  onCoachDone: (cb) => ipcRenderer.on("coach-done", () => cb()),
  onCoachError: (cb) => ipcRenderer.on("coach-error", (_e, m) => cb(m)),

  // Wenn sich der Maus-Durchklick-Modus ändert
  onClickThroughChanged: (cb) =>
    ipcRenderer.on("clickthrough-changed", (_e, v) => cb(v)),

  // Tray-Menü hat "Mithören starten/stoppen" geklickt -> Renderer soll den Button triggern
  onTrayToggleListen: (cb) => ipcRenderer.on("tray-toggle-listen", () => cb()),

  // App komplett beenden
  quitApp: () => ipcRenderer.send("quit-app"),
  // Fenster minimieren (läuft im Tray weiter)
  hideWindow: () => ipcRenderer.send("hide-window"),

  // Keys & Skripte verwalten
  saveKeys: (payload) => ipcRenderer.invoke("save-keys", payload),
  saveScript: (payload) => ipcRenderer.invoke("save-script", payload),
  deleteScript: (payload) => ipcRenderer.invoke("delete-script", payload),

  // Call-Aufzeichnung + Auswertung
  callStart: (payload) => ipcRenderer.invoke("call-start", payload),
  transcriptLine: (payload) => ipcRenderer.send("transcript-line", payload),
  callEnd: (payload) => ipcRenderer.invoke("call-end", payload),
  openCallsFolder: () => ipcRenderer.send("open-calls-folder"),
  log: (msg) => ipcRenderer.send("debug-log", String(msg)),
});
