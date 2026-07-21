# Playbook 03 — Daily LinkedIn Outreach / Erstkontakt (Alex)
> Step 3 · täglich ~08:00. Vernetzte Leads anschreiben (Erstnachricht M1). Max. **15 Leads/Tag**, menschlich, zufällige Pausen. CRM + Outreach-Sheet aktualisieren. (Airtable abgeschafft — CRM = Quelle.)

## Account & Browser + Pflicht-Check
Wie Playbook 01/02: Steuerung über **`mcp__browser__*`** (chrome-devtools-mcp, **fest Port 9222 = der Nutzer** — keine Browser-Auswahl). Paul = Port 9223, NIE anfassen. Eigener Arbeits-Tab (`new_page`); offener LinkedIn-Tab / nicht eingeloggt / Captcha → abbrechen.

## Schritt 1 — Leads holen (CRM)
Aus dem CRM lesen — `dashboard/data/leads.json` (bzw. GET `http://localhost:4321/api/leads`). Filter: `status`=„Vernetzung angenommen" UND `account`=„der Nutzer". Pro Lead: `name`, `url`, `icebreaker`, **`category`** (bestimmt die M1-Variante). **Max. 15** (die ersten 15).

## Schritt 2 — pro Lead anschreiben (Claude in Chrome)
- **🚫 KANALÜBERGREIFENDER DE-DUPE (vor jedem M1, Pflicht):** Name der Person (normalisiert) gegen `known-contacts.json` + CRM prüfen. Steht sie dort schon als kontaktiert/InMail/Erstkontakt — **egal ob per Sales Navigator (`/sales/lead/…`) oder normale (`/in/…`) URL** — dann **KEIN M1**. URL-Vergleich reicht NICHT (verschiedene URLs pro Kanal für dieselbe Person) → nach NAME matchen. InMail und M1 sind derselbe Erstkontakt.
- **MENSCHLICH statt URL-Klick (Pflicht):** NICHT die gespeicherte LinkedIn-URL direkt öffnen — stattdessen im LinkedIn-/Sales-Nav-**Suchfeld nach dem Namen suchen** und das Profil aus den Treffern öffnen (so wie ein Mensch). Bei Namensgleichen über Firma/Region den richtigen wählen.
- MENSCHLICH auf dem Profil: Profilbild kurz anklicken/anschauen, langsam hoch/runter scrollen, Text „durchlesen", Zeit lassen — pro Profil leicht anders (random).
- **📬 KANAL: IMMER die normale LinkedIn-Inbox** (Profil unter `/in/…`, dort „Nachricht") — NIE über „In Sales Navigator anzeigen" in den SalesNav-Chat wechseln. M1 + spätere Follow-ups müssen im SELBEN Thread laufen (sonst zwei Chats mit derselben Person, ein früherer Doppelkontakt-Fall).
- „Nachricht"-Button klicken (`click` auf den Button, oder per `evaluate_script`: Button mit Text 'Nachricht' `.click()`).
- **🛑 CHAT = WAHRHEIT (Pflicht vor JEDEM Senden):** Nach dem Öffnen des Nachrichten-Fensters ZUERST den Verlauf lesen. Steht dort IRGENDEINE frühere Nachricht (egal von wem — auch eine eigene InMail, die im Thread auftaucht) → **KEIN M1**. Stattdessen CRM + Sheet per **Profil-URL** auf den echten Stand korrigieren und im Report melden. CRM/Sheet sind nur der Wegweiser — **was im Chat steht, ist die Wahrheit** (ein früherer Vorfall 10.07.: Sheet-Dublette sagte „Erstkontakt", Chat hatte längst Follow-up 2 → Doppel-Nachricht).
- **Nachricht = Icebreaker (CRM-Feld `icebreaker`) + Leerzeile + M1-Variante nach `category`** (siehe unten). Fehlt der Icebreaker, aus dem Profil formulieren. ⚠️ Alt-Icebreaker in Sie-Form („Hallo Herr/Frau …") vor dem Senden auf Du-Form umformulieren („Hey [Vorname],") — Icebreaker und Pitch müssen zusammenpassen.
- Ins `<textarea>` per `mcp__browser__fill` oder `evaluate_script`: nativer value-Setter + `_valueTracker.setValue('x')/setValue('')` + `InputEvent('input',{inputType:'insertText'})`; dann „Senden".
- Zwischen Leads zufällig **60–150 Sek** warten. Erfolgreiche Leads merken (Name, URL, recordId).

## Schritt 3 — am Ende gebündelt
- **(a) CRM:** je angeschriebenem Lead `curl -s -X POST http://localhost:4321/api/lead-save -H 'Content-Type: application/json' -d '{"id":"<profil-url>","fields":{"status":"Kontaktiert","pipelineStage":"Kontaktiert","kontaktiertAm":"<TT.MM.JJJJ>","messagingVariante":"<Makler|Agentur|Dienstleister>"}}'`. Account bleibt „der Nutzer". Stufen-Datum nur setzen, nicht überschreiben.
- **(b) Google Sheet: ABGESCHAFFT (17.07.).** Kein `gsheet.js append` mehr. Das CRM ist die einzige Quelle, das Dashboard (Outreach-Funnel) rechnet alle Quoten daraus. Die Juni-Kampagne bleibt als Archiv im Sheet, wird aber nicht mehr beschrieben.

## Schritt 4 — Tabs schließen (PFLICHT, IMMER)
Alle in diesem Lauf geöffneten LinkedIn-/Sales-Nav-Tabs schließen (`close_page`), auch bei Abbruch/Fehler.

## PITCH (M1 — Variante nach CRM-Feld `category`, wortgleich aus `messages.md`)
**Quelle: `agents/outreach-alex/messages.md`** — dort stehen die drei M1-Varianten wortgleich. Auswahl:
- `category` = **Makler** (oder Alt-Kategorien: Immobilienmakler, Kapitalanlagevertrieb, Projektvertrieb / Neubau, Projektentwickler, Sonstiges Immobilien) → **M1-MAKLER**
- `category` = **Agentur** → **M1-AGENTUR**
- `category` = **Dienstleister** → **M1-DIENSTLEISTER**
- `category` fehlt/unklar → aus dem Profil zuordnen; passt keine der drei → NICHT anschreiben, im Report melden.
**Du-Form, KEINE Signatur, KEINE Garantie in der DM** (Geld-zurück ist Call-Material). Im CRM beim Speichern (Schritt 3a) zusätzlich `"messagingVariante":"Makler|Agentur|Dienstleister"` mitschreiben — das ist unser A/B-Tracking, welches Messaging rausging.

## Abschluss
Account (der Nutzer), wie viele angeschrieben, welche, CRM + Sheet aktualisiert. Bei Problemen (nicht eingeloggt, Blatt fehlt, Senden inaktiv, offenes Fenster) abbrechen + der Nutzer informieren.
