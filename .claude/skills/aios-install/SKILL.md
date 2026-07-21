---
name: aios-install
description: AIOSOS Outreach-Agent komplett auf einem (fremden) Mac installieren — ein Befehl, Claude Code richtet alles ein, der Kunde loggt nur ein und gibt seinen ICP. Trigger: "/aios-install", "installier den Outreach-Agent", "AIOS aufsetzen", Setup auf Kunden-Rechner.
---

# AIOS-Install — Outreach-Agent auf einem neuen Mac aufsetzen

Du installierst das AIOSOS Outreach-Modul auf DIESEM Rechner, Schritt für Schritt, **verifiziert** (Karpathy-Regel 5: nichts als fertig melden, was du nicht geprüft hast). Der Mensch vor dem Rechner ist ab jetzt „der Kunde". Sprich seine Sprache (DE default), erkläre kurz was du tust, frag nur was du wirklich brauchst.

**Endzustand (= Definition of done):**
1. Dashboard läuft auf `http://localhost:4321` und startet nach Reboot/Absturz von selbst mit.
2. Agent `agents/outreach-<name>/` mit ICP, Playbooks, Limits des Kunden.
3. Gehärtetes Chrome-Profil (Port 9222), Kunde ist dort in LinkedIn (+ Sales Navigator) eingeloggt.
4. launchd-Jobs: Tageslauf 07:00 + Outreach-Watchdog stündlich 10–18 Uhr — beide geladen und getestet.
5. Smoke-Test bestanden (Mini-Lauf: Login-Check + 1 Suchseite, Trail beweist es).

## Phase 0 — Voraussetzungen prüfen (abbrechen + erklären, wenn etwas fehlt)
- macOS (launchd-basiert). `sw_vers` prüfen.
- **Node ≥ 18**: `node -v`. Fehlt → Homebrew-Install anbieten. **Pfad merken** (`command -v node`) — die plists brauchen den ECHTEN Pfad (Apple Silicon: `/opt/homebrew/bin/node`, nicht `/usr/local/bin/node` hart annehmen!).
- **Google Chrome** installiert.
- **LinkedIn-Account mit Sales Navigator** (fürs Lead-Playbook Pflicht — ohne SalesNav klar sagen, dass nur eingeschränkter Betrieb geht).
- Dieses Repo liegt lokal (der Kunde hat es geklont bzw. du klonst es nach `~/AIOS` — NICHT auf den Desktop-Root).

## Phase 1 — Daten-Hygiene (Pflicht bei Fremd-Installation)
Dieses Repo darf beim Kunden KEINE der Nutzer-Daten enthalten. Prüfe und leere:
- `dashboard/data/` → `leads.json` auf `[]`, `kunden-index.md` weg, alle `*-state/status/runs*`-Dateien weg.
- `agents/*/runs/` → komplett leeren (Trails, Reports, `.known-contacts.json`, `.crm-inbox.jsonl`, `.blocklist.json` → leere Strukturen), `stats.json` → `{}`.
- `.env`, `config/.gcreds/` → dürfen NICHT existieren (sonst löschen und dem Kunden sagen).
- `brain/` → falls vorhanden: löschen (gehört nicht ins Produkt).
Wenn irgendwo echte Fremd-Daten auftauchen → STOPP und melden, nicht einfach weiterinstallieren.

## Phase 2 — Kunden-Interview (kurz, eine Frage nach der anderen)
1. **Vorname/Accountname** → Agent-ID `outreach-<vorname klein>`.
2. **ICP**: Branche, Region, Firmengröße, Zielrollen, was verkauft er? → `agents/outreach-<name>/goal.md` schreiben.
3. **Limits**: Default 20 Connects / 15 Messages pro Tag, Warmup 10/5 wenn der Account kalt ist (empfehlen!).
4. **Messages**: M1/M2/M3-Entwürfe vorhanden? Sonst aus goal.md Entwürfe generieren → `messages.md`, Kunde freigeben lassen.
5. **Telegram** (optional): eigener Bot-Token + Chat-ID → `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`). Ohne Telegram laufen Reports nur ins Dashboard — ok.
6. **Google Sheet** (optional): eigenes Tracking-Sheet + OAuth-Creds nach `config/.gcreds/` — sonst Sheet-Schritte in den Playbooks auf „nur CRM" stellen.

