---
description: Video-Link (YouTube/Instagram/…) → wirklich schauen (watch-Skill) + Learning-Notiz in brain/08_Video-Learnings/.
argument-hint: <video-url>
---

# youtube-to-brain

der Nutzer dropt einen Video-Link: `$ARGUMENTS`

## Ablauf
1. **Wirklich schauen** mit dem `watch`-Skill (`~/.claude/skills/watch/scripts/watch.py <url>`): zieht Frames + Transkript. Lies die Frames (Bild) UND das Transkript (Ton) — nicht nur das Transkript. Bei sehr langem Video ggf. auf einen Abschnitt fokussieren (`--start/--end`) statt sparsam alles zu scannen.
2. Erzeuge eine Notiz aus `brain/_templates/video-learning.md` in **`brain/08_Video-Learnings/`** (NICHT `05_Knowledge` — das ist eigenes Wissen):
   - Dateiname: kebab-case aus dem Titel.
   - `type: video-learning`. Fülle `source`, `creator`, `platform`, `duration`.
   - **Worum geht's** (1–2 Sätze) + **3–6 Key-Takeaways** + **„Was nehme ich mit / wofür"** (konkret: Produkt / Marketing / Content / abschauen).
   - Tags: Plattform (`#youtube`/`#instagram`) + Art (`#bildidee`/`#contentidee`/`#fuer-produkt`/`#fuer-marketing`/`#abschauen`/`#inspiration`/`#cool`).
   - Mit `[[...]]` zu relevanten Ideen/Projekten/Areas verlinken (z. B. [[dein-projekt]], [[makler-os]], [[positionierung]]).
3. Trag die Notiz in `brain/08_Video-Learnings/_README.md` unter „Inhalt" ein.
4. Schreibe einen kurzen Eintrag ins heutige `brain/99_Daily/<YYYY-MM-DD>.md`.
5. Antworte **kurz**: Titel + 3 Takeaways + wohin verlinkt.

## Regeln
- Faktentreu bleiben — nichts erfinden, was nicht im Video ist.
- Erst **besprechen**, dann auf Ansage speichern (außer der Command wird bewusst aufgerufen).
- Kommunikationsstil aus `identity.md`: kurz, direkt.
