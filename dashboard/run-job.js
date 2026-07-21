#!/usr/bin/env node
// run-job.js — launchd-TCC-Workaround: macOS blockiert /bin/bash beim Zugriff auf
// ~/Desktop im launchd-Kontext ("Operation not permitted", Exit 126). node hat den
// Zugriff (siehe telegram-bot) und vererbt ihn an Kindprozesse. Deshalb starten alle
// com.jarvis-Jobs ihre bash-Skripte über diesen Wrapper: node run-job.js <script.sh>
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const script = process.argv[2];
if (!script) { console.error("usage: run-job.js <script.sh>"); process.exit(1); }

// Log-Rotation (Audit-Fix 3): VOR dem Job-Start alle dashboard/*.log > 1 MB auf die
// letzten 2000 Zeilen kappen (deckt <job>.log UND <job>.launchd.log ab). In-place
// (kein rename!) — launchd hält den .launchd.log-fd mit O_APPEND offen, Appends landen
// danach weiter korrekt am (neuen) Dateiende.
try {
  for (const f of fs.readdirSync(__dirname)) {
    if (!f.endsWith(".log")) continue;
    const log = path.join(__dirname, f);
    try {
      if (fs.statSync(log).size <= 1024 * 1024) continue;
      const lines = fs.readFileSync(log, "utf8").split("\n");
      fs.writeFileSync(log, lines.slice(-2000).join("\n"));
      console.error("[run-job] Log rotiert (>1MB → letzte 2000 Zeilen): " + f);
    } catch {}
  }
} catch {}

try { execFileSync("/bin/bash", [script], { stdio: "inherit" }); }
catch (e) { process.exit(typeof e.status === "number" ? e.status : 1); }
