# AIOS Setup: was ist fertig, was ist offen

Diese Datei ist deine Einrichtungs-Checkliste. Claude Code pflegt sie beim Onboarding (`/aios-setup`):
was eingerichtet ist wird abgehakt, offene Punkte bleiben stehen. Du kannst jederzeit mit dem WhatsApp-Modul
starten und den Rest später nachziehen.

Status pro Punkt: `[ ]` offen, `[~]` angefangen, `[x]` fertig.

## Kern (nach der Installation da)
- [ ] Dashboard laeuft auf http://localhost:4321
- [ ] Branding gesetzt (Name / Farbe / Logo in `config/brand.json`)
- [ ] Brain eingebunden (dein Obsidian oder leeres PARA-Geruest)
- [ ] Jarvis Copilot getestet (kurz mit ihm reden)
- [ ] Telegram-Bot verbunden (mobiles Interface + Signale)

## Hauptmodul
- [ ] WhatsApp-Outreach: eigenes WhatsApp Business (Meta Cloud API) verbunden
- [ ] WhatsApp: erste Kampagne / Alt-Kontakte-Reaktivierung eingerichtet

## Weitere Module (jederzeit nachruestbar)
- [ ] Content-Pipeline: aktiviert (Videos/Instagram-Links droppen)
- [ ] Competitor Watch: Beobachtungs-Links hinterlegt
- [ ] Nachtwerker + Heartbeat: launchd-Jobs geladen
- [ ] Lead-Sourcing: Google Drive verbunden + Keys (Apify/AnyMailFinder/MillionVerifier)
- [ ] Note Taker / Sales Copilot: Deepgram + BlackHole eingerichtet
- [ ] Rechnungstool: Firma/Logo/Bankdaten hinterlegt
- [ ] Finanzen: Konten verbunden (Open Banking)
- [ ] Mail-/Kalender-Watcher: Google verbunden (Action-Needed-Signale)
- [ ] LinkedIn-Outreach: Account + Sales Navigator verbunden

## Schluessel (in `.env`, alle optional)
- [ ] Telegram (Bot-Token + Chat-ID)
- [ ] WhatsApp (Meta Cloud API)
- [ ] Apify (Content + Lead-Sourcing)
- [ ] Deepgram (Note Taker + Captions)
- [ ] ElevenLabs (Voice-Over)
- [ ] Google (Gmail/Kalender/Drive)
