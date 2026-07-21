// notetaker.js — Nachverarbeitung nach Call-Ende (läuft für JEDEN Call, nicht nur Sales).
// 1) Kunden-Erkennung: „Mit wem hatte ich gerade einen Termin?" via Google-Kalender
//    (gleiches OAuth-Token wie der Jarvis-Watcher: config/.gcreds).
// 2) Neutraler Recap über die Claude-CLI (Subscription, KEIN API-Geld) —
//    nicht jeder Call ist ein Sales-Call, oft Kunden-/Projektcalls.
// 3) Call-Notiz ins Jarvis-Brain (03_Projects/<kunde>-calls/ bzw. 00_Inbox/)
//    + Action-Items als Tasks (Projekt-Notiz des Kunden bzw. 07_Tasks/tasks.md).

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { spawn } = require("child_process");

const HOME = os.homedir();
const BRAIN = path.join(HOME, "AIOS/brain");
const PROJECTS_DIR = path.join(BRAIN, "03_Projects");
const INBOX_DIR = path.join(BRAIN, "00_Inbox");
const TASKS_FILE = path.join(BRAIN, "07_Tasks/tasks.md");
const CREDS_FILE = path.join(HOME, "AIOS/config/.gcreds/" + (process.env.GOOGLE_CREDS_FILE || "credentials.json") + "");
const CLAUDE_BIN_SH = path.join(HOME, "AIOS/dashboard/claude-bin.sh");
const CODEX_BIN_SH = path.join(HOME, "AIOS/dashboard/codex-bin.sh");

// Wachsende Einwand-Bibliothek (wird nach jedem Call von Opus befüllt).
const einwandBib = require("./einwand-bib");

