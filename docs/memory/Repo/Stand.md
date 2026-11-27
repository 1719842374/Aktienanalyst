---
title: Repo-Stand
date: 2026-11-25
tags:
  - aktienanalyst
  - repo
  - github
aliases:
  - Stand
  - main
main_sha: 7aaa13ce4ceac60e9b54be3f8edf6f4320d70629
main_sha_status: historisch (Abruf 2026-11-25 16:23 Europe/Madrid; entspricht nicht origin/main und gilt als veraltet)
---

# Repo-Stand

> Logbuch, geprüft gegen SHA `d78c370492899c58bec150b8c3e0f2e6a37c9e6d` am 27.11.2026, 09:38 Europe/Madrid. Ein `main_sha` in dieser Notiz, der nicht `origin/main` entspricht, gilt als veraltet. main-SHA und PR-Status immer live ermitteln. Diese Notiz ist nur Kontext und gehört nicht zur Pflichtlektüre; nur bei Bedarf lesen. Owner: Die Work.MD-Lane hängt nach jedem Squash per eigenem Docs-PR einen datierten Nachtrag an, ohne die ältere Notiz umzuschreiben.

Repo: [1719842374/Aktienanalyst](https://github.com/1719842374/Aktienanalyst), öffentlich. Stand über die öffentliche GitHub API abgerufen am 2026-11-25 16:23 Europe/Madrid. Kein Clone.

## main-Spitze

- **Branch:** `main`
- **SHA:** `7aaa13ce4ceac60e9b54be3f8edf6f4320d70629` (historisch, Abruf 25.11.2026 16:23 Europe/Madrid; entspricht nicht mehr `origin/main`, gilt als veraltet. Aktueller Stand: Nachtrag unten.)
- **Commit-Zeit:** 2026-11-19 10:02 Europe/Madrid
- **Autor (Commit-Metadaten):** Philip Diaz
- **Message:** docs: Ampel c4975703, Prod-Smoke #505–#511 und Briefing-Regional-Befund (#513)
- **Link:** [7aaa13ce](https://github.com/1719842374/Aktienanalyst/commit/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629)

## Besonders: #515 und #492

### [PR #515](https://github.com/1719842374/Aktienanalyst/pull/515) — Revert von #316 (TAM / Sektion 9)

- **Titel:** Revert #316: 5-%-Branchenanzeige in Sektion 9 wiederherstellen
- **Zustand:** open, Draft: True, gemergt: False (merged_at: nein)
- **Erstellt:** 2026-11-19 11:53 Europe/Madrid
- **Aktualisiert:** 2026-11-19 13:05 Europe/Madrid
- **Head:** `revert/316-section9-tam` `177c8ac50a7abf05044b33fd6f194822abff07f7`
- **Base:** `main` `7aaa13ce4ceac60e9b54be3f8edf6f4320d70629`
- **mergeable / mergeable_state:** True / clean

Laut PR-Body: Reiner `git revert --no-edit` von #316 (`2911cfcf8c0775f0454dfcc308583cecbc1203e4`, Parent `6d9f08f3fbcd9ff51f7113db8bc2c155062484a5`) auf main `7aaa13ce`. Kein neuer Code, keine manuellen Edits. Der Body verweist auf Philip, 19.11.2026 11:42 (der später um 11:56 durch [[Regeln/Restore v2]] präzisiert wurde). Ziel: die 5-%-Branchenanzeige in Sektion 9 („Revenue Growth vs. Branche“ in `Section7.tsx`) wiederherstellen, die auf main bei fehlendem `tamCAGR` `n/a` zeigt.

#316 selbst ist gemergt am 2026-11-18 19:38 Europe/Madrid: [fix(tam): n/a statt 'Global Market 5 %' ohne Sektor/Branche (SAP.DE/VOW3.DE, Folge #292)](https://github.com/1719842374/Aktienanalyst/pull/316).

Zum Zeitpunkt des API-Abrufs ist #515 **weiterhin offen und Draft**, also noch nicht auf main.

### [PR #492](https://github.com/1719842374/Aktienanalyst/pull/492) — Bereich für fehlende Segmente und Regionen

- **Titel:** Add: Bereich für fehlende Segmente und Regionen
- **Zustand:** open, Draft: True, gemergt: False (merged_at: nein)
- **Erstellt:** 2026-11-11 19:01 Europe/Madrid
- **Aktualisiert:** 2026-11-19 12:58 Europe/Madrid
- **Head:** `cursor/missing-segments-1bac` `a71e480d34afe21d43300d7361eacea5cbd2b151`
- **Base:** `main` `7aaa13ce4ceac60e9b54be3f8edf6f4320d70629`
- **mergeable / mergeable_state:** True / clean

Laut PR-Body (Stand 19.11.2026 im Body-Text): bleibt Draft, nicht gemergt; `WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md` bleibt offen. Head im Body-Text damals `a69872b7…`; die API liefert als aktuellen Head-SHA `a71e480d34afe21d43300d7361eacea5cbd2b151`.

Zum Zeitpunkt des API-Abrufs ist #492 **weiterhin offen und Draft**.

## Offene PRs

99 offene PRs über `GET /repos/1719842374/Aktienanalyst/pulls?state=open&per_page=100` (eine Seite, 99 Ergebnisse; eine Link-Header-Folgeseite war nicht nötig). Davon **93 Drafts** und **6 nicht-Draft**.

Nicht-Draft zum Abrufzeitpunkt:

| Nummer | Titel | Link | Aktualisiert |
| --- | --- | --- | --- |
| [#467](https://github.com/1719842374/Aktienanalyst/pull/467) | KI-Chat S13: vorhandene Porter-Begründungen durchreichen | https://github.com/1719842374/Aktienanalyst/pull/467 | 2026-11-08 23:45 Europe/Madrid |
| [#466](https://github.com/1719842374/Aktienanalyst/pull/466) | Hype-Cycle: FMP-Proxy aus PR 390 auf main, mit Coverage und Stichtag | https://github.com/1719842374/Aktienanalyst/pull/466 | 2026-11-08 23:26 Europe/Madrid |
| [#464](https://github.com/1719842374/Aktienanalyst/pull/464) | Podcast: Browser-Stimme, Besitz der Stimme und Ansichts-Lauf | https://github.com/1719842374/Aktienanalyst/pull/464 | 2026-11-09 00:08 Europe/Madrid |
| [#463](https://github.com/1719842374/Aktienanalyst/pull/463) | Screener: Custom Criteria nur auf geladenen Kandidaten | https://github.com/1719842374/Aktienanalyst/pull/463 | 2026-11-09 00:31 Europe/Madrid |
| [#461](https://github.com/1719842374/Aktienanalyst/pull/461) | fix(trends): Last-Good bei pytrends rate_limited behalten | https://github.com/1719842374/Aktienanalyst/pull/461 | 2026-11-08 23:58 Europe/Madrid |
| [#448](https://github.com/1719842374/Aktienanalyst/pull/448) | Ampel: Kurs über MA50 nach Death Cross wird gelb | https://github.com/1719842374/Aktienanalyst/pull/448 | 2026-11-03 23:35 Europe/Madrid |

Vollständige offene Liste (Draft-Spalte laut API):

| Nummer | Draft | Titel | Link |
| --- | --- | --- | --- |
| [#520](https://github.com/1719842374/Aktienanalyst/pull/520) | ja | Revert: main auf Stand vor 17.11.2026 (4220d4e9) | https://github.com/1719842374/Aktienanalyst/pull/520 |
| [#517](https://github.com/1719842374/Aktienanalyst/pull/517) | ja | docs: Read-only Review PR 492 Segment-Lücken (nicht mergen) | https://github.com/1719842374/Aktienanalyst/pull/517 |
| [#516](https://github.com/1719842374/Aktienanalyst/pull/516) | ja | docs: Read-only-Review von PR 515 (Revert #316) | https://github.com/1719842374/Aktienanalyst/pull/516 |
| [#515](https://github.com/1719842374/Aktienanalyst/pull/515) | ja | Revert #316: 5-%-Branchenanzeige in Sektion 9 wiederherstellen | https://github.com/1719842374/Aktienanalyst/pull/515 |
| [#514](https://github.com/1719842374/Aktienanalyst/pull/514) | ja | fix(s9): Peer-Median statt n/a, wenn tamCAGR fehlt | https://github.com/1719842374/Aktienanalyst/pull/514 |
| [#512](https://github.com/1719842374/Aktienanalyst/pull/512) | ja | Draft: DCF-Bilanz-Kalibrierung hinter Flag (kein Merge) | https://github.com/1719842374/Aktienanalyst/pull/512 |
| [#498](https://github.com/1719842374/Aktienanalyst/pull/498) | ja | docs: BTC cycle anticipation and market-structure scoring spec | https://github.com/1719842374/Aktienanalyst/pull/498 |
| [#497](https://github.com/1719842374/Aktienanalyst/pull/497) | ja | S12-Kegel: Ziele auf H, Bear-Produkt, Drift auf 0 (nur Anzeige) | https://github.com/1719842374/Aktienanalyst/pull/497 |
| [#496](https://github.com/1719842374/Aktienanalyst/pull/496) | ja | DOCS READ-ONLY – nicht mergen ohne Philip | https://github.com/1719842374/Aktienanalyst/pull/496 |
| [#495](https://github.com/1719842374/Aktienanalyst/pull/495) | ja | Earnings-Ampel Stufe 2 – HOLD bis Philip | https://github.com/1719842374/Aktienanalyst/pull/495 |
| [#492](https://github.com/1719842374/Aktienanalyst/pull/492) | ja | Add: Bereich für fehlende Segmente und Regionen | https://github.com/1719842374/Aktienanalyst/pull/492 |
| [#491](https://github.com/1719842374/Aktienanalyst/pull/491) | ja | Fix: KI-Badge, Bestätigen und Regionen-Button lösen einen Request aus | https://github.com/1719842374/Aktienanalyst/pull/491 |
| [#488](https://github.com/1719842374/Aktienanalyst/pull/488) | ja | Earnings-Ampel Stufe 2 – HOLD bis Philip | https://github.com/1719842374/Aktienanalyst/pull/488 |
| [#484](https://github.com/1719842374/Aktienanalyst/pull/484) | ja | Earnings-Ampel: zwei Lampen und Quartalstabelle (Schwellen zur Bestätigung) | https://github.com/1719842374/Aktienanalyst/pull/484 |
| [#480](https://github.com/1719842374/Aktienanalyst/pull/480) | ja | fix(section3): RSL n/a statt Absturz bei zu kurzer Historie | https://github.com/1719842374/Aktienanalyst/pull/480 |
| [#478](https://github.com/1719842374/Aktienanalyst/pull/478) | ja | Kurslinie nach Vier-Bedingungen-Signal (keine Spec, Philip-Entscheid offen) | https://github.com/1719842374/Aktienanalyst/pull/478 |
| [#477](https://github.com/1719842374/Aktienanalyst/pull/477) | ja | fix(gold): AISC-Stufe erst ab Quellen-Datum, Perzentil über Quartale | https://github.com/1719842374/Aktienanalyst/pull/477 |
| [#476](https://github.com/1719842374/Aktienanalyst/pull/476) | ja | docs: Audit der offenen Specs gegen main ed1e98cd | https://github.com/1719842374/Aktienanalyst/pull/476 |
| [#475](https://github.com/1719842374/Aktienanalyst/pull/475) | ja | Label: Lage an die Ampel, DCF-Satz an valuationBaseLabel, Teilscores A–E, vier Technik-Flags | https://github.com/1719842374/Aktienanalyst/pull/475 |
| [#474](https://github.com/1719842374/Aktienanalyst/pull/474) | ja | K-04: FX-Fehler liefert Cache-Kurs oder null statt Kurs 1 | https://github.com/1719842374/Aktienanalyst/pull/474 |
| [#473](https://github.com/1719842374/Aktienanalyst/pull/473) | ja | fix(s8): Risiko-Refresh nutzt API_BASE (K-48) | https://github.com/1719842374/Aktienanalyst/pull/473 |
| [#470](https://github.com/1719842374/Aktienanalyst/pull/470) | ja | feat(recession): Asien-Katalog aus Japan und China (BIP, ASHR) | https://github.com/1719842374/Aktienanalyst/pull/470 |
| [#467](https://github.com/1719842374/Aktienanalyst/pull/467) | nein | KI-Chat S13: vorhandene Porter-Begründungen durchreichen | https://github.com/1719842374/Aktienanalyst/pull/467 |
| [#466](https://github.com/1719842374/Aktienanalyst/pull/466) | nein | Hype-Cycle: FMP-Proxy aus PR 390 auf main, mit Coverage und Stichtag | https://github.com/1719842374/Aktienanalyst/pull/466 |
| [#464](https://github.com/1719842374/Aktienanalyst/pull/464) | nein | Podcast: Browser-Stimme, Besitz der Stimme und Ansichts-Lauf | https://github.com/1719842374/Aktienanalyst/pull/464 |
| [#463](https://github.com/1719842374/Aktienanalyst/pull/463) | nein | Screener: Custom Criteria nur auf geladenen Kandidaten | https://github.com/1719842374/Aktienanalyst/pull/463 |
| [#461](https://github.com/1719842374/Aktienanalyst/pull/461) | nein | fix(trends): Last-Good bei pytrends rate_limited behalten | https://github.com/1719842374/Aktienanalyst/pull/461 |
| [#448](https://github.com/1719842374/Aktienanalyst/pull/448) | nein | Ampel: Kurs über MA50 nach Death Cross wird gelb | https://github.com/1719842374/Aktienanalyst/pull/448 |
| [#439](https://github.com/1719842374/Aktienanalyst/pull/439) | ja | fix(researcher): Stocks · US mit Einheit und deutschem Zahlenformat | https://github.com/1719842374/Aktienanalyst/pull/439 |
| [#435](https://github.com/1719842374/Aktienanalyst/pull/435) | ja | Podcast-Player: Section 2 (Earnings Call + KI-Analyse) und hörbarer Researcher-Podcast, Server-Stimme Piper mit Web-Speech-Fallback | https://github.com/1719842374/Aktienanalyst/pull/435 |
| [#434](https://github.com/1719842374/Aktienanalyst/pull/434) | ja | fix(chart): Quartals-Fallback annualisieren, DCF-FX zurück auf main | https://github.com/1719842374/Aktienanalyst/pull/434 |
| [#432](https://github.com/1719842374/Aktienanalyst/pull/432) | ja | fix(recession): Eurostat EA21, t = Tage bis FY-Ende + 182 | https://github.com/1719842374/Aktienanalyst/pull/432 |
| [#431](https://github.com/1719842374/Aktienanalyst/pull/431) | ja | fix(tam): SAP.DE-Schätzung nur mit Beleg | https://github.com/1719842374/Aktienanalyst/pull/431 |
| [#430](https://github.com/1719842374/Aktienanalyst/pull/430) | ja | KI-Chat: GuV-Posten aus SEC EDGAR, letzter Earnings Call mit SEC-Fallback, Chat-Modell Claude Haiku 4.5 | https://github.com/1719842374/Aktienanalyst/pull/430 |
| [#425](https://github.com/1719842374/Aktienanalyst/pull/425) | ja | F2-09: SPY-KGV aus Holdings summieren | https://github.com/1719842374/Aktienanalyst/pull/425 |
| [#422](https://github.com/1719842374/Aktienanalyst/pull/422) | ja | feat(recession): Buffett-Regression BA-01–06 und BA-08, Score zur Freigabe | https://github.com/1719842374/Aktienanalyst/pull/422 |
| [#420](https://github.com/1719842374/Aktienanalyst/pull/420) | ja | fix(peers): KI-Vorschläge in derselben Tabelle, Score unverändert | https://github.com/1719842374/Aktienanalyst/pull/420 |
| [#416](https://github.com/1719842374/Aktienanalyst/pull/416) | ja | Gold: AISC-Pane und Miner-Zone auf BTC-Parität | https://github.com/1719842374/Aktienanalyst/pull/416 |
| [#413](https://github.com/1719842374/Aktienanalyst/pull/413) | ja | feat(recession): Asien-Katalog aus Japan und China (ASHR) | https://github.com/1719842374/Aktienanalyst/pull/413 |
| [#396](https://github.com/1719842374/Aktienanalyst/pull/396) | ja | TA: Margin-Debt-Ratio als Stufen-Overlay (bestehende FINRA-Route) | https://github.com/1719842374/Aktienanalyst/pull/396 |
| [#395](https://github.com/1719842374/Aktienanalyst/pull/395) | ja | feat(dividend): adaptive Schwelle aus Historie und Peer-Median (S6/S20) | https://github.com/1719842374/Aktienanalyst/pull/395 |
| [#394](https://github.com/1719842374/Aktienanalyst/pull/394) | ja | Statements: Jahrestabelle, Sankey und markierte Segment-Schätzung | https://github.com/1719842374/Aktienanalyst/pull/394 |
| [#392](https://github.com/1719842374/Aktienanalyst/pull/392) | ja | Screener: eigene Kriterien, fehlende Felder bleiben n/a | https://github.com/1719842374/Aktienanalyst/pull/392 |
| [#390](https://github.com/1719842374/Aktienanalyst/pull/390) | ja | Hype-Cycle: FMP-Proxy ohne Trends | https://github.com/1719842374/Aktienanalyst/pull/390 |
| [#385](https://github.com/1719842374/Aktienanalyst/pull/385) | ja | feat(f1-52): fünf regionale Untergruppen, Tabelle folgt der Region | https://github.com/1719842374/Aktienanalyst/pull/385 |
| [#383](https://github.com/1719842374/Aktienanalyst/pull/383) | ja | feat(recession): adaptive Makro-Gewichte als Zusatzobjekt (F9-09/12/13/16/17) | https://github.com/1719842374/Aktienanalyst/pull/383 |
| [#382](https://github.com/1719842374/Aktienanalyst/pull/382) | ja | Anzeige: Gewinnwachstum, Growth Gap und Realzins auf #/recession | https://github.com/1719842374/Aktienanalyst/pull/382 |
| [#381](https://github.com/1719842374/Aktienanalyst/pull/381) | ja | Anzeige-Lücken aus den Work-Specs Oktober 2026, Score unangetastet | https://github.com/1719842374/Aktienanalyst/pull/381 |
| [#379](https://github.com/1719842374/Aktienanalyst/pull/379) | ja | feat(gold): Angebotsreaktion, MA-Backtest, Zentralbanken — GIS und QE/QT nur n/a | https://github.com/1719842374/Aktienanalyst/pull/379 |
| [#378](https://github.com/1719842374/Aktienanalyst/pull/378) | ja | feat(f1-36): φ-bereinigten Buffett nur im Rezessions-Panel zeigen | https://github.com/1719842374/Aktienanalyst/pull/378 |
| [#377](https://github.com/1719842374/Aktienanalyst/pull/377) | ja | feat(recession): Asien-Katalog aus Japan und China (ASHR) | https://github.com/1719842374/Aktienanalyst/pull/377 |
| [#375](https://github.com/1719842374/Aktienanalyst/pull/375) | ja | feat(recession): adaptive Schwellen als Zusatzobjekt, Score unverändert | https://github.com/1719842374/Aktienanalyst/pull/375 |
| [#372](https://github.com/1719842374/Aktienanalyst/pull/372) | ja | feat(gold): AISC, Volumen-Trend, Bollinger, ATR und Fiskal nur in der Zusatzschicht | https://github.com/1719842374/Aktienanalyst/pull/372 |
| [#371](https://github.com/1719842374/Aktienanalyst/pull/371) | ja | Trends: 429-Backoff und n/a-Grund, Score unverändert | https://github.com/1719842374/Aktienanalyst/pull/371 |
| [#370](https://github.com/1719842374/Aktienanalyst/pull/370) | ja | FW-17: Gold/Bond-Verhältnis (GC=F / TLT, nur Anzeige) | https://github.com/1719842374/Aktienanalyst/pull/370 |
| [#367](https://github.com/1719842374/Aktienanalyst/pull/367) | ja | FW-12: Hash-Ribbon und Miner-Zone getrennt benennen | https://github.com/1719842374/Aktienanalyst/pull/367 |
| [#366](https://github.com/1719842374/Aktienanalyst/pull/366) | ja | feat(scoring): Score-Ergänzungen hinter Flag scoringAdditions (Default aus) | https://github.com/1719842374/Aktienanalyst/pull/366 |
| [#365](https://github.com/1719842374/Aktienanalyst/pull/365) | ja | FW-31: Sektorrotation im Rezessions-Dashboard (nur Anzeige) | https://github.com/1719842374/Aktienanalyst/pull/365 |
| [#353](https://github.com/1719842374/Aktienanalyst/pull/353) | ja | fix(peers): Duplikat ohne Request, nur den neuen Peer nachladen | https://github.com/1719842374/Aktienanalyst/pull/353 |
| [#318](https://github.com/1719842374/Aktienanalyst/pull/318) | ja | Kosmetik: doppeltes „Formel:“ + peerOverrides-Platzhalter | https://github.com/1719842374/Aktienanalyst/pull/318 |
| [#315](https://github.com/1719842374/Aktienanalyst/pull/315) | ja | FW-04 Kostolany-Ei im Researcher (Schwellen als Vorschlag) | https://github.com/1719842374/Aktienanalyst/pull/315 |
| [#314](https://github.com/1719842374/Aktienanalyst/pull/314) | ja | FW-16: GDX/GLD-Verhältnis auf /gold (nur Anzeige) | https://github.com/1719842374/Aktienanalyst/pull/314 |
| [#313](https://github.com/1719842374/Aktienanalyst/pull/313) | ja | feat(gold): F10-20 AISC-Marge + F10-24 Fiskaldefizit als Zusatzschicht (nur Anzeige) | https://github.com/1719842374/Aktienanalyst/pull/313 |
| [#311](https://github.com/1719842374/Aktienanalyst/pull/311) | ja | FW-38: Autocomplete am Peer-Eingabefeld | https://github.com/1719842374/Aktienanalyst/pull/311 |
| [#310](https://github.com/1719842374/Aktienanalyst/pull/310) | ja | F1-24: PESTEL Economic – Kreditrisiko-Zeile (FRED BAA10Y, nur Anzeige) | https://github.com/1719842374/Aktienanalyst/pull/310 |
| [#309](https://github.com/1719842374/Aktienanalyst/pull/309) | ja | F10-34 Zentralbank-Goldkäufe (Anzeige) | https://github.com/1719842374/Aktienanalyst/pull/309 |
| [#307](https://github.com/1719842374/Aktienanalyst/pull/307) | ja | F10-33: Backtest der MA-Kreuz-Signale auf Gold (Modul + Skript, nicht gemountet) | https://github.com/1719842374/Aktienanalyst/pull/307 |
| [#306](https://github.com/1719842374/Aktienanalyst/pull/306) | ja | docs: Future_5/6/10 an Code 73eff97e angleichen (F5-06, F6-01, F6-07, F10-35) – nur Ergänzungen | https://github.com/1719842374/Aktienanalyst/pull/306 |
| [#305](https://github.com/1719842374/Aktienanalyst/pull/305) | ja | FW-09 BTC Fiskal-Overlay (Anzeige) | https://github.com/1719842374/Aktienanalyst/pull/305 |
| [#304](https://github.com/1719842374/Aktienanalyst/pull/304) | ja | FW-36: Regulatory-Risiken in Sektion 10 Risikoinversion (nur Anzeige, kein Score) | https://github.com/1719842374/Aktienanalyst/pull/304 |
| [#303](https://github.com/1719842374/Aktienanalyst/pull/303) | ja | F1-26: Verschuldung/Refinanzierung in Sektion 5 (nur Anzeige) | https://github.com/1719842374/Aktienanalyst/pull/303 |
| [#302](https://github.com/1719842374/Aktienanalyst/pull/302) | ja | FW-14: QE/QT-Regime-Bänder im BTC-Technik-Chart (nur Anzeige, kein Gate/Score) | https://github.com/1719842374/Aktienanalyst/pull/302 |
| [#301](https://github.com/1719842374/Aktienanalyst/pull/301) | ja | F1-52/F1-47: five subgroup gauges for Europa/Asien (display only) | https://github.com/1719842374/Aktienanalyst/pull/301 |
| [#300](https://github.com/1719842374/Aktienanalyst/pull/300) | ja | F10 Gold-Chart: Volumen, Bollinger, ATR (Anzeige) | https://github.com/1719842374/Aktienanalyst/pull/300 |
| [#299](https://github.com/1719842374/Aktienanalyst/pull/299) | ja | feat(dividend): F1-14/17/18 Dividendenrendite S6/S20 + 4%-Band (nur Anzeige) | https://github.com/1719842374/Aktienanalyst/pull/299 |
| [#298](https://github.com/1719842374/Aktienanalyst/pull/298) | ja | F3-04: Google Trends Retry mit begrenztem Backoff (Draft) | https://github.com/1719842374/Aktienanalyst/pull/298 |
| [#297](https://github.com/1719842374/Aktienanalyst/pull/297) | ja | docs: Soll-Ist-Nachzug auf 73eff97e (Status je Punkt mit offenen PRs, nur Ergänzungen) | https://github.com/1719842374/Aktienanalyst/pull/297 |
| [#273](https://github.com/1719842374/Aktienanalyst/pull/273) | ja | F9-07/10/11: Konzentration, Managing, Widerspruchs-Score (Draft, stacked auf #269) | https://github.com/1719842374/Aktienanalyst/pull/273 |
| [#270](https://github.com/1719842374/Aktienanalyst/pull/270) | ja | feat(s10): Kreditrisiko-Karte in Risikoinversion – FRED BAA10Y + FMP D/E & Zinsdeckung (nur Anzeige, kein Score) | https://github.com/1719842374/Aktienanalyst/pull/270 |
| [#269](https://github.com/1719842374/Aktienanalyst/pull/269) | ja | F9 Makro-Ebene (Future_9) – Zusatzobjekt, kein Score-Einfluss | https://github.com/1719842374/Aktienanalyst/pull/269 |
| [#220](https://github.com/1719842374/Aktienanalyst/pull/220) | ja | feat(recession): Buffett-20J-Perzentil als Zusatzzeile + Lesehinweis Sektion 4, kein Score (Mini-PR 10b) | https://github.com/1719842374/Aktienanalyst/pull/220 |
| [#219](https://github.com/1719842374/Aktienanalyst/pull/219) | ja | feat(recession): CAPE-20J-Perzentil als Zusatzzeile, kein Score (Future_7/8, Mini-PR 10 erster Schritt) | https://github.com/1719842374/Aktienanalyst/pull/219 |
| [#164](https://github.com/1719842374/Aktienanalyst/pull/164) | ja | fix(recession): Vier-Märkte PE from NPORT constituents | https://github.com/1719842374/Aktienanalyst/pull/164 |
| [#160](https://github.com/1719842374/Aktienanalyst/pull/160) | ja | docs: Ampel-Nachzug Value-Chain Ränge 7–9 Live PASS (#159) | https://github.com/1719842374/Aktienanalyst/pull/160 |
| [#157](https://github.com/1719842374/Aktienanalyst/pull/157) | ja | docs: official open/fertig lists in WORK.md | https://github.com/1719842374/Aktienanalyst/pull/157 |
| [#143](https://github.com/1719842374/Aktienanalyst/pull/143) | ja | feat(recession): four-market vol charts, click factpack, FINRA strip | https://github.com/1719842374/Aktienanalyst/pull/143 |
| [#141](https://github.com/1719842374/Aktienanalyst/pull/141) | ja | feat(peers): cached 2-hop competitor set | https://github.com/1719842374/Aktienanalyst/pull/141 |
| [#137](https://github.com/1719842374/Aktienanalyst/pull/137) | ja | feat(portfolio): Soll vs. Ist — Active Weight und Trade-Notional | https://github.com/1719842374/Aktienanalyst/pull/137 |
| [#135](https://github.com/1719842374/Aktienanalyst/pull/135) | ja | docs: Ampel-Nachzug tip b8feab3 (#134 Peer-Set, #128 Miner-Zone) | https://github.com/1719842374/Aktienanalyst/pull/135 |
| [#133](https://github.com/1719842374/Aktienanalyst/pull/133) | ja | docs: Ampel-Nachzug tip 6fedbf4e (#128 Miner-Zone 13) | https://github.com/1719842374/Aktienanalyst/pull/133 |
| [#132](https://github.com/1719842374/Aktienanalyst/pull/132) | ja | Hide BTC signal dots on the mobile price chart | https://github.com/1719842374/Aktienanalyst/pull/132 |
| [#127](https://github.com/1719842374/Aktienanalyst/pull/127) | ja | docs: Ampel-Nachzug tip 556c8f02 (#126 grün) | https://github.com/1719842374/Aktienanalyst/pull/127 |
| [#120](https://github.com/1719842374/Aktienanalyst/pull/120) | ja | feat(btc): section 14 direction arrows from document effect | https://github.com/1719842374/Aktienanalyst/pull/120 |
| [#110](https://github.com/1719842374/Aktienanalyst/pull/110) | ja | fix(ta): moving averages inside the existing chart | https://github.com/1719842374/Aktienanalyst/pull/110 |
| [#109](https://github.com/1719842374/Aktienanalyst/pull/109) | ja | fix(ta): start MA200 at the left edge of the 10Y chart | https://github.com/1719842374/Aktienanalyst/pull/109 |
| [#108](https://github.com/1719842374/Aktienanalyst/pull/108) | ja | fix(ta): plot moving averages across every chart window | https://github.com/1719842374/Aktienanalyst/pull/108 |
| [#107](https://github.com/1719842374/Aktienanalyst/pull/107) | ja | fix(ta): Aktien-TA — alle MAs auf voller Kurshistorie (1Y–10Y, Fenster A/B/C) + MA200W | https://github.com/1719842374/Aktienanalyst/pull/107 |
| [#106](https://github.com/1719842374/Aktienanalyst/pull/106) | ja | Docs Ampel Nachzug tip 1984ae2b (#102 Mobile TA Skalierung) | https://github.com/1719842374/Aktienanalyst/pull/106 |
| [#105](https://github.com/1719842374/Aktienanalyst/pull/105) | ja | fix(btc-miner): configurable mempool API base for Render egress | https://github.com/1719842374/Aktienanalyst/pull/105 |

## Zuletzt gemergte PRs (20)

Quelle: `GET /repos/…/pulls?state=closed&per_page=40&sort=updated&direction=desc`, Einträge mit `merged_at`, die 20 neuesten.

| Nummer | Gemergt | Titel | Link |
| --- | --- | --- | --- |
| [#513](https://github.com/1719842374/Aktienanalyst/pull/513) | 2026-11-19 10:02 Europe/Madrid | Docs: Ampel c4975703 + Prod-Smoke #505–#511 + Briefing-Regional-Befund | https://github.com/1719842374/Aktienanalyst/pull/513 |
| [#511](https://github.com/1719842374/Aktienanalyst/pull/511) | 2026-11-18 23:12 Europe/Madrid | fix(ta): Earnings Yield von Nicht-USD-EPS gegen den USD-Kurs | https://github.com/1719842374/Aktienanalyst/pull/511 |
| [#507](https://github.com/1719842374/Aktienanalyst/pull/507) | 2026-11-18 22:44 Europe/Madrid | fix(segmente): KI-YoY für kuratierte Segmente ohne Wachstum | https://github.com/1719842374/Aktienanalyst/pull/507 |
| [#506](https://github.com/1719842374/Aktienanalyst/pull/506) | 2026-11-18 22:15 Europe/Madrid | Anzeige: Cross erst nach 3 Handelstagen und Freeze positiv | https://github.com/1719842374/Aktienanalyst/pull/506 |
| [#510](https://github.com/1719842374/Aktienanalyst/pull/510) | 2026-11-18 22:08 Europe/Madrid | docs: .DE/Yahoo-Fundamentals-Zeilen entfernen (Philip 18.11. 22:00) | https://github.com/1719842374/Aktienanalyst/pull/510 |
| [#505](https://github.com/1719842374/Aktienanalyst/pull/505) | 2026-11-18 21:48 Europe/Madrid | fix(fx): Abschlüsse, Segmente und Jahresreihe in USD | https://github.com/1719842374/Aktienanalyst/pull/505 |
| [#509](https://github.com/1719842374/Aktienanalyst/pull/509) | 2026-11-18 21:43 Europe/Madrid | docs: Ampel #468 🟢 Prod-Smoke PASS (806772f2) | https://github.com/1719842374/Aktienanalyst/pull/509 |
| [#508](https://github.com/1719842374/Aktienanalyst/pull/508) | 2026-11-18 21:37 Europe/Madrid | docs: Ampel #468 🟡 (806772f2), enger Tester-PASS | https://github.com/1719842374/Aktienanalyst/pull/508 |
| [#468](https://github.com/1719842374/Aktienanalyst/pull/468) | 2026-11-18 21:20 Europe/Madrid | fix(recession): Differenzen als Prozentpunkte anzeigen | https://github.com/1719842374/Aktienanalyst/pull/468 |
| [#504](https://github.com/1719842374/Aktienanalyst/pull/504) | 2026-11-18 20:43 Europe/Madrid | docs: Morning-Briefing-Ampel Header/Nav als erledigt (#503) | https://github.com/1719842374/Aktienanalyst/pull/504 |
| [#503](https://github.com/1719842374/Aktienanalyst/pull/503) | 2026-11-18 20:19 Europe/Madrid | Briefing-Modal: Kopf wie Country Macro Pulse | https://github.com/1719842374/Aktienanalyst/pull/503 |
| [#316](https://github.com/1719842374/Aktienanalyst/pull/316) | 2026-11-18 19:38 Europe/Madrid | fix(tam): n/a statt 'Global Market 5 %' ohne Sektor/Branche (SAP.DE/VOW3.DE, Folge #292) | https://github.com/1719842374/Aktienanalyst/pull/316 |
| [#486](https://github.com/1719842374/Aktienanalyst/pull/486) | 2026-11-18 18:48 Europe/Madrid | Fix: KI-Schätzen für Segmente und Regionen schickt bekannte Fakten an OpenRouter | https://github.com/1719842374/Aktienanalyst/pull/486 |
| [#502](https://github.com/1719842374/Aktienanalyst/pull/502) | 2026-11-18 18:30 Europe/Madrid | fix(chart): Ampel-Badge bei Kegel aus aus dem Plot-Scroll | https://github.com/1719842374/Aktienanalyst/pull/502 |
| [#500](https://github.com/1719842374/Aktienanalyst/pull/500) | 2026-11-18 18:10 Europe/Madrid | fix(s15): KI-Katalysatoren beim Tickerwechsel verwerfen | https://github.com/1719842374/Aktienanalyst/pull/500 |
| [#501](https://github.com/1719842374/Aktienanalyst/pull/501) | 2026-11-18 17:51 Europe/Madrid | docs: Ampel #494 🟢 (58f6c237) + #489 (f6b88795) | https://github.com/1719842374/Aktienanalyst/pull/501 |
| [#489](https://github.com/1719842374/Aktienanalyst/pull/489) | 2026-11-18 17:37 Europe/Madrid | fix(chat): stale-write verwirft den lokalen Thread (Zwei-Tab) | https://github.com/1719842374/Aktienanalyst/pull/489 |
| [#494](https://github.com/1719842374/Aktienanalyst/pull/494) | 2026-11-18 17:29 Europe/Madrid | fix(s15): Katalysator-Enrich lädt die Analyse bei Cache-404 einmal neu | https://github.com/1719842374/Aktienanalyst/pull/494 |
| [#462](https://github.com/1719842374/Aktienanalyst/pull/462) | 2026-11-18 17:04 Europe/Madrid | fix(peers): KI-Vorschläge in derselben Tabelle, nur Anzeige | https://github.com/1719842374/Aktienanalyst/pull/462 |
| [#493](https://github.com/1719842374/Aktienanalyst/pull/493) | 2026-11-18 16:44 Europe/Madrid | S12: Ampel-Badge bei Kegel in die Toolbar | https://github.com/1719842374/Aktienanalyst/pull/493 |


## Spec-Dateien im Repo-Root

Gefunden über `GET /repos/…/git/trees/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629` (nicht rekursiv, nur Root-Blobs). Status hier **nur aus dem Dateinamen-Prefix**, ohne den Dateiinhalt zu bewerten. `WORK_*` / `WORK.md` ohne `Fertig_`/`fertig_`/`Offen_`-Prefix gelten damit nicht automatisch als offen oder fertig.

Zählung auf main `7aaa13ce`: **50 fertig**, **6 offen**, **42 ohne Prefix**, zusammen **98** Spec-Dateien.

| Datei | Status laut Prefix |
| --- | --- |
| [Fertig_MINER_INTEGRATION.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/Fertig_MINER_INTEGRATION.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [Fertig_WORK_BITCOIN_MINER_MAP.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/Fertig_WORK_BITCOIN_MINER_MAP.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [Fertig_WORK_RECESSION_SOURCES.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/Fertig_WORK_RECESSION_SOURCES.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [Fertig_WORK_SECTION4_DATA_BUGS.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/Fertig_WORK_SECTION4_DATA_BUGS.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [Offen_FUTURE_SOLL_IST.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/Offen_FUTURE_SOLL_IST.md) | offen (Prefix `Offen_`) |
| [Offen_FUTURE_SOLL_IST_DETAIL.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/Offen_FUTURE_SOLL_IST_DETAIL.md) | offen (Prefix `Offen_`) |
| [Offen_WORK_BUFFETT_ASIA_10Y.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/Offen_WORK_BUFFETT_ASIA_10Y.md) | offen (Prefix `Offen_`) |
| [Offen_WORK_CAPEX_SECTOR_MAP.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/Offen_WORK_CAPEX_SECTOR_MAP.md) | offen (Prefix `Offen_`) |
| [Offen_WORK_GOLD_MINER_BREAKEVEN.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/Offen_WORK_GOLD_MINER_BREAKEVEN.md) | offen (Prefix `Offen_`) |
| [Offen_WORK_RESEARCHER_CAPEX_MAP.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/Offen_WORK_RESEARCHER_CAPEX_MAP.md) | offen (Prefix `Offen_`) |
| [WORK.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_BUFFETT_ADAPTIVE_SOLUTION.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_BUFFETT_ADAPTIVE_SOLUTION.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_BUFFETT_ADJUST_IMPL.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_BUFFETT_ADJUST_IMPL.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_BUFFETT_OVERLAYS.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_BUFFETT_OVERLAYS.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_BUFFETT_WEIGHT_DISTORTION.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_BUFFETT_WEIGHT_DISTORTION.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_CHAT_PODCAST_MCP.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_CHAT_PODCAST_MCP.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_CHAT_UPLOAD_CONNECTOR.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_CHAT_UPLOAD_CONNECTOR.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_DASHBOARD_FEATURES_2026-10.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_DASHBOARD_FEATURES_2026-10.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_EARNINGS_YIELD_ROIC_IMPLEMENTATION.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_EARNINGS_YIELD_ROIC_IMPLEMENTATION.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_EARNINGS_YIELD_ROIC_PLOT.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_EARNINGS_YIELD_ROIC_PLOT.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_GURUFOCUS_METRICS_ASSESSMENT.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_GURUFOCUS_METRICS_ASSESSMENT.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_HYBRID_CLASSIFICATION.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_HYBRID_CLASSIFICATION.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_HYBRID_XPENG.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_HYBRID_XPENG.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_HYPECYCLE_EMAIL_SUPABASE.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_HYPECYCLE_EMAIL_SUPABASE.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_IMPLEMENTIERUNG_OFFEN.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_IMPLEMENTIERUNG_OFFEN.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_IST_VS_SOLL.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_IST_VS_SOLL.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_KI_CHAT_BIG_PICTURE.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_KI_CHAT_BIG_PICTURE.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_KI_CHAT_ERROR.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_KI_CHAT_ERROR.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_KI_CHAT_LIMIT_ALL.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_KI_CHAT_LIMIT_ALL.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_KI_CHAT_SCHEMA.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_KI_CHAT_SCHEMA.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_KI_CHAT_SCHEMA_UPDATE.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_KI_CHAT_SCHEMA_UPDATE.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_KOMBINATIONSKURS_AMPEL.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_KOMBINATIONSKURS_AMPEL.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_KOSTENUEBERSICHT.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_KOSTENUEBERSICHT.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_MORNING_BRIEFING.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_MORNING_BRIEFING.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_NVO_TECHNICAL_OVERRIDE.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_NVO_TECHNICAL_OVERRIDE.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_PEER_RELATIVE_VALUATION_BUGS.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_PEER_RELATIVE_VALUATION_BUGS.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_PEER_SELECTION.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_PEER_SELECTION.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_PEER_SELECTION_DETAILED.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_PEER_SELECTION_DETAILED.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_PODCAST_PIPELINE.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_PODCAST_PIPELINE.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_PODCAST_PROMPT.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_PODCAST_PROMPT.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_REALZINS_ADJUST.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_REALZINS_ADJUST.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_RECESSION_EARNINGS_GROWTH_PLOT.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_RECESSION_EARNINGS_GROWTH_PLOT.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_RECESSION_GROWTH_GAP.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_RECESSION_GROWTH_GAP.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_RECESSION_TA_CHART.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_RECESSION_TA_CHART.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_REMOVE_BUFFETT_STOCK.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_REMOVE_BUFFETT_STOCK.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_SCENARIO_CONE_STOCK.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_SCENARIO_CONE_STOCK.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_SCORING_ADDITIONS_MSFT.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_SCORING_ADDITIONS_MSFT.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_SECTION_WEIGHTING_ADAPTIVE.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_SECTION_WEIGHTING_ADAPTIVE.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_SECTORAL_MOAT_DAMPING.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_SECTORAL_MOAT_DAMPING.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_SECTOR_PE_ATTRACTIVITY_REVERSEDCF.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_SECTOR_PE_ATTRACTIVITY_REVERSEDCF.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [WORK_SIMPLYWALLST_LEARNINGS.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/WORK_SIMPLYWALLST_LEARNINGS.md) | ohne `Fertig_`/`Offen_`-Prefix (Status nicht aus dem Dateinamen ableitbar) |
| [fertig_WORK.md_portfolio_3](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK.md_portfolio_3) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK2.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK2.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_ANALYZE_DISK_CACHE.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_ANALYZE_DISK_CACHE.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_ANTIBIAS_DCF.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_ANTIBIAS_DCF.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_BIAS_FIXES_INVERSE_DCF.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_BIAS_FIXES_INVERSE_DCF.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_BTC_MINER.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_BTC_MINER.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_DATA_PROVIDERS.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_DATA_PROVIDERS.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_EXEC_SUMMARY.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_EXEC_SUMMARY.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_NEWS_SENTIMENT.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_NEWS_SENTIMENT.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_PEER_ADAPTIVE.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_PEER_ADAPTIVE.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_PEER_PRICING_POWER.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_PEER_PRICING_POWER.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_PEER_ROIC_SANITY.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_PEER_ROIC_SANITY.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_PORTFOLIO.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_PORTFOLIO.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_PORTFOLIO_BACKTEST.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_PORTFOLIO_BACKTEST.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_PORTFOLIO_SOLL_IST.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_PORTFOLIO_SOLL_IST.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_RECESSION_2008_DRIVERS_LLM.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_RECESSION_2008_DRIVERS_LLM.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_RECESSION_FRED_SAHM.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_RECESSION_FRED_SAHM.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_RECESSION_MARKET_CHARTS.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_RECESSION_MARKET_CHARTS.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_RECESSION_RATE_OIL_BRIDGE.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_RECESSION_RATE_OIL_BRIDGE.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_RECESSION_RSI_MACD.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_RECESSION_RSI_MACD.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_RESEARCHER_BRIEFING_REGIONAL.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_RESEARCHER_BRIEFING_REGIONAL.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_RESEARCHER_BUTTONS_APPLY.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_RESEARCHER_BUTTONS_APPLY.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_RESEARCHER_LIQUIDITY_REGIME.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_RESEARCHER_LIQUIDITY_REGIME.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_RESEARCHER_PORTFOLIO.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_RESEARCHER_PORTFOLIO.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_RESEARCHER_PORTFOLIO_TEIL2.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_RESEARCHER_PORTFOLIO_TEIL2.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_RESEARCHER_SECTOR_ADD.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_RESEARCHER_SECTOR_ADD.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_REVERSE_DCF_BRIDGE.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_REVERSE_DCF_BRIDGE.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_SCORING_VORLAGE.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_SCORING_VORLAGE.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_SEGMENT_DEDUP.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_SEGMENT_DEDUP.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_SEKTORROTATIONS_RAT.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_SEKTORROTATIONS_RAT.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_SIGNAL_BACKTEST.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_SIGNAL_BACKTEST.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_STABLECOIN_TBILL_GENIUS.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_STABLECOIN_TBILL_GENIUS.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_TAM_RESIDUAL_XBOX.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_TAM_RESIDUAL_XBOX.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_TAM_SEGMENT_MAPPING.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_TAM_SEGMENT_MAPPING.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_TEIL0-6.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_TEIL0-6.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_TEIL7_SCORING.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_TEIL7_SCORING.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_THESIS_LAB.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_THESIS_LAB.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_VALUECHAIN_LAB_LOOKUP.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_VALUECHAIN_LAB_LOOKUP.md) | fertig (Prefix `Fertig_`/`fertig_`) |
| [fertig_WORK_VALUECHAIN_SECTOR_ROTATION.md](https://github.com/1719842374/Aktienanalyst/blob/7aaa13ce4ceac60e9b54be3f8edf6f4320d70629/fertig_WORK_VALUECHAIN_SECTOR_ROTATION.md) | fertig (Prefix `Fertig_`/`fertig_`) |

Diese Notiz nach Merges aktualisieren, nicht löschen. Siehe [[Pflege]].

## Nachtrag 2026-11-25 17:05 Europe/Madrid: #520 gemergt (GitHub-Lane)

- [PR #520](https://github.com/1719842374/Aktienanalyst/pull/520) „Revert: main auf Stand vor 17.11.2026 (4220d4e9)“ wurde um ca. 17:04 Europe/Madrid gesquasht. Der Squash lief mit SHA-Pin auf den Head `378ff2a4c5792b7780f50d17f07acf05daa7479d`, auf Philips Anweisung vom 19.11.2026 13:03.
- **Neue main-SHA:** [`65ba08dd5ea9faa00a6f8fdc8cc5277ba95c7e46`](https://github.com/1719842374/Aktienanalyst/commit/65ba08dd5ea9faa00a6f8fdc8cc5277ba95c7e46). Parent ist `7aaa13ce`.
- **Tree:** `868cc39c370447b62ba95aa4185cb8f6bfd1aa71`. Er ist identisch mit dem Tree von `4220d4e9`, die Diff zu `4220d4e9` ist leer. Ich habe das lokal per `git rev-parse` und `git diff` im Clone `/workspace/m493` (nur Box, für Cloud-Agenten nicht lesbar) geprüft.
- **Umfang gegen 7aaa13ce:** 72 Dateien, +440/−7849. Auf main gibt es 0 Konfliktmarker.
- **Gates:** DC Diff-GO Run 29 laut Stabschef. Vercel-Gate GO mit Preview-Deploy der Vercel-Lane. Tester-PASS 20/20, Bericht unter `/workspace/dod-520-378ff2a4/report.md` (nur Box, für Cloud-Agenten nicht lesbar). CI `currency-conversion` grün. Der frische merge-tree hatte rc0 und 0 CONFLICT.
- **Folgen:** Auf main steht wieder `tamCAGR ?? 5` in `Section7.tsx:40`. Laut Tester zeigen MSFT, AAPL, NVO und TSLA dort unbeschriftet +5.0 %. Die Ampel und die Prefix-Liste oben spiegeln noch den Stand `7aaa13ce`. Work.MD zieht die Ampel nach, `WORK_IMPLEMENTIERUNG_OFFEN.md` soll wieder auf den Stand von `4286b44f`.
- **Offen danach:** #492 hat einen Konflikt in `Section2.tsx` gegen den Revert-Stand und muss neu aufgesetzt werden. Der S9-Cursor-Agent setzt neu auf `65ba08dd` auf; den Fallback `?? 5` entfernt er dabei ausdrücklich. Beides wartet auf das Go von Stabschef. #515 wird erst nach dem neuen S9-PR geschlossen.

## Nachtrag 2026-11-25 17:10 Europe/Madrid: Ampel und Prefix-Liste auf 65ba08dd (Work.MD)

- **Ampel (Quelle `/home/box/agent-data/shared/Aktienanalyst-IMPLEMENTIERUNG.md` (nur Box, für Cloud-Agenten nicht lesbar), Eintrag `## 17:03` mit Nachträgen 17:04/17:08):** main `65ba08dd5ea9faa00a6f8fdc8cc5277ba95c7e46` · #520 🟢 gelandet (Revert, kein Feature-Ticket) · S9-Regression 🔴 (`tamCAGR ?? 5` in `Section7.tsx:40`, unbeschriftet +5.0 %) · #492 🟡 (Konflikt `Section2.tsx`, Rebase auf 65ba08dd + neues DC-Delta, Vercel, Tester) · #515 offen. DC Post-Merge KLAR, CI currency-conversion success (17:03). Kein WORK-Ticket neu abgeschlossen.
- **Prefix-Liste:** Root-`.md`-Dateinamen per `GET /repos/…/git/trees/{sha}` (nicht rekursiv) verglichen, `7aaa13ce` gegen `65ba08dd`: 120 = 120, **keine Umbenennung, kein Zu- oder Abgang**. Die Zählung oben (50 fertig, 6 offen, 42 ohne Prefix, 98 Spec-Dateien) gilt unverändert auch für `65ba08dd`; die Links oben zeigen weiter auf `7aaa13ce`.
- **Inhalt durch den Revert geändert (Blob-SHA 7aaa13ce → 65ba08dd), Prefix unverändert:** `Offen_FUTURE_SOLL_IST.md`, `Offen_FUTURE_SOLL_IST_DETAIL.md`, `WORK.md`, `WORK_CHAT_PODCAST_MCP.md`, `WORK_DASHBOARD_FEATURES_2026-10.md`, `WORK_EARNINGS_YIELD_ROIC_IMPLEMENTATION.md`, `WORK_EARNINGS_YIELD_ROIC_PLOT.md`, `WORK_IMPLEMENTIERUNG_OFFEN.md` (5cded8f6 → 67992963, Kopf wieder `4286b44f`), `WORK_IST_VS_SOLL.md`, `WORK_MORNING_BRIEFING.md`, `WORK_RECESSION_GROWTH_GAP.md`, `WORK_SIMPLYWALLST_LEARNINGS.md`. Diese Specs tragen wieder ihren Stand von `4220d4e9`; Doku-Nachträge #505–#513 werden nicht wiederhergestellt (Philips Revert).
- **Offen (Work.MD):** Kopf-Block in `WORK_IMPLEMENTIERUNG_OFFEN.md` auf `65ba08dd` per Docs-Draft-PR (Cursor-Agent der Work.MD-Lane, nur Additionen, kein Rückholen alter Ampeln).

- Nachtrag 2026-11-25 17:14 Europe/Madrid (Work.MD): Docs-Draft #521 (https://github.com/1719842374/Aktienanalyst/pull/521) Head 1f890f3f, Basis 65ba08dd, nur WORK_IMPLEMENTIERUNG_OFFEN.md +28/−0, nicht gemergt; #492 HOLD (Abhängigkeit #507), S9 Ersatz-Fix neu von 65ba08dd ohne Cherry-pick 19c1a88c.
- Nachtrag 2026-11-25 17:16 Europe/Madrid (Work.MD): DC Post-Merge #520 GO auf 65ba08dd (Pins VOW3/SAP/MSFT Δ 0, CI success, tsc 76); #512 CLEAN; S9-Cursor-Agent neu von 65ba08dd ohne Cherry-pick; #492 HOLD.

## Nachtrag 2026-11-25 GitHub-Lane: #521 gemergt

- [PR #521](https://github.com/1719842374/Aktienanalyst/pull/521) „docs(ampel): WORK_IMPLEMENTIERUNG_OFFEN.md Kopf auf 65ba08dd (Revert #520)“ wurde gesquasht. Der Squash lief mit SHA-Pin auf den Head `1f890f3f30742c4333f5c8559b771e7fa3cafce3`. Grundlage: DC Diff-GO auf genau `1f890f3f` und Stabschefs Vorab-Freigabe für den Squash direkt nach dem DC-GO.
- **Neue main-SHA:** [`5b476265ba9d71729a4e69a3f1385157b8e45ecb`](https://github.com/1719842374/Aktienanalyst/commit/5b476265ba9d71729a4e69a3f1385157b8e45ecb). Parent ist `65ba08dd`, der Tree ist `630b3122`. Er ist identisch mit dem Tree aus dem frischen merge-tree vor dem Squash (rc 0, 0 CONFLICT).
- **Umfang:** Nur `WORK_IMPLEMENTIERUNG_OFFEN.md` mit +28/−0 und 0 Konfliktmarkern. Reine Doku, es ist kein Tester nötig.
- **Offen:** DC Post-Merge auf `5b476265` und die Ampel durch Work.MD. #522 (S9 Branchen-Quelle, Head `3c0506de`) steht auf HOLD P1 wegen wörtlicher Übernahme aus `19c1a88c` ohne dessen Schutzregeln, Entscheidung bei Stabschef; danach braucht die neue UI Philips OK. #512 steht auf HOLD (Score/Entry/CRV ändern sich, wenn das Flag an ist). #492 steht auf HOLD.

## Nachtrag 2026-11-25 17:50 Europe/Madrid GitHub-Lane: #512 gemergt (Flag aus)

- [PR #512](https://github.com/1719842374/Aktienanalyst/pull/512) „DCF-Bilanz-Kalibrierung Draft 1, Flag aus“ wurde aus dem Draft geholt und gesquasht, mit SHA-Pin auf den Head `8765ce7f34d288b14c66f769efc6dbf3b2a4cc69`. Grundlage: DC-Delta GO (Flag aus) auf genau `8765ce7f` und Stabschefs Anweisung, nur ohne roten Check zu squashen.
- **Keine Workflows auf diesem Head:** Die API liefert für `8765ce7f` 0 Check-Runs, 0 Commit-Status und 0 Actions-Runs (ebenso für den Parent `862e59f5`). Die drei `pull_request`-Workflows haben Pfadfilter, die keine der 13 PR-Dateien treffen: currency-conversion (`server/fmp.ts`, `server/routes.ts`, Test-Skript), miner-metrics (`client/src/lib/btc/**`, `server/btc-miner.ts`), regulatory (`server/regulatory.ts`). Die übrigen drei Workflows laufen nur per Schedule, Dispatch oder Push auf fremde Branches. Es gibt also keinen roten Check, nur keinen anwendbaren.
- **Neue main-SHA:** [`5eec205a19be43bf55bd33e51a1d94c61a4e72af`](https://github.com/1719842374/Aktienanalyst/commit/5eec205a19be43bf55bd33e51a1d94c61a4e72af). Parent ist `5b476265`, der Tree ist `33832368` und damit identisch mit dem merge-tree vor dem Squash (rc 0, 0 CONFLICT).
- **Umfang:** 13 Dateien, +1521/−11, 0 Konfliktmarker. Auf main steht `shared/dcf-calibration.ts:21` `enabled: false`; Scores, Entry und CRV bleiben unverändert.
- **Offen:** DC Post-Merge auf `5eec205a`, Ampel durch Work.MD. Die Spec `Offen_WORK_DCF_BILANZ_KALIBRIERUNG.md` bleibt Offen_. Flag an nur mit Philip über [Issue #523](https://github.com/1719842374/Aktienanalyst/issues/523), Frist 2026-12-09. #522 wartet auf das finale DC auf `e07cc169`; #492 bleibt auf HOLD.

## Nachtrag 2026-11-26 12:46 Europe/Madrid Stabschef: #525 gemergt, #526 offen

- [PR #525](https://github.com/1719842374/Aktienanalyst/pull/525) „docs: WORK.md-Anker und vier Renames“ wurde mit SHA-Pin auf `86d187a5` gesquasht. **Neue main-SHA:** `70048c8ff047f5a01ee480394d1d0cfe1e25f2eb`, Parent `fdb162c4`, Tree `3ac6c883`. Umfang: 7 Dateien, +24/−20, nur Docs. `WORK_KI_CHAT_ERROR`, `WORK_KI_CHAT_LIMIT_ALL`, `WORK_NVO_TECHNICAL_OVERRIDE` und `WORK_REMOVE_BUFFETT_STOCK` heißen jetzt `fertig_WORK_*`. DC Post-Merge KLAR (0 Deletes, 0 Marker, weiter 7 Offen_-Dateien im Root), Ampel von Work.MD (`## 10:54`). Prod steht weiter auf `5eec205a`.
- [Draft #526](https://github.com/1719842374/Aktienanalyst/pull/526) „ci: Sperre DCF_CALIBRATION.enabled auf false“, Head `22954707`, Cursor-Agent. Neu sind `.github/workflows/dcf-calibration-test.yml` und `script/test-dcf-flag-off.ts`. Beleg: grün bei `false`, rot (Exit 1) bei `enabled: true`. Wartet auf DC Diff-GO, danach Squash. Kein UI, deshalb kein Tester.

- 2026-11-26 12:50: #526 Zyklus zu (DC Post-Merge KLAR auf 0247d57b, Ampel ## 12:48). Merkposten: Sagt Philip zu #523 Ja, muss die CI-Sperre (script/test-dcf-flag-off.ts + dcf-calibration-test.yml) im selben PR wie das Einschalten angepasst werden, sonst wird main rot. P3-Nachzug: Pfadfilter um currency-format.ts, lynch-dcf-defaults.ts, listing-units.ts, guard-approved-dcf-calibration.ts, test-buffett-robust.ts ergänzen.


## Nachtrag 27.11.2026, 09:38 Europe/Madrid: origin/main `d78c3704` (#531)

Prüfung gegen `origin/main` über die GitHub-API. Der `main_sha` im Kopf (`7aaa13ce`, Abruf 25.11.2026 16:23) entspricht nicht mehr `origin/main` und gilt als veraltet. Dieser Nachtrag überschreibt die älteren Abschnitte nicht.

- **Aktuelle main-SHA:** [`d78c370492899c58bec150b8c3e0f2e6a37c9e6d`](https://github.com/1719842374/Aktienanalyst/commit/d78c370492899c58bec150b8c3e0f2e6a37c9e6d). Titel: `fix(podcast): Namenspruefung none-Pfad, Stand A (#531)`. Parent [`61b12b96`](https://github.com/1719842374/Aktienanalyst/commit/61b12b962f7e0e6014ebc3c9fbb683daafc06812) (#528). Gemergt 27.11.2026 08:36 Europe/Madrid.
- **Kürzlich gemergt:** [#531](https://github.com/1719842374/Aktienanalyst/pull/531) (27.11. 08:36 → `d78c3704`, Podcast-Namensprüfung Stand A; B = LLM-Prüfer bleibt offen). [#528](https://github.com/1719842374/Aktienanalyst/pull/528) (27.11. 08:33 → `61b12b96`, Podcast-Player UI). [#529](https://github.com/1719842374/Aktienanalyst/pull/529) (26.11. 23:27 → `3a07a85e`, Podcast-Backend). [#526](https://github.com/1719842374/Aktienanalyst/pull/526) (26.11. 12:46 → `0247d57b`, CI-Sperre `DCF_CALIBRATION.enabled` auf false; Einschalten nur mit Philip über [Issue #523](https://github.com/1719842374/Aktienanalyst/issues/523)). [#520](https://github.com/1719842374/Aktienanalyst/pull/520) (25.11. 17:01 → `65ba08dd`, Revert auf `4220d4e9`).
- **Wichtigste offene Punkte (live prüfen):** [#530](https://github.com/1719842374/Aktienanalyst/pull/530) (dieser PR, Draft). [Issue #523](https://github.com/1719842374/Aktienanalyst/issues/523) (DCF-Flag). [#527](https://github.com/1719842374/Aktienanalyst/pull/527) (Draft, Podcast-Entwurf bleibt `Offen_`). [#522](https://github.com/1719842374/Aktienanalyst/pull/522) (Draft, S9-Fix nach #520). [#492](https://github.com/1719842374/Aktienanalyst/pull/492) (Draft, historisch HOLD). [#515](https://github.com/1719842374/Aktienanalyst/pull/515) (Draft, nach #520 fachlich überlagert). [#463](https://github.com/1719842374/Aktienanalyst/pull/463) (offen, Screener Custom Criteria).
