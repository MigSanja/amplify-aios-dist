# Playbook 05 — Daily LinkedIn Follow-ups (Alex)
> Step 5 · täglich. **Max. 3 Follow-ups pro Lead (FU1 Text + FU2 `waitingmeme.png` + FU3 `kermetmeme.jpg`), kein Tageslimit** (nach FU3 ist Schluss; Änderung 20.07., vorher max. 2). Follow-ups gehen an bestehende Kontakte/Konversationen; einzige Bremse ist menschliches Tempo, Pausen 60–150 Sek. Quelle für fällige Follow-ups ist das Google Sheet.

## Account & Browser + Pflicht-Check
Wie Playbook 01: Chrome via **`mcp__browser__*`** (chrome-devtools-mcp, Port 9222 = fest der Nutzer — keine Browser-Auswahl nötig). Eigener Arbeits-Tab (`new_page`), Login prüfen; offener LinkedIn-Tab / nicht eingeloggt / Captcha → abbrechen.
**Datentrennung:** im Sheet NUR Zeilen mit Spalte G („Contacted On ") = „der Nutzer LinkedIn". „Paul LinkedIn" komplett ignorieren.

## Voraussetzungen
Chrome offen + in LinkedIn eingeloggt. Meme-Dateien liegen in `$HOME/AIOS/assets/memes/` (kein Finder-/Zwischenablage-Zugriff mehr nötig — Upload geht direkt, siehe Bild-Versand).
**NUR AKTUELLE KAMPAGNE: ausschließlich Leads AB ZEILE 38.** Alles oberhalb ignorieren.

## Schritt 1 — Sheet lesen (DIREKT, KEIN n8n)
`node dashboard/gsheet.js read "Juni Erstkontakt" "F2:K1013"` → JSON aller Zeilen. Spalten: F=Name+URL, G=Account/Quelle, H=Stufe, I=zuletzt kontaktiert, J=Contacted?, K=Replied?. **Fällige FU** = Zeilen mit G=„der Nutzer LinkedIn", noch keine Antwort (K leer) und letzter Kontakt (I) > 2 Tage her. Zeilennummer = Index im Ergebnis + 2.

## Schritt 2 — fällige Leads (nur Zeile ≥38 UND G = „der Nutzer LinkedIn")
- Überspringen wenn K (Replied?) = „Yes".
- Überspringen wenn H = „InMail" (exakt, inkl. Varianten mit trailing Space / „In Mail") — InMail bekommt NIE Follow-ups. Gilt auch wenn die Person auf die InMail geantwortet hat — Antworten auf InMails handhabt der Nutzer manuell, kein automatischer Follow-up.
- Überspringen wenn H = „STOPP" — diesen Lead NIE wieder automatisiert anfassen (manuell von der Nutzer gesetzt, z.B. nach Panne oder Ablehnung).
- Nur wenn Datum I ≥ 2 Tage her. Stufenlogik (H) — **nur VORAUSWAHL, die echte Stufe entscheidet der Chat (Schritt 3)**:
  - „Erstkontakt " → **Follow-up 1** (reiner Text)
  - „Follow Up 1" → **Follow-up 2** (Bild `waitingmeme.png` + 😅)
  - „Follow Up 2" → **Follow-up 3** (Bild `kermetmeme.jpg`, Kermit/Frosch) — **letzte Stufe**
  - „Follow Up 3" → fertig, überspringen (max. 3 Follow-ups)
- **ALLE Fälligen abarbeiten (kein Limit an Leads, aber max. 3 Stufen pro Lead).** Block-Verarbeitung: erst alle FU1 (Text), dann Meme-Block `waitingmeme.png` für alle FU2, dann Meme-Block `kermetmeme.jpg` für alle FU3. Danach ist Schluss.