// ---------- kleine Helfer ----------
function pad(n) {
  return String(n).padStart(2, "0");
}
function isoDay(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function deDay(d) {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" }[c]))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "call";
}

// Roh-Transkript in lesbares Markdown bringen: Deepgram finalisiert alle 1-3s, dadurch
// zerfällt jeder Satz in Schnipsel-Zeilen. Hier werden aufeinanderfolgende Zeilen desselben
// Sprechers zu EINEM Absatz gemerged: Zeit (HH:MM) links, Sprecher fett, Leerzeile zwischen
// Sprecherwechseln. Nach >60s Pause desselben Sprechers beginnt ein neuer Block (neue Zeitmarke).
function formatTranscript(raw) {
  const blocks = [];
  let lastSec = null;
  for (const line of String(raw || "").split("\n")) {
    const m = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]\s+([^:]{1,20}):\s*(.*)$/);
    if (!m) continue;
    const [, hh, mm, ss, speaker, text] = m;
    if (!text.trim()) continue;
    const sec = +hh * 3600 + +mm * 60 + +ss;
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === speaker && lastSec !== null && sec - lastSec <= 60) {
      last.parts.push(text.trim());
    } else {
      blocks.push({ time: `${hh}:${mm}`, speaker, parts: [text.trim()] });
    }
    lastSec = sec;
  }
  if (!blocks.length) return String(raw || "").trim();
  return blocks
    .map((b) => `**${b.time} ${b.speaker}:** ${b.parts.join(" ").replace(/\s+/g, " ")}`)
    .join("\n\n");
}

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => {
        if (r.statusCode >= 200 && r.statusCode < 300) {
          try {
            resolve(d ? JSON.parse(d) : {});
          } catch (e) {
            reject(new Error("JSON-Parse: " + e.message));
          }
        } else reject(new Error(`HTTP ${r.statusCode} ${opts.path}: ${d.slice(0, 200)}`));
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------- Google-Kalender (gleiches Muster wie dashboard/watcher.js) ----------
async function accessToken() {
  const c = JSON.parse(fs.readFileSync(CREDS_FILE, "utf8"));
  const body = new URLSearchParams({
    client_id: c.client_id,
    client_secret: c.client_secret,
    refresh_token: c.refresh_token,
    grant_type: "refresh_token",
  }).toString();
  const u = new URL(c.token_uri || "https://oauth2.googleapis.com/token");
  const res = await request(
    {
      hostname: u.hostname,
      path: u.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    },
    body
  );
  if (!res.access_token) throw new Error("kein access_token");
  return res.access_token;
}

// Termin finden, der den Call zeitlich überlappt (Kalender ist optional —
// wenn nichts gefunden wird oder das Token fehlt, läuft der Recap ohne weiter).
async function findCalendarEvent(startDate, endDate) {
  try {
    const tok = await accessToken();
    const q = new URLSearchParams({
      timeMin: new Date(startDate.getTime() - 2 * 3600e3).toISOString(),
      timeMax: new Date(endDate.getTime() + 5 * 60e3).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "20",
    }).toString();
    const res = await request({
      hostname: "www.googleapis.com",
      path: `/calendar/v3/calendars/primary/events?${q}`,
      method: "GET",
      headers: { Authorization: `Bearer ${tok}` },
    });
    const evs = (res.items || [])
      .filter((e) => e.status !== "cancelled" && e.start && e.start.dateTime)
      .filter(
        (e) =>
          new Date(e.start.dateTime) < endDate &&
          new Date(e.end.dateTime) > new Date(startDate.getTime() - 15 * 60e3)
      );
    if (!evs.length) return null;
    // Termin bevorzugen, dessen Start am nächsten am Call-Start liegt
    evs.sort(
      (a, b) =>
        Math.abs(new Date(a.start.dateTime) - startDate) -
        Math.abs(new Date(b.start.dateTime) - startDate)
    );
    const ev = evs[0];
    return {
      titel: ev.summary || "",
      teilnehmer: (ev.attendees || [])
        .filter((a) => !a.self)
        .map((a) => a.displayName || a.email)
        .filter(Boolean),
    };
  } catch {
    return null;
  }
}

// ---------- Projekte im Brain ----------
function listProjects() {
  try {
    return fs
      .readdirSync(PROJECTS_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

// ---------- Claude-CLI (Subscription statt API) ----------
// opts.model = CLI-Modell-Override (z.B. "claude-haiku-4-5" für schnelle Live-Tipps), opts.timeoutMs = Abbruch.
function runClaude(prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const model = String(opts.model || "").replace(/[^a-zA-Z0-9._-]/g, "");
    // Subscription erzwingen: ein gesetzter ANTHROPIC_API_KEY (global via launchctl ODER aus
    // sales-copilot/.env) überschreibt sonst den claude.ai-Login und die CLI bricht mit Exit 1 ab
    // ("connectors are disabled … API key takes precedence"). Deshalb den Key aus der Kind-Umgebung
    // entfernen — belt & suspenders: zusätzlich im Shell-Aufruf unsetten.
    const cleanEnv = { ...process.env };
    delete cleanEnv.ANTHROPIC_API_KEY;
    const p = spawn("/bin/bash", ["-c", `unset ANTHROPIC_API_KEY; source "${CLAUDE_BIN_SH}" && exec "$CLAUDE_BIN" -p${model ? ` --model ${model}` : ""}`], {
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanEnv,
    });
    let out = "";
    let err = "";
    const toMs = opts.timeoutMs || 300000;
    const to = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`Claude-CLI Timeout (${Math.round(toMs / 1000)}s)`));
    }, toMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(to);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(to);
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(`Claude-CLI Exit ${code}: ${(err || out).slice(0, 200)}`));
    });
    p.stdin.write(prompt);
    p.stdin.end();
  });
}

