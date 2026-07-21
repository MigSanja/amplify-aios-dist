---
name: kunden-onboarding
description: SOP für neue Kunden/Leads — Teil A (Brain-Bookkeeping) + Teil B (client-facing Onboarding nach dem Ja). Trigger: "neuer Kunde", "Kunde anlegen", "Deal gewonnen", "Onboarding", neuer Lead/Prospect aus Call oder Outreach.
---

# Kunden-Onboarding SOP

Zwei Teile:
- **Teil A — Brain-Bookkeeping:** wenn ein neuer Lead/Kunde reinkommt → nichts geht verloren, alles verlinkt (Schritt 1–4 unten).
- **Teil B — Client-Facing Onboarding:** wenn der Kunde JA sagt → sauberer, professioneller Übergabe-Ablauf (9 Schritte). Weiter unten.

Alle Pfade relativ zu `$HOME/AIOS/brain/`.

# Teil A — Brain-Bookkeeping (Lead/Kunde reinkommt)

## Schritt 1 — Person-Notiz anlegen

Bucket: **`02_People/`** (Regel: ein Eintrag enthält eine Person → hierher). Dateiname sprechend, klein, Bindestriche: `riccardo-fazzino.md`. Regel seit 01.07.26: **jeder neue Kunde/Kontakt/Gespräch** bekommt eine Person-Notiz (Alt-Kontakte NICHT rückwirkend anlegen).

```markdown
---
type: person
tags: [lead, kunde]
status: active
created: JJJJ-MM-TT
links: [[[<kunde-projektnotiz>]]]
---

# Vorname Nachname

- **Rolle/Firma:** <Titel> bei <Firma>
- **Kontakt:** <mail> · <telefon>
- **Kennengelernt:** <wo/wann — Call, Upwork, LinkedIn …>

## Besprochen
- <Datum> — <was besprochen, Kernaussagen>

## Follow-ups
- [ ] <offenes Follow-up + Fälligkeit>
```

Tags anpassen: `lead` (noch kein Deal) vs. `kunde` (gewonnen), ggf. `prospect`, `partner`.

## Schritt 2 — Projektnotiz anlegen

Datei: **`03_Projects/<kunde>.md`** (z.B. `beispiel-kunde.md`). Muster aus [[beispiel-kunde]] / [[beispiel-firma]]:

```markdown
---
type: project
tags: [projekt, kunde]
status: active
created: JJJJ-MM-TT
links: [[[<person>]], [[positionierung]]]
---

# <Kundenname>

> 📄 **Google-Doc:** <Link zum verlinkten Doc — immer OBEN>

- **Firma:** <Was macht sie, Sitz, Größe — 1-2 Zeilen>
- **Kontakt/Entscheider:** [[<person>]] (<Rolle>)
- **Status:** <wo steht der Deal/das Projekt, nächster Termin>
- **Abrechnung:** <Fixpreis / Stunden / Retainer + Betrag>

## Calls
- **<Call-Art>** <Datum> → [[<kunde>-<call-slug>]] (Kernpunkte)

## Kontext (Kurz)
- <Systeme/Tools des Kunden, Pain, des Nutzers Ansatz, Angebot>

## 📋 Offene To-Dos
> Kunden-To-Dos leben hier, nicht auf Alex' Signal-Liste. In `tasks.md` nur die Übergabe-Headline als Sammel-Pointer.

- [ ] 👤 <Task, die nur Alex kann>
- [ ] 🧑‍💻 <Task mit Claude Code bauen>

## Verknüpfungen
- [[<person>]] · [[<verwandte-projekte>]]
```

Pflicht-Elemente: **Google-Doc-Link oben**, **Sektion „📋 Offene To-Dos"**, Status-Zeile mit nächstem Termin. Tags bei Prospect: `[projekt, kunde, prospect, sales]`.

## Schritt 3 — Sammel-Pointer in tasks.md

In `07_Tasks/tasks.md` unter 🎯 Signal **genau EINEN Eintrag pro Kunde** — die aktuelle Haupt-Headline, nicht alle Einzeltasks (Signal-Liste schlank halten):

```markdown
- [ ] 🔴 👤 **[[<kunde>]]: <aktueller Haupt-Schritt>** — <1 Zeile Kontext> · **weitere To-Dos → [[<kunde>]] (📋 Offene To-Dos)**
```

Einzelne Kunden-Tasks kommen NICHT nach tasks.md, sondern in die Projektnotiz (Schritt 2). Ausnahme: echte Alex-Deadlines mit hartem Datum dürfen einzeln aufs Signal (Muster beispiel-kunde).

