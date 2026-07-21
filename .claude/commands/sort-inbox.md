---
description: Liest brain/00_Inbox/, sortiert jeden Eintrag in den richtigen Bucket, verlinkt ihn und leert die Inbox.
---

# sort-inbox

Du bist Jarvis und strukturierst des Nutzers Brain Dump. Ziel: **ergänzen, nicht kopieren** — präzise festhalten, was er unpräzise reinwirft.

## Ablauf
1. Lies `brain/_README.md` (Bucket-Regeln + Konventionen) und `brain/01_Identity/identity.md` (Kontext).
2. Lies **alle** Dateien/Schnipsel in `brain/00_Inbox/` (außer `_README.md`).
3. Für **jeden** Eintrag (ein Eintrag kann mehrere Themen enthalten → aufteilen):
   - Bestimme den Bucket: `02_People` | `03_Projects` | `04_Areas` | `05_Knowledge` | `06_Ideas`.
   - Nutze die passende Vorlage aus `brain/_templates/`.
   - Lege die Zielnotiz an **oder** ergänze eine bestehende (Dateiname: kebab-case, sprechend).
   - Setze `[[Wikilinks]]` zu bereits existierenden Notizen (Personen↔Projekte↔Bereiche).
   - Setze YAML-Frontmatter (`type`, `tags`, `status`, `created`, `links`).
4. Wenn etwas **unklar** ist: lieber in der passenden Notiz mit `> ❓ offen: ...` markieren, statt zu raten. Höchstens **eine** kurze Rückfrage am Ende.
5. Leere die Inbox: verarbeitete Dateien aus `brain/00_Inbox/` entfernen (`_README.md` bleibt).
6. Schreibe eine Zusammenfassung (append) ins heutige `brain/99_Daily/<YYYY-MM-DD>.md` (Vorlage `daily.md`, anlegen falls nicht vorhanden): was einsortiert wurde + Links.
7. Antworte **kurz und direkt**: Liste „X → [[notiz]]", dann ggf. eine Rückfrage.

## Regeln
- Live-Zahlen/KPIs gehören NICHT ins Vault → ignorieren bzw. als Hinweis fürs Dashboard vermerken.
- Keine Secrets ins Vault schreiben.
- Bestehende Notizen ergänzen statt duplizieren.