// ---------- Codex-CLI (OpenAI, ChatGPT-Subscription) ----------
// Für die LIVE-TIPPS: mit model_reasoning_effort=low ~4-5,5s pro Antwort (gemessen 11.07.; Boden ist
// CLI-Start + Netzwerk, nicht das Denken) statt 13-30s über die Claude-CLI. Schneller geht ohne API nicht:
// andere Modelle (gpt-5.1, gpt-5, *-mini) und effort=minimal lehnt der ChatGPT-Account mit 400 ab.
// Antwort kommt sauber über --output-last-message (Tempfile), stdout ist nur Log.
function runCodex(prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const os = require("os");
    const outFile = path.join(os.tmpdir(), `codex-tip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
    const effort = String(opts.effort || "low").replace(/[^a-z]/g, "");
    const p = spawn(
      "/bin/bash",
      ["-c", `source "${CODEX_BIN_SH}" && [ -n "$CODEX_BIN" ] || { echo "codex-CLI nicht gefunden" >&2; exit 127; }; exec "$CODEX_BIN" exec --skip-git-repo-check -c model_reasoning_effort="${effort}" -o "${outFile}" "$0"`, prompt],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let err = "";
    const toMs = opts.timeoutMs || 45000;
    const to = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`Codex-CLI Timeout (${Math.round(toMs / 1000)}s)`));
    }, toMs);
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(to);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(to);
      let out = "";
      try { out = fs.readFileSync(outFile, "utf8").trim(); } catch {}
      try { fs.unlinkSync(outFile); } catch {}
      if (code === 0 && out) resolve(out);
      else reject(new Error(`Codex-CLI Exit ${code}: ${err.slice(0, 200)}`));
    });
  });
}

// ---------- OpenAI Streaming (nur mit API-Key, für ECHTE Echtzeit-Live-Tipps) ----------
// Warum: die Codex-CLI startet pro Tipp neu (~4-5s Boden). Ein offener Stream hält die
// Verbindung, Token kommen sofort (unter 1-2s). gpt-4.1-mini = schnell + klug + spottbillig.
// Prompt-Caching greift automatisch: der STABILE Teil (Methodik + Bibliothek + Skript) steht
// in der System-Message vorne, nur das wachsende Transkript hinten in der User-Message.
// onDelta(text) bekommt jeden Token sofort (gleiche coach-delta-Bahn wie die CLI).
async function streamOpenAiTip({ system, user, apiKey, onDelta, model, signal }) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4.1-mini",
      stream: true,
      temperature: 0.3,
      max_tokens: 160,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    let t = "";
    try { t = await res.text(); } catch {}
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`);
  }
  // Server-Sent-Events zeilenweise parsen
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) || "";
        if (delta) {
          full += delta;
          if (onDelta) onDelta(delta);
        }
      } catch {}
    }
  }
  return full;
}

