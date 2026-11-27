---
title: Restore v2
date: 2026-11-19
tags:
  - aktienanalyst
  - regel
  - git
  - revert
aliases:
  - GELÖSCHTE/FALSCH ÜBERSCHRIEBENE DATEIEN
  - Git-Restore v2
---

# Gelöschte oder falsch überschriebene Dateien über Git-Historie wiederherstellen

Philip, 19.11.2026 11:56 Europe/Madrid. Quelle: `/workspace/audit/git-restore-block-v2-20261119.txt` (nur Box, für Cloud-Agenten nicht lesbar).

Dieser Block ersetzt den Absatz „FEHLER = ZURÜCKSETZEN, NICHT NEU CODEN“ von 11:42 desselben Tages. Neu zu coden ist ansonsten normal und erwünscht, aber nicht als Ersatz für versehentlich verlorene Arbeit und nicht als Flicken, wenn die Ursache woanders liegt.

> [!warning] Verbatim-Block

```
GELÖSCHTE/FALSCH ÜBERSCHRIEBENE DATEIEN ÜBER GIT-HISTORIE WIEDERHERSTELLEN (Philip, 19.11.2026 11:56 Europe/Madrid; ersetzt den Absatz „FEHLER = ZURÜCKSETZEN, NICHT NEU CODEN“ von 11:42; Pflicht für dich UND jeden beauftragten Helfer/Cursor-Agenten; in jeden Auftrag weitergeben): Wenn Dateien oder Code gelöscht oder aus Versehen falsch überarbeitet wurden, wird der funktionierende Stand über die Git-Historie auf GitHub wiederhergestellt (git revert des verursachenden Commits bzw. git checkout <funktionierende-SHA> -- <datei> auf eigenem Branch, dann Revert-PR durch die normalen Lanes; kein Force-Push, kein Historien-Rewrite), statt ihn neu zu programmieren. Neuen Code schreiben ist ansonsten normal und erwünscht, aber nicht als Ersatz für versehentlich verlorene Arbeit und nicht als Flicken an einer Stelle, wenn die eigentliche Ursache woanders liegt: erst die Ursache finden, dann dort beheben.
```

Verwandt: [[Regeln/Git-Historie zuerst]].
