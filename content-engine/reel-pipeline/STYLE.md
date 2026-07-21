# Video-Stil — Arbeitsstand (NICHTS hier ist final)

> **Grundregel (Alex, 15.07.):** Wir **testen** noch. Claude entscheidet NICHTS auf eigene Faust
> und markiert nichts als „so machen wir das jetzt". Erst wenn der Nutzer zu einem Element sagt
> „das ist gut", wandert es von 🧪/💡 auf ✅ — und erst ✅-Elemente gehören in die Skills.
>
> **Status-Legende:**
> - ✅ **von der Nutzer bestätigt** (wörtlich, mit Datum)
> - 🧪 **im Test** (gebaut + gezeigt, Urteil steht aus)
> - 💡 **Claudes Vorschlag** (ungeprüft, jederzeit verwerfbar)

## Es gibt MEHRERE Formate, nicht einen Stil (Alex, 15.07.)
Geplant sind verschiedene Content-Formate mit **je eigenem Skill** — nicht alles wird voll-editiert:
- 🧪 **Voll-editiert** (Talking-Head + Szenen-Baukasten) — Stand: Reel 2 + Reel 3 produziert
- 💡 **Minimal** (Selbstaufnahme, nur Captions + wenige Elemente, bewusst kein Hyper-Editing)
- 💡 **Screen-Recording** (Bildschirm zeigen + Captions)
- 🧪 **Faceless** (AI-B-Roll + VO, ohne Alex vor der Kamera) — Demo gebaut, Alex: „geil geworden"
Welches Format wann gewinnt, entscheidet sich beim Testen. Kein Format ist gesetzt.

