# Sales-Copilot-Regeln

Sales-Copilot (Call-Transkription, Follow-ups, Demo-Automation) folgt diesen Regeln:

## Transkripte & Handoff
- **Aufnahme-Setup:** BlackHole (System-Audio) + Mikro (Alex) → Stereo-WAV → Deepgram Transkription
- **Transkript speichern:** `sales-copilot/transcripts/<date>_<kunde>.json` (strukturiert: Speaker, Timestamps, Emotionality)
- **Handoff an Brain:** automatisch Action-Items als Tasks nach `brain/07_Tasks/tasks.md` (Regel: **aus jedem Transkript Tasks**)

## Call-Notes & Follow-up-Automation
- **Note Taker:** Agent schreibt Call-Notizen in die Projekt-Notiz (`brain/03_Projects/<kunde>.md`) — live während des Calls oder danach
- **Demo-Recording:** bessere Aufnahme-Qualität (Screen + Audio) als Transkription → als Link/Video in die Notiz

## Zeiterfassung & Deal-Tracking
- **Strikte Zeiten:** Call-Start/End → rechnet in die Monthly-Hours
- **Deal-Value:** pro Lead/Deal manuell oder auto-befüllt (Default 5k, überschreibbar)
- **Pipeline-Updates:** Call-Ergebnis → Lead-Status im CRM updaten (Geantwortet → Call vorgeschlagen / Kunde)

## Neue Features
- Neue Automation/Report? → Dokumentation in SYSTEM.md + Skill-Register bei Bedarf.
