# Dashboard-Regeln

Dashboard-Skripte (server.js, watcher.js, launchd-Jobs, Datenablage) folgen diesen Regeln:

## Datenablage (JSON-Driven)
- **Single Source of Truth:** `dashboard/data/leads.json`, `invoices.json`, `expenses.json`, `streak.json` (nicht in Brain/Notion)
- **Atomare Writes:** alle JSON-Schreibvorgänge erst in Temp-Datei, dann `rename()` (verhindert Race Conditions bei gleichzeitigen Requests)
- **Keine JSON-Leseparallelen:** API liest immer die aktuelle Datei

## WhatsApp-Modul (wa.js)
- **`data/wa-*.json` NUR über die Server-API schreiben** (`/api/wa/*`), nie direkt mit Edit/Write/Skripten — server.js/wa.js ist der einzige Schreiber (Single-Writer, verhindert JSON-Races wie beim known-contacts-Vorfall).
- Secrets (`WA_ACCESS_TOKEN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`) leben in `.env`; `.env` nur über `envSet()` in wa.js bzw. die Einstellungen-UI ändern.
- `/webhooks/wa` liegt bewusst AUSSERHALB von `/api/` (Meta authentifiziert per HMAC, nicht Bearer) — beim Anfassen der Auth-Gates nicht versehentlich davor hängen.

## Server & Routes
- **server.js:** Express + statisches Frontend; alle `/api/*` sind API-Endpoints, Daten-Schreibvorgänge gehen über Atomare Writes
- **Neue Route = neu dokumentiert in SYSTEM.md** (Socket-Handler, DB-Anbindung, Abhängigkeiten)

## launchd-Jobs
- **Alle launchd-Plist-Dateien in `~/Library/LaunchAgents/`**
- **Output/Error-Logs:** `dashboard/*.launchd.log` (Rotation: tageweise)
- **run-job.js Wrapper:** Node hat die Berechtigungen, bash/python-Subprozesse erben sie → umgeht TCC-Sperren
- **Neuer Job = in SYSTEM.md dokumentieren** (was läuft, Trigger, Abhängigkeiten, Output-Pfad)
- **Fehler tracken:** watcher.js scannt Logs auf neue Fehler und pingt via Telegram (max. 1 Ping pro 12h pro Log)

## Telegram-Notification (notify.js)
- Token in `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)
- Format: `node dashboard/notify.js --title "🎯 Titel" "Nachricht"` — simple, max. 1–2 Sätze
- Nur für echte Blocker/Wins/System-Fehler; kein Spam

## Vor jeder Änderung an SYSTEM.md nachziehen
- Neue Dependency? SYSTEM.md.
- Neue Job/Route? SYSTEM.md.
- Neues Modul im Dashboard? SYSTEM.md + ggf. Produkt-Register.
