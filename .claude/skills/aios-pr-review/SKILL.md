---
name: aios-pr-review
description: "PR-Review- & Refactor-SOP für das AIOS-Codebase (Jarvis). Nutzen bei: Review, Refactor, Code-Änderung am AIOS prüfen, Diff checken, neuer launchd-Job/Route/Skript. Stellt sicher, dass jede Session (egal welches Modell) auf gleichem Niveau reviewt: Netzwerk-Binding, JSON-Races, TCC/launchd-Fallen, Secrets, Doku-Pflicht."
---

# AIOS PR-Review & Refactor SOP

Kontext: lokales Node-Stdlib-System (kein npm, kein Framework). Server + launchd-Jobs auf des Nutzers Mac.
Referenz wie alles läuft: `SYSTEM.md` (Repo-Root). Vor jedem Review dort die betroffene Zeile der Bausteine-Tabelle lesen.

## 1. Review-Checkliste (jede Änderung dagegen prüfen)

### Netzwerk & Auth — härteste Regel
- `server.js` hat **keine Auth**. Es MUSS bei `server.listen(PORT, "127.0.0.1", ...)` bleiben (aktuell ~Zeile 860).
  Jede Änderung, die das Binding entfernt, auf `0.0.0.0` stellt oder einen zweiten Listener aufmacht → **blocken**.
  (Historie: stand offen im WLAN = Remote-Code-Execution, gefixt 03.07.2026. Mobil später NUR via Tailscale/Token.)
- Neue Routen in `server.js`: Pfad-Inputs gegen `ROOT`/`BRAIN` prüfen (`startsWith`-Check wie bei agent-asset), nie rohen `req.url` in `fs`-Aufrufe.

### JSON-Dateizugriffe — Races sind hier real
- Bekanntes offenes Finding: `leads.json` / `expenses.json` werden per read-modify-write **ohne Lock** beschrieben; Heartbeat + Nightly + Copilot schreiben parallel ins Brain.
- Bei JEDEM neuen/geänderten `fs.writeFileSync(p, JSON.stringify(...))`:
  - Atomar schreiben: erst nach `p + ".tmp"`, dann `fs.renameSync(tmp, p)` — nie halb geschriebene JSONs riskieren.
  - Read-modify-write-Fenster klein halten; keine zweite Stelle einführen, die dieselbe Datei schreibt, ohne das im Review zu benennen.
  - Kein stilles `catch {}` um Writes an kritischem State (CRM, Rechnungen, watcher-state). Loggen oder pingen.
- Append-only bevorzugen wo möglich (Muster: `heartbeat-runs.jsonl`, `.crm-inbox.jsonl`) — appendFileSync racet nicht.
- CRM-Regel: alles, was Leads in `dashboard/data/leads.json` schreibt, MUSS durch den Blocklist-Filter (`.blocklist.json`, Match URL ODER Name) — Freunde dürfen NIE ins CRM. Neue Schreibpfade daran vorbei = blocken.

### launchd-Jobs — zwei dokumentierte Fallen
- **TCC-Falle:** macOS blockiert `/bin/bash` auf `~/Desktop` im launchd-Kontext (Exit 126, tagelang stille Ausfälle).
  Neue Jobs NIE mit `/bin/bash` als ProgramArguments → immer `node dashboard/run-job.js <script.sh>`.
- **Claude-CLI-Falle:** kein Standalone-`claude` im PATH; Binary liegt versioniert im App-Bundle.
  Jedes Skript, das `claude -p` ruft: `source "$ROOT/dashboard/claude-bin.sh"` + Check `[ -x "$CLAUDE_BIN" ]`,
  bei Fehlen: laut abbrechen + `notify.js`-Ping (Muster: `guardrail-morning.sh` Z. 18–23). Nie Pfad hart pinnen.
- Jobskripte: `export PATH=...` am Kopf (launchd strippt env), Log nach `$ROOT/dashboard/<job>.log`, launchd-Log heißt `<job>.launchd.log` (der Watcher-Watchdog scannt genau diese Dateien — Namensschema nicht brechen).
- Überlappende Läufe? Lock-Muster aus `heartbeat.sh` (Lockfile + Alters-Check + `trap ... EXIT`).
- Plists liegen in `~/Library/LaunchAgents/com.jarvis.*.plist` — Namensschema `com.jarvis.<name>` beibehalten.

### Secrets
- Secrets NUR in `.env` (Repo-Root, nicht committet) und `config/` (`.gcreds`, `wise_private.pem`). NIE in `brain/`, NIE im Repo, NIE in Prompts/Logs.
- Lesen wie bestehender Code: `envVal()` in server.js bzw. `loadEnv()` in telegram-bot.js. Kein dotenv-Package einführen.
- Review-Grep vor Merge: keine Tokens/Keys als Literale im Diff (`grep -iE "api[_-]?key|token|secret" <diff>` — Treffer manuell prüfen).

### Telegram-Notify — nie still, aber sparsam
- Blocker/Fehler in Jobs → Ping via `node dashboard/notify.js [--ok|--title X] "Text"`. Stilles Überspringen ist ein Review-Fail.
- Aber: max. sparsam (Regel: nur neue Antworten + harte Blocker; Watchdog max. 1 Ping/12h). Neue Ping-Quellen im Review hinterfragen — der Nutzer will keine Ping-Flut.
- Bot-Sicherheit: `telegram-bot.js` erlaubt nur `TELEGRAM_ALLOWED_CHAT_ID`-Whitelist. Änderungen dürfen die nicht aufweichen.

