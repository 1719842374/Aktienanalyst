---
title: Routinen
date: 2026-11-25
tags:
  - aktienanalyst
  - routinen
aliases:
  - Arbeitsroutinen
  - Automations
---

# Routinen

Sicherung vom 25.11.2026 unter `/workspace/audit/routines-backup-20261125/*/automations/*/automation.json` (nur Box, für Cloud-Agenten nicht lesbar). Unten nur Felder aus diesen Dateien (Name, Trigger, Prompt/Zweck, Owner der Sicherungsordner, `enabled`, `createdAt`, `lastRunAt`, `provenance`).

> [!note] Zeitstempel
> `createdAt` und `lastRunAt` sind als Unix-Millisekunden gelesen und nach Europe/Madrid (UTC+1) umgerechnet. Eine Zeitzone für die Cron-Ausdrücke steht in den JSON-Dateien nicht.

> [!warning] Enabled-Stand in der Sicherung
> Mehrere Routinen sind in der Sicherung `enabled: false`. Der Team-Ablauf (25.11.2026) verlangt: Jede Lane hält ihre Routinen aktiv; fehlt eine nach einem Update, legt die Lane sie sofort selbst wieder an und meldet das [[Team/Bots/Stabschef|Stabschef]].

## Aktienanalyst Integrity

- **Owner:** [[Team/Bots/Stabschef|Stabschef]]
- **Status in der Sicherung:** aktiv (`enabled: true`)
- **Trigger:** GitHub-Events am Repo `1719842374/Aktienanalyst`: pr-opened, pr-pushed, pr-merged, pr-closed
- **Zweck (aus dem Prompt):** Integrity-Watch: Commit-Historie kurz dokumentieren (main-Tip plus auslösendes PR/Push); prüfen auf Merge-Konflikte und gelöschte/truncatedzte kritische Dateien (analyze-route.ts, researcher.ts, keine PLACEHOLDER-Stubs); nur bei Problem oder relevanten Änderungen an Philip/Engineering melden, bei reinem No-Change still bleiben; bei Alarm [[Team/Bots/Doublecheck|Doublecheck]] parallel anpingen. FactPack-Hinweis im Prompt: feat/factpack-hook nicht mergen; feat/factpack-v2 Watch bis Hook remote.
- **Angelegt:** 2026-09-06 14:44 Europe/Madrid
- **Letzter Lauf laut Sicherung:** 2026-09-08 18:23 Europe/Madrid
- **provenance:** `untrusted`

## Teamfeedback

- **Owner:** [[Team/Bots/Stabschef|Stabschef]]
- **Status in der Sicherung:** in der Sicherung deaktiviert (`enabled: false`)
- **Trigger:** Cron `0 8 * * *` (Zeitzone ist in der JSON-Datei nicht angegeben)
- **Zweck (aus dem Prompt):** Implementierungscheck-Review im eigenen Live-URL-Review-Desktop auf dem Cloudrechner. Output validieren und mit dem User-Prompt und seinen Erwartungen vergleichen, sonst nochmal fixen.
- **Angelegt:** 2026-09-01 20:23 Europe/Madrid
- **Letzter Lauf laut Sicherung:** 2026-09-05 07:00 Europe/Madrid
- **provenance:** `user`

## Work.md

- **Owner:** [[Team/Bots/Work-MD|Work.MD]]
- **Status in der Sicherung:** in der Sicherung deaktiviert (`enabled: false`)
- **Trigger:** Cron `0 * * * *` (stündlich zur Minute 0; Zeitzone in der JSON-Datei nicht angegeben)
- **Zweck (aus dem Prompt):** Auf GitHub die Commit-Historie verfolgen, abgeschlossene Arbeitsprozesse in einem Implementierungsfile speichern, damit andere Bots prüfen können; Stabschef benachrichtigen, dass ausstehende Work.md-Dateien (mehr als eine) an die anderen Agenten verteilt werden, und Philip benachrichtigen.
- **Angelegt:** 2026-08-30 19:09 Europe/Madrid
- **Letzter Lauf laut Sicherung:** 2026-09-01 17:08 Europe/Madrid
- **provenance:** `user`