## Phase 3 — Agent-Akte bauen
`agents/outreach-alex/` ist die Vorlage: Struktur + Playbooks 01–05 kopieren nach `agents/outreach-<name>/`, dann **personalisieren** (nichts von der Nutzer stehen lassen):
- `config.json`: `account`, `browserPort: 9222`, `userDataDir: ~/.jarvis-chrome/<name>`, Limits aus dem Interview, `model` wie Vorlage.
- `goal.md`, `messages.md` aus dem Interview; `learnings.md` leer.
- Playbooks: ICP-Abschnitt + Such-URL auf den Kunden umschreiben (Sales-Nav-Filter aus seinem ICP bauen; **Filter „kürzlich gepostet" IMMER drin** — ~3× Annahmequote; 2./3. Grad; Firmengröße nach ICP). Such-URL nach `runs/.search-url.txt`.
- `dashboard/daily-run-prompt.json`: `agent`-Feld + alle Namen („der Nutzer" → Kunde) anpassen.
- `dashboard/daily-run.sh` + `dashboard/outreach-watchdog.sh`: Agent-ID und Chrome-Profilpfad anpassen (Variablen am Skriptkopf).

## Phase 4 — Chrome-Profil + Login (Kunde macht den Login SELBST)
1. `bash dashboard/launch-chrome.sh 9222 ~/.jarvis-chrome/<name>` — startet das gehärtete Chrome.
2. Kunde loggt sich dort in LinkedIn ein (inkl. Sales Navigator öffnen). **Du loggst NIE selbst ein, du fragst nie nach Passwörtern.**
3. Verifizieren: `curl -s localhost:9222/json/version` antwortet UND ein LinkedIn-Tab ist eingeloggt (Snapshot über den Agent oder Kunde bestätigt).

## Phase 5 — launchd-Jobs installieren
Zwei plists nach `~/Library/LaunchAgents/` schreiben — **Vorlagen**: `com.jarvis.outreach-alex.plist` (Tageslauf 07:00) und `com.jarvis.outreach-watchdog.plist` (stündlich 10–18 Uhr :20) auf des Nutzers Rechner, Struktur übernehmen mit:
- `ProgramArguments`: `<node-pfad> <repo>/dashboard/run-job.js <repo>/dashboard/<script>.sh` (run-job.js = TCC-Workaround, IMMER über ihn starten).
- `AbandonProcessGroup=true` (sonst killt launchd das gestartete Chrome/Dashboard wieder — gelernt am 07.07.).
- Label-Schema `com.aios.outreach-<name>` / `com.aios.outreach-watchdog`.
Laden: `launchctl bootstrap gui/$(id -u) <plist>`, prüfen mit `launchctl list | grep aios`.
**TCC-Hinweis an den Kunden:** beim ersten Lauf fragt macOS evtl. nach Festplatten-/Ordner-Zugriff für node — genehmigen.

## Phase 6 — Smoke-Test (Pflicht, ohne den ist die Installation NICHT fertig)
1. Dashboard starten (`nohup node dashboard/server.js >> dashboard/server.local.log 2>&1 &`), `curl localhost:4321/api/agents` ok.
2. Mini-Auftrag an den Agent senden (`/api/agent-console-send`): „Nur Login-Check + erste Suchseite öffnen, ICP-Score für 2 Profile begründen, NICHTS senden/vernetzen, Report als Test." 
3. Verifizieren: Trail `agents/outreach-<name>/runs/.live-<datum>.jsonl` füllt sich, kein STOPP/Login-Fehler.
4. Watchdog einmal von Hand: `launchctl kickstart gui/$(id -u)/com.aios.outreach-watchdog` → Log prüfen (er soll „läuft gerade" oder „Report da" sagen, nichts kaputtmachen).
5. Dem Kunden das Dashboard zeigen (`http://localhost:4321`, Modul Agents) und erklären: 07:00 läuft die Kette automatisch, Watchdog zieht nach, Report landet im Agent-Modul.

## Abschluss-Checkliste (dem Kunden als Übergabe zeigen)
- [ ] Dashboard erreichbar, Agent sichtbar
- [ ] Chrome-Profil eingeloggt (LinkedIn + SalesNav)
- [ ] ICP in goal.md, Messages freigegeben, Limits gesetzt (Warmup!)
- [ ] 2 launchd-Jobs geladen
- [ ] Smoke-Test bestanden (Trail gezeigt)
- [ ] Erklärt: Blocklist (`runs/.blocklist.json`) für Freunde/Bestandskontakte pflegen

**Sicherheits-Grundsätze (nicht verhandelbar, stehen auch in agent.md):** nie selbst einloggen, bei Checkpoint/Captcha stoppen + melden, Limits nie überschreiten, Warmup bei kaltem Account, nur ICP-geprüfte Kontakte anschreiben.
