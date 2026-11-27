---
title: Hard Limits
date: 2026-11-25
tags:
  - aktienanalyst
  - regel
  - limits
aliases:
  - Harte Limits
  - Freigabegrenzen
---

# Hard Limits

Zusammengestellt aus den vorliegenden Quellen. Nichts hier ist neu erfunden; wo ein eigener datierter Audit-Block fehlt, ist das gekennzeichnet.

## Aus den vorliegenden Blöcken und Profilen

- **Kein Force-Push, kein Historien-Rewrite.** Steht in [[Regeln/Git-Historie zuerst]] und [[Regeln/Restore v2]] sowie im Team-Ablauf (Revert-PR statt Force-Push).
- **Kein direkter Historien-Eingriff; Arbeit über Branches und PRs.** Restore nur per `git revert` bzw. `git checkout <SHA> -- <datei>` auf eigenem Branch, dann Revert-PR durch die normalen Lanes.
- **Wer nach main schreiben darf.** [[Regeln/Code-Review durch Ideengenerierung]]: Ideengenerierung macht keinen eigenen Push nach main und keinen Merge; Engineering behebt. [[Regeln/Autonom-Merge bei GO PASS]]: Die [[Team/Bots/GitHub|GitHub]]-Lane squash-mergt unter [[Team/Bots/Stabschef|Stabschef]] autonom, wenn Soll-Ist stimmt, Doublecheck klar ist und bei UI der Tester PASS hat. Philip wird dafür nicht gefragt, außer bei beschädigten Daten, unklarer Integration, roten Checks, Security, Breaking Change oder Production-Deploy-Domain-Env.
- **Score, Rating, Entry, Peer.** Philip zuerst fragen (Team-Ablauf Punkt 5, 25.11.2026). Der Review-Block (19.11.2026 11:31) fordert, ungenehmigte Score-/Rating-/Entry-/Peer-Set-Änderungen konkret zu belegen; Ideengenerierung ändert keine Scores.
- **Security, Breaking Changes, Production/Domain/Env, beschädigte Daten, neuer Tool-Zugang.** Philip fragen (Team-Ablauf Punkt 5 und Autonom-Merge-Ausnahmen).
- **Design.** Philip zuerst fragen, sonst kein autonomes Mergen. Siehe [[Regeln/Design immer erst Philip fragen]].

## Dokumentierte Team-Limits ohne eigenen Audit-Block in `/workspace/audit` (nur Box, für Cloud-Agenten nicht lesbar)

Die folgenden Punkte stehen in der laufenden Team-Koordination als weiterhin geltende Hard Limits, lagen beim Anlegen dieses Vaults aber nicht als eigener datierter Block unter `/workspace/audit/*.txt` (nur Box, für Cloud-Agenten nicht lesbar) vor:

- Nicht direkt auf `main` pushen (Merges nur über die GitHub-Lane nach GO/PASS, siehe oben).
- `analyze-route.ts` und `researcher.ts` nicht anfassen. Datierte Quelle wird nachgetragen; gilt bis Philip anders entscheidet.
- Keine zweite `.L`-Datenquelle. Datierte Quelle wird nachgetragen; gilt bis Philip anders entscheidet.
- ETFs bleiben auf dem Aktien-Dashboard gesperrt. Datierte Quelle wird nachgetragen; gilt bis Philip anders entscheidet.
- Keine `.DE`-Tests/Specs. Quelle: Philip 18.11.2026 21:59.
- AAPL statt SAP.DE. Datierte Quelle wird nachgetragen; gilt bis Philip anders entscheidet.

Wenn ein datierter Originalblock auftaucht, hier nachtragen und verlinken, die Notiz nicht löschen ([[Pflege]]).
