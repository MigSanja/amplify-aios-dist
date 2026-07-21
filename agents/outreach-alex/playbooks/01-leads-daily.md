# Playbook 01 — LinkedIn Leads Daily (Alex)
> Step 1 der Tageskette. Findet ICP-Leads, **bewertet sie (ICP-Score) VOR dem Vernetzen**, vernetzt nur ≥7 ohne Nachricht, speichert jeden vernetzten Lead ins CRM. Tageslimit: **`limits.connectsPerDay` aus `config.json` (aktuell 25, fix — kein Ramp)**.

## Browser & Tools (chrome-devtools-mcp · Port 9222 = der Nutzer)
Du fährst Chrome über **`mcp__browser__*`** — fest an deinen Account-Port gebunden, keine Browser-Auswahl nötig (Verwechslung unmöglich).
Werkzeuge: `new_page` · `navigate_page` · `take_snapshot` · `take_screenshot` · `click` · `fill` / `fill_form` · `evaluate_script` · `close_page`.
(Die alten Cowork-Tools `list_connected_browsers`/`select_browser`/`tabs_close_mcp` gibt es NICHT mehr — ignorieren.)

## Pflicht-Check ZUERST
1. **Alte Tabs aufräumen (self-healing):** `list_pages` — noch LinkedIn-/Sales-Navigator-Tabs offen? Das sind **Waisen aus einem vorher abgebrochenen/gekillten Lauf** (es läuft nur EIN Agent-Prozess pro Account, also nie ein Parallel-Lauf). **Alle schließen** (`close_page`), im Trail kurz vermerken. **NICHT abbrechen** — offene Tabs sind KEIN Abbruchgrund.
2. **Eigenen frischen Arbeits-Tab** öffnen (`new_page`).
3. Login auf linkedin.com prüfen. **NUR bei Login-Seite / Checkpoint / Captcha / SMS / Logout → SOFORT STOPPEN + melden, NIE selbst einloggen.**

## Modus A — Kandidatenliste abarbeiten (bevorzugt, seit 20.07.)
Existiert `runs/.candidates-<heute>.jsonl` (vom globalen Sourcing-Lauf, Playbook 00), **arbeite DIESE Liste ab statt live zu sourcen**:
- Pro Eintrag: **NICHT** den `salesNavUrl` anklicken. Stattdessen auf **normalem LinkedIn per Namen (+ Firma) suchen** und das `/in/`-Profil öffnen (menschliches Verhalten + Verwechslungsschutz, des Nutzers Ansage).
- **Identitäts-Check (Pflicht):** Ist es dieselbe Person? Firma/Rolle/Standort müssen zum Kandidaten-Eintrag passen. Nein oder unsicher → überspringen, im Trail vermerken, nächster Eintrag.
- Passt die Person: weiter wie im Ablauf unten — **ICP-Score ≥7 VOR dem Vernetzen**, Eisbrecher (NUR in die CRM-Datei, nie ins Eingabefeld), **blank vernetzen** (ohne Nachricht), speichern, De-Dupe.
- Arbeite die Liste ab bis `limits.connectsPerDay` vernetzt sind oder die Liste leer ist.

Fehlt die Liste (kein Sourcing gelaufen) → **Modus B: live sourcen wie bisher** (Abschnitte unten).

## Suchen (Modus B — Live-Sourcing, Fallback · NEU 17.07. — 3 Zielgruppen parallel, A/B-Test)
Drei Zielgruppen, jede mit EIGENER Sales-Nav-Suche. **Tagesbudget aufteilen: Agentur 6 · Dienstleister 6 · Makler 3** (bei Limit 15; proportional bei anderem Limit). Makler läuft nur noch MIT — Pool auf LinkedIn fast leer (0/20 am 17.07.), Hauptkanal Makler = Cold Email.
**Pflicht in JEDER Suche (NIE anfassen):** „kürzlich auf LinkedIn gepostet" (`POSTED_ON_LINKEDIN`, id:RPOL — wichtigstes Kriterium, sonst Annahmequote tot) · Region DACH (id:91000006), **NUR deutschsprachige Leads** (Profil primär Deutsch; primär FR/EN/IT → skip, Regel 20.07.), Schweiz nur **Deutschschweiz** · Firmengröße **NUR 1-10 (Stufe B)** — 11-50 macht Paul (Split-Test) · 2./3. Grad, 1. Grad AUSSCHLIESSEN · Titel NUR Entscheider (Inhaber, Geschäftsführer, Gründer, CEO), keine Mitarbeiter-Rollen.

