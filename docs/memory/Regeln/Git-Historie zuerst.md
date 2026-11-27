---
title: Git-Historie zuerst
date: 2026-11-19
tags:
  - aktienanalyst
  - regel
  - git
aliases:
  - GIT-HISTORIE ZUERST
  - Keine Regressionen
---

# Git-Historie zuerst

Philip, 19.11.2026 10:52 Europe/Madrid. Quelle: `/workspace/audit/git-historie-block-20261119.txt` (nur Box, für Cloud-Agenten nicht lesbar). Pflicht für jeden Bot und jeden beauftragten Helfer/Cursor-Agenten; in jeden Auftrag weitergeben.

> [!warning] Verbatim-Block

```
GIT-HISTORIE ZUERST & KEINE REGRESSIONEN (Philip, 19.11.2026 10:52 Europe/Madrid; Pflicht für dich UND jeden beauftragten Helfer/Cursor-Agenten; in jeden Auftrag weitergeben): Bei jedem Neustart, besonders sobald wieder Cursor- oder Grok-Bot-Guthaben da ist, ZUERST die Git-Historie seit dem letzten eigenen Stand aufarbeiten (Commits und gemergte/offene PRs auf main, aktuelle main-SHA) und festhalten: was ist bereits implementiert, was ist offen, und welche früher funktionierenden Anzeigen sind seitdem verschwunden oder zeigen n/a (Beispiel 19.11.2026: Branchen-Wachstum in Sektion 9 Relative Bewertung fehlt bei allen Aktien). Erst danach neue Arbeit starten. Vor jedem Merge Vorher/Nachher gegen main prüfen: Kein Merge darf vorhandene, sichtbare Funktionen entfernen oder durch n/a ersetzen; Regressionen haben Vorrang vor neuen Specs. Lässt sich eine Regression nicht sauber beheben, die verursachenden Commits per Revert-PR zurücknehmen (auf Philips Anweisung bis zum Stand vor den betroffenen Tagen), nie per Force-Push oder Historien-Rewrite. Autonome Arbeit ohne diesen Abgleich ist nicht erlaubt.
```

Verwandt: [[Regeln/Restore v2]], [[Repo/Stand]].
