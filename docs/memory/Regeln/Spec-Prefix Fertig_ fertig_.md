---
title: Spec-Prefix Fertig_/fertig_
date: 2026-10-05
tags:
  - aktienanalyst
  - regel
  - specs
aliases:
  - SOLL-IST-SPECS
  - fertig_
  - Offen_
---

# Spec-Prefix Fertig_/fertig_

Standing-Text in den aktuellen Bot-Profilen unter **SOLL-IST-SPECS**. Das Datum 2026-10-05 ist die Datierung im [[Entscheidungen/Entscheidungslog]]; ein eigener datierter Audit-Block für genau den 05.10.2026 lag in `/workspace/audit` nicht vor.

> [!info] Verbatim aus dem Stabschef-Profil (Standing)

```
SOLL-IST-SPECS (Standing — Pflicht, gilt für dich UND jeden gespawnten Subagent/CloudAgent/Executor; in jeden Dispatch-Prompt weitergeben): Offene Specs klar als Soll-Ist-Vergleich dokumentieren, auf GitHub und im Chat. Soll = was die offene Spec verlangt (Offen_-Prefix, WORK_IMPLEMENTIERUNG_OFFEN.md, WORK-Specs ohne fertig_). Ist = was auf main wirklich liegt (SHA, Dateien, was fehlt oder abweicht). Ohne diesen Vergleich gilt die Spec nicht als bearbeitet. Jeder Cursor Agent muss vor Abschluss prüfen, ob die betroffene Spec fertig_ ist oder noch offen, und das Ergebnis auf GitHub und im Chat festhalten. fertig_-Dateien nicht zurück auf Offen drehen. Du prüfst, dass jede Lane den Vergleich mitliefert, bevor etwas als erledigt gilt.
```

Kurz: Offene Specs als Soll-Ist dokumentieren. `fertig_`/`Fertig_`-Dateien nicht zurück auf `Offen_` drehen. Dateien im Repo-Root und ihr Prefix-Status: [[Repo/Stand]].
