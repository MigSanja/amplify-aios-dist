---
name: reel-captions
description: Rohvideo → fertiges Reel. Deepgram-Transkript, Auto-Schnitt (Ähs/Pausen/Versprecher raus), TikTok-Captions mit Wort-Highlight (iOS-Blau), Szenen-Overlays im Gennaro-Stil (PiP mit blauem Schimmer-Ring, Icon-Verbindung, Bullets, Count-Up+Bar-Chart, Hook, Checklist-/NO-Cards, Kommentar-Pill, Browser-Demo via Playwright) + Cover per Codex. Trigger: der Nutzer droppt ein Video und will ein Reel/Captions/Schnitt ("mach ein Reel draus", "Video bearbeiten", "Captions drauf").
---

# Reel-Captions — Video rein, fertiges Reel raus

Projekt liegt in `content-engine/reel-pipeline/` (Remotion, Node 22, Deps installiert).
Alle Befehle DORT ausführen. Kein Submagic/Zernio nötig; Zernio nur fürs spätere Publishing.

**FEEDBACK-LOOP (Pflicht):** Vor jeder Produktion `content-engine/reel-pipeline/STYLE.md`
lesen (lebendes Stil-Profil). Nach jedem Feedback von der Nutzer zum fertigen Video:
STYLE.md sofort nachziehen (Datum + Zitat + Regel). So wird der Stil mit jedem Video besser.

**CODEX-FIRST (Regel 15.07., Token sparen — Claude denkt, Codex arbeitet ab):**
Alles Mechanische an Codex delegieren, NICHT selbst tippen:
```bash
cd content-engine/reel-pipeline && codex exec -s workspace-write --skip-git-repo-check "<Auftrag>"
```
(`-s workspace-write` ist PFLICHT, sonst Read-only-Sandbox und Codex kann nichts schreiben.)
- **An Codex:** neue Remotion-Komponenten nach schriftlicher Spec bauen/ändern, Playwright-
  Record-Scripts schreiben, Bild-/Key-Art-Gen, Refactorings, Boilerplate.
- **Bei Claude bleibt:** Stil-/Taste-Entscheidungen, Referenz-Videos analysieren, STYLE.md,
  Transkript-Fix (nur Claude weiß aus dem Chat, was der Nutzer wirklich gesagt hat),
  Szenen-Dramaturgie, des Nutzers Feedback verarbeiten.
- Codex-Output IMMER kurz verifizieren (Typecheck + ein Still anschauen), bevor es zu der Nutzer geht.
- Die Pipeline-Scripts selbst (transcribe/cut/render) kosten ohnehin keine Tokens — direkt per Bash.

## Ablauf (pro Video)

0. **Aufnehmen (optional, ohne Handy):** Dashboard → Content-Pipeline → Button **„🎥 Video aufnehmen"**
   (oder direkt `http://localhost:4321/teleprompter`). MUSS über den Dashboard-Server laufen —
   `file://` geht zwar auch, aber der Server-Weg ist der dokumentierte (getUserMedia braucht
   sicheren Kontext). Kann: **Format 9:16 (Reel) ↔ 16:9 (YouTube)** umschalten, Kamera wählen
   (Sony ZV-1 / iPhone via Continuity Camera), Skript mit `*`-Betonungszeilen, Tempo/Schriftgröße,
   Space/↑↓/R/E. **Vorschau = exakt die Aufnahme** (Canvas-Crop). Datei landet in Downloads,
   der Nutzer droppt sie selbst in den Chat.

1. **Video übernehmen:** `cp <gedropptes-video> public/<slug>.mp4` (kurzer Slug, z. B. `reel3`).
2. **Transkribieren:** `node deepgram-to-captions.mjs public/<slug>.mp4 --language=de`
   → `public/<slug>.json` (Wort-Captions) + `<slug>-deepgram.json` (Rohdaten, Debug).
   Key: `DEEPGRAM_API_KEY` aus Jarvis-Root-`.env` (liest das Script selbst).
