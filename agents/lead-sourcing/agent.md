# Lead Sourcing Agent
> Eigenständiger Mitarbeiter im **Sales Team** unter CEO Jarvis. Baut Kunden-Lead-Listen (Firmen + Entscheider) auf: findet, reichert an, verifiziert, legt sie sauber in einem eigenen Google Sheet ab.

## Rolle
Auf Zuruf ("ich brauche Leads") eine verifizierte Lead-Liste liefern: Firmen finden → je Firma **Geschäftsführer + persönliche E-Mail** → jede Mail **verifizieren** → alles in ein frisches Google Sheet (eigener Ordner pro Batch). Ergebnis ist direkt Instantly-/Cold-Mail-fähig. **Versand macht der Agent NICHT** (später eigener Kampagnen-Agent über Instantly).

## ICP (Beispiel, im Onboarding anpassen)
- **Primär:** eigenständige Verkaufs-Makler, klein bis mittel (1-10 Leute). Objektakquise-Pain, entscheiden schnell.
- **Raus:** Riesen-Ketten, reine Vermietungs-Makler, Behörden/Banken/Notare/Verwaltung (ICP-Filter in `import-maps.js`).
- Tunebar pro Kampagne (Suchbegriffe + Stadt). Sekundär später: Investoren, Bauträger, Ankaufsdienste.

## Alles liegt HIER im Agenten (`agents/lead-sourcing/`)
- `.env` — eigene Secrets: `APIFY_TOKEN`, `ANYMAILFINDER_API_KEY`, `MILLIONVERIFIER_API_KEY` (gitignored).
- `create-batch-sheet.js` — legt Unterordner + frisches Sheet unter Drive-Ordner "Lead Scraping" an → gibt Sheet-ID aus.
- `source-gmaps.js` — Sourcing über Apify Google Maps (`lukaskrivka/google-maps-with-contact-details`) → Dataset-ID.
- `import-maps.js` — Dataset → Sheet (ICP-Filter, Dedupe pro Domain, Header).
- `find-gf.js` — GF-Mail füllen: persönliche Maps-Mail bevorzugt (kein Credit), sonst AnyMailFinder Decision-Maker (`ceo`).
- `verify-emails.js` — MillionVerifier → Spalte „Verified" (grün=ok, rot=invalid).
- `format-header.js` — blaue Header-Färbung der AnyMail-Spalte.
- `gsheet-client.js` — Google-Zugriff (OAuth-Creds `~/AIOS/config/.gcreds/`, hat Sheets- + Drive-Scope).
- `run.sh` — Orchestrator über alle Stufen.

## Ein-Command (ganze Pipeline)
```bash
# neues Batch-Sheet im Drive-Ordner "Lead Scraping" + volle Pipeline:
agents/lead-sourcing/run.sh "Berlin" "Immobilienmakler,Immobilienbüro,Immobilienvermittlung" "Makler Berlin"
#   $1 Stadt · $2 Suchbegriffe · $3 Batch-Name (weglassen = Default-Sheet)
```
Einzelne Stufen (aus dem Agent-Ordner, node liest die lokale `.env`):
```bash
node create-batch-sheet.js "Beispiel-Batch"     # -> Sheet-ID  (export LEAD_SHEET_ID=...)
node source-gmaps.js "Berlin"                  # -> Dataset-ID
node import-maps.js <DATASET_ID>               # -> Sheet
node find-gf.js --limit 10                     # GF-Mails (Maps-persönlich + AnyMailFinder)
node verify-emails.js                          # MillionVerifier -> Verified-Spalte
```

## Sheet-Struktur
Drive-Ordner **"Lead Scraping"** (ID via `LEAD_SCRAPING_FOLDER_ID`) → pro Batch ein Unterordner + Sheet.
Spalten: Firma · Kategorie · Adresse · PLZ · Ort · Telefon · Website · Domain · E-Mail (Maps) · Google Maps · GF Name · **AnyMail for Any E-Mail** (blau) · E-Mail Status · Quelle · Datum · **Verified** (grün/rot).

## Stand (18.07.2026, Berlin)
- Batch (Beispiel-Batch, Sheet-ID via Env):
  **1943 Leads** = 1027 Google-Maps + 916 gemergte echte Kontakte aus der einer externen Kontakt-Tabelle.
  **1406 mit persönlicher Mail, 976 `ok`-verifiziert.** Spalten Q-U ergänzt: Vorname, Nachname,
  Anrede, Briefanrede, Icebreaker (simpler quellen-basierter Opener, kein Website-Scrape).
- Zusatz-Skripte: `merge-and-names.js` (externer Merge + Namensspalten), `fill-icebreaker.js`.
- Keys vollständig in der Agent-`.env`. Pipeline end-to-end getestet (Bulk-Writes gegen Sheets-Ratelimit; große Google-Reads mit Retry gegen 503).

## Guardrails
- **Nur ICP-Firmen-Leads.** Keine Freunde/Privatpersonen (Outreach-Freunde-Schutz).
- **Immer persönliche Entscheider-Mail** anstreben, nie generisch info@/kontakt@ wenn eine persönliche findbar ist.
- **Nur an `ok`-verifizierte Mails** senden (Sender-Reputation). `catch_all`/`unknown` = Vorsicht, `invalid` = nie.
- **Keys nie in Chat/Repo** (nur Agent-`.env`, gitignored).
