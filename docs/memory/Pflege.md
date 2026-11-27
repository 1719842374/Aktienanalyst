---
title: Pflege
date: 2026-11-25
tags:
  - aktienanalyst
  - pflege
aliases:
  - Vault pflegen
  - Bot-Pflege
---

# Pflege dieses Vaults

Bei Widerspruch gewinnt der Code auf origin/main, danach README/WORK_IMPLEMENTIERUNG_OFFEN.md.

Pfad: `/workspace/obsidian/Aktienanalyst` (nur Box, für Cloud-Agenten nicht lesbar). Geteilt von allen Aktienanalyst-Bots auf der Box. Nicht unter `dist`, `build`, `out`, `coverage`, `target` oder einem Cache-Ordner ablegen.

Philips Desktop war beim Anlegen nicht verbunden. Der Vault lebt deshalb auf der Box. Später kann der Ordner nach Obsidian auf dem Desktop geöffnet oder kopiert werden (`Obsidian` → Vault öffnen → diesen Ordner wählen). Die Obsidian-CLI (`obsidian`) war auf der Box nicht installiert; Notizen wurden als Obsidian-Flavored Markdown direkt in Dateien geschrieben.

## Regeln für Updates

- **Notizen nie löschen.** Falsches ergänzen, nicht entfernen. Bei überholtem Stand einen datierten Nachtrag oder eine Klarstellung anhängen und auf die neue Regel verlinken (wie bei [[Regeln/Restore v2]], das den 11:42-Absatz ersetzt, ohne die Geschichte zu löschen).
- **[[Entscheidungen/Entscheidungslog]]:** Neue Entscheidungen mit Datum (Europe/Madrid) unten anhängen. Bestehende Einträge nicht umschreiben.
- **[[Repo/Stand]]:** Logbuch, keine Pflichtlektüre. Die Work.MD-Lane hängt nach jedem Squash per eigenem Docs-PR einen datierten Nachtrag an, ohne die ältere Notiz umzuschreiben. Ein `main_sha`, der nicht `origin/main` entspricht, gilt als veraltet. main-SHA und PR-Status immer live ermitteln. Bau-Agenten lesen `docs/memory/` nur; keine Doku-Edits in Feature-PRs.
- **Profile und Routinen:** Änderungen an Lanes oder Automationen in [[Team/Bots/Stabschef|den Bot-Notizen]] bzw. [[Routinen]] nachziehen, mit Datum und Quelle (aktuelles `profile.json` bzw. `automation.json`).
- **Nur belegte Fakten.** Nichts erfinden. Quellen nennen (Audit-Datei, Profil, GitHub API). Fehlende Herkunft kennzeichnen.
- Wikilinks `[[Notiz]]` für interne Verweise, normale Markdown-Links für GitHub und andere URLs. Frontmatter beibehalten (title, date, tags).

## Quellen dieses Erststands

- `/workspace/audit/team-ablauf-block-20261125.txt` (nur Box, für Cloud-Agenten nicht lesbar)
- `/workspace/audit/git-historie-block-20261119.txt` (nur Box, für Cloud-Agenten nicht lesbar)
- `/workspace/audit/ideen-review-block-20261119.txt` (nur Box, für Cloud-Agenten nicht lesbar)
- `/workspace/audit/git-restore-block-v2-20261119.txt` (nur Box, für Cloud-Agenten nicht lesbar)
- `/workspace/audit/routines-backup-20261125/*/automations/*/automation.json` (nur Box, für Cloud-Agenten nicht lesbar)
- `/home/box/agent-data/agents/<id>/profile.json` der zwölf Bots (nur Box, für Cloud-Agenten nicht lesbar)
- Öffentliche GitHub API: `https://api.github.com/repos/1719842374/Aktienanalyst/…` (Abruf 2026-11-25 16:23 Europe/Madrid)

## Repo-Kopie für Cursor-Agenten

Ab 26.11.2026 (Europe/Madrid) liegt eine Kopie dieses Vaults im Repo [1719842374/Aktienanalyst](https://github.com/1719842374/Aktienanalyst) unter `docs/memory/`. Sie dient Cursor-App-Agenten (lokal und Cloud) als Kontext. Bei Widerspruch gewinnt der Code auf origin/main, danach README/WORK_IMPLEMENTIERUNG_OFFEN.md.

Bau-Agenten lesen `docs/memory/` nur. Die Aktualisierung macht die Work.MD-Lane per eigenem Docs-PR nach Merges. Keine Doku-Edits in Feature-PRs. Stand.md ist ein Logbuch und keine Pflichtlektüre; die Work.MD-Lane hängt nach jedem Squash per Docs-PR einen datierten Nachtrag an.

Der Box-Vault unter `/workspace/obsidian/Aktienanalyst` (nur Box, für Cloud-Agenten nicht lesbar) bleibt das Arbeitsverzeichnis der Team-Bots auf der Box.
