---
title: Autonom-Merge bei GO/PASS
date: 2026-10-05
tags:
  - aktienanalyst
  - regel
  - merge
aliases:
  - AUTONOM-MERGE & LIVE-REVIEW
  - Autonom-Merge
---

# Autonom-Merge bei GO/PASS

Der Standing-Text steht in den aktuellen Bot-Profilen (z. B. [[Team/Bots/Stabschef]]) unter der Überschrift **AUTONOM-MERGE & LIVE-REVIEW**, ohne eigenes Datum im Absatz. Das Datum 2026-10-05 ist die Datierung im Entscheidungslog dieses Vaults ([[Entscheidungen/Entscheidungslog]]); ein eigener datierter Audit-Block für genau den 05.10.2026 lag in `/workspace/audit` (nur Box, für Cloud-Agenten nicht lesbar) nicht vor.

> [!info] Verbatim aus dem Stabschef-Profil (Standing)

```
AUTONOM-MERGE & LIVE-REVIEW (Standing — Pflicht, gilt für dich UND jeden gespawnten Subagent/CloudAgent/Executor; in jeden Dispatch-Prompt weitergeben): Wenn die Aufgabe korrekt implementiert ist (Soll-Ist stimmt; Doublecheck klar; bei UI Tester-PASS mit Live-Screenshots Ist vs Soll), squash-mergt die GitHub-Lane unter Stabschef autonom — Philip wird dafür nicht gefragt. Philip nur anpingen, wenn Daten beschädigt sind, unklar ist wie etwas integriert werden soll, oder bei roten Checks / Security / Breaking Change / Production-Deploy-Domain-Env. Autonom reviewen und live mit Screenshots Ist gegen Soll prüfen; so lange weiterarbeiten, bis die Aufgabe korrekt erfüllt ist. Ein Draft-Body „Do not merge“ blockiert den Squash-Merge nicht, wenn die Lanes GO/PASS haben. fertig_/Fertig_-Dateien nicht zurück auf Offen_ drehen.
```

Ergänzung aus dem Team-Ablauf (25.11.2026): Bei GO + PASS squasht die [[Team/Bots/GitHub|GitHub]]-Lane autonom. Das autonome Mergen gilt nicht für Design-Entscheidungen ohne Philips OK ([[Regeln/Design immer erst Philip fragen]]). `fertig_`/`Fertig_`-Dateien nicht zurück auf `Offen_` drehen ([[Regeln/Spec-Prefix Fertig_ fertig_]]).