function buildPrompt({ transcript, event, projects, startDate }) {
  const eventInfo = event
    ? `Kalender-Termin zum Call (Anhaltspunkt für die Kunden-Zuordnung, kann unpassend sein):\nTitel: ${event.titel}\nTeilnehmer: ${event.teilnehmer.join(", ") || "(keine)"}`
    : "Kein Kalender-Termin zum Call gefunden.";
  return `Du bekommst das Transkript eines gerade beendeten Calls von der Nutzer ([Ich] = der Nutzer, [Kunde] = Gesprächspartner; deutsch und/oder englisch). WICHTIG: Nicht jeder Call ist ein Sales-Call — oft sind es Kunden-Projektcalls (z.B. "wie verbessern wir das Projekt"). Fasse NEUTRAL zusammen, kein Sales-Framing.

${eventInfo}

Bekannte Projekte/Kunden im Brain (Datei-Slugs in 03_Projects): ${projects.join(", ") || "(keine)"}

Datum des Calls: ${deDay(startDate)}

SCHRITT 1 — Call-Typ bestimmen. Ordne den Call GENAU einem Typ zu:
- setting = Erstgespräch/Discovery, in dem Prozesse & Pain-Points eines Interessenten erfragt werden, bevor ein Sales-Call zur Vorstellung folgt.
- closing = Verkaufsgespräch, in dem das Angebot vorgestellt und abgeschlossen wird.
- demo = Vorführung einer gebauten Lösung/Demo für einen Interessenten.
- projekt = laufender Kunden-/Projektcall (Umsetzung, Verbesserung, Status).
- notiz = KEIN Gespräch mit einem Kunden, sondern ein Selbst-Mitschnitt/Learning: der Nutzer diktiert oder schneidet ein Video/Coaching mit, um Learnings festzuhalten (oft sagt er das am Anfang, z.B. "das ist ein Learning" / "das will ich als Learning abspeichern"). Fasse dann die Learnings sauber zusammen (Recap + Key-Takeaways als Stichpunkte), KEINE Sales-Analyse.
- sonstiges = passt in keine Schublade.
- kurz-kalt = KEIN echtes Gespräch, nur ein kurzer kalter Anwahlversuch (grob < 3 Min, niemand erreicht / sofort abgewürgt / kein Inhalt).

SCHRITT 2 — Antworte auf Deutsch, GENAU in diesem Format (Markdown, keine weiteren Vor-/Nachbemerkungen):
PROJEKT: <exakt passender Slug aus der Liste oben, oder "-" wenn keiner sicher passt>
TEILNEHMER: <Namen der Gesprächspartner, kommagetrennt>
TITEL: <Thema des Calls in 3-6 Wörtern>
CALLTYP: <setting | closing | demo | projekt | notiz | sonstiges | kurz-kalt>

Bei CALLTYP = kurz-kalt: NUR den folgenden Recap-Block ausgeben, 1-2 Sätze, und danach STOPPEN (keine Entscheidungen/Action Items/Next Steps/Offene Fragen):
# Recap
<1-2 Sätze: was passiert ist, warum kein echtes Gespräch>

Bei allen anderen CALLTYP-Werten das VOLLE Schema ausgeben:
# Recap
3-6 Sätze: Worum ging es, was wurde besprochen, was ist der Stand.

## Entscheidungen
- <konkret getroffene Entscheidungen, oder "keine">

## Action Items
- [ ] 👤 <konkrete Aufgabe für der Nutzer>
- [ ] 🧑‍💻 <Aufgabe, die der Nutzer mit Claude ausarbeitet>
(Zuständigkeits-Emojis nach des Nutzers Task-Modell: 👤 = der Nutzer selbst · 👥 = Mitarbeiter · 🧑‍💻 = mit Claude ausarbeiten · 🤖 = Agent macht es selbstständig. Nur ECHTE, konkrete To-Dos aus dem Gespräch — keine erfundenen. Wenn keine: "- keine".)

## Next Steps
Der EINE nächste Schritt, der den Deal/das Projekt in die nächste Stufe trägt (Pipeline-Übergabe, nicht bloß beschreiben). Als Checkbox mit Zuständigkeits-Emoji. Richte den nächsten Schritt am Call-Typ aus:
- setting → "- [ ] 🧑‍💻 Demo aufsetzen für <Name>: <konkret was gebaut/gezeigt wird>". Formuliere es so präzise, dass es direkt als Ticket in Cursor umgesetzt werden kann: nenne den größten Pain Point / Prozess, der sich am schnellsten als KI-Automatisierung/KI-Mitarbeiter bauen lässt (der Quick-Win der Demo), plus die konkreten Bausteine.
- closing → "- [ ] 🧑‍💻 Projekt-Setup starten für <Name>: <was zuerst aufgesetzt wird>" (aus dem Close direkt ins Projekt).
- demo → "- [ ] 👤 Angebot/Close nachziehen: <nächster Schritt zum Abschluss>".
- projekt → "- [ ] <emoji> <nächster Meilenstein im Projekt>".
- sonstiges → der sinnvollste nächste Schritt, oder "- keine".

## Offene Fragen
- <offene Punkte / vom Kunden genannte Tools, Links, Urlaubs-/Termindaten, oder "keine">

Transkript:
${transcript}`;
}

function grab(re, s) {
  const m = s.match(re);
  return m ? m[1].trim() : "";
}

