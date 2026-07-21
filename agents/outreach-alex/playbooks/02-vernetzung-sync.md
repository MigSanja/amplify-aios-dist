# Playbook 02 — LinkedIn Vernetzungs-Sync (Alex)
> Step 2 · täglich ~07:00. Prüft die neuesten LinkedIn-Verbindungen und setzt passende CRM-Leads von „Vernetzt" auf „Vernetzung angenommen". (Airtable abgeschafft — CRM = alleinige Quelle.)

## Account & Browser (ZUERST)
- Steuerung über **`mcp__browser__*`** (chrome-devtools-mcp, **fest Port 9222 = der Nutzer** — keine Browser-Auswahl nötig, Verwechslung strukturell unmöglich). Paul läuft auf Port 9223 und wird hier NIE angefasst.
- Maßgeblich = der gebundene Browser (dauerhaft in Alex' LinkedIn eingeloggt, `<ACCOUNT_EMAIL>`).

## Pflicht-Check
- Ist schon ein LinkedIn-/Sales-Nav-Tab offen (jemand arbeitet) → SOFORT ABBRECHEN. Sonst EINEN eigenen Arbeits-Tab öffnen (`new_page`) + Login prüfen. Nicht eingeloggt / Captcha / Checkpoint → abbrechen, nie selbst einloggen.

## Ablauf
- **Schritt 1 — Verbindungen abrufen:** `navigate_page` auf `https://www.linkedin.com/mynetwork/invite-connect/connections/` (sortiert „Neu hinzugefügt"). 2–3 Sek warten, dann Seitentext lesen (`take_snapshot` bzw. `evaluate_script` → `document.body.innerText`). 2–3× scrollen (8–10 Ticks), Text neu laden → neueste ~30 Kontakte. Namen extrahieren (Format „Name – Am X. Monat Jahr vernetzt").
- **Schritt 2 — CRM-Leads holen:** aus dem CRM lesen — `dashboard/data/leads.json` (bzw. GET `http://localhost:4321/api/leads`). Alle Leads mit `status`=„Vernetzt" UND `account`=„der Nutzer". Merke je Lead `name` + `url`.
- **Schritt 3 — Namen abgleichen:** case-insensitiv, Vor-/Nachname. Abgekürzte Nachnamen („Uwe S." = „Uwe Seybert") + Umlaute beachten. Profil-URL je Match merken.
- **Schritt 4 — Update im CRM:** je gematchtem Lead `curl -s -X POST http://localhost:4321/api/lead-save -H 'Content-Type: application/json' -d '{"id":"<profil-url>","fields":{"status":"Vernetzung angenommen","pipelineStage":"Vernetzung angenommen","vernetzungAngenommenAm":"<TT.MM.JJJJ>"},"lead":{<volles Lead-Objekt aus Schritt 2>}}'`. Der Endpoint macht Upsert (findet per URL, kein Duplikat); `lead` mitgeben, falls der Lead nur in `.crm-inbox.jsonl` liegt. Stufen-Datum NICHT überschreiben, nur setzen.
- **Schritt 4b — Stats + Annahmequote (Pflicht, NEU 17.07.):** In `agents/outreach-alex/stats.json` für HEUTE das Feld `gesynct` um die Anzahl gematchter Leads erhöhen (`gesynct` = Vernetzungen angenommen, bestehender Key). Danach die **Annahmequote berechnen und in den Bericht schreiben**: Summe `gesynct` ÷ Summe `vernetzt` über die letzten 14 Tage (aus stats.json), in Prozent. Zusätzlich, wenn möglich, die Quote **je Zielgruppe** (aus dem CRM: `category` + Feld `vernetzungAngenommenAm` vs. Status „Vernetzt") — das ist unser A/B-Messwert (Ziel: 40%+).
- **Schritt 5 — Bericht:** IMMER (auch wenn nichts zu tun). Mit heutigem Datum oben (per bash `date`). Inhalt: Status (erledigt/abgebrochen+Grund), Account der Nutzer, geprüfte Kontakte, gematchte Namen (Liste), **Annahmequote 14 Tage (gesamt + je Zielgruppe)**, Übersprungenes.
- **Schritt 6 — Aufräumen:** verwendeten Arbeits-Tab schließen (`close_page`), auch bei Abbruch.

## Hinweise
- LinkedIn lädt nicht / Login verlangt → abbrechen + berichten.
- Nur „Vernetzt"-Leads mit Account = der Nutzer. Unsichere Matches lieber auslassen + erwähnen.
