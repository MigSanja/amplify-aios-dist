---
name: automation-doku
description: Visuelle Team-Dokumentation für Automationen als eine fertige HTML-Datei (One-Pager, editorial, grafisch, nicht zu technisch). Zeigt Zusammenhänge, Abläufe und "wer macht was" mit Diagrammen, annotierten Screenshots und Callouts. Baut auf einem bewährten Team-Guide-Stil auf. Trigger: "Automations-Doku", "Doku für das Team", "erklär die Automation visuell", "One-Pager für die Automation", "Anleitung für die Mitarbeiter".
---

# Automation-Doku — visuelle Team-Dokumentation

Erzeugt **eine einzige, in sich geschlossene HTML-Datei**, die eine Automation für ein Team
verständlich macht: was sie tut, wie die Teile zusammenhängen, wo ein Mensch eingreift.
Editorial/magazin-artig, viel Grafik, wenig Technik. Für Nicht-Techniker gebaut.

Vorlage: ein bewährter, visueller Team-Guide-Stil.
Ausgangspunkt für jede neue Doku: **`assets/template.html`** in diesem Skill-Ordner.

## Ablauf

1. **Kontext holen.** Wenn nicht schon klar, kurz fragen (eine Frage pro Punkt, nicht alles auf einmal):
   - Welche Automation? Was macht sie in einem Satz?
   - Für wen ist die Doku (Team-Rolle)? Was müssen die verstehen/tun?
   - Welches Tool läuft dahinter (Smoobu, n8n, Make, Tapkey ...)?
   - Wo greift ein Mensch ein? (das ist fast immer der wichtigste Teil)
   - Gibt es Screenshots? Wenn ja, Pfade. Sonst bauen wir Diagramme als SVG.
2. **`assets/template.html` kopieren** an den Zielort (siehe unten) und dort befüllen. Nie das
   Template selbst überschreiben.
3. **Struktur füllen** nach dem Muster unten. Sektionen weglassen/hinzufügen je nach Automation.
4. **Verifizieren:** Datei im Browser öffnen, prüfen dass alles rendert, keine kaputten Bilder,
   Handy-Breite ok. Dann erst abgeben. Screenshot als Beleg zeigen.

## Aufbau (bewährtes Muster)

Immer diese Reihenfolge, das führt den Leser wie eine Geschichte:

1. **Kopf (masthead)** — Marken-Zeile, ein Satz was es ist, Lede (Kontext + welches Problem gelöst wird), Datum.
2. **01 Das große Ganze** — ein Übersichts-Diagramm (SVG-Flow oder Screenshot) + nummerierte Legende
   drunter, die die Boxen erklärt. Hier muss man in 10 Sekunden den ganzen Ablauf checken.
3. **02..N Schritt-Sektionen** — je Teilablauf eine Sektion: großer Titel, kurzer Absatz,
   Schritt-Karten oder Screenshot mit Legende, Callouts für Hinweise/Warnungen/Tipps.
4. **Wer macht was / Handover** — explizit machen wo der Mensch eingreift (die orange Box). Das ist
   für Teams der Kern. Nicht verstecken.
5. **Details** — Key-Value-Tabelle mit den Eckdaten (Tool, Auslöser, Zuständig).
6. **Offene Punkte / nächste Schritte** — falls die Automation noch nicht ganz fertig ist.
7. **Footer** — wen fragen, letzte Aktualisierung.

## Komponenten (alle im Template fertig als CSS-Klassen)

- `figure` + `figcaption` — für Diagramm oder Screenshot, gerahmt.
- `ol.legend` — nummerierte orange Kreise, die ein Bild annotieren. Das Herzstück, macht Bilder erklärbar.
- `.steps` / `.step` — Ablauf als nummerierte Karten.
- `.note brand|accent|info` — farbige Callouts: brand=gut zu wissen, accent(orange)=Achtung, info(blau)=Tipp.
- `.kv` — Key-Value-Tabelle für technische Eckdaten.
- `ul.plain` — saubere Punktliste mit Farb-Dots.
- `.assign` — kleines Mono-Tag für "wer ist zuständig".
- **SVG-Flow** — im Template ist ein Muster (Boxen + Pfeile) drin. Für "Zusammenhänge zeigen" ohne
  Screenshot einfach die Boxen/Texte/Pfeile anpassen. Farben aus den CSS-Variablen nehmen.

## Diagramme: Screenshots vs. SVG

- **Screenshots** (echte Tool-Oberfläche): als `<img>` einbetten. Am robustesten als Base64-Data-URI
  (Datei bleibt in sich geschlossen, keine losen Bilddateien). Umwandeln z.B. mit:
  `base64 -i bild.png` und als `src="data:image/png;base64,..."`. Immer eine `legend` drunter, die
  die markierten Stellen erklärt.
- **SVG-Flow** für Abläufe/Zusammenhänge, wenn kein Screenshot passt. Boxen = Stationen, Pfeile =
  Fluss, orange Box = "Mensch greift ein". Klarer als jede Wortbeschreibung.

## Farben anpassen (für andere Kunden/Teams)

Nur den `:root`-Block oben im HTML ändern. `--brand` / `--brand-d` / `--brand-wash` = Primärfarbe des
Kunden, `--accent` = Warnfarbe (orange lassen, hebt sich ab). Rest bleibt. Ein Kunde = eine Farbe tauschen,
fertig. Bei Bedarf Kunden-Logo statt dem `.brand .dot` einsetzen.

## Sprache & Ton (Pflicht)

- **KEINE Gedankenstriche (— oder –). Nirgends.** Kein Mensch schreibt so, das ist AI-Slop. Stattdessen
  Punkt, Komma, Doppelpunkt oder umformulieren. Vor Abgabe die Datei nach `—` und `–` durchsuchen.
- Menschlich, konkret, Team-tauglich. Kein Fachjargon, keine Tool-Namen erklären die keiner kennt.
- Kurze Sätze. Der Leser soll sich sicher fühlen, nicht dumm.
- Aktiv formulieren: "Du machst X", nicht "X wird durchgeführt".
- Sag klar, wo der Mensch dran ist und wo nicht. Angst-nehmend ("den Rest macht das System").

## Ablage

- Kundenprojekt → in den Kunden-Ordner, z.B. `~/Desktop/Kunden/<Kunde>/<Name>_Doku.html`.
- AIOS/intern → passenden Projekt-Unterordner. Nie lose auf den Desktop.
- Immer den finalen Pfad nennen.

## Fertig heißt

Eine `.html`-Datei, die man doppelklickt und die sofort erklärt, was die Automation tut, ohne dass
jemand nachfragen muss. Im Browser geprüft, keine Dashes, Handy-Breite ok, richtiger Kunde/Farbe.