// Checkbox-Zeilen aus einem benannten Abschnitt ("## <name>") ziehen
function checkboxLines(body, heading) {
  const sec = body.split(new RegExp(`^## ${heading}\\s*$`, "m"))[1];
  if (!sec) return [];
  return sec
    .split(/^## /m)[0]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^- \[ \]/.test(l));
}

// Action Items UND Next Steps werden zu Tasks (Next Steps = Pipeline-Übergabe,
// z.B. Demo-Ticket nach einem Setting-Call). Duplikate raus.
function extractTasks(body) {
  const seen = new Set();
  return [...checkboxLines(body, "Action Items"), ...checkboxLines(body, "Next Steps")].filter((l) => {
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });
}

// eindeutigen Notiz-Pfad finden (nicht überschreiben)
function uniquePath(dir, base) {
  let p = path.join(dir, base + ".md");
  let i = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${base}-${i++}.md`);
  return p;
}

// Tasks in tasks.md direkt unter "## 🎯 Signal" einsortieren
function appendToTasksFile(lines) {
  let content = "";
  try {
    content = fs.readFileSync(TASKS_FILE, "utf8");
  } catch {
    return false;
  }
  const marker = "## 🎯 Signal";
  const block = lines.join("\n");
  if (content.includes(marker)) content = content.replace(marker, marker + "\n" + block);
  else content += "\n" + block + "\n";
  fs.writeFileSync(TASKS_FILE, content);
  return true;
}

// ---------- Hauptablauf ----------
// recapText: bereits fertige Auswertung (Sales-Modus, aus main.js/API) im selben
//   Format wie buildPrompt es erwartet (PROJEKT/TEILNEHMER/TITEL + Markdown + ## Action Items).
//   Fehlt er (Note Taker / kein API-Key), erzeugt notetaker den neutralen Recap selbst via CLI.
async function run({ transcript, startDate, endDate, scriptName, recapText, recapTimeoutMs }) {
  const event = await findCalendarEvent(startDate, endDate);
  const projects = listProjects();

  // recapTimeoutMs kürzer als die App-Notbremse (main.js, 300s) halten, damit bei einem hängenden
  // CLI-Recap noch Zeit für den Roh-Notiz-Fallback bleibt, statt dass die App vorher zwangsbeendet.
  const out = recapText
    ? recapText
    : await runClaude(buildPrompt({ transcript, event, projects, startDate }), recapTimeoutMs ? { timeoutMs: recapTimeoutMs } : {});

  let projekt = grab(/^PROJEKT:\s*(.+)$/m, out);
  if (projekt === "-" || !projects.includes(projekt)) projekt = "";
  let teilnehmer = grab(/^TEILNEHMER:\s*(.+)$/m, out);
  if (teilnehmer === "-") teilnehmer = "";
  if (!teilnehmer) teilnehmer = event ? event.teilnehmer.join(", ") : "";
  const titel = grab(/^TITEL:\s*(.+)$/m, out) || (event && event.titel) || scriptName || "Call";
  const CALLTYP_LABELS = { setting: "Setting", closing: "Closing", demo: "Demo", projekt: "Projekt", notiz: "Notiz", "kurz-kalt": "Kurz-kalt", sonstiges: "Sonstiges" };
  const calltypRaw = grab(/^CALLTYP:\s*([a-zäöü-]+)/im, out).toLowerCase();
  const calltyp = CALLTYP_LABELS[calltypRaw] ? calltypRaw : "";

  // Recap-Körper = alles ab der ersten Markdown-Überschrift; diese eine Ebene runter,
  // damit die Notiz nur EINE H1 hat ("# Recap" ODER "# Sales-Auswertung" → H2).
  const hIdx = out.search(/^# /m);
  let recap = (hIdx >= 0 ? out.slice(hIdx) : out).trim().replace(/^# /, "## ");

  // Neu gelernte Einwände: Opus hängt am Ende einen Maschinen-Block <!--EINWAND-BIB ... -->
  // an. Den herausziehen, in die Bibliothek mergen und aus der sichtbaren Notiz entfernen.
  let newObjections = [];
  const bibMatch = recap.match(/<!--\s*EINWAND-BIB\s*([\s\S]*?)-->/i);
  if (bibMatch) {
    recap = recap.replace(bibMatch[0], "").trim();
    try {
      const parsed = JSON.parse(bibMatch[1].trim());
      if (Array.isArray(parsed)) newObjections = parsed;
    } catch {}
  }

  const tasks = extractTasks(recap).filter((l) => !/^- \[ \]\s*keine\s*$/i.test(l));

  const dauerMin = Math.max(1, Math.round((endDate - startDate) / 60000));
  const day = isoDay(startDate);

  // --- Call-Notiz schreiben ---
  const noteDir = projekt ? path.join(PROJECTS_DIR, `${projekt}-calls`) : INBOX_DIR;
  fs.mkdirSync(noteDir, { recursive: true });
  // Teilnehmer-Name gehört in den Dateinamen, sonst sieht man in Listen nicht, MIT WEM
  // der Call war (Wunsch 17.07.).
  const wer = slugify((teilnehmer.split(",")[0] || "").trim());
  const baseName = (projekt ? `${day}` : `call-${day}`) + (wer ? `-${wer}` : "") + `-${slugify(titel)}`;
  const notePath = uniquePath(noteDir, baseName);
  const noteName = path.basename(notePath, ".md");

  // Neu gelernte Einwände in die Bibliothek übernehmen (Quelle = diese Call-Notiz).
  let gelernteEinwaende = 0;
  if (newObjections.length) {
    gelernteEinwaende = einwandBib.mergeNew(newObjections, { quelle: noteName, datum: day });
  }

  const note = `---
type: call-note
datum: ${day}
projekt: ${projekt || '""'}
teilnehmer: [${teilnehmer}]
calltyp: ${calltyp || '""'}
dauer: ${dauerMin} Min
---

# Call ${deDay(startDate)} — ${titel}
${calltyp ? `Typ: ${CALLTYP_LABELS[calltyp]}\n` : ""}${projekt ? `Projekt: [[${projekt}]]\n` : ""}
${recap}

## Transkript
${formatTranscript(transcript)}
`;
  fs.writeFileSync(notePath, note);

  // --- Action-Items als Tasks einsortieren ---
  let tasksTarget = "";
  if (tasks.length) {
    const projFile = projekt ? path.join(PROJECTS_DIR, `${projekt}.md`) : "";
    if (projFile && fs.existsSync(projFile)) {
      // in die Projekt-Notiz des Kunden
      const block = `\n## 📞 Call ${deDay(startDate)} — ${titel}\n→ Notiz: [[${noteName}]]\n${tasks.join("\n")}\n`;
      fs.appendFileSync(projFile, block);
      tasksTarget = projFile;
    } else {
      // Fallback: zentrale tasks.md, mit [[kunde]]-Link falls erkannt
      const suffix = projekt ? ` (Call ${deDay(startDate)}) → [[${projekt}]]` : ` (Call ${deDay(startDate)} → [[${noteName}]])`;
      if (appendToTasksFile(tasks.map((t) => t + suffix))) tasksTarget = TASKS_FILE;
    }
  }

  // Nur 👤-Tasks (der Nutzer selbst, zeitnah) zusätzlich als abhakbare Aktion in die
  // Dashboard-Inbox pushen — die Inbox ist "heute zu erledigen", normale To-Dos
  // (🧑‍💻/🤖/👥) bleiben in Projektnotiz + To-Dos-View (Regel 15.07.). Über die
  // Server-API, NICHT direkt in aktionen.json (Single-Writer). Dashboard aus → skip.
  for (const t of tasks) {
    const titelClean = t.replace(/^- \[ \]\s*/, "").trim();
    if (!titelClean.startsWith("👤")) continue;
    postAktion({ titel: titelClean, detail: `Call ${deDay(startDate)} — ${titel}`, quelle: "call" });
  }

  return { notePath, projekt, teilnehmer, titel, tasks: tasks.length, tasksTarget, gelernteEinwaende };
}

// Fire-and-forget POST an die Dashboard-Inbox (/api/aktion-add). Blockt nie den Recap.
function postAktion(payload) {
  try {
    const body = JSON.stringify(payload);
    const req = require("http").request(
      { host: "127.0.0.1", port: 4321, path: "/api/aktion-add", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: 3000 },
      (res) => res.resume()
    );
    req.on("error", () => {});
    req.on("timeout", () => req.destroy());
    req.write(body); req.end();
  } catch {}
}

module.exports = { run, findCalendarEvent, listProjects, runClaude, runCodex, streamOpenAiTip, formatTranscript };
