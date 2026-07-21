---
name: aios-setup
description: AIOS auf diesem Mac einrichten: Onboarding Schritt für Schritt. Bindet das bestehende Obsidian-Brain ein, verbindet WhatsApp, aktiviert Module. Jeder Schritt überspringbar. Trigger "/aios-setup", "AIOS einrichten", "Onboarding", "Setup", "richte das AIOS ein".
---

# AIOS-Setup: Onboarding auf diesem Rechner

Du richtest das **AIOS** für den Menschen vor dem Rechner ein („der Nutzer"). Sprich seine Sprache
(Deutsch default), **eine Frage nach der anderen**, erkläre kurz was du tust, frag nur was du wirklich
brauchst. **Verifiziere** jeden Schritt (nichts als fertig melden, was du nicht geprüft hast). **Jeder
Schritt ist überspringbar**: „später" ist immer eine gültige Antwort, das Modul bleibt dann Platzhalter.

Der Nutzer will meistens **zuerst WhatsApp-Outreach** (alte Kontakte reaktivieren). Halte den Weg dahin
kurz; alles andere kann warten.

## Phase 0: Voraussetzungen + Plattform erkennen
- **Erkenne zuerst das Betriebssystem** (`node -p process.platform` → `darwin`=macOS, `win32`=Windows,
  `linux`). Danach richtet sich alles Weitere. Der Kern läuft auf allen gleich, nur die OS-Spezifika unterscheiden sich:
  - **Pfade:** `~/AIOS` (Mac/Linux) bzw. `%USERPROFILE%\AIOS` (Windows).
  - **Hintergrund-Jobs:** Mac → launchd (`templates/launchd/`); Windows → Task Scheduler
    (`templates/windows/register-job.ps1`); Linux → cron.
  - **Shell-Job-Skripte** (`dashboard/*.sh`) laufen auf Windows über **Git Bash** (kommt mit Git for Windows).
  - **Note-Taker-Audio:** Mac = BlackHole, Windows = VB-Audio Cable.
  - **Kern (Dashboard, Copilot, Brain, WhatsApp)** läuft auf beiden nativ mit Node, ohne OS-Spezifika.
- Node ≥ 18 (`node -v`; echten Pfad: `command -v node` bzw. `(Get-Command node).Source`). Git. Google Chrome.
- Claude Code läuft (bist du). Claude nutzt die **Subscription** (claude-CLI), kein API-Key nötig.
- Fehlt etwas → sagen, wie es installiert wird (Mac: `brew`, Windows: `winget`), dann weiter. Nicht raten.

## Phase 1: Sicherheits-Selbstcheck (kurz)
Dies ist ein frisches Produkt-Repo, es darf keine Fremddaten enthalten. Prüfe:
- `.env` existiert (aus `.env.example` kopiert) und enthält nur, was der Nutzer selbst einträgt.
- `brain/` ist leer oder gehört dem Nutzer. `dashboard/data/` ist leer/neu.
Falls doch fremde Daten auftauchen → **STOPP + melden**, nicht weitermachen.

## ADDITIV, niemals überschreiben (Grundregel)
Der Nutzer hat auf seinem Rechner meist schon Einiges: eine globale `~/.claude/CLAUDE.md` (seine
Instruktionen), eigene Skills/Commands, ein Obsidian-Brain, evtl. eigene Configs. **Nichts davon überschreiben.**
- Das AIOS lebt komplett in `~/AIOS` und ist in sich geschlossen. Die `~/AIOS/CLAUDE.md` gilt NUR im
  `~/AIOS`-Ordner und läuft ZUSÄTZLICH zu seiner globalen `~/.claude/CLAUDE.md` (Claude Code lädt beide,
  sie ergänzen sich, keine überschreibt die andere).
- Wenn du Bestehendes einbindest (Brain, Instruktionen, Configs): **lesen und ERGÄNZEN**, nie ersetzen.
  Bei Konflikt oder wenn eine Datei schon existiert → **fragen**, nicht drüberbügeln.
- Existiert `~/AIOS` schon → der Installer bricht bewusst ab (kein Clobber). Auch bei erneutem `/aios-setup`:
  vorhandene `.env`, `config/*.json`, `brain/` nur ergänzen.

## Phase 2: Interview (eine Frage nach der anderen)

### a) Brain einbinden ZUERST (das ist dem Nutzer wichtig)
Der Nutzer hat oft schon ein **Obsidian / eigenes „EIOS"** angefangen. Übernimm das, baue nichts doppelt:
1. Frag: „Hast du schon einen Obsidian-Vault / ein Brain? Wenn ja, wo liegt es?"
2. Wenn ja: sichte die Struktur (welche Ordner, PARA vorhanden?). Binde es ein: entweder
   **Symlink** (`ln -s <sein-vault> brain`) wenn er in Obsidian weiterarbeiten will, oder die Inhalte
   in die PARA-Struktur übernehmen. Seine Notizen/Leads/Ideen bleiben erhalten.
3. Wenn nein: kopiere das Gerüst `templates/brain-skeleton/` nach `brain/` und lege mit ihm zusammen
   `brain/01_Identity/identity.md` an (wer er ist, Ziele, Kommunikationsstil): das liest Jarvis zuerst.
4. Geh gemeinsam durch, was er schon hat und wie es hier weitergenutzt wird. Interaktiv, nicht automatisch drüberbügeln.
5. **Wichtig:** Nur SEINE Inhalte übernehmen. Es dürfen keine fremden/vorbefüllten Content-Ideen, Leads oder Dateien im System sein (das Repo startet leer).

### a2) Branding (macht das AIOS zu SEINEM)
Frag nach seiner Marke und schreib sie nach `config/brand.json`:
- **Name** oben links (Default „AIOS"; oder sein Firmenname).
- **Akzentfarbe** (`accent`, Hex): wenn er Brand-Farben hat, übernimm sie.
- **Logo** (`logoDataUrl`): wenn er ein Logo hat, als data:-URL eintragen, dann steht es oben im Header.
Wenn er nichts hat, neutral „AIOS" lassen. Dashboard neu laden zeigt die Marke sofort.

### b) Name / Firma + Telegram (mobiles Interface + Signale)
- Kurz: Name/Firma → ins `identity.md`.
- Telegram-Bot: bei **@BotFather** anlegen → `TELEGRAM_BOT_TOKEN`. Chat-ID holen (dem Bot schreiben,
  dann `https://api.telegram.org/bot<TOKEN>/getUpdates`) → `TELEGRAM_ALLOWED_CHAT_ID`. Beides in `.env`.
  Ohne Telegram läuft alles im Dashboard weiter: „später" ok.

### c) WhatsApp (Hero: hier will der Nutzer meist hin)
- Der Nutzer verbindet **sein eigenes** WhatsApp Business über die **Meta Cloud API**.
- Wenn er das schon hat (App bei Meta for Developers, System-User-Token): Werte in **Einstellungen**
  (Dashboard) bzw. `.env` eintragen: `WA_ACCESS_TOKEN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `WA_APP_ID`,
  `WA_PHONE_NUMBER_ID`, `WA_WABA_ID`.
- Wenn nicht: führ ihn durch das Anlegen (Meta-App → WhatsApp-Produkt → Nummer → System-User-Token).
  Der Webhook braucht einen öffentlichen Tunnel: dafür ist `dashboard/wa-tunnel.sh` da.
- Danach `config/modules.json` → `whatsapp.configured = true`, WhatsApp-Jobs laden (siehe Phase 3),
  im Dashboard die WhatsApp-View öffnen. Ziel: **alte Kontakte reaktivieren**: Kampagne mit seiner
  Leadliste, KI-Setter beantwortet Antworten.

### d) Weitere Module (jeweils „jetzt" oder „später")
Frag pro Modul knapp, ob jetzt oder später. Bei „später" bleibt es Platzhalter: nichts weiter tun.
- **Content-Pipeline**: Zwei Wege rein, ein Ideen-Feed raus. Erklär ihm beides:
  (1) **Er droppt** Instagram-Videos/Links (oder redet mit Jarvis darüber), die KI merkt sie sich als
      **Content-Ideen** und macht daraus Vorschläge für Video-Posts oder Carousel-Posts.
  (2) **Competitor Watch**: er gibt ein paar Instagram-Accounts/Links von Vorbildern oder Wettbewerbern an.
      Der Job scrapt sie täglich, erkennt Ausreißer-Posts (überdurchschnittliche Performance) und macht
      daraus automatisch neue Ideen im Feed.
  Frag konkret: „Sollen wir Competitor Watch gleich einrichten? Dann drop mir ein paar Instagram-Links,
  die du beobachten willst." Bei „später" bleibt es Platzhalter, Links kann er jederzeit nachreichen
  (per Chat oder in `dashboard/data/competitor-watch.json`).
  Braucht `APIFY_TOKEN` (Scraping), optional `DEEPGRAM_API_KEY` (Captions). Der Nachtwerker füllt Ideen nach.
- **Nachtwerker + Heartbeat**: autonome Läufe. Nur Jobs laden, kein Key nötig (Claude-Subscription).
- **Lead-Sourcing**: B2B-Listen (Keys `APIFY_TOKEN`, `ANYMAILFINDER_API_KEY`, `MILLIONVERIFIER_API_KEY`).
  Er verknüpft **sein eigenes Google Drive** (dort werden Ordner + Sheets pro Batch angelegt) und sein
  eigenes Google-Konto (OAuth). Es sind keine fremden Sheets/IDs vorbelegt, alles baut auf seinem Konto auf.
- **Note Taker / Sales Copilot**: `DEEPGRAM_API_KEY` + BlackHole-Audiogerät. `npm install` in `sales-copilot/`.
- **Rechnungstool**: leeres Tool. Frag: „Sollen wir dein Rechnungstool einrichten? Gib mir deine Firma,
  Adresse, Bankdaten und dein Logo." Trag das in die Absenderfelder ein (Logo als Bild/Datei), dann macht
  er Rechnungen mit seinem Branding. Nichts ist vorbefüllt, es startet komplett leer.
- **Finanzen**: optional, er verbindet seine **eigenen** Konten (Open Banking). Keine Wise/Amex-Vorbelegung.
- **LinkedIn-Outreach**: braucht seinen LinkedIn-Account (+ Sales Navigator). Bewusst später:
  `agents/outreach-alex/` ist die Vorlage → nach `agents/outreach-<name>/` kopieren und mit seinem ICP/
  seinen Messages personalisieren. Chrome-Profil, er loggt SELBST ein (nie Passwörter erfragen).
- **Pipeline/CRM, Projekt-Board, Mail-Watcher, Proposals**: optional, datengetrieben (leer starten).

**Google verknüpfen (wenn ein Modul es braucht: Lead-Sourcing, Mail-/Kalender-Watcher, Drive):**
Er verbindet sein eigenes Google-Konto (eigene OAuth-Credentials, Google Cloud Console). Führ ihn durch
den OAuth-Flow. Es wird nie ein fremdes Konto/Drive genutzt.

## Phase 3: Aktivierung
Für jedes eingerichtete Modul:
1. `config/modules.json` → `"<modul>": { "configured": true }`.
2. Hintergrund-Jobs plattformgerecht registrieren:
   - **macOS:** launchd-Jobs aus `templates/launchd/com.aios.JOB.plist.tmpl` rendern (echten `__NODE__`-Pfad,
     `__REPO__` = dieser Ordner, `__SCRIPT__`, `__LOG__`, `__SCHEDULE__`), nach `~/Library/LaunchAgents/`
     schreiben und laden: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<LABEL>.plist`.
   - **Windows:** je Job `templates/windows/register-job.ps1` aufrufen, z.B.
     `powershell -File templates\windows\register-job.ps1 -Label aios-nightwork -Script nightwork.sh -At 23:30`
     (oder `-EveryMinutes 10`). Prüfen: `Get-ScheduledTask -TaskName aios-*`. Die `.sh` laufen über Git Bash.
   - **Linux:** entsprechende cron-Einträge (`crontab -e`) auf `node run-job.js dashboard/<script>.sh`.
   Jobs pro Modul (Auswahl): WhatsApp → `wa-tunnel.sh` (RunAtLoad), `wa-heartbeat.sh` (600s);
   Nachtwerker → `nightwork.sh` (23:30); Heartbeat → `heartbeat.sh` (stündlich); Content → `competitor-watch.sh` (08:30);
   Telegram → `telegram-bot.js` (RunAtLoad, direkt via node, ohne run-job.js); Watcher → `watcher.sh` (600s).
3. Dashboard starten: `node dashboard/server.js` → `http://localhost:4321`. Prüfen: `curl -s localhost:4321/api/modules`.
4. **`SETUP.md` pflegen:** hak jeden fertigen Punkt ab (`[x]`), lass offene stehen. Das ist seine Übersicht,
   was schon läuft und was noch fehlt. Nach jedem Onboarding-Schritt aktualisieren.

## Phase 4: Smoke-Test + Übergabe
- Dashboard erreichbar, Sidebar zeigt aktivierte Module normal, nicht eingerichtete als „einrichten"-Platzhalter.
- WhatsApp (falls aktiv): Tunnel läuft, Webhook-Verify grün, 1 Test-Thread sichtbar: **nichts senden** ohne Freigabe.
- Zeig dem Nutzer kurz das Dashboard, `SETUP.md` (was fertig/offen ist) und wie er mit Jarvis spricht.
- Er kann jederzeit sagen „lass uns den Rest später machen, ich will erst WhatsApp": dann WhatsApp fertig
  machen, alles andere bleibt als offener Punkt in `SETUP.md` + Platzhalter im Dashboard.
- Optional: eine kurze „So läuft dein System"-Übergabe (Skill `automation-doku`).

## Grundsätze (nicht verhandelbar)
- Nie selbst in fremde Accounts einloggen, nie nach Passwörtern fragen.
- Bei Checkpoint/Captcha stoppen + melden. Limits/Warmup bei Outreach beachten.
- Nur ICP-geprüfte, nicht-private Kontakte kontaktieren. Freunde/Privatkontakte nie.
- Secrets nur in `.env`. Nichts Persönliches committen.
- Alles ist überspringbar und später via `/aios-setup` nachrüstbar.