3. **LLM-Schritt (Pflicht!): Transkript prüfen.** Deepgram verhaut deutsche Aussprache
   englischer Marken ("Adoffic"→Anthropic, "Cloud"→Claude, "Hintern"→GitHub) und
   VERSCHLUCKT Wörter (liegen dann in Lücken!). Fehlende Wörter in
   `<slug>-deepgram.json` als Wort-Objekte einfügen (start/end schätzen), falsche
   `punctuated_word` korrigieren. Immer gegen das prüfen, was der Nutzer wirklich sagt.
4. **Schneiden:** `node cut-fillers.mjs public/<slug>.mp4 public/<slug>-deepgram.json [--cut=a-b ...]`
   → `<slug>-cut.mp4` + `<slug>-cut.json` (Captions auf neuer Zeitachse).
   Lücken >0.45s (= Ähs/Pausen) fliegen automatisch raus; Versprecher/Neustarts als
   explizite `--cut=SEK.START-SEK.ENDE` mitgeben. Korrekturen aus Schritt 3 landen
   automatisch in der Cut-Fassung (Script liest die Rohdaten).
5. **Overlays authoren:** `public/<slug>-cut.overlays.json` schreiben (Referenz unten).
   Keyword-Timings aus `<slug>-cut.json` ziehen (startMs der Wörter). Sparsam und
   hochwertig, kein TikTok-Geschrei. Zahlen nie erfinden, die als echte Behauptung
   rüberkommen (der Nutzer fragen oder neutral halten).
6. **Quelle setzen:** in `src/Root.tsx` `defaultProps.src` auf `staticFile("<slug>-cut.mp4")`.
7. **Rendern:** `npx remotion render CaptionedVideo out/<slug>-final.mp4`
   Vorher Stichprobe: `npx remotion still CaptionedVideo out/check.png --frame=<n>` und
   Frame per Read anschauen (Verify before returning!).
8. **Cover:** Key-Art via Codex generieren (falls noch keine passende in `public/cover-bg.png`):
   `codex exec --skip-git-repo-check "Generiere ein Bild ... 9:16 ... speichere als cover-bg.png"`
   (Codex legt es ggf. in `~/.codex/generated_images/...` ab → nach `public/cover-bg.png` kopieren).
   Titel in `src/Root.tsx` Cover-defaultProps setzen → `npx remotion still Cover out/cover.png`.
9. **Abliefern:** final.mp4 + cover.png nach `~/Downloads/` kopieren, `open` beide,
   kurz melden was geschnitten/eingeblendet wurde.

## Overlays-Referenz (`<slug>-cut.overlays.json`)

```jsonc
{
  "hooks": [ // Plattform-Icons an Rändern + fetter 2-Zeilen-Titel (Zeile 2 = Claude-Orange)
    { "startMs": 400, "durationMs": 4500, "title1": "Claude Code", "title2": "Content Autopilot",
      "icons": [ { "glyph": "♪", "color": "#69C9D0", "x": 13, "y": 11 } /* x/y in % */ ] }
  ],
  "explainers": [ // Video schrumpft in PiP mit blauem Schimmer-Ring, Szene dahinter
    { "startMs": 6600, "endMs": 12900, "eyebrow": "ZWEI TOOLS", "title": "...", "subtitle": "...",
      "scene": "iconConnect", // 2 Icons, Linie wächst, Puls wandert
      "icons": [ { "glyph": "✳", "label": "Claude Code", "from": "#D97757", "to": "#8F4630" }, { } ] },
    { "scene": "bullets", "bullets": [ { "ms": 18400, "text": "..." } ] },          // Check-Cards links
    { "scene": "stats", "stat": { "label": "...", "value": 950164, "bars": true } }, // Serif-Count-Up + Bar-Chart
    { "scene": "browser", "browserSrc": "<name>.webm", "urlLabel": "github.com/..." } // Playwright-Screencast im Browser-Rahmen
  ],
  "cards": [ // schwarze Balken stapeln sich mittig; negative:true = rotes NO
    { "startMs": 37000, "endMs": 44000, "items": [ { "ms": 37200, "text": "Uploading", "negative": true } ] }
  ],
  "badges": [ // Glas-Pill oben; style:"comment" = iOS-Kommentar-Pill (CTA)
    { "startMs": 49700, "durationMs": 2900, "text": "VIDEO", "style": "comment" }
  ]
}
```

