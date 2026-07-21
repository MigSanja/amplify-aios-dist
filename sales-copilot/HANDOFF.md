# HANDOFF — Note-Taker-Ausbau (Auftrag vom 02.07.2026)

**Ziel:** Aus dem Sales Copilot wird zusätzlich des Nutzers eigener Note Taker — ersetzt Fireflies/Krisp. Kein Bot im Call, alles lokal über BlackHole + Deepgram.

## 1. Note-Taker-Modus in der App
- Im Modus-Dropdown (heute: Skripte wie „Setting"/„Closing") einen Eintrag **„Note Taker"** ergänzen.
- Im Note-Taker-Modus: KEINE Claude-Live-Tipps (kein API-Call während des Calls), nur Live-Transkription beider Spuren (Ich + Gegenüber) mit Sprecher-Label und Zeitstempel.
- Toggle „Transkript an/aus" sichtbar im Overlay (der Nutzer will pro Call deaktivieren können).
- **Projekt-Auswahl:** Dropdown, gespeist aus den Ordnern/Dateien in `~/AIOS/brain/03_Projects/` + Freitextfeld. Das gewählte Projekt bestimmt, wohin das Transkript einsortiert wird.

## 2. Speichern + Nachverarbeitung (nach Call-Ende)
- Transkript als Markdown speichern: `~/AIOS/brain/03_Projects/<projekt>-calls/YYYY-MM-DD-<slug>.md` (oder `00_Inbox/` wenn kein Projekt gewählt). Frontmatter: datum, projekt, teilnehmer, dauer.
- Danach automatisch Recap erzeugen — über die **Claude-CLI (Subscription!)**: `claude-bin.sh -p` mit Prompt: Zusammenfassung, Entscheidungen, Action-Items (als Checkboxen mit 👤/🧑‍💻/🤖 nach des Nutzers Task-Modell), offene Fragen. Recap oben in dieselbe Datei.
- Action-Items zusätzlich in `~/AIOS/brain/07_Tasks/` einsortieren (bestehende Struktur ansehen und ihr folgen).

## 3. Auto-Start & Auto-Record
- **Ton-Erkennung:** Wenn auf dem BlackHole-Eingang Pegel anliegt (= Call läuft) und kein Recording aktiv ist → Aufnahme automatisch starten (nach ~5 s anhaltendem Pegel), bei ~2 Min Stille automatisch stoppen und Nachverarbeitung anstoßen.
- **Kalender-Trigger:** Den bestehenden 10-Min-Watcher in `~/AIOS/dashboard/` erweitern: Termin mit Meeting-Link beginnt in <10 Min → App starten (`open -a` bzw. `npm start`-Äquivalent), falls nicht schon läuft.
- App soll beim Mac-Login im Hintergrund starten können (Login Item / launchd), klein im Tray.

## 4. Sichtbarkeit
- **Menübar-Tray-Icon:** grau = bereit, rot (●REC) = Aufnahme läuft. Klick aufs Icon: Start/Stop, Modus, Projekt, „Transkript aus".
- Status-Datei schreiben (z. B. `~/AIOS/dashboard/data/salescopilot-status.json`: {recording, mode, project, since}), damit das AIOS-Dashboard den Status anzeigen kann.

## 5. AIOS-Dashboard-Anbindung (zweiter Schritt, nach 1–4)
- In `~/AIOS/dashboard/server.js` Nav-Punkt **„Sales Copilot"**: Status (aus der Status-Datei), Liste der letzten Call-Notes/Recaps mit Link ins Brain, Button „App starten".
- Baustein ins Produkt-Register eintragen: `~/AIOS/brain/03_Projects/aios-produkt.md`.

