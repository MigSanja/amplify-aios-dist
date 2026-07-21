# Playbook 04 — Daily LinkedIn InMails (Alex)
> Step 4 · täglich ~11:00. Bis zu **20 InMails/Tag** an Leads, deren Vernetzungsanfrage seit **≥7 Tagen** offen ist. **InMails bekommen KEINE Follow-ups.**

## Account & Browser + Pflicht-Check
Steuerung über **`mcp__browser__*`** (chrome-devtools-mcp, **fest Port 9222 = der Nutzer** — keine Browser-Auswahl). Paul = Port 9223, NIE anfassen. Eigener Arbeits-Tab (`new_page`); offener LinkedIn-Tab → evtl. läuft andere LinkedIn-Task → abbrechen. Nicht eingeloggt / Captcha / „Wichtiger Hinweis von LinkedIn" → abbrechen, nie selbst einloggen.
**Datentrennung:** im CRM nur `account`=„der Nutzer"; Google Sheet Spalte G („Contacted On ") = „der Nutzer LinkedIn".

## 1) Kandidaten (lokal — KEINE externe Permission nötig)
Primärquelle **`agents/outreach-alex/runs/pending-invites.json`** (offene Vernetzungsanfragen, Feld `sentAgo` = „Vor X Tagen gesendet"). Filter: `sentAgo` ≥ **7 Tage**. **Älteste zuerst, max. 20.** Je Kandidat den passenden CRM-Eintrag (`dashboard/data/leads.json`, Match per `url`) für `icebreaker` + ICP ziehen; fehlt der Icebreaker → aus dem Profil formulieren. Fallback, falls Datei fehlt/leer: CRM-Leads mit `status`=„Vernetzt" UND `account`=„der Nutzer" UND `addedAt` ≥ 7 Tage. **Nie wegen fehlender Quelle den ganzen Schritt still überspringen — bei Problem `node dashboard/notify.js` (siehe agent.md).**

## 2) Pro Lead InMail senden (Claude in Chrome)
- Profil über URL öffnen → „Nachricht" (falls nur „Folgen"/„Ausstehend": über „In Sales Navigator anzeigen" → „Nachricht", ggf. 2×). InMail-Maske im Sales Navigator (`msgType=inmail`; „1 von X InMail-Guthaben" bzw. „Kostenlos für Open Profile").
- „Kommunikation deaktiviert" → ÜBERSPRINGEN (bleibt „Vernetzt"). „Kontakt gesendet"-Datum ≥7 Tage prüfen.
- **BETREFF:** „Kurze Frage, Herr/Frau <Nachname>".
- **ICEBREAKER** aus CRM-Feld `icebreaker`; falls leer, aus Profil formulieren.
- **TEXT** (nicht kürzen): „Hallo Herr/Frau <Nachname>", Leerzeile, Eisbrecher, Leerzeile, kompletter Pitch (unten), Ende „Mit freundlichen Grüßen," OHNE Namen (Signatur automatisch).
- Erste Eingabe landet manchmal nicht → per Screenshot prüfen, dass Betreff UND Text gefüllt sind; sonst neu tippen. Dann „Senden" + per Screenshot bestätigen.

### PITCH (wortgleich, NACH dem Eisbrecher)
NEU 17.07.: **M1-Variante nach Zielgruppe aus `messages.md`** (Makler / Agentur / Dienstleister — wortgleich, Du-Form, ohne Signatur). Betreff: „Kurze Frage, [Vorname]". Zielgruppe aus dem Profil zuordnen; passt keine → keine InMail.

## 3) CRM nachtragen
Je gesendetem Lead `curl -s -X POST http://localhost:4321/api/lead-save -H 'Content-Type: application/json' -d '{"id":"<profil-url>","fields":{"status":"InMail","pipelineStage":"InMail","inmailAm":"<TT.MM.JJJJ>"}}'`. Account bleibt „der Nutzer". Stufen-Datum nur setzen, nicht überschreiben.

## 4) Google Sheet (DIREKT, KEIN n8n)
Pro gesendetem InMail EINEN Befehl:
`node dashboard/gsheet.js append "Juni Erstkontakt" "<Name>" "<Profil-URL>" "InMail" "<TT.MM.JJJJ>"`
Schreibt F=Name+URL, G="der Nutzer LinkedIn", H="InMail", I=Datum, J="Yes". Blatt = **„Juni Erstkontakt"** (laufendes Kampagnenblatt Richtung 300). Kontrolle: `node dashboard/gsheet.js count "Juni Erstkontakt"`.

## 5) Limits
Max. 20/Tag. Guthaben beachten (Antwort = Credit zurück; Open Profile kostenlos). Menschliches Tempo. KEIN zweiter InMail an dieselbe Person. **UND kein InMail, wenn die Person schon per normale Nachricht/M1 kontaktiert wurde** — VOR dem InMail den Namen (normalisiert) gegen CRM + `known-contacts.json` prüfen (nicht nur URL: SalesNav `/sales/lead/…` ≠ normales `/in/…` für dieselbe Person). InMail und M1 zählen als DERSELBE Erstkontakt.

## 6) Bericht
Account (der Nutzer), gesendet (Namen+Firma), übersprungen, CRM+Sheet ja/nein, Restguthaben.
