# Sales Copilot 🎯

Ein transparentes Echtzeit-Coaching-Overlay für Mac. Es liegt **über** deinem
Zoom-/Google-Meet-Call, zeigt dein **Verkaufsskript**, hört den **Kunden mit**
und gibt dir per **Claude** in Echtzeit kurze **Tipps**, was du sagen kannst.

- Für den Kunden unsichtbar (wird nicht im Screen-Sharing angezeigt)
- Festes Modell: `claude-opus-4-8`
- Live-Transkription über Deepgram

---

## 1. Installation (einmalig)

Im Terminal:

```bash
cd "$HOME/AIOS/sales-copilot"
npm install
```

## 2. API-Keys eintragen

```bash
cp .env.example .env
```

Dann `.env` öffnen und eintragen:

- `DEEPGRAM_API_KEY` → von https://console.deepgram.com (kostenloses Startguthaben)
- Kein Anthropic-API-Key nötig: Die **Sales-Auswertung** nach dem Call läuft über die Claude-Subscription (claude-CLI via `dashboard/claude-bin.sh`), die **Live-Tipps** über die Codex-CLI (ChatGPT-Subscription, `dashboard/codex-bin.sh` — einmalig `codex login`).

> Ohne Deepgram-Key läuft das **Skript-Overlay** trotzdem — nur das Mithören ist aus.

## 3. Deine Skripte hinterlegen

Skripte liegen im Ordner **`scripts/`** — jede `.txt`-Datei wird ein Eintrag im
Dropdown oben im Overlay. Aktuell vorhanden:

- `scripts/Setting.txt` (dein Setting-Skript)
- `scripts/Closing.txt` (Vorlage — Closing-Skript hier einfügen)

Du kannst beliebig viele anlegen; der Dateiname (ohne `.txt`) ist der Name im
Dropdown. Während des Calls wechselst du oben einfach zwischen Setting und Closing.

## 4. Starten

```bash
npm start
```

---

## 🎧 Den Kunden-Ton mithören (wichtig!)

Damit Claude hört, was der **Kunde** sagt, braucht der Mac ein virtuelles
Audiogerät, das den Zoom/Meet-Ton "abgreift":

1. **BlackHole installieren** (kostenlos):
   ```bash
   brew install blackhole-2ch
   ```
2. In den Mac-Systemeinstellungen unter **Ton** ein **"Multi-Output-Gerät"**
   (über die App *Audio-MIDI-Setup*) anlegen, das den Ton gleichzeitig an deine
   **Lautsprecher/Kopfhörer** UND an **BlackHole** schickt.
3. In Zoom/Meet als Lautsprecher dieses Multi-Output-Gerät wählen.
4. Im Sales Copilot unten als Eingang **BlackHole** auswählen → "▶︎ Mithören".

So hörst du den Kunden normal und die App bekommt denselben Ton zum Transkribieren.

---

## 📝 Note-Taker-Modus

Im Modus-Dropdown oben (neben Setting/Closing) gibt es **„📝 Note Taker"** — für
Kunden-/Projektcalls, die keine Sales-Calls sind:

- **Keine Skripte, keine Live-Tipps, kein API-Call während des Calls** — die App
  hört nur zu und transkribiert beide Spuren (Ich + Gegenüber).
- Workflow: App an → Modus „Note Taker" → **„Mithören"** klicken → Fenster
  ausblenden (`⌘⇧H`), fertig. Der zuletzt gewählte Modus wird gemerkt.
- Nach dem **Stoppen** läuft die Nachverarbeitung automatisch (Status: „Recap läuft …"):
  1. **Kunden-Erkennung** über den Google-Kalender („mit wem hatte ich gerade
     einen Termin?", gleiches OAuth-Token wie der Jarvis-Watcher).
  2. **Neutraler Recap** (Zusammenfassung, Entscheidungen, Action-Items,
     offene Fragen) über die **Claude-CLI** (Subscription, kein API-Geld).
  3. **Call-Notiz** ins Jarvis-Brain: `03_Projects/<kunde>-calls/YYYY-MM-DD-<thema>.md`
     — oder `00_Inbox/call-…` wenn kein Kunde erkannt wurde.
  4. **Action-Items als Tasks**: in die Projekt-Notiz des Kunden
     (`03_Projects/<kunde>.md`) bzw. in `07_Tasks/tasks.md` mit Link zur Notiz.

Die Brain-Nachverarbeitung (Notiz + Tasks) läuft übrigens **nach jedem Call** —
auch nach Sales-Calls, dort zusätzlich zur gewohnten PDF-Auswertung.

---

## ⌨️ Tastenkürzel

| Kürzel | Funktion |
|---|---|
| `⌘ + ⇧ + H` | Overlay ein-/ausblenden |
| `⌘ + ⇧ + K` | Maus-Durchklick an/aus (Transparent-Modus für den Call) |
| `⌘ + ⇧ + Q` | App beenden |

Die App startet **interaktiv/beweglich** (verschieben, klicken, bedienen).
Den Durchklick-Modus — Mausklicks gehen durch das Overlay hindurch — schaltest
du bei Bedarf mit `⌘⇧K` an.

---

## Nächster Schritt (später): Netlify

Diese App ist lokal (Desktop). Eine spätere Web-Version auf Netlify würde den
Claude-API-Key in einer **Netlify-Function** verstecken (nicht im Browser), weil
ein Browser den Key sonst offenlegen würde. Das transparente "Über-dem-Call"-
Fenster bleibt aber eine Desktop-Funktion — im Browser geht nur ein Fenster daneben.