## Wichtig
- Deutsch UND Englisch müssen transkribiert werden (Deepgram-Sprache: multi/de+en prüfen, ggf. Sprach-Toggle im Tray).
- Kein neues Abo-Tool: Deepgram-API (Cent-Beträge) + Claude-Subscription reichen.
- Bestehende Sales-Copilot-Funktionen (Skripte, Overlay, Tipps) dürfen nicht kaputtgehen.
- Am Ende: README.md um Note-Taker-Abschnitt ergänzen + kurzer Testplan (1 Fake-Call mit YouTube-Audio als „Gegenüber").

## 7. Update 06.07. — Tray-Icon + Root-Cause "leerer Call"
- **Tray-Icon umgesetzt** (`main.js`: `Tray`/`Menu`, `preload.js`: `onTrayToggleListen`, `renderer.js`: `listenBtn.click()` via Tray-Event): Menüleiste zeigt „⚪ Copilot" (bereit) / „🔴 REC" (Aufnahme läuft), Klick öffnet Menü mit Fenster ein-/ausblenden, Mithören starten/stoppen, Beenden. Damit lässt sich die App (v.a. Note Taker) minimieren, ohne die Übersicht zu verlieren.
- **Root Cause für "nichts im Dashboard" (Call mit Matthias, 06.07. ~11:00):** BlackHole/System-Audio-Eingang hatte die ganze Zeit Pegel 0 — Matthias' Ton kam nie an (Audio-Ausgang war nicht auf Multi-Output/Aggregate mit BlackHole gestellt). Dadurch gab es im Call nur 1 gesprochene Zeile, `main.js` (`spoken.length < 2`) hat den Call daraufhin **stillschweigend** verworfen — keine Nachverarbeitung, keine Brain-Notiz, nichts im Dashboard. Zusätzlich lief der Call noch im Sales-Skript-Modus „Closing" statt „Note Taker" (Restzustand vom letzten Test).
- **07.07. — kein Bug:** Log-Auswertung zeigte, dass die „Kunde"-Spur (BlackHole) nur bei des Nutzers **Solo-Mic-Tests** (17:16/17:17, niemand auf der Gegenseite) still war — im echten Thomas-Call (Google Meet, 14:30) kam der Gegenüber-Ton durchgehend an (`final (Kunde)`), ebenso im 16:59-Call (`Pegel Kunde 6/128 Ton ok` nach ~6 Sek). Einstellungen (Jabra=Ich, BlackHole=Kunde) waren korrekt. Eine kurz eingebaute 8-Sek-„Kunde-still"-Warnung wurde wieder entfernt: Fehlalarm-Risiko (feuert bei Solo-Tests + wenn Gegenseite erst nach >8 Sek spricht).
- **07.07. — Sprach-Umschalter:** DE/EN/Auto-Dropdown in der **Fußleiste** (`foot-lang`, neben Ich/Kunde) + Zweit-Dropdown in Settings (`set-lang`), synchron. `de`/`en` → `nova-2` + fixe Sprache (genau), `multi` → `nova-3` Code-Switching. Grund: englischer Brandon-Call wurde als deutsches Kauderwelsch transkribiert. Für bekannt englische Calls vor dem Call auf EN stellen.
- **07.07. — Tray/Dock/Fern-Aus:** Menüleiste jetzt nur noch **weißer Punkt ○** (nie rot, kein Text), **kein Dock-Icon** (`app.dock.hide()`). Aufnahme-Status/An-Aus läuft übers Dashboard. Neuer **Ausschalten-Button** im Dashboard-Modul: `POST /api/salescopilot/stop` schreibt `dashboard/data/salescopilot-command.json` `{cmd:"shutdown"}`; die App pollt das (alle 2 s, `pollCommands`) und fährt sauber runter — bei laufender Aufnahme ERST Notiz fertig (`gracefulShutdown`→`tray-toggle-listen`→`call-end`→`maybeQuitAfterProcessing`), dann beenden. Kein Mitschnitt geht verloren.
- ~~Projekt liegt weiterhin außerhalb vom Jarvis-Repo~~ → 06.07. nach `Jarvis/sales-copilot/` verschoben (siehe unten).
- **Kalender-Auto-Start existiert bereits:** `dashboard/watcher.js` startet die App automatisch, wenn ein Termin mit Meeting-Link (Zoom/Meet) in <10 Min beginnt (10-Min-Watcher, launchd). Kein neuer Code nötig — nur die "Ton-Erkennung" (automatisch aufnehmen sobald Pegel da ist) fehlt noch, siehe Abschnitt 3 oben.

### Update 06.07. Teil 2 (Feedback nach dem Matthias-Call)
- **Minimieren-Button** im Header ergänzt (– neben ⚙/✕, `index.html`/`renderer.js`/`preload.js`/`main.js`: `hide-window`-IPC) — versteckt das Fenster, App läuft im Tray weiter, per Tray-Menü oder ⌘⇧H wieder holbar.
- **Note-Taker zeigt jetzt keine Mitschrift mehr** (`transcript-section` in `enterNoteTaker()` auf `display:none`, in `selectScript()` wieder sichtbar) — er soll da nichts mitlesen müssen.
- **Notiz öffnet sich direkt nach dem Call** (auch im Note-Taker-Modus, `main.js` call-end: `shell.openPath(res.notePath)`), analog zum bisherigen PDF-Verhalten im Sales-Modus — nicht mehr nur stumm ins Brain schreiben.
- **Recap-Prompt (`notetaker.js`) generiert bei Setting-/Discovery-Calls jetzt gezielt ein Demo-Vorbereitungs-Action-Item**, das den größten/am schnellsten umsetzbaren Pain Point als Quick-Win für die Demo benennt.
- **Root-Cause-Verdacht "eigene Stimme kaum transkribiert":** Im Matthias-Call war laut `debug.log` auch der "Ich"-Pegel fast durchgehend bei 0-1/128 (STILL), nicht nur "Kunde". Wahrscheinlich war beim Mic-Dropdown ("Ich") nicht das Gerät ausgewählt, über das tatsächlich gesprochen wurde (z. B. Jabra-Headset-Mikro fürs Zoom-Gespräch vs. falsch ausgewähltes Mikro im Dropdown) — vor dem nächsten wichtigen Call beide Dropdowns (Ich + Kunde) gegenchecken.

### Update 06.07. Teil 3 — Dock-Icon nach Minimieren tot
- **Bug:** Nach „Minimieren" war die App nirgends im Dock klickbar — `skipTaskbar: true` im `BrowserWindow`-Konstruktor + `app.on("activate")` erzeugte nur bei 0 Fenstern ein neues (das versteckte Fenster blieb aber bestehen, also passierte beim Dock-Klick nichts).
- **Fix:** `skipTaskbar: true` entfernt (Dock-Icon bleibt normal sichtbar/klickbar) und `activate`-Handler zeigt ein bestehendes verstecktes Fenster wieder (`win.show()`), statt nur bei fehlendem Fenster neu zu erzeugen. Rückweg jetzt also: Dock-Icon anklicken ODER Tray-Menü „Fenster anzeigen" ODER ⌘⇧H.

### Update 06.07. Teil 4 — Umzug ins Jarvis-Repo + PDF im Dashboard
- **Projekt verschoben:** ein separater Projekt-Ordner → `~/AIOS/sales-copilot/` (jetzt Teil des Jarvis-Repos, aufgeräumt). Pfade angepasst in `dashboard/watcher.js` (Auto-Start-Trigger) und `dashboard/server.js` (`/api/salescopilot/start`). Der App-Speicher (`~/Library/Application Support/Sales Copilot/` — Config, Skripte, `calls/`-Ordner mit Transkripten/PDFs) bleibt unverändert, ist unabhängig vom Projekt-Pfad (Electron `userData`).
- **Zwei getrennte Outputs bewusst so belassen** (kein Merge nötig): Brain-Notiz (`brain/03_Projects/<projekt>-calls/` bzw. `00_Inbox/`) = maschinenlesbar für die KI (Markdown, Recap + Action Items). Lokales `Auswertung.pdf` im `calls/`-Ordner (nur Sales-Modus/Setting+Closing) = schönes PDF für der Nutzer selbst. Keine feste Datei-Verlinkung zwischen beiden (Brain-Recap und PDF-Erzeugung laufen im Code parallel, nicht sequenziell — Race beim Verlinken), stattdessen:
- **Dashboard-Modul „Sales Copilot" zeigt jetzt beides getrennt:** neue Karte „PDF-Auswertungen (Sales-Modus)" unter den Brain-Notizen, liest live aus `~/Library/Application Support/Sales Copilot/calls/*/Auswertung.pdf` (`/api/salescopilot` liefert zusätzlich `pdfs[]`), Klick öffnet das PDF lokal (`POST /api/salescopilot/open-pdf`, `open <pfad>` via `child_process.spawn`, Ordnername wird gegen echte Unterordner von `calls/` validiert — kein Path-Traversal).

### Update 06.07. Teil 5 — Dock-Icon reicht der Nutzer nicht als Reminder
- Feedback: Cmd+Tab holt das Fenster zwar zurück, aber der Nutzer vergisst den Shortcut ohne sichtbaren Hinweis (der Text dazu steht ja nur im jetzt versteckten Overlay).
- **Fix:** `hideWithHint()` in `main.js` — beim Minimieren (Button, Tray-Menü, ⌘⇧H) feuert jetzt zusätzlich eine native macOS-Notification: "Sales Copilot minimiert — Zurückholen: Tray-Symbol oben rechts (⚪/🔴) oder ⌘⇧H." Läuft über alle drei Minimier-Wege gleich.

### Update 06.07. Teil 6 — PDFs raus, alles ins Brain, alte Desktop-App weg, Status ehrlich
Sammel-Feedback nach dem Matthias-Call. Umgesetzt:
1. **Alte gebaute Desktop-App war die Fehlerquelle:** `~/Desktop/Sales Copilot.app` war ein Build vom 18.06. (KEIN Minimieren/Tray) — die öffnete der Nutzer versehentlich, deshalb „Minimieren geht nicht / finde sie nie wieder". App + `dist/`-Build in den Papierkorb verschoben (reversibel). Launch nur noch über Dashboard-Button „App starten" oder Kalender-Auto-Start (`watcher.js`). Beide zeigen auf `Jarvis/sales-copilot` via `npm start`.
2. **PDFs komplett raus** (der Nutzer: „PDF schön, aber unnötig — Brain ist lesbar genug"). `report.js` + `makepdf.js` gelöscht, `htmlToPdf`/`report`-Nutzung aus `main.js` raus. **Sales-Modus schreibt jetzt EINE Brain-Notiz statt PDF:** Die Sales-Auswertung (API, Skript-Treue/Einwände/Verbesserungstipps + Demo-Todo bei Setting-Calls) wird in `main.js` erzeugt und als `recapText` an `notetaker.run()` durchgereicht — dieselbe Infrastruktur wie Note Taker (Kunden-Erkennung, Notiz-Ablage, Task-Verteilung). Ergebnis: 1 Notiz/Call, kein PDF, keine Doppel-Auswertung. `notetaker.run` nimmt jetzt optional `recapText` (fehlt er → neutraler CLI-Recap wie bisher). Ein-H1-Fix: erste Überschrift wird generisch zu H2 demotet (`# Recap`/`# Sales-Auswertung` → `##`).
3. **Status-Datei wird jetzt wirklich geschrieben:** `main.js` schreibt bei call-start `{recording:true, mode, since}` und bei call-end `{recording:false}` nach `dashboard/data/salescopilot-status.json`. Vorher schrieb die App die Datei NIE → Dashboard zeigte immer nur „BEREIT" (pgrep), nie „● REC". Jetzt sieht der Nutzer im Dashboard echt, ob gerade aufgenommen wird.
4. **Dashboard-Modul überarbeitet:** PDF-Karte + `/api/salescopilot/open-pdf` + `pdfs[]` entfernt. Neue rote Hinweis-Box, die NUR bei laufender Aufnahme erscheint („● Aufnahme läuft — Fenster zurückholen mit ⌘⇧H, dann Stoppen"), damit der Nutzer den Call nicht vergisst zu beenden. Call-Notizen öffnen jetzt **inline im Sales-Copilot-Modul** (eigene Viewer-Karte mit „✕ schließen"), statt ins Brain-Modul zu springen (von dort fand er nicht zurück). `[[Links]]` in der Notiz springen weiterhin bewusst ins Brain.

## 6. Feedback der Nutzer 03.07. (Nacht-Dump — Prio für nächste Session)
> **Status 03.07.:** Punkte 1–4 umgesetzt (Modus „📝 Note Taker" im Dropdown, Start interaktiv statt Click-through, neutraler Recap + Tasks/Kunden-Erkennung in `notetaker.js` — läuft nach jedem Call). Punkt 5 (Auto-Erkennung/Ton) = Abschnitt 3, noch offen. Ebenfalls offen: Abschnitte 3–5 oben + Dashboard-API `/api/salescopilot`.
1. **Dritter Modus „Note Taker"** neben Setting/Closing-Skript in der Modus-Auswahl: KEINE Skripte, KEINE Tipps/Empfehlungen, nichts Sichtbares — hört nur zu, transkribiert im Hintergrund. Workflow: App an → „Mithören" klicken → minimieren, fertig.
2. **Start-Verhalten umdrehen:** App startet aktuell im transparenten Click-through-Modus (man muss erst Cmd+Shift+K drücken, um sie bewegen zu können). Soll andersrum sein: **beweglich/interaktiv starten**, Transparent-Modus erst auf Cmd+Shift+K.
3. **Nicht alles ist ein Sales-Call:** Viele Calls sind Kunden-/Projektcalls (z. B. „wie verbessern wir das Projekt"). Recap-Prompt entsprechend neutral halten, nicht nur Sales-Framing.
4. **To-Dos + Kunden-Zuordnung:** Aus jedem Call automatisch Action-Items als Tasks generieren UND den Kunden erkennen — via Kalender-Abgleich („mit wem hatte ich gerade einen Termin?", Watcher/Google-Kalender liegt in ~/AIOS/dashboard/) → Tasks in die Projekt-Notiz des Kunden (brain/03_Projects/<kunde>.md) bzw. tasks.md mit [[kunde]]-Link. Call-Notizen landen im Brain und erscheinen im Dashboard-Modul „Sales Copilot" (API /api/salescopilot liest brain/03_Projects/*-calls/ + 00_Inbox/call-*.md).
5. **Best case:** App joint/erkennt Calls automatisch (Ton-Erkennung aus Abschnitt 3 reicht als v1).

## 7. Feedback der Nutzer 12.07. (Recap härten + Transkript-Archiv + Pipeline-Handover)
Auslöser: Meetily-Repo angeschaut (siehe Sales-Copilot-Notiz). Deren festes Recap-JSON-Schema übernehmen. Prio für nächste Session:

1. **Recap-Schema härten (aus Meetily klauen):** feste Struktur statt Freitext — `KeyDecisions`, `ActionItems`, `NextSteps` (+ Teilnehmer, Kurz-Summary). Zwingt Struktur, wird bei echten Calls (nicht 3-Min-kalt) deutlich besser.
2. **Call-Typ-Awareness:** erkennen ob **Setting / Closing / Demo / Projektcall** UND ob echter Call vs. kurzer kalter (~3 Min) Anwahlversuch. Bei kurz-kalt kein volles Schema; bei echtem Call volles Schema + Typ-spezifisches Framing.
3. **NextSteps = echte Pipeline-Übergabe:** die Next-Steps sollen in die nächste Stufe führen, nicht nur beschreiben.
   - Setting-Call → konkretes Todo/Ticket „Demo aufsetzen" (idealerweise so ausgegeben, dass es direkt in Cursor/als Ticket verarbeitet werden kann).
   - Closing-Call → aus dem Close direkt weiter: Demo-Ergebnis → Projekt-Setup.
   - Also: jede Stufe reicht sauber an die nächste weiter (Setting → Demo → Projekt).
4. **Volles Transkript speichern UND abrufbar (wichtig):** nicht nur der Recap. Jarvis/Claude muss ins komplette Transkript reinschauen können, was der Kunde wörtlich gesagt hat. Konkrete Fälle: Kunde nennt „Tool XY / diesen Link" → später abrufbar. Kunde sagt „da bin ich im Urlaub" → Datum später abfragbar, um das Projekt im Nachhinein zu planen. Transkript-Archiv durchsuchbar halten (nicht nach dem Recap wegwerfen).

> **Status 12.07. (umgesetzt, Punkte 1–3):** Recap-Schema in BEIDEN Pfaden gehärtet — Note-Taker-Prompt (`notetaker.js` `buildPrompt`) und Sales-Prompt (`main.js`).
> - **Call-Typ-Awareness:** neues Feld `CALLTYP:` (setting/closing/demo/projekt/sonstiges/kurz-kalt). Bei `kurz-kalt` (kein echtes Gespräch, <3 Min) wird nur ein 1-2-Satz-Recap ausgegeben, KEIN volles Schema. Typ landet in Frontmatter (`calltyp:`) + Header (`Typ: …`) der Call-Notiz.
> - **Feste Struktur:** `## Entscheidungen` + `## Action Items` + `## Next Steps` statt Freitext.
> - **NextSteps = Pipeline-Übergabe:** typ-abhängig — Setting → Cursor-fähiges „Demo aufsetzen"-Ticket (größter Pain Point + Bausteine), Closing → „Projekt-Setup starten", Demo → „Angebot/Close nachziehen". `extractTasks` zieht Tasks jetzt aus **Action Items UND Next Steps** (dedupliziert) → Demo-Ticket wird automatisch zum Task.
> - **Punkt 4 (Transkript-Archiv):** vom aktuellen Stand großteils abgedeckt — das volle Transkript liegt im `## Transkript`-Block jeder Call-Notiz (grepbar im Brain). Noch offen falls gewünscht: separater durchsuchbarer Transkript-Index/-Ordner.

> **Zusätzlich 12.07. — Selbstlernende Einwand-Bibliothek + OpenAI-Streaming (Punkt 5, Feedback-Dump):** der Nutzer will (a) dass Einwände nach dem Call verarbeitet werden (welche kamen, gut/schlecht gelöst) und in eine wachsende Bibliothek wandern, (b) dass das Live-Modell diese gelernten Antworten rausgreift statt neu zu denken, (c) echten Echtzeit-Stream statt CLI-Neustart.
> - **`einwand-bib.js`** (+ `data/einwand-bibliothek.json`, `{eintraege:[{einwand,antwort,quelle,datum}]}`): `load` / `formatForPrompt(max=40)` / `mergeNew(pairs,meta)` (dedup über normalisierten Einwand-Kern) / `normKey`.
> - **Lern-Loop (Nachverarbeitung):** Recap-Prompt (Opus, Sales-Modus) hängt am Ende einen Maschinen-Block `<!--EINWAND-BIB [{einwand,antwort}]-->` an. `notetaker.js` `run()` parst ihn (`bibMatch`), `mergeNew(..., {quelle:noteName, datum:day})`, strippt den Block aus der sichtbaren Notiz.
> - **Nutz-Loop (Live-Tipps):** `main.js` `coach`-Handler zieht `einwandBib.formatForPrompt()` in den Prompt (Block „GELERNTE EINWÄNDE", hinter der festen MMS-Methodik). Leere Bib → kein Block (verifiziert: `formatForPrompt()` gibt `""` zurück). **Damit ist der Kreis zu** — was in einem Call gelernt wird, hilft im nächsten sofort.
> - **`notetaker.streamOpenAiTip({system,user,apiKey,onDelta,model,signal})`:** offener Streaming-`fetch` gegen OpenAI (`stream:true`), Token kommen sofort via `onDelta`. **Gated** — läuft NUR mit `OPENAI_API_KEY`; ohne Key bleibt alles bei der Codex-CLI (~4-5s). Der Renderer-Umbau (Coach ruft Stream statt `runCodex`, sobald Key da) + Prompt-Caching (fixer Kontext vorne, gpt-4.1-mini) ist der **letzte offene Schritt, sobald der Nutzer den OpenAI-Key nachreicht** (er wollte morgen dran erinnert werden). Alles andere ist ohne Key fertig gebaut + verifiziert.
>
> **Zusätzlich 12.07. — Meeting-Modus (an „Mithören" gehängt):** Damit Calls flüssig bleiben (kein RAM/CPU-Geruckel), pausiert „Mithören an" automatisch alles Störende im Hintergrund, „Mithören aus" weckt es wieder. `main.js` `setMeetingMode(on)` postet an `http://127.0.0.1:4321/api/meeting-mode` (fire-and-forget, blockt den Call nie): call-start → `{on:true}`, call-end → `{on:false}`. Server (`server.js`, Block „Meeting-Modus 12.07."): `meetingModeOn` friert laufende Outreach-Agents per SIGSTOP ein + schreibt `dashboard/.meeting-mode` (`.paused`-Agents bleiben unberührt); die Shell-Runner `watcher.sh`/`outreach-watchdog.sh`/`daily-run.sh` ruhen, solange das Flag <2h alt ist (danach selbstheilend); `meetingModeOff` weckt nur die eingefrorenen Agents (SIGCONT) + löscht das Flag. Failsafe bei Copilot-Crash mitten im Call: `meetingModeStatus` weckt bei Flag-Alter >2h alles auf. Kein Kalender-Dauerpolling — der Aufnahme-Schalter ist der Trigger. Details in SYSTEM.md (Sales-Copilot-Zeile).