## ✅ Bestätigt von der Nutzer
- **iOS-Systemblau `#007AFF`** als Caption-Highlight statt Grün (15.07., „meine blaue Schriftfarbe von iOS")
- **Captions kleiner, kein TikTok-Geschrei** (15.07., „nicht so übertrieben wie so ein TikTok-Video")
- **Keine billigen Emoji-Pop-ins** (15.07., „das sind billige Emojis, find ich nicht geil")
- **PiP-Ring: schimmerndes Blau, nicht bunt** (15.07.)
- **Hochwertig, YouTube- UND Instagram-tauglich** (15.07.)
- **Qualität statt Quantität** (15.07.) — lieber wenig richtig Geiles, dafür kontinuierlich
- **Kanal-Trennung:** Instagram = Reels · LinkedIn = Bild-Posts (15.07.)
- **Jedes Video braucht ein Thumbnail/Cover** (15.07.); große Zahl gehört ins Thumbnail, nicht in den ersten Satz
- **Immer des Nutzers eigener Winkel**, nie 1:1 nachgemacht (15.07.)
- **Feedback-Loop:** Alex gibt am Ende jedes Videos Feedback → hier nachziehen

## 🧪 Im Test (gebaut, Urteil steht aus)
- **HeadroomCard** (Karte über dem Kopf, Fortschritts-Segmente, Alex bleibt groß) — Mechanik von eine Referenz-Vorlage, erstmals in Reel 3
- **FakeTerminal** (animiertes Claude-Code-CLI, kein Recording) — Mechanik von Austin, erstmals in Reel 3
- **Icon-Verbindung, Count-Up + Bar-Chart, Hook-Overlay, Checklist-/NO-Cards, Kommentar-Pill, Browser-Demo (Playwright)** — in Reel 2/3 gezeigt
- **Serif (Georgia) für edle Titel** — Claudes Wahl, nie bestätigt
- **Claude-Orange `#D97757` als Akzent** — aus dem Gennaro-Nachbau übernommen, nie bestätigt
- **Dunkler Grade / Nacht-Look** — Alex zu Reel 3: „ich finde die Atmosphäre sogar geil" (= offen, nicht bestätigt)
- **Faceless: Tempo 1.1 + des Nutzers Voice-Clone** — seit 17.07. **„Alex Top Stimme" `<ELEVENLABS_VOICE_ID>`** (echter Professional Voice Clone; alter Instant-Clone `<ELEVENLABS_VOICE_ID>` abgelöst, klang nur ähnlich). Urteil zur neuen Stimme steht aus.
- **`Autopilot`-Format** (16.07.) — voll-animiertes Motion-Graphics-Reel (kein Talking-Head): Chapter-Chips,
  Serif-Headlines (weiß + gold-kursiv m. Unterstrich), Proof-Pill m. Count-Up, Reel-Card-Fächer, animierte
  Pipelines (Wort-Sync), Claude-Code-Chat-Karte, Kommentar-Boxen, Toast. **Recolor auf unser Branding**
  (Cyan `#36e0ff` / Navy `#03070e` / Teal `#3fd0c9`, Gold nur als Emphasis). Nachbau eines EN-Reels als
  Härtetest, Deutsch, Alex' Voice. Komposition `Autopilot` in `src/Autopilot.tsx`. **Urteil steht aus.**
- **Musik-Bett** (17.07.) — via **ElevenLabs Music API** (`POST /v1/music`) generiert, kein Suno/Fremdtrack nötig.
  **des Nutzers Wahl aus 3 Kandidaten: Variante A = treibender Tech-Puls** (`public/music-a.mp3`), `volume 0.25`,
  nur 6 Frames Einblende. **Urteil zum fertigen Mix steht aus.**
  **Regel-Learning (Alex 17.07., wichtig für JEDES Reel):** Musik muss **ab Sekunde 0 auf vollem Pegel** sein.
  Kein Intro, kein Build, keine lange Einblende („dauert so lange bis sich die Musik aufbaut, dass du nichts hörst").
  Erster Versuch scheiterte nicht am Track, sondern am **Mix**: leiser Ambient-Track (-16 dB) × `volume 0.16` ≈ -32 dB = unhörbar.
  Prüfen per `ffmpeg -af volumedetect` (erste 2s vs. gesamt; Differenz nahe 0 = startet sofort auf Pegel).
  **Und: Musik vor dem Reinschneiden von der Nutzer abnehmen lassen** (mehrere Kandidaten zum Anhören, er wählt).

## 💡 Vorschläge (ungeprüft)
- Sofort-Einstieg ohne Intro-Gelaber (aus dem Kommentar unter Austins Video: „I subscribed at second 15
  because you got right into it"). **Alex' Einschränkung:** nicht wörtlich „Projekt Nummer eins" reingehen.
- Licht vor die Person statt hinter sie (technisch: dunkel = Rauschen beim Hochziehen — Alex mag den dunklen Look aber)
- Kopffreiheit beim Dreh lassen (Platz für die HeadroomCard)
- iPhone via Continuity Camera statt MacBook-Cam (Auflösung/Low-Light)
- ~~Musik-Layer~~ → **gebaut 17.07.** (jetzt 🧪, siehe oben)

## Referenzen (Mechanik lernen, nicht kopieren)
- `brain/08_Video-Learnings/gennaro-content-autopilot-reel-stil.md`
- `brain/08_Video-Learnings/card-editing-referenz.md`
- `brain/08_Video-Learnings/austin-marchese-editing-mechanik.md`
- `brain/08_Video-Learnings/riley-brown-codex-remotion-launch-video.md`

## Feedback-Log (des Nutzers Urteile, chronologisch)
- 15.07. Reel 1 (V1): Ähs müssen raus, Emojis billig, Captions zu groß/grün → V2/V3
- 15.07. Reel 1 (V3): Look bestätigt (iOS-Blau, blauer Ring, dezenter)
- 15.07. Faceless-Demo: „schon mal geil geworden" ✅
- 15.07. Teleprompter: „funktioniert geil und sehr gut" ✅ (Aufnahme-Format-Bug war separat)
- 15.07. Reel 3 (HeadroomCard + FakeTerminal): **Urteil steht aus**