### Fehlerbehandlung bei Netz-Ausfällen
- Langläufer (`telegram-bot.js`, `watcher.js`, `server.js`) dürfen bei Netzfehlern NICHT crashen: Muster ist `req.on("error", ...)` + `req.on("timeout", ...)` mit resolve `{ok:false}` bzw. Fehlerlog — jedes neue `https.request`/`fetch` braucht beides.
- Externe Calls (Google, Telegram, GoCardless, Wise) immer mit Timeout; HTTP-Status prüfen (`if(!r.ok) throw` mit Status im Text), nie Response blind parsen.
- Einmal-Jobs: Netzfehler → Exit ≠ 0 + Log-Zeile (Watchdog greift dann), kein leerer catch.

## 2. Refactor-Regeln (Karpathy, aus CLAUDE.md)
1. **Vor dem Code „fertig" definieren** — ein Satz: was ist danach anders, woran messe ich es.
2. **Surgical changes** — nur ändern, was verlangt ist. Kein Nebenbei-Umbau, kein Umformatieren fremder Zeilen (bläht Diffs, versteckt Bugs).
3. **Simplicity first** — Node-Stdlib bleibt Node-Stdlib. Keine neuen Dependencies/Frameworks ohne expliziten Auftrag. Kein Gold-Plating, keine Abstraktion für Zukunftsfälle (Runner-Abstraktion z. B. erst, wenn ein zweites Modell real ansteht).
4. **Annahmen explizit machen** — unklar? Fragen (interaktiv) bzw. Telegram-Ping (autonom), nicht raten.
5. **Konsistenz überall** — eine Änderung an JEDER betroffenen Stelle durchziehen (Code + SYSTEM.md + ggf. Plist + UI), nie halb.

## 3. Verifikation nach Änderung

### Syntax & Server
```bash
node --check dashboard/server.js          # gilt für jede geänderte .js
node dashboard/server.js                  # startet auf 127.0.0.1:4321
curl -s http://localhost:4321/ | head -5  # antwortet?
curl -s http://localhost:4321/api/<neue-route>   # neue Route direkt testen
lsof -iTCP:4321 -sTCP:LISTEN              # MUSS 127.0.0.1:4321 zeigen, nie *:4321
```
Läuft der echte Server schon (launchd/manuell), Änderung mit `PORT=4322 node dashboard/server.js` isoliert testen.

### Watcher & Jobskripte
```bash
node dashboard/watcher.js --today         # harmloser Lesemodus (druckt Termine)
node dashboard/watcher.js                 # voller Lauf — Achtung: kann real pingen & State schreiben
bash -n dashboard/<job>.sh                # Shell-Syntax
node dashboard/run-job.js dashboard/<job>.sh   # Job so starten wie launchd es tut
```

### launchd-Checks
```bash
launchctl list | grep com.jarvis                          # geladen? Spalte 1 = letzter Exit-Code (0 gut)
launchctl kickstart -k gui/$(id -u)/com.jarvis.<name>     # Job sofort testweise feuern
tail -50 dashboard/<name>.launchd.log dashboard/<name>.log  # danach Logs lesen
plutil -lint ~/Library/LaunchAgents/com.jarvis.<name>.plist # Plist valide?
```
Nach Plist-Änderung: `launchctl bootout gui/$(id -u)/com.jarvis.<name>` + `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jarvis.<name>.plist`.

### Manuell prüfen (Checkliste vor „fertig")
- [ ] Binding weiterhin 127.0.0.1, keine neue Netz-Exponierung
- [ ] Geänderte JSON-Writes atomar, kein neuer unkoordinierter Schreiber auf leads/expenses/brain
- [ ] Neuer/geänderter Job: einmal via `run-job.js` real gelaufen, Exit 0, Log sauber, Ping kam an (falls vorgesehen)
- [ ] Keine Secrets im Diff (`git diff` durchsehen), nichts Sensibles in `brain/`
- [ ] Fehlerpfad einmal provoziert (z. B. .env-Variable weggenommen) → lauter Abbruch statt stillem Skip
- [ ] Doku nachgezogen (Abschnitt 4)

## 4. Doku-Pflicht (nicht optional — Teil der Definition of Done)
Sofort nachziehen, nicht „später":

| Änderung | Datei(en) |
|---|---|
| Neuer/geänderter launchd-Job, Skript, Route, Dependency, Datenablage | `SYSTEM.md` — Bausteine-Tabelle + Abschnitt Abhängigkeiten/Datenablage + Datum „Zuletzt aktualisiert" oben setzen |
| Neues Modul / Skill / Agent (jedes neue Bauteil) | zusätzlich Produkt-Register `brain/03_Projects/aios-produkt.md` |
| Modul-Status / kritischer Pfad geändert | `brain/03_Projects/aios-work-map.md` |
| Kunden-/Projekt-To-Dos entstanden | `brain/03_Projects/<kunde>.md` (Sektion „Offene To-Dos"); in `tasks.md` nur Sammel-Pointer |

Ein Review ist erst DONE, wenn Code UND Doku im selben Durchgang konsistent sind. Halbe Doku = Fail.