Stil-Konstanten: Captions iOS-Blau `#007AFF`, Akzent Claude-Orange `#D97757`,
Ring/Blau-Töne `#0A84FF/#64D2FF/#5E5CE6`, Serif für edle Titel (Georgia), sonst SF.

## Browser-Screencasts (Playwright)

In `record/`: Scripts nach Muster `record-github.mjs` (chromium, 1440x900, deviceScaleFactor 2,
recordVideo, smoothScroll). Neues Ziel = neues Script. Ergebnis-webm nach `public/` kopieren
und als `browserSrc` referenzieren. Öffentliche Seiten brauchen kein Login; für eingeloggte
Tools einmalig persistentes Profil (der Nutzer loggt selbst ein).

## Faceless-Reels (ohne der Nutzer vor der Kamera, seit 15.07. abends)

Komposition `Faceless` in `src/Faceless.tsx` — Demo produziert (`out/faceless-demo.mp4`). Ablauf:
1. **VO:** Skript schreiben → ElevenLabs TTS (`ELEVENLABS_API_KEY` aus Root-`.env`,
   `POST api.elevenlabs.io/v1/text-to-speech/<voiceId>?output_format=mp3_44100_128`,
   `model_id: eleven_multilingual_v2`; Demo-Voice „Liam" TX3LPaxmHKxFdv7VOQHJ; später des Nutzers geklonte Stimme).
2. **Timing:** `node deepgram-to-captions.mjs public/vo.mp3 --language=de` → Wort-Timestamps.
3. **B-Roll-Bilder:** Codex-Bild-Gen (9:16, cinematisch, dunkelblau, KEIN Text im Bild) → `public/broll-*.png`.
4. **Szenen** in Faceless.tsx auf die Wort-Timings schneiden. Baukasten: KenImg (Punch-in + Ken-Burns),
   Stamp (Wort-Stempel), SerifLine (Wörter faden nacheinander), NoCards, GrowBars, CommentPill.
5. Rendern: `npx remotion render Faceless out/<name>.mp4` (durationInFrames an VO-Länge anpassen, Root.tsx).
**Musik-Layer (gelöst 17.07.):** Track per **ElevenLabs Music API** generieren —
`POST https://api.elevenlabs.io/v1/music` mit `{"prompt":"…kein Gesang, sitzt unter einer VO…","music_length_ms":<VO-Länge+500>}`
(gleicher `ELEVENLABS_API_KEY`) → `public/music.mp3`. Als zweites `<Audio>` unter die VO legen mit
`volume={(f)=>interpolate(f,[0,24,<ende-95>,<ende>],[0,0.16,0.16,0],{extrapolateLeft:"clamp",extrapolateRight:"clamp"})}`
(leise + Ein-/Ausblende, damit die Stimme klar bleibt).

## Bekannte Grenzen / Roadmap (Wochenende 19./20.07.)

- "Grafiken HINTER der Nutzer" (Ebenen-Sandwich) braucht Person-Matting → RobustVideoMatting,
  wartet auf Go (Download ~100 MB).
- Musik-Layer, Szenen-Übergänge, Stil-Presets je Kanal.
- Kanal-Regel: **Instagram = Reels (diese Pipeline), LinkedIn = Bild-Posts** (Cover-/Key-Art-Strecke).
- Anbindung an Content-Pipeline-UI im Dashboard (Karte → "Reel bauen"-Button) steht aus;
  bis dahin läuft alles über diesen Skill im Chat.
- Auto-Publishing via Zernio (Key-Feld im Dashboard geplant, Account = des Nutzers Part).
