# Playbook 00 — Globales Lead-Sourcing (Alex' Sales Navigator, für BEIDE Accounts)

> **Zweck (Architektur 20.07.):** EIN Sourcing-Lauf früh morgens (geplant ~04:00) nutzt **Alex' Sales Navigator** (der einzige Sitz) und baut die Kandidatenlisten für **Alex UND Paul**. Danach arbeiten beide Outreach-Läufe (Alex ab 07:00, Paul ab 11:00) ihre Liste ab und vernetzen. So wird der eine SalesNav-Sitz nur hier benutzt, nie in zwei Outreach-Läufen parallel.
>
> **Dieser Lauf VERNETZT NICHT und schreibt KEINE Nachrichten.** Er liest nur Suchergebnisse und schreibt zwei Listen-Dateien. Kein Klick auf „Verbinden", kein Nachrichtenfeld. Reines Sammeln.

## Browser & Tools (chrome-devtools-mcp · Port 9222 = der Nutzer/SalesNav)
`mcp__browser__*` — fest an Alex' Account gebunden. Werkzeuge: `new_page` · `navigate_page` · `take_snapshot` · `evaluate_script` · `close_page`.

## Pflicht-Check ZUERST
1. **Alte Tabs aufräumen:** `list_pages` — offene LinkedIn-/SalesNav-Tabs sind Waisen → alle `close_page`, im Trail vermerken. Kein Abbruchgrund.
2. **Eigenen frischen Arbeits-Tab** (`new_page`).
3. Login prüfen. **Login-Seite / Checkpoint / Captcha / SMS / Logout → SOFORT STOPPEN + melden, NIE selbst einloggen.**

## Was gesammelt wird — zwei Größen-Buckets, drei Zielgruppen

**Pflicht-Filter in JEDER Suche (NIE anfassen):** „kürzlich auf LinkedIn gepostet" (`POSTED_ON_LINKEDIN`, id:RPOL) · Region DACH (id:91000006) · 2./3. Grad (1. Grad ausschließen) · Titel NUR Entscheider (Inhaber, Geschäftsführer, Gründer, CEO).
**NUR deutschsprachige Leads (Regel 20.07.):** Profil primär auf Deutsch. Primär französisch-/englisch-/italienischsprachige Profile NICHT aufnehmen (unsere Messages sind Deutsch). Schweiz = nur **Deutschschweiz** (Romandie/Tessin raus).
**CRM-Abgleich beim Sourcing (Pflicht):** vor dem Aufnehmen jeden Kandidaten gegen `node dashboard/known-contacts.js has` UND das CRM prüfen — **nur wirklich NEUE (noch nie kontaktierte) Leads** in die Kandidatenliste, nie schon Kontaktierte erneut.

Einziger Unterschied Alex vs. Paul = **Firmengröße**:
- **Alex-Liste:** Firmengröße **1-10** (`COMPANY_HEADCOUNT` id:B). Basis-URLs: `runs/.search-url-makler.txt` · `runs/.search-url-agentur.txt` · `runs/.search-url-dienstleister.txt`.
- **Paul-Liste:** identische Suchen, aber Firmengröße **11-50** (`COMPANY_HEADCOUNT` id:C, im UI „11-50 Mitarbeiter" setzen). Persistiere die besten 11-50-URLs nach `../outreach-paul/runs/.search-url-<gruppe>.txt`.

**Tagesmengen (Puffer +50%, weil beim Vernetzen manche am Identitäts-Check rausfallen):**
- Alex: Ziel 25 → sammle **~38** Kandidaten, Split Agentur/Dienstleister/Makler ≈ 15/15/8.
- Paul: Ziel 15 → sammle **~23** Kandidaten, gleicher Split ≈ 9/9/5.
(Zahlen aus `config.json` `limits.connectsPerDay` × 1,5; bei dünner Makler-Quelle Budget Richtung Agentur/Dienstleister verschieben, im Report vermerken.)

## Pro Suchergebnis — nur lesen, nicht vernetzen
- Ergebnisliste durchgehen. Pro Treffer aus der Liste **ohne das Profil zu öffnen** notieren: Name, SalesNav-Profil-URL, Firma, Standort, Rolle/Headline-Snippet, Zielgruppe (Makler/Agentur/Dienstleister), Bucket (Alex 1-10 / Paul 11-50).
- **DE-DUPE Pflicht** vor Aufnahme: `node dashboard/known-contacts.js has "<Name>" "<URL>"` → `yes` = überspringen (schon kontaktiert, kanal- und accountübergreifend). Auch „Gespeichert"/„Ausstehend"/„Vernetzt" im UI = überspringen.
- **BLOCKLIST + Freunde:** `runs/.blocklist.json` (Alex) bzw. `../outreach-paul/runs/.blocklist.json` (Paul) prüfen — Treffer nicht aufnehmen. Erkennbare Privat-/Freundeskontakte gar nicht erst aufnehmen.
- **Score + Eisbrecher NICHT hier** — die entstehen erst beim Vernetzen (Playbook 01), wenn das echte Profil offen ist und der aktuelle Post sichtbar. Hier zählt nur: passt grob zum ICP der Zielgruppe (sonst gar nicht aufnehmen).

## Schreiben — zwei Listen-Dateien (je EINE JSON-Zeile pro Kandidat)
- Alex → `agents/outreach-alex/runs/.candidates-<YYYY-MM-DD>.jsonl`
- Paul → `agents/outreach-paul/runs/.candidates-<YYYY-MM-DD>.jsonl`

Genau diese Felder (gültiges JSONL, EINE physische Zeile pro Kandidat):
```
{"name":"…","salesNavUrl":"https://www.linkedin.com/sales/lead/…","company":"…","location":"…","group":"Makler|Agentur|Dienstleister","bucket":"1-10|11-50","account":"der Nutzer|Paul","sourcedAt":"YYYY-MM-DD","snippet":"Rolle/Headline"}
```
> `salesNavUrl` ist nur Referenz + Dedupe. **Der Outreach-Lauf öffnet sie NIE direkt** — er sucht die Person per Namen auf normalem LinkedIn und verifiziert die Identität (Playbook 01, Modus A). So gewollt (menschliches Verhalten + Verwechslungsschutz).

## Abschluss
- **Arbeits-Tab schließen** (`close_page`) — IMMER, auch bei Abbruch. Kein offener SalesNav-Tab.
- Report `runs/<YYYY-MM-DD>-sourcing.md`: pro Zielgruppe/Bucket wie viele gesammelt, Suchvarianten, übersprungen (Dedupe/Blocklist), Alerts.
- EINE Telegram-Abschlussmeldung: „Sourcing fertig: Alex <n> Kandidaten, Paul <m>. Bereit fürs Vernetzen." Bei hartem Blocker sofort pingen.

## Safety
Reines Lesen — kein Vernetzen, keine Nachricht, kein Eingabefeld anfassen (Absende-Gate/Draft-Verbot aus agents/CLAUDE.md gilt trotzdem: falls du je in einem Compose-Feld landest, sofort raus). Menschliches Tempo zwischen Seiten (20–45s). Login/Checkpoint/Captcha → STOPP + melden.
