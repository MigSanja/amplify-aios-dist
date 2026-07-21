# Agent-Regeln (Outreach, Scripts, Automation)

Agenten (Outreach-Alex, Outreach-Paul, Nacht-Werker, Heartbeat) folgen diesen Regeln:

## Freunde-Schutz (kritisch)
- **Nie** an Kontakte in Alex' persönlichem Netzwerk schreiben (Familie, enge Freunde, bekannte Personen)
- **Blocklist:** `brain/02_People/freunde-blocklist.md` — vor jeder Kampagne abgleichen
- **Intake-Bremse:** neue Leads gegen die Blocklist filtern, Duplikate (kanalübergreifend) abfangen

## Kanalübergreifende De-Duplication
- **Problem:** selbe Person über LinkedIn + Email + Referral anschreiben = Ärger
- **Lösung:** Leads per **Vor-/Nachname matchen** (LinkedIn-URL ≠ Punkt, nur Name zählt)
- **InMail + M1 (LinkedIn-Message):** als ein Erstkontakt zählen, nicht doppelt abschreiben
- **Known Contacts:** nur über Helper-Funktion checken, nicht blind scrappen

## Follow-up-Frequenz & Reply-Monitoring
- **Max. 3 Follow-ups** pro Lead: FU1 Text + FU2 `waitingmeme.png` + FU3 `kermetmeme.jpg` (Änderung 20.07., vorher max. 2). Nicht mehr — Backlash bei zu aggressiv.
- **Reply-Monitoring nötig:** Antworten dürfen nicht liegen bleiben (→ Auto-Ping an der Nutzer)
- **Keine weiteren Messages nach Ablehnung** — Lead kommt auf Pause/später

## Schreibstil (Out-of-Channel-Messages)
- **Keine Em-Dashes / Gedankenstriche** (— oder –)
- **Fließtext, keine Bullet-Wüsten**
- **Klingt nach der Nutzer:** locker, konkret, weicher CTA
- **Jeder Kanal eigene Tonalität:** Upwork = formeller, WhatsApp = locker

## Browser-Disziplin (hart — Vorfall 10.07.)
- **NIE `pkill`/`killall` auf „Google Chrome"** — das killt AUCH des Nutzers eigenes Chrome samt seiner Fenster (ist am 10.07. mehrfach passiert, der Nutzer flog laufend aus seinem Browser). Automations-Chrome neu starten NUR über `bash dashboard/launch-chrome.sh <port> <profil>` — nie mit eigenen Flags experimentieren.
- **Crasht das Automations-Chrome 2× hintereinander:** Lauf sauber abbrechen, Zwischenstand in Report/Trail festhalten, Telegram-Ping — NICHT weiter an Prozessen/Flags herumdoktern.
- **Nachrichten NIE über `linkedin.com/messaging/thread/new/` + Namenssuche** — Verwechslungsgefahr und zweiter Thread mit derselben Person. Chats IMMER über das `/in/…`-Profil öffnen (dort „Nachricht").
- **CHAT = WAHRHEIT:** Vor JEDEM Senden den Verlauf lesen; gesendet wird nur, was laut Chat als Nächstes dran ist. CRM/Sheet sind Wegweiser, nicht Wahrheit.

## Absende-Gate (hart — Vorfall 19.07., Fall dieser Kontakt)
**Vor JEDEM Klick auf „Senden" (LinkedIn, InMail, WhatsApp, überall) sind 5 Checks Pflicht. Einer schlägt fehl → NICHT senden, Feld leeren, im Trail begründen:**
1. **Empfänger:** Name im Chat-Header = der Lead, dem ich JETZT laut Playbook schreiben soll?
2. **Inhalt:** Der Text im Eingabefeld ist EXAKT die Nachricht, die ich in dieser Minute für diesen Lead formuliert habe? (Fremder/alter Text im Feld = Alarm: Feld leeren, nie „einfach mitsenden".)
3. **Verlauf:** Chat gelesen — diese Nachricht ist der logische nächste Schritt (kein Duplikat, kein Follow-up der schon da war, richtige Stufe M1/FU)?
4. **Zeitpunkt:** Senden JETZT erlaubt? (Mo–Fr; Sa/So gehen NIE Nachrichten raus, nur Vernetzungen. Tageslimits nicht überschritten, kein `.paused`-Flag.)
5. **Auftrag:** Das Playbook des AKTUELLEN Laufs sieht ein Senden überhaupt vor? (Vernetzungs-Lauf = 0 Nachrichten, egal was im Feld steht.)

**Draft-Verbot (Ursache 19.07.):** In ein LinkedIn-/Chat-Eingabefeld wird NUR getippt, was in derselben Minute gewollt gesendet wird. Icebreaker/Nachrichten-Entwürfe werden AUSSCHLIESSLICH in Dateien (CRM-JSONL, Notizen) formuliert, NIE im Compose-Feld „zwischengeparkt" — LinkedIn speichert getippten Text als scharfen Entwurf im Chat, der später versehentlich rausgehen kann (genau so ging am 19.07. ein nackter Eisbrecher an ein Kontakt raus).
**Draft-Sweep (Pflicht am Lauf-Ende + bei Abbruch):** Vor dem Schließen prüfen: kein offenes Chat-Fenster, kein Eingabefeld mit Text (getippten Rest markieren + löschen, per Snapshot verifizieren), Arbeits-Tab zu. Erst dann Feierabend melden.

## Über-Device-Läufe
- **Browser-Agenten (LinkedIn, Upwork, etc.) laufen NIE parallel zu der Nutzer**
  - → Gefahr von Session/Cookie-Konflikt, kann Account-Risiko bedeuten
  - → Vor Agenten-Start: der Nutzer wird gefragt / Lauf in separaten Browser-Tab
- **Bot-Profile (Telegram, Email) → parallel ok**

## WhatsApp-Setter (agents/whatsapp-setter/)
- Bot-Kanal (Meta Cloud API) → darf parallel zu der Nutzer laufen (kein Browser).
- Antwortet NUR Threads mit `mode:"ai"` + Kampagnen-Zuordnung; manuelle Chats nie anfassen. `.paused`-Flag stoppt AI-Antworten sofort.
- Vor JEDEM Send greift das Guardrail-Gate in `dashboard/wa.js` (Opt-out → Freunde-Blocklist → Quiet Hours 9–19 → Daily Cap). STOP/„abmelden" = permanenter Opt-out, nie wieder anschreiben.
- Kampagnen-Persona liegt in `playbooks/<kampagne>.md` — neue Kampagne = neues Playbook, agent.md (harte Regeln) bleibt unangetastet.

## Neue Agents (Setup-Checkliste)
- Agent-File: `agents/<name>/config.json` + `agents/<name>/<name>.md`
- Läuft in `agents/` → liest diesen CLAUDE.md + die Root-CLAUDE.md
- Dokumentation: ins Produkt-Register `brain/03_Projects/aios-produkt.md` + Roadmap `brain/03_Projects/aios-work-map.md`

## Vor jeder Änderung an SYSTEM.md nachziehen
- Neue Agent-Datei? SYSTEM.md.
- Neue Automation/Job (z.B. täglicher Scan)? SYSTEM.md.