- **MAKLER** — Basis-URL (bewährt): `https://www.linkedin.com/sales/search/people?query=(filters:List((type:INDUSTRY,values:List((id:44,text:Immobilien,selectionType:INCLUDED))),(type:REGION,values:List((id:91000006,text:Deutschland%2C%20%C3%96sterreich%20und%20die%20Schweiz,selectionType:INCLUDED))),(type:COMPANY_HEADCOUNT,values:List((id:B,text:1-10,selectionType:INCLUDED))),(type:POSTED_ON_LINKEDIN,values:List((id:RPOL,selectionType:INCLUDED)))))` — dazu im UI: Aktuelle Position = Inhaber / Geschäftsführer / Immobilienmakler / Immobilienkaufmann (NICHT mehr Seniority „Leitende Position", NICHT vertriebslastig).
- **AGENTUR** — Suche im UI bauen: Branchen Marketing/Werbung/Design (z.B. „Werbedienstleistungen", „Marketingdienstleistungen", „Designdienstleistungen") ODER Keywords `Agentur`, `Marketing Agentur`, `Webdesign`, `Social Media Agentur` · Titel Inhaber/Geschäftsführer/Founder/CEO · Rest = Pflicht-Filter oben.
- **DIENSTLEISTER** — Suche im UI bauen: Branchen Coaching/Unternehmensberatung/Weiterbildung ODER Keywords `Coach`, `Business Coach`, `Berater`, `Trainer`, `Consulting` · Titel Inhaber/Geschäftsführer/Founder · Rest = Pflicht-Filter oben.

**Beste funktionierende URL je Gruppe persistieren:** `runs/.search-url-makler.txt` · `runs/.search-url-agentur.txt` · `runs/.search-url-dienstleister.txt` (mit Datum + Trefferzahl als Kommentarzeile). Der nächste Tag startet mit diesen URLs. Die alte `runs/.search-url.txt` ist damit abgelöst.
**Selbstständige (1 MA) nur bei harten Erfolgssignalen** (postet aktiv, klar zahlungskräftig/wachsend: Kundenlogos, Team im Aufbau, plausibel 10k+/Monat) — sonst skip. Details: `goal.md`.

## Such-Exploration — wenn der Pool dünn wird
Signal: über **2–3 aufeinanderfolgende Seiten kaum noch ICP ≥7** (viele „Angesehen", institutionelle Rollen, Consultants) oder die Suche ist fast durchgearbeitet.
Dann NICHT einfach weiterquälen, sondern **eigenständig 2–3 alternative Sales-Nav-Suchvarianten bauen und testen** (je 1–2 Seiten, Trefferdichte im Trail notieren). Varianten IMMER innerhalb des ICP aus `goal.md`: andere Titel-Keywords (Inhaber, Gründer, Geschäftsführer, Founder, CEO), andere Branchen-/Keyword-Kombis innerhalb der Zielgruppe, Regionen einzeln statt DACH-gesamt (DE / AT / CH). Dünn ist v.a. Makler → Budget in Richtung Agentur/Dienstleister verschieben und im Report melden.
**NIE anfassen, in JEDER Variante Pflicht:** Filter **„kürzlich auf LinkedIn gepostet"** (`POSTED_ON_LINKEDIN`) — ~3× Annahmequote, fester Kern der Strategie. Ebenso fest: 2./3. Grad, Firmengröße 1-10, nur Entscheider-Titel, Score-Schwelle ≥7 (nie aufweichen, um das Tagesziel zu schaffen).
Die **beste Variante des Tages nach `runs/.search-url-<gruppe>.txt` schreiben** — der nächste Tag startet damit. Tageslimit aus config bleibt; ist es sauber nicht erreichbar, so viele wie möglich vernetzen.
**Melde-Pflicht:** Im Tages-Report UND in der Telegram-Abschlussmeldung ausdrücklich sagen: „Pool wird knapp — Vorschlag: <konkrete Zielgruppen-Erweiterung, 1–2 Optionen>". Rückfragen an der Nutzer sind erwünscht (echte ICP-Erweiterung entscheidet er). Kommt bis zum nächsten Lauf keine Antwort: selbständig mit den besten Varianten weitermachen und wieder melden — nie stillstehen, nie still bleiben.

## ICP (kleine Teams DACH — NUR Entscheider) — Details in `goal.md`
**Der Satz, an dem gescort wird: „Ich baue kleinen Teams KI-Mitarbeiter, damit sie wachsen können, ohne einzustellen."**
**Rolle (hart):** NUR Inhaber · Geschäftsführer · Gründer · CEO. Keine Angestellten/Mitarbeiter-Rollen, kein „Vertriebsleiter" mehr.
**Firmengröße:** 1-10 MA (Stufe B). 11-50 macht Paul (Split-Test). Selbstständige (1 MA) nur mit harten Erfolgssignalen (siehe goal.md), sonst skip.
**Zielgruppe je Lead festhalten:** Makler · Agentur · Dienstleister (Coach/Berater/Trainer) — entscheidet später, welche M1-Variante er bekommt.
**Kaufsignale (scoren hoch):** postet aktiv · wächst/skaliert erkennbar · kleines Team sichtbar · zahlungskräftiger Auftritt.
**Skip:** Angestellte · **KI/AI in Positionierung/Headline/Angebot** (nicht nur Titel — auch „KI-Systeme/AI Sales/KI-gehebelt/KI-Agentur/KI-Berater"; die bauen/nutzen KI selbst = Mitbewerber, antworten uns nicht; Regel 21.07.) · Firmen ab 11 MA · tote Accounts · reine PropTech-Tools, reine Hausverwaltung, Headhunter, Telko.

## Ablauf — pro Lead (bis 20 vernetzt)
- **Such-URL öffnen** (mit 2./3.-Grad-Filter), Ergebnisliste durchgehen. **DE-DUPE Pflicht:** vor jedem Vernetzen `node dashboard/known-contacts.js has "<Name>" "<URL>"` — Ausgabe `yes` → überspringen (matcht Name ODER URL, kanalübergreifend). Auch „Gespeichert"/„Ausstehend" überspringen. Nach dem Vernetzen `node dashboard/known-contacts.js add "<Name>" "<URL>"` (NIE die Datei per truncate/Edit anfassen). **Über mehrere Suchseiten weiterarbeiten, bis 20 vernetzt oder ICP-Quelle erschöpft.**
- **🚫 BLOCKLIST + PRIVAT-CHECK (Pflicht, VOR dem Vernetzen):** `runs/.blocklist.json` lesen — Name **oder** URL enthalten → **NICHT vernetzen, NICHT speichern**, überspringen. Ebenso jeden erkennbaren **Privat-/Freundeskontakt** (kein Immobilien-Bezug, duzt der Nutzer) → nicht vernetzen **und neu in `.blocklist.json` eintragen**. **Freunde dürfen gar nicht erst ins CRM** — der Server filtert `.crm-inbox.jsonl` zwar zusätzlich gegen die Blocklist, aber die erste Bremse bist du.
- Pro Kandidat: **Profil öffnen und wie ein Mensch verhalten** — Profilbild kurz anklicken/anschauen/schließen, langsam hoch & runter scrollen, den Text wirklich „durchlesen", **20–55 Sek Zeit lassen**. **Verhalten pro Profil leicht variieren (random)** — nicht immer gleiche Reihenfolge/Dauer. Dann `take_snapshot`/Profiltext lesen.
- **ICP-Score 1–10 VERGEBEN — VOR jeder Vernetzungs-Aktion.** Im Trail kurz begründen (Warum dieser Score?).
  - **Score ≥ 7 → vernetzen** (••• → „Verbinden" → **ohne Nachricht**) + **speichern** (siehe unten).
  - **Score ≤ 6 → NICHT vernetzen, NICHT speichern**, eine Zeile Begründung im Trail, nächster Lead.
- **Icebreaker** (nur ≥7, zum Speichern) — **NUR in die CRM-Datei schreiben, NIEMALS in ein LinkedIn-Eingabefeld tippen** (kein Chat-Fenster, kein Notiz-Dialog — LinkedIn speichert getippten Text als scharfen Entwurf; genau so ging am 19.07. ein nackter Eisbrecher an ein Kontakt raus). Regeln: `brain/05_Knowledge/icebreaker-guide.md` (Moneymaking-Wissen). Kernregeln: **genau EIN Aufhänger**, **bevorzugt ein aktueller Post** der Person (sie posten ja — Filter „kürzlich gepostet"); nur wenn kein brauchbarer Post da ist → Rolle/Werdegang/Meilenstein. **der Nutzer-Stil (NEU 20.07.): EIN echter Aufhänger** (Banner · Post · Positionierung/Claim · irgendwas Konkretes), **EIN kurzer lockerer Satz**, KEIN erklärender/analytischer Nachsatz (der macht es geschwollen). des Nutzers Wortwahl: „feier ich / stark / richtig gut / hat mich erwischt / cool". Kein Pitch/Produkt/CTA, keine Gedankenstriche, **Du-Form**, Humor ok aber nie auf Kosten der Person, **max. 150 Zeichen**. Beispiel: „Hey Daniel, das Raumfahrer-Banner feier ich. Starke Bilder statt Bulletpoints, sehr gut." Test: „Würde der Nutzer das genau so in eine DM tippen?" → wenn es nach Analyse klingt, kürzen. Details: `brain/05_Knowledge/icebreaker-guide.md` (Abschnitt „des Nutzers Stil"). Format: „Hey [Vorname]," + [ein lockerer Aufhänger].
- Zwischen Aktionen **echt** warten (kein Alibi-Sleep!): `sleep $((RANDOM % 120 + 60))` = 60–180 Sek randomisiert, via Bash wirklich ausführen. Auf dem Profil vorher `sleep $((RANDOM % 35 + 20))` + wirklich scrollen/Bild anschauen. **Tempo ist heilig — auch beim Aufholen nie verkürzen** (siehe agent.md „Menschliches Tempo ist heilig"). Bei CAPTCHA/Rate-Limit/Login-Redirect **sofort stoppen**.

## Speichern (Pflicht, pro vernetztem Lead ≥7)
**KEIN vernetzter Lead darf untergehen** — jeden SOFORT nach dem Vernetzen speichern (erst speichern, dann nächster Lead), inkl. **ICP-Score · LinkedIn-URL · Firma · Standort · Icebreaker**.
Hänge **eine JSON-Zeile** an `agents/outreach-alex/runs/.crm-inbox.jsonl` an (Read → Write/Edit). Genau diese Felder:
```
{"name":"…","company":"…","category":"Makler|Agentur|Dienstleister","location":"…","icpScore":8,"icebreaker":"Hey [Vorname],\n\n…","url":"https://www.linkedin.com/in/…","account":"der Nutzer","status":"Vernetzt","stage":"Vernetzt","addedAt":"YYYY-MM-DD"}
```
**WICHTIG — gültiges JSONL:** GENAU EINE physische Zeile pro Lead. Zeilenumbrüche im Icebreaker als `\n` schreiben (escaped), **NIEMALS echte Umbrüche** — sonst zerbricht die JSON-Zeile und der Lead erscheint nicht sauber im CRM.
**Narrensichere Schreibweise (Pflicht, seit 20.07.):** NIE mit `echo '{...mehrzeilig...}'` anhängen — ein Icebreaker mit echten Umbrüchen zerbricht dann die Zeile (ein Vorfall 20.07.). Stattdessen das Objekt in JS bauen und mit `JSON.stringify` als GENAU EINE Zeile anhängen, z.B.:
```
node -e 'const fs=require("fs");const lead={name:"…",company:"…",category:"Agentur",location:"…",icpScore:8,icebreaker:"Hey Vorname,\n\n…",url:"https://www.linkedin.com/in/…",account:"der Nutzer",status:"Vernetzt",stage:"Vernetzt",addedAt:"YYYY-MM-DD"};fs.appendFileSync("agents/outreach-alex/runs/.crm-inbox.jsonl",JSON.stringify(lead)+"\n")'
```
`JSON.stringify` escaped Umbrüche automatisch → immer valides Single-Line-JSONL, egal was im Icebreaker steht.
→ Diese Datei speist **automatisch das Jarvis-CRM** (Dashboard-Pipeline). Schon vorhandene URL (im CRM oder in der Datei) → nicht doppelt anhängen.

## Tages-Stats (Pflicht, am Ende)
`agents/outreach-alex/stats.json` für HEUTE: `vernetzt` um die Anzahl tatsächlich vernetzter Leads erhöhen (kumulativ). Siehe agent.md.

## Abschluss
- **Draft-Sweep (Pflicht, vor dem Tab-Schließen):** kein offenes Chat-/Nachrichtenfenster, kein Eingabefeld mit Resttext (markieren + löschen, per Snapshot verifizieren). Siehe Absende-Gate in `agents/CLAUDE.md`.
- **Arbeits-Tab schließen** (`close_page`) — IMMER, auch bei Abbruch.
- Kurzer Report nach `agents/outreach-alex/runs/<YYYY-MM-DD>-leads-daily.md`: Profile geöffnet · vernetzt · übersprungen (mit Score) · Ziel erreicht ja/nein · Alerts.

## Safety (hart)
Min. 60 Sek zwischen Vernetzungen. Tageslimit 20 Vernetzungen nie überschreiten (Ban-Schutz vor Volumen). Unsicher über einen Lead → überspringen + im Trail loggen.
