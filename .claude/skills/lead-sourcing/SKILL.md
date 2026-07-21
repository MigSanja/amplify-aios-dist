---
name: lead-sourcing
description: Verifizierte Kunden-Lead-Listen auf Zuruf. Scrapt Firmen (Apify Google Maps), findet je Firma den Geschäftsführer + persönliche E-Mail (AnyMailFinder), verifiziert jede Mail (MillionVerifier) und legt alles in ein frisches Google Sheet (eigener Ordner pro Batch unter "Lead Scraping"). Trigger: "ich brauche Leads", "Lead Sourcing", "scrape mir Makler in <Stadt>", "/lead-sourcing".
---

# Lead Sourcing Agent

Liefert auf Zuruf eine **verifizierte Lead-Liste** als Google Sheet. Der Agent lebt in
`~/AIOS/agents/lead-sourcing/` (eigene `.env` mit allen Keys). **Kein Mail-Versand** hier, nur die saubere Liste.

## Wenn der Nutzer "ich brauche Leads" sagt

1. **Kurz klären (eine Nachricht, mit sinnvollen Defaults):**
   - **Branche/ICP** (Default: Immobilienmakler) und **Stadt** (Default: Berlin).
   - Optional: wie viele / welche Suchbegriffe. Default-Begriffe für Makler:
     `Immobilienmakler,Immobilienbüro,Immobilienvermittlung,Immobilienagentur,Immobilienberatung`.
   - ICP-Erinnerung: kleine/mittlere eigenständige Firmen bevorzugt; Ketten/Behörden/reine
     Vermietung werden vom Import gefiltert.

2. **Pipeline mit einem Command starten** (legt automatisch einen eigenen Ordner + Sheet
   unter dem Drive-Ordner **"Lead Scraping"** an):
   ```bash
   ~/AIOS/agents/lead-sourcing/run.sh "<Stadt>" "<Suchbegriffe,komma>" "<Batch-Name>"
   # z.B.: run.sh "Berlin" "Immobilienmakler,Immobilienbüro" "Makler Berlin"
   ```
   Stufen: Batch-Sheet anlegen → Sourcing (Apify Google Maps) → Import (ICP-Filter, Domain-Dedupe)
   → GF-Enrichment (persönliche Maps-Mail bevorzugt, sonst AnyMailFinder `ceo`) → Verify (MillionVerifier).
   Der Scrape läuft einige Minuten; `run.sh` wartet und meldet die Zahlen.

3. **Zurückmelden:** den Sheet-Link + Zahlen (X Firmen, Y persönliche Mails, Z `ok`-verifiziert).

## Einzelne Stufen (falls nötig, aus dem Agent-Ordner)
```bash
cd ~/AIOS/agents/lead-sourcing
node create-batch-sheet.js "Beispiel-Batch"    # -> Sheet-ID; danach: export LEAD_SHEET_ID=<id>
node source-gmaps.js "Berlin" "Immobilienmakler,Immobilienbüro"   # -> Dataset-ID
node import-maps.js <DATASET_ID>              # Dataset -> Sheet
node find-gf.js                               # GF-Mails (Maps-persönlich + AnyMailFinder)
node verify-emails.js                         # -> Verified-Spalte
```
Alle Stufen respektieren `LEAD_SHEET_ID` (Batch-Sheet). Ohne die Variable = kein Sheet-Export.

## Guardrails
- Nur ICP-**Firmen** (keine Freunde/Privatpersonen).
- Immer die **persönliche Entscheider-Mail** anstreben, nie generisch info@/kontakt@ wenn eine
  persönliche findbar ist.
- Nur an **`ok`**-verifizierte Mails senden lassen (Sender-Reputation). `invalid` = nie.
- Keys nur in der Agent-`.env` (gitignored), nie in Chat/Repo.
- Versand ist NICHT Teil dieses Skills (kommt später über einen Instantly-Kampagnen-Agenten).

## Details
Rolle, Sheet-Spalten, Stand: `~/AIOS/agents/lead-sourcing/agent.md`.