## Schritt 3 — pro fälligem Lead (Claude in Chrome)
- URL aus F öffnen. **📬 IMMER die normale LinkedIn-Inbox / das reguläre „Nachricht"-Fenster am `/in/…`-Profil** — NICHT über „In Sales Navigator anzeigen" in den SalesNav-Chat (sonst zweiter Thread mit derselben Person, ein früherer Doppelkontakt-Fall). **🔍 KANAL-IDENTITÄT EXPLIZIT VERIFIZIEREN (Pflicht, ein früherer Fall 14.07.):** Vor dem Senden prüfen, in WELCHEM Chat du wirklich stehst: Browser-URL darf KEINE `linkedin.com/sales/…`-Adresse sein und das Fenster muss das normale Messaging-Overlay am `/in/`-Profil sein. „Irgendein M1-Verlauf ist sichtbar" reicht NICHT: Liegt der Verlauf nur im SalesNav-Chat (sales/lead-URL bzw. SalesNav-Oberfläche), ist das ein **STOPP** für diesen Lead — kein Follow-up, keinen neuen Thread eröffnen, Sheet H="STOPP", im Report vermerken. Der Follow-up gehört in **denselben regulären Chat wie das M1**; existiert im normalen Thread kein M1-Verlauf → ebenfalls STOPP für diesen Lead, im Report vermerken (Stufe prüfen), nicht in einem neuen Thread nachfassen. Nur „Vernetzen" (2. Grades, kein „Nachricht") → überspringen + melden.
- MENSCHLICH: Maus bewegen, scrollen, ggf. Profilbild kurz öffnen/schließen.
- Chat öffnen. **🛑 CHAT = WAHRHEIT — Pflicht-Verify vor JEDEM Senden (ein früherer Vorfall 10.07.: Sheet-Dublette sagte „Erstkontakt", im Chat hing längst Follow-up 2 → dieselbe Nachricht ging doppelt raus. Das darf NIE wieder passieren):**
  1. **Hat die Person geantwortet?** JA → NICHT senden. Sheet K („Replied? ") = „Yes", H unverändert. Überspringen. **Sofort Telegram-Ping:** `node dashboard/notify.js "Antwort von <Name> (<Firma>) am <TT.MM.JJJJ>! Bitte übernehmen."` — NUR wenn Antwortdatum neuer als letzter bekannter Kontakt (kein Fehlalarm für alte Antworten).
  2. **Letzte EIGENE Nachricht im Verlauf lesen und der Stufe zuordnen:** M1 (Icebreaker+Pitch) → als Nächstes FU1 · FU1-Text („Kurze Nachfrage…") → FU2 (waitingmeme) · Bild waitingmeme → FU3 (kermetmeme) · Bild kermetmeme → fertig, nichts mehr senden.
  3. **Gesendet wird IMMER die Stufe laut CHAT, nie laut Sheet.** Weicht das Sheet ab → Sheet per **Profil-URL** korrigieren (`gsheet.js update` mit der URL), im Report vermerken, dann die laut Chat korrekte Stufe senden (bzw. skippen, wenn laut Chat schon alles raus ist).
  4. Letzte eigene Nachricht **< 2 Tage her** (egal was das Sheet sagt) → überspringen.

### Follow-up-Inhalte
**Follow-up 1 (NUR TEXT):**
```
Hallo Herr/Frau <Nachname>

Kurze Nachfrage:

Ist das Thema KI und Automatisierung im Vertrieb bei Ihnen grundsätzlich interessant?

Falls ja, würde ich Ihnen gerne kostenlos eine personalisierte 1:1-Demo vorbereiten, angepasst auf Ihre Kanäle, Tools und Abläufe.

Dazu hätte ich vorab nur ein paar kurze Fragen an Sie.
```
Versand: Text in die Chat-`<textarea>` via `mcp__browser__fill` oder `evaluate_script` (nativer value-Setter + `_valueTracker` + `InputEvent('input',{inputType:'insertText'})` — bewährt aus Playbook 03), dann „Senden"-Button klicken. NIE Enter in der Box (sendet sofort).

**Follow-up 2** = Bild `$HOME/AIOS/assets/memes/waitingmeme.png` + „😅".

**Follow-up 3** = Bild `$HOME/AIOS/assets/memes/kermetmeme.jpg` (Kermit/Frosch). **Das ist die letzte Stufe — danach kein weiterer Follow-up.**

### Bild-Versand — OHNE Zwischenablage/Finder (das alte Cmd+C/Cmd+V-Gefrickel ist Geschichte)
- **Weg: `mcp__browser__upload_file`** — setzt die Datei per PFAD direkt in den Datei-Input des Chats. Ablauf: Chat öffnen → `take_snapshot` → das `<input type=file>` der Chatbox finden (bei LinkedIn/Sales Nav versteckt; notfalls per `evaluate_script` sichtbar machen: `document.querySelector('input[type=file]')`, oder den Anhang-/Bild-Button (📎/🖼) klicken, wodurch der Input aktiv wird) → `upload_file` mit uid des Inputs + `$HOME/AIOS/assets/memes/<datei>` → warten bis Vorschau/„Angefügt" erscheint.
- **PFLICHT-CHECK:** Screenshot VOR dem Senden — Bild-Vorschau muss im Chat hängen. Dann Emoji in die Textbox, Senden, Screenshot zur Bestätigung.
- **Fallback, falls `upload_file` am Element scheitert:** per `evaluate_script` alle `input[type=file]` auflisten (auch außerhalb der Chatbox) und den richtigen nehmen. KEIN Finder, KEIN Clipboard, KEIN computer-use.
- **Wenn der Bild-Anhang nach 2 Versuchen nicht klappt:** Meme-Follow-up für diesen Lead überspringen (H-Stufe NICHT hochsetzen, im Report vermerken) und beim nächsten Lead weitermachen — NICHT den ganzen Schritt abbrechen. Am Ende im Report + einmalig Telegram: „Meme-Upload klappt nicht, <N> FU2 offen".
- Zwischen Leads 60–150 Sek warten.

## Schritt 4 — CRM + Sheet aktualisieren (IMMER BEIDE — jede Aktion in CRM UND Tracking-Sheet)
Pro gesendetem Follow-up ZWEI Befehle:
1. **CRM:** `curl -s -X POST http://localhost:4321/api/lead-save -H 'Content-Type: application/json' -d '{"id":"<profil-url>","fields":{"status":"Follow-up 1","pipelineStage":"Follow-up 1","followup1Am":"<TT.MM.JJJJ>"}}'` (bei FU2/FU3 entsprechend `Follow-up 2`/`Follow-up 3` + `followup2Am`/`followup3Am`).
2. **Sheet — Match IMMER per PROFIL-URL, NIE per Name:** `node dashboard/gsheet.js update "Juni Erstkontakt" "<profil-url>" H "Follow Up 1" I "<TT.MM.JJJJ>"` (Stufe „Follow Up 1/2/3" OHNE Leerzeichen). Name-Match traf am 10.07. die falsche Namens-Dublette (ein früherer Vorfall) — die URL identifiziert die Person eindeutig. G NICHT ändern.
- Erkannte Antworten: BEIDE — CRM `status/pipelineStage "Geantwortet" + geantwortetAm` UND Sheet `gsheet.js update ... K "Yes"`.
- „InMail"-Leads NIEMALS verändern.

## Abschluss
Account (der Nutzer), Follow-ups je Stufe, wer „Replied = Yes", wer übersprungen (2. Grades / InMail / falscher Account / offenes Fenster), Sheet aktualisiert ja/nein. Bei Problemen abbrechen + der Nutzer informieren.
