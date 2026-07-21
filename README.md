# AIOS

Dein persönliches Business-OS: ein lokales Command Center + ein KI-Partner (Jarvis, via Claude Code) +
Module, die echte Arbeit übernehmen. Läuft lokal auf deinem Rechner (macOS oder Windows), deine Daten bleiben bei dir.

## In einem Befehl installieren

**macOS / Linux** (Terminal):
```bash
curl -fsSL https://raw.githubusercontent.com/MigSanja/amplify-aios-dist/main/install.sh | bash
```

**Windows** (PowerShell):
```powershell
irm https://raw.githubusercontent.com/MigSanja/amplify-aios-dist/main/install.ps1 | iex
```

Der Installer prüft die Voraussetzungen, holt das AIOS nach `~/AIOS` (Windows: `%USERPROFILE%\AIOS`) und
sagt dir den nächsten Schritt. Danach öffnest du den Ordner in **Claude Code** und tippst:

```
/aios-setup
```

Claude Code **erkennt automatisch dein Betriebssystem** und führt dich Schritt für Schritt durch alles.
Jeder Schritt ist überspringbar, du kannst alles später nachholen.

## Voraussetzungen
- macOS **oder** Windows 10/11
- [Node.js](https://nodejs.org) ≥ 18
- Git (Windows: Git for Windows inkl. Git Bash)
- Google Chrome
- [Claude Code](https://claude.com/claude-code) (mit Claude-Subscription: das AIOS nutzt deine Subscription, kein API-Key nötig)

> Voll plattformübergreifend: Dashboard, Jarvis-Copilot, Brain und WhatsApp-Outreach laufen nativ auf
> beiden Systemen. Automatisierte Hintergrund-Jobs richtet Claude Code passend ein (macOS: launchd,
> Windows: Task Scheduler). Der Note Taker braucht ein Audio-Loopback (Mac: BlackHole, Windows: VB-Cable).

## Was du damit machen kannst

**Kern (immer dabei)**
- **Command Center**: Dashboard mit Übersicht über alles (`http://localhost:4321`).
- **Second Brain**: dein Wissen als Obsidian-Vault (`brain/`). Du kannst dein bestehendes Obsidian einbinden.
- **Jarvis Copilot**: dein KI-Partner: Brain-Dumps rein, er strukturiert, plant, erinnert. Auch mobil per Telegram.

**Module (im Onboarding aktivierbar, sonst „später einrichten")**
- **WhatsApp-Outreach**: alte Kontakte reaktivieren, Kampagnen fahren, ein KI-Setter beantwortet Antworten und macht Termine. Du verbindest dein eigenes WhatsApp Business.
- **Content-Pipeline**: droppe Videos oder Instagram-Links rein, die KI merkt sie sich als Content-Ideen. Der Nachtwerker füllt nachts neue Ideen nach. Alles wird zu einem Ideen-Feed.
- **Nachtwerker + Heartbeat**: autonome Agenten, die nachts und stündlich dein Backlog abarbeiten (nach Freigabe-Regeln).
- **Lead-Sourcing**: B2B-Leadlisten ziehen, Geschäftsführer-Mails finden und verifizieren, ins lokale CRM schreiben.
- **Note Taker / Sales Copilot**: transkribiert deine Calls und legt Recap + Action-Items ins Brain.
- **LinkedIn-Outreach, Finanzen, Rechnungen, Pipeline/CRM, Projekt-Board**: als Code enthalten, im Dashboard sichtbar, einrichtbar wann du willst.

## Welche Schlüssel wofür (alle optional, später nachrüstbar)
- **Telegram**: mobiles Interface + Benachrichtigungen (eigener Bot).
- **WhatsApp**: Meta Cloud API (dein eigenes WhatsApp Business).
- **Apify**: Scraping für Content-Pipeline + Lead-Sourcing.
- **Deepgram**: Transkription für Note Taker + Content-Captions.
- **ElevenLabs**: Voice-Over fürs Video-Modul.
- **Google**: Gmail/Kalender für Action-Needed-Signale.

Kopiere `.env.example` zu `.env` und fülle nur, was du brauchst. `.env` wird nie geteilt.

## Datenschutz
Dieses Repo enthält **nur Code**. Alle persönlichen Daten (`brain/`, `dashboard/data/`, `.env`) sind
gitignored und bleiben lokal auf deinem Rechner.

## Anpassbar
Das ist dein System. Erweitere es direkt mit Claude Code: neue Module, eigene Agents, eigene Skills.