## Schritt 4 — Verlinken

- Person ↔ Projekt **bidirektional** (`links:` im Frontmatter + `[[...]]` im Text).
- Call-/Transkript-Notizen ans Projekt linken.
- Falls der Kunde für die Positionierung relevant ist (Zielgruppe/Vertikale): am Ende der Projektnotiz `> Relevant für [[positionierung]]: <warum>`.
- Team-Mitglieder des Kunden (z.B. Ops-Kontakt) ebenfalls als Person-Notiz + verlinken.

## Task-Regeln

**Ownership-Emoji bei JEDEM Task vergeben:**
- 👤 = der Nutzer selbst (nur echtes Signal: Entscheiden/Antworten/Reviewen — nie Restkram)
- 👥 = Mitarbeiter
- 🧑‍💻 = mit Claude Code ausarbeiten/bauen (Standardmodus)
- 🤖 = Subagent läuft selbst los (nur wenn Subagent existiert; zu bauende Automationen = 🧑‍💻 mit Notiz „später als Subagent")

**Meetings/Transkripte → IMMER Action-Items als Tasks:**
- Gemini-Transkripte: zuerst Sektion „Nächste Schritte" auswerten, dann Text nach Zusagen scannen.
- des Nutzers eigene Items → Projektnotiz „📋 Offene To-Dos" (nur die Headline auf Signal, s. Schritt 3).
- To-Dos anderer (Kundenteam) → am Projekt/Person als „Offen (Name)".

## Was NICHT ins Vault gehört (goldene Regel)

Obsidian speichert **Wissen** (wer/was/warum). Die DB speichert **Zahlen** (wie viele).
- ❌ Live-KPIs, Zähler, Outreach-Stats, Umsätze → DB/Dashboard
- ❌ Secrets/API-Keys → `config/` + `.env`
- ❌ Große Dateien/Videos → normaler Dateispeicher

Einzelbeträge als **Kontext** (Deal-Wert, Angebotshöhe) sind ok — laufende Umsatz-Tracking-Zahlen nicht.

# Teil B — Client-Facing Onboarding (nach dem „Ja")

Das ist der professionelle Übergabe-Ablauf, den der KUNDE spürt, sobald er zusagt. Ziel: souverän, klar, kein Chaos. AIOS-gemünzt. **Kein Vertrag, kein „annehmen"-Button** — ein **Angebot** mit allen Punkten + Preis, und der **Stripe-Zahlungslink IST die Annahme** (Alex' Präferenz). Reihenfolge = Reihenfolge.

> **Kern-Ablauf (Standard):** Closing-Call → **Angebot** (alle Leistungspunkte + Preis) → **Stripe-Zahlungslink** → Zahlung = Annahme → **Auto-Rechnung** (Rechnungstool) + **sofort Welcome** feuert. Bei komplexen Projekten davor ein 2. Call zum Scopen (Punkte final festzurren), dann Angebot raus. Ziel: im Call den Sack zumachen, solange die Energie da ist — nichts vertagen (verpufft sonst).

> **Status:** Diese Assets fehlen noch alle und sind zu bauen (👤/🧑‍💻). Bis dahin ist der Ablauf das Soll, die Vorlagen der Backlog.

### 1. Angebot (statt Vertrag)
Ein sauberes Angebot mit **allen Leistungspunkten explizit gelistet** (was genau drin ist), Preis, Zahlungsmodus, Timeline. Deckt Alex' Verhandlungs-Realität ab: im Closing-Call durchgehen was er braucht („nehmen wir mit rein" / Preis anpassen), dann direkt rausschicken — kein separater Vertrag nötig. → Asset: **`Angebot-Template`** (Punkte-Liste + Preis, führt direkt zum Zahlungslink).

### 2. Stripe-Zahlungslink = Annahme
Statt „Angebot annehmen"-Klick: der **Zahlungslink** ist die verbindliche Zusage. Zahlt er → Sack zu. Kein Überweisen, kein Warten. Zahlung triggert automatisch Schritt 3 (Rechnung) + Schritt 4 (Welcome).

### 3. Auto-Rechnung
Nach Stripe-Zahlung geht die Rechnung **automatisch** raus übers bestehende Rechnungstool (`dashboard/rechnung.js` / `rechnungstool.html`) + Wise-/Stripe-Zahlungserkennung. Kein manueller Schritt.

### 4. Welcome (Sofort-Trigger 🔴)
**Muss unmittelbar nach dem Signen/Zahlen automatisch feuern** — das „jetzt geht's los"-Signal, das der Kunde direkt spürt. Der EINZIGE Schritt, der zwingend automatisiert sein muss (Rest darf manuell bleiben). Inhalt: was ihn erwartet, wer wofür ansprechbar ist, Kommunikationswege (Telegram/Mail/Call), Timelines, welche Zugänge wir brauchen. → Asset: `Welcome-Doc-Vorlage` + Auto-Versand an Stripe-Zahlung gekoppelt.

### 4b. Referenz-Freigabe von Anfang an (NEU 11.07., Learning von aibymike.de)
**Nicht erst am Ende fragen.** Schon im Welcome-Doc ein weicher Satz: „Wenn du am Ende zufrieden bist, würde ich das Projekt gern (anonymisiert oder mit Namen, wie du willst) als Referenz zeigen und freue mich über eine kurze Bewertung." So ist die Erwartung von Tag 1 gesetzt, die eigentliche Freigabe + Testimonial wird dann in Schritt 9 nur noch abgeholt statt kalt erfragt. Kein Vertrag, eine Zeile im Welcome-Doc reicht.
> **Offene Entscheidung (Alex, 11.07.):** Auftragsverarbeitungsvertrag (AVV) ins Onboarding? Wirkt professionell und ist DSGVO-sauber, widerspricht aber Alex' Vertrauensbasis-Ansatz („ich hasse Verträge"). Noch NICHT einbauen, erst entscheiden.

### 4c. Access Request (E-Mail)
Eine strukturierte Mail: Logo/Branding-Files, Tool-Zugänge (CRM, Mail, Ads, Kalender …), bestehende Listen/Daten, alte Beispiele/Assets, wichtige Termine/Deadlines. → Asset: `Access-Request-Mailvorlage`.

### 5. Kickoff-Call
Über cal.com-Link buchen lassen (Meet/Zoom). Erwartungen final abgleichen, Fahrplan bestätigen.

### 6. Client Portal / AIOS-Zugang
Statt Notion-Portal → **AIOS als Portal**: Sichtbarkeit auf Arbeit, Timelines, Deliverables. Unser struktureller Vorsprung. → Asset: Kunden-View im AIOS.

### 7. Fulfillment
Files strukturiert liefern: Google Drive `Kunden/<Kunde>/` + im Portal gespiegelt. Klare Ordnerstruktur ab Tag 1.

### 8. Monatliche Reports
KPI-Dashboard im AIOS, exportiert + gemailt. Zeigt Wirkung, hält den Wert sichtbar. → Asset: Report-Export.

### 9. Feedback / Testimonial
Kurzes Feedback-Formular (Typeform o.ä.), Testimonial holen solange die Begeisterung frisch ist. → Asset: `Feedback-Formular`.

### 📋 Backlog (zu bauende Onboarding-Assets)
- [x] 🧑‍💻 **Angebot-Template** (Leistungspunkte-Liste + Preis, führt zum Stripe-Link) → `assets/angebot-template.md` ✅
- [ ] 🧑‍💻 Stripe-Zahlungslink-Flow (Link = Annahme, triggert Rechnung + Welcome)
- [ ] 🧑‍💻 Welcome-Doc-Vorlage + Auto-Versand an Stripe-Zahlung gekoppelt (Sofort-Trigger)
- [ ] 🧑‍💻 Access-Request-Mailvorlage (Checkliste Zugänge)
- [ ] 🧑‍💻 Kunden-View / Portal im AIOS
- [ ] 🧑‍💻 Monats-Report-Export aus dem AIOS
- [ ] 🧑‍💻 Feedback-Formular

# Teil A — Abschluss-Checkliste (Brain-Bookkeeping)

- [ ] Person-Notiz in `02_People/` mit Follow-ups
- [ ] Projektnotiz `03_Projects/<kunde>.md` mit Frontmatter + „📋 Offene To-Dos"
- [ ] Google-Doc erstellt/verlinkt — Link OBEN in der Projektnotiz
- [ ] Sammel-Pointer in `tasks.md` gesetzt (EIN Eintrag, mit Verweis auf die To-Dos)
- [ ] Person ↔ Projekt bidirektional verlinkt, Calls verlinkt
- [ ] [[positionierung]] verlinkt, falls relevant
- [ ] Alle Tasks mit 👤/👥/🧑‍💻/🤖 getaggt
- [ ] Aus vorhandenen Transkripten Action-Items gezogen
- [ ] Keine Live-KPIs/Secrets im Vault
