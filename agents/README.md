# Agents — Jarvis' Mitarbeiter
> **Jarvis = CEO.** Jeder Agent = ein Mitarbeiter mit eigener Akte (Ordner). Alle kennen das Overall-Goal über `brain/` — keine dummen Worker, sondern kontext-bewusste Mitarbeiter.

## Konvention: ein Agent = ein Ordner (Mitarbeiter-Akte)
```
agents/<name>/
  agent.md        # Rolle, Ablauf, Limits, Safety, Autonomie   (editierbar)
  goal.md         # aktuelles Ziel/ICP — hier steuerst du ihn   (editierbar)
  learnings.md    # Erkenntnisse, vom Agent nach jedem Lauf angehängt
  runs/           # täglicher Report pro Lauf (Zahlen) — NICHT ins Vault
```
Das Dashboard-Modul **„Agents"** rendert genau diese Ordner:
Kategorie → Agent anklicken → Tages-Historie/Report (pro Step mit Zahlen) + Chat zum Steuern.

## Agents
- `outreach-alex/` — LinkedIn-Outreach, Account der Nutzer.
- *(geplant)* `outreach-paul/` — gleiches, Account Paul, läuft **parallel** (eigener Lock, eigenes Chrome-Profil).

## Regeln
- **Zahlen** (Leads/kontaktiert/Funnel) → `runs/` (Daten/Report), nicht ins Vault.
- **Wissen** (ICP-Strategie, wer/was/warum) → `brain/`.
- Pro Account **ein Lock** → nie zwei Läufe auf demselben Profil. Verschiedene Accounts dürfen parallel (Browser-Ebene, kein geteilter Cursor).
