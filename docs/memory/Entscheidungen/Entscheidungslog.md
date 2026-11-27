---
title: Entscheidungslog
date: 2026-11-25
tags:
  - aktienanalyst
  - entscheidungen
aliases:
  - Log
  - Entscheidungen
---

# Entscheidungslog

Nur datierte, belegte Entscheidungen. Neue Einträge unten anhängen, bestehende Zeilen nicht löschen oder überschreiben. Siehe [[Pflege]].

## 2026-10-05 — Autonom-Merge und Spec-Prefix

Autonom-Merge bei GO/PASS und das Spec-Prefix `fertig_`/`Fertig_` (nie zurück auf `Offen_`) gelten als Standing-Regeln in den Bot-Profilen. Der Profiltext selbst trägt kein Tagesdatum. Das Datum 05.10.2026 ist die Datierung, unter der diese Entscheidung in diesem Vault festgehalten wird; ein eigener Audit-Block mit genau diesem Datum lag unter `/workspace/audit` (nur Box, für Cloud-Agenten nicht lesbar) nicht vor.

Siehe [[Regeln/Autonom-Merge bei GO PASS]] und [[Regeln/Spec-Prefix Fertig_ fertig_]].

## 2026-11-08 — Fünf Cursor-CloudAgents parallel

Philip, 08.11.2026 (Block **CURSOR-TEAMBELEGUNG & AUTONOMER WORK-KREISLAUF** in den Profilen): teamweit insgesamt fünf Cursor-Cloud-Agenten parallel mit noch offenen, baubaren WORK-Specs beschäftigen; [[Team/Bots/Stabschef|Stabschef]] koordiniert die Belegung, keine fünf pro Bot, keine Doppelarbeit. MAIN-CODE-VORPRÜFUNG denselben Tag, 23:29 Europe/Madrid: vor jeder Implementierung main-SHA und vorhandenen Code samt offenen PRs prüfen. CURSOR-AGENTEN-PFLICHT am 09.11.2026 14:01 Europe/Madrid ergänzt die Pflicht, Cursor-Agenten zu nutzen.

Siehe [[Regeln/CloudAgent-Budget zuerst]].

## 2026-11-19 — Git-Historie zuerst, Revert #316, Klarstellung 11:56

- 10:52 Europe/Madrid: [[Regeln/Git-Historie zuerst]] (Quelle `/workspace/audit/git-historie-block-20261119.txt` (nur Box, für Cloud-Agenten nicht lesbar)). Anlass im Block: Branchen-Wachstum in Sektion 9 zeigte n/a.
- 11:31 Europe/Madrid: [[Regeln/Code-Review durch Ideengenerierung]].
- 11:42: Anweisung, den Stand über die Git-Historie wiederherzustellen und nicht neu zu coden (im PR-Body von [#515](https://github.com/1719842374/Aktienanalyst/pull/515) zitiert). Der Absatz „FEHLER = ZURÜCKSETZEN, NICHT NEU CODEN“ wurde um 11:56 ersetzt.
- 11:56 Europe/Madrid: [[Regeln/Restore v2]] — Wiederherstellen gelöschter oder falsch überschriebener Dateien über Git-Historie (Revert-PR, kein Force-Push). Neuen Code schreiben bleibt sonst erwünscht, aber nicht als Ersatz für verlorene Arbeit und nicht als Flicken, wenn die Ursache woanders liegt.
- Entscheidung der Koordination: #316 wird per Revert (#515) zurückgenommen, statt die Sektion-9-Anzeige neu zu coden. API-Stand von #515 und #492: [[Repo/Stand]].

## 2026-11-25 — Team-Ablauf neu, Design-Fragen zuerst an Philip, Obsidian-Gedächtnis

- 16:19 Europe/Madrid: [[Team/Rollen und Ablauf]] (Quelle `/workspace/audit/team-ablauf-block-20261125.txt` (nur Box, für Cloud-Agenten nicht lesbar)). Rollen, PR-Kreislauf, autonome Zusammenarbeit Engineering ↔ Ideengenerierung, Routinen wieder aktiv halten.
- Dieselbe Anweisung: Bei Design-Fragen Philip immer zuerst fragen. Siehe [[Regeln/Design immer erst Philip fragen]].
- Zusätzlich: Projektgedächtnis für Aktienanalyst als Obsidian-Vault auf der Box unter `/workspace/obsidian/Aktienanalyst` (nur Box, für Cloud-Agenten nicht lesbar) (Philips Desktop war beim Anlegen nicht verbunden). Pflege: [[Pflege]], Einstieg: [[00 Start]].

## 2026-11-25 — Tester-PASS Smoke #520 (Revert auf 4220d4e9)

- 16:59 Europe/Madrid: [[Team/Bots/Tester|Tester]] meldet **PASS** für den Smoke von [#520](https://github.com/1719842374/Aktienanalyst/pull/520) auf Head `378ff2a4` (Preview `aktienanalyst-pr-520.onrender.com`, Bundle `index-Cearnm_9.js`, Health-Uptime 916 → 2394 s ohne Neustart). MSFT, AAPL, NVO, TSLA, SHEL.L sowie `#/btc`, `#/gold`, `#/recession`, `#/screener`, `#/compare` bei 1440 und 375 px mit Daten, ohne Same-Origin-API-Fehler.
- Beleg für den S9-Fix: `tamCAGR ?? 5` (`client/src/components/sections/Section7.tsx:40`) zeigt bei MSFT, AAPL, NVO, TSLA unbeschriftet `+5.0%` als Sector Avg und Balken „Branche“; SHEL.L zeigt den beschrifteten Payload-Wert 17 %.
- Quelle: `/workspace/dod-520-378ff2a4/report.md` (nur Box, für Cloud-Agenten nicht lesbar) (Cursor-Agent des Testers).

## 2026-11-26 — Schalter-Sperre für die DCF-Kalibrierung

- 12:38 Europe/Madrid, Philip: Der Schalter `DCF_CALIBRATION.enabled` aus #512 ist eine Code-Konstante. Ein Test muss ihn auf aus festhalten, damit ein späterer PR ihn nicht mit einer Zeile einschaltet und dann ohne Philips Vorher/Nachher-OK ([#523](https://github.com/1719842374/Aktienanalyst/issues/523)) autonom gemergt wird.
- Ist auf `70048c8f`: Den Test gab es schon (`script/test-dcf-calibration.ts:56`), aber kein CI-Workflow hat ihn ausgeführt.
- Umsetzung: CI-Guard [#526](https://github.com/1719842374/Aktienanalyst/pull/526). Außerdem meldet die Integrity-Routine (Punkt 5) jede Änderung an `enabled`, am Guard-Test oder am Workflow als Alarm: HOLD gegen den Squash und Meldung an Philip.

- 2026-11-26 12:50: #526 Zyklus zu (DC Post-Merge KLAR auf 0247d57b, Ampel ## 12:48). Merkposten: Sagt Philip zu #523 Ja, muss die CI-Sperre (script/test-dcf-flag-off.ts + dcf-calibration-test.yml) im selben PR wie das Einschalten angepasst werden, sonst wird main rot. P3-Nachzug: Pfadfilter um currency-format.ts, lynch-dcf-defaults.ts, listing-units.ts, guard-approved-dcf-calibration.ts, test-buffett-robust.ts ergänzen.