## Aktienanalyst Implementierung

- **Owner:** [[Team/Bots/Work-MD|Work.MD]]
- **Status in der Sicherung:** in der Sicherung deaktiviert (`enabled: false`)
- **Trigger:** Gruppe: GitHub-Events (pr-opened, pr-pushed, pr-merged, pr-closed, ci-passed, ci-failed, ciBranch main) und Cron `8 9,15 * * 1-5` (Mo–Fr 09:08 und 15:08; Zeitzone in der JSON-Datei nicht angegeben)
- **Zweck (aus dem Prompt):** Ampel-/Implementierungsdatei aus der Commit-Historie gegen `WORK_IMPLEMENTIERUNG_OFFEN.md` aktualisieren. Kein Code implementieren. Schreiben nach `/workspace/Aktienanalyst-IMPLEMENTIERUNG.md` (nur Box, für Cloud-Agenten nicht lesbar) und `/home/box/agent-data/shared/Aktienanalyst-IMPLEMENTIERUNG.md` (nur Box, für Cloud-Agenten nicht lesbar). Bei unverändertem Stand still bleiben; bei neu abgeschlossenem Ticket Philip kurz auf Deutsch informieren. Bei wiederholtem GitHub-Auth-Fehler Routine pausieren und Philip zum Reconnect auffordern, nie Tokens einfügen.
- **Angelegt:** 2026-08-30 19:10 Europe/Madrid
- **Letzter Lauf laut Sicherung:** 2026-09-05 13:18 Europe/Madrid
- **provenance:** `untrusted`

## Aktienanalyst Commit-Check

- **Owner:** [[Team/Bots/Doublecheck|Doublecheck]]
- **Status in der Sicherung:** in der Sicherung deaktiviert (`enabled: false`)
- **Trigger:** Gruppe: GitHub-Events (pr-opened, pr-pushed, pr-merged, ci-passed, ci-failed, ciBranch main) und Cron `0 9,17 * * *` (09:00 und 17:00; Zeitzone in der JSON-Datei nicht angegeben)
- **Zweck (aus dem Prompt):** Öffentliches Repo 1719842374/Aktienanalyst überwachen: neue Commits dokumentieren (SHA, Autor, Message, neue/geänderte/gelöschte Dateien), Konflikt-Marker und unerwartete Löschungen prüfen, Philip bei Problemen sofort benachrichtigen, sonst knappe Historie; beim Zeitplan still bleiben, wenn nichts Neues und keine offenen Probleme da sind.
- **Angelegt:** 2026-08-30 18:57 Europe/Madrid
- **Letzter Lauf laut Sicherung:** 2026-09-05 16:04 Europe/Madrid
- **provenance:** `user`

## Doublecheck

- **Owner:** Engineering-Gruppe (Profilname „Engineering“, kein Lane-Bot der zwölf)
- **Status in der Sicherung:** aktiv (`enabled: true`)
- **Trigger:** Cron `30 * * * *` (stündlich zur Minute 30; Zeitzone in der JSON-Datei nicht angegeben)
- **Zweck (aus dem Prompt):** Auf GitHub die Aktienanalyst-Commit-Historie dokumentieren, prüfen, dass keine Merge-Konflikte bleiben und durch neue Commits keine Files gelöscht wurden, und dann benachrichtigen.
- **Angelegt:** 2026-08-30 18:49 Europe/Madrid
- **Letzter Lauf laut Sicherung:** 2026-09-22 03:42 Europe/Madrid
- **provenance:** `user`

In dieser Sicherung liegen keine Routinen der Lanes [[Team/Bots/GitHub|GitHub]], [[Team/Bots/Vercel|Vercel]], [[Team/Bots/Tester|Tester]], [[Team/Bots/Designer|Designer]], [[Team/Bots/Werki|Werki]] oder der Ideengenerierung-Bots.
