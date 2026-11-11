# WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md

**Stand:** 2026-10-28  
**Status:** Offen / Implementierungsvorschlag  
**Ziel:** KI-Ergänzung des Geschäftsmodells / der Segmentierung analog zum Peer-Vergleich. Unterposten werden **eingeschoben** (nicht als eigene Segmente), mit relativer Häufigkeit innerhalb des Eltern-Segments. Alles Geschätzte klar als Override markiert.

---

## 1. Ausgangslage (FMP + Bilanzierung)

### Tesla (TSLA) – Beispiel aus Dashboard (Stand Screenshot)

| Segment                          | Umsatz   | Anteil | YoY     |
|----------------------------------|----------|--------|---------|
| Automotive                       | $69,53B  | 73,3 % | −9,8 %  |
| Energy Generation & Storage      | $12,77B  | 13,5 % | +26,6 % |
| Services & Other                 | $12,53B  | 13,2 % | +18,9 % |
| **Summe**                        |          | **100 %** |      |

**Offizielle Bilanzierung (Tesla 10-K / 10-Q):**
- Zwei reportable Segmente: (i) Automotive, (ii) Energy Generation and Storage.
- Automotive umfasst Fahrzeuge + Services & Other (Supercharging, Wartung, Versicherung, Teile, Merchandise) + FSD (upfront und Subscriptions).
- FSD wird **nicht** als eigenes Segment ausgewiesen. Es steckt in Automotive (Verkauf) oder Services (Subscription). Es gibt Deferred Revenue für FSD-Features.
- Robotics / Optimus ist noch nicht material und nicht separat bilanziert.

**Ähnliche Unternehmen:**
- XPeng, NIO: oft nur ein Segment (Vehicle Sales and Related Business).
- Autonomes Fahren / Software wird bei den meisten EV-Herstellern nicht als eigenes Segment geführt, solange der CODM es nicht separat steuert.

---

## 2. Problem

- FMP liefert die offiziellen Segmente (Summe 100 %).
- Nicht bilanzierte / nicht separat ausgewiesene Werte (FSD, Robotics, Software-Anteile) stecken in den bestehenden Segmenten.
- Fehlende Wachstumszahlen (z. B. nächstes Jahr) müssen geschätzt werden.
- Der Override muss Sinn machen: User muss sehen, **wo** etwas drunter fällt und **wie viel relativ** innerhalb des Eltern-Segments.

---

## 3. Lösung: Unterposten einschieben (kein neues Segment)

### Prinzip

1. **Zuerst** die bestehenden FMP-Zahlen nehmen (Summe bleibt 100 %).
2. KI schätzt nur fehlende Wachstumszahlen für bestehende Segmente (aus Historie, Peers, letztem Call).
3. Nicht ausgewiesene Themen werden als **Unterposten** unter dem passenden Eltern-Segment eingeschoben (eingerückt nach rechts/unten).
4. Relative Häufigkeit / Anteil **innerhalb des Eltern-Segments** angeben (nicht vom Gesamtumsatz).
5. Alles, was nicht direkt aus FMP kommt, wird klar als **Override** markiert (Badge / Farbe / Tooltip).
6. Keine neuen Top-Level-Segmente erfinden. Summe der Top-Level-Segmente bleibt 100 %.

### UI-Darstellung (Beispiel TSLA)

```
Automotive                          73,3 %   −9,8 % YoY
  └─ FSD / Software (Override)        ~X % vom Automotive   Geschätzt / nicht separat ausgewiesen
Energy Generation & Storage         13,5 %   +26,6 % YoY
  └─ (keine Unterposten nötig)
Services & Other                    13,2 %   +18,9 % YoY
  └─ Supercharging / Service (Override)  ~Y % vom Services
  └─ Robotics / Optimus (Override)      <1 % oder n/a   nicht quantifiziert
```

- Unterposten sind eingerückt.
- Relative Häufigkeit bezieht sich auf das Eltern-Segment (z. B. „~15 % des Automotive-Umsatzes“).
- Wachstumsschätzungen für das nächste Jahr stehen als Override am Eltern-Segment.

### Schätzlogik der KI

| Fehlend                          | Basis für Schätzung                                      | Beispiel Ergebnis     | Markierung                  |
|----------------------------------|------------------------------------------------------------|-----------------------|-----------------------------|
| Wachstum nächstes Jahr (Energy)  | Historische YoY (+26,6 %) + Call-Guidance falls vorhanden | ~20–25 %             | Override: „geschätzt aus Historie“ |
| Wachstum nächstes Jahr (Auto)    | Letzte 4 Quartale + Call (Cybertruck / Refresh)           | −5 % bis +5 %        | Override: „geschätzt“        |
| FSD-Anteil innerhalb Automotive  | Call-Aussagen, Deferred Revenue, Peer-Analogien           | Hinweis + grobe Range | Override: „nicht separat ausgewiesen“ |
| Robotics / Optimus               | Kein FMP-Segment, Call erwähnt Pilot                      | <1 % oder n/a         | Override: „nicht quantifiziert“ |

**Regeln für die KI:**
- Zuerst FMP-Daten verwenden.
- Nur schätzen, wenn Historie, Peers oder Call-Aussagen vorhanden.
- Bei fehlender Basis: „nicht schätzbar“ markieren.
- Konservativer Wert bei widersprüchlichen Quellen.
- Relative Anteile immer auf das Eltern-Segment beziehen.

---

## 4. Analogie zum Peer-Vergleich

- Peer-Vergleich: KI kann Vorschläge machen / Overrides markieren.
- Hier gleich: KI ergänzt fehlende Wachstumszahlen und Unterposten-Hinweise, alles klar als Override gekennzeichnet.
- User kann Overrides manuell überschreiben oder bestätigen.

---

## 5. Zusätzliche Aufgabe: Perplexity-Link entfernen

| Element                                      | Aktion     |
|----------------------------------------------|------------|
| „Created with Perplexity Computer“            | Entfernen  |
| Link `https://www.perplexity.ai/computer`    | Entfernen  |

**Aufwand:** ~1 h

---

## 6. Implementierungsaufwand

| Teil                                      | Aufwand   |
|-------------------------------------------|-----------|
| Backend: FMP-Segmente laden + Lücken erkennen | 3–4 h    |
| KI-Call (Kontext: FMP-Daten + Historie)   | 2–3 h    |
| Frontend: Unterposten eingerückt darstellen + Override-Badge | 3–4 h |
| Tooltip / Quelle der Schätzung             | 1 h       |
| Perplexity-Link entfernen                 | 1 h       |
| **Gesamt**                                | **~10–13 h** |

---

## 7. Beispiel-Output (final)

**Automotive (73,3 %):** Umsatz −9,8 % YoY. Enthält Fahrzeuge und FSD-Software (nicht separat ausgewiesen). Geschätztes Wachstum nächstes Jahr: −5 % bis +5 % (Override).  
  └─ FSD / Software: Anteil innerhalb Automotive geschätzt / Hinweis (Override).

**Energy (13,5 %):** Umsatz +26,6 % YoY. Geschätztes Wachstum nächstes Jahr: ~20–25 % (Override).

**Services & Other (13,2 %):** Umsatz +18,9 % YoY. Enthält Service, Supercharging und weitere Anteile. Geschätztes Wachstum nächstes Jahr: ~15–20 % (Override).  
  └─ Robotics / Optimus: nicht quantifiziert (Override).

---

## 8. Nächste Schritte

1. Backend-Endpoint für Segment-Daten + KI-Ergänzung bauen.
2. Frontend-Darstellung mit eingerückten Unterposten und Override-Markierung.
3. Perplexity-Footer entfernen.
4. Test mit TSLA, MSFT und einem klassischen Industrie-Titel.

**Quellen:** Tesla 10-K / 10-Q (Segment Reporting, Revenue Recognition), FMP Segment-Daten, Dashboard-Screenshot.  
**Regel:** Keine neuen Top-Level-Segmente. Summe bleibt 100 %. Unterposten nur als Hinweis + relative Häufigkeit innerhalb des Eltern-Segments.

## Soll-Ist-Nachtrag 10.11.2026 – #465 @dd30e8b7
## 07:50 Europe/Berlin (10.11.2026) · HEAD main `dd30e8b7` · Ampel 🟡 · #465 TEILWEISE umgesetzt (Lanes belegt)
- #465 (https://github.com/1719842374/Aktienanalyst/pull/465) squash `dd30e8b7a3faf6b13da29c7257ba07c3ce52c540` über Parent `1a8791bb`, PR-Head `88d72a0d`. Tree `bd705da7` = merge-tree = Merge-Probe `61dce036` = GitHub pull/465/merge `c090184a`. 38 Files +7958/−137 (25 A, 13 M, 0 D, 0 R), 0 Konflikt-Marker, keine Trunkierung, Minuszeilen echte Ersetzungen. Wächter 8/8 Blobs gleich (researcher `fee6d637` bytegleich, #180 erhalten; schema `89bafb1d`). Hunk-Vergleich #479/#472/#386/#180: 0 fehlend, 0 doppelt, 0 zurück.
- Datenkette (DC): index.ts:110 → routes-register.ts:8 → routes.ts:582 (segment-growth :608, children :633, outline :727) + routes-register.ts:84 financial-history / :86 segment-supplement. Dashboard :698 → Section2/YahooSection3 → SegmentEstimateBlock :549 → useSegmentGrowth → /api/segment-growth; SegmentChildrenPanel → /api/segment-children → reviewKiChildren (shared/segment-children.ts); SegmentSupplementView → POST /api/segment-supplement → shared/segment-supplement.ts; Dashboard :699 → FinancialStatements → AnnualFinancials → /api/financial-history → buildFinancialHistory (shared/financial-history.ts) → StatementSankey. Neue Typen in shared-Modulen, schema.ts unverändert. Keine erfundenen Werte (null → „n/a — …“). Plausibel durchgereicht.
- Soll WORK_DASHBOARD_FEATURES_2026-10.md (Blob `61d01de8`) §1 + WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md (Blob `bebef8d7`), beide auf main unverändert.
- Ist ERLEDIGT auf `dd30e8b7`: Jahres-Tabelle (AnnualFinancials), Sankey (StatementSankey), Segment-YoY (segment-growth), KI-Untersegmente mit Fremdmarken-Prüfung (Live: HPE „n/a — Fremdmarke verworfen: Arista Networks“, MSFT Power Platform bleibt, kein Dell/PowerEdge/AMD/Intel/Samsung), promptVersion `n29-brandOwner` live.
- Ist OFFEN → beide Specs bleiben OFFEN, nicht fertig_: P2-N29-2 KI-Lüge ohne geladenen Peer (Folgespec FMP-Namenssuche pro brand); P2-3 fail-open (vorbestehend); Folgespec „eigene Unterbrands“/P3; Elternsegment als Kind (NVDA „Data Center Segment“, HPE „Hybrid Cloud Segment“); UNTESTED-Flaggschiffe wegen 24-h-KI-Cache (CRM, AX, NAV, Azure OpenAI, GitHub Copilot, Nuance, Aruba, Cisco, Juniper, Alletra MP, Zerto, DGX, Blackwell, Mellanox, MacBook Air, Beats).
- Baseline NEU: Tests **259/30** (n=289; +11 neu grün segment-*; cone-stable bekannter Flake, isoliert 0/6 rot); guard-180/326 rot wie zuvor. tsc 76 (normdiff 0). Build rc 0. Pins Δ0 (VWAGY 4.7357 / SAP 5.1748 / MSFT 4.0581, Buffett 5.6381). Live MSFT finalScore 70, HPE 55 Prod = Preview.
- Lanes: DC-Delta GO mit Auflagen /workspace/dispatch/DC-PR465-88d72a0d.md · Tester enger Live-PASS @`88d72a0d` Deployment 7674709527 /workspace/dod-465-88d72a0d/report.md · DC Post-Merge KLAR mit Hinweisen /workspace/dispatch/DC-PR465-postmerge-dd30e8b7.md (Raws /workspace/audit/pm465-dd30e8b7-raws/) · CI success Run 42768069621 · Prod liefert dd30e8b7-Bundle (index-CJJ_04RX.js, Neustart 07:25:05 Madrid; kein GitHub-Production-Deployment-Eintrag, H2).
- Hinweise: H3 Merge-Kommentar 6760620940 nennt N29-15 ms fälschlich „Ablesefehler von DC“ (nicht korrigiert). H4 Drafts #381/#394 durch #465 neu konfliktbehaftet und fachlich überholt (Entscheid Stabschef). #448/#461 Konflikt wie vorher.
- Ersetzt 07:25-Hinweis „Post-Merge DC/Prod-Tester nicht belegt“. Neu abgeschlossen: keine Spec. Offen außerdem: #480, Country-Macro-Pulse-Header/Nav, §2 Earnings-Restlücken, guard-180/326-Mutationstests.
- Do-not-touch: Miner, PEG, invertierter DCF, Sentiment, Portfolio F.2; fertig_/Fertig_ nicht auf Offen_ drehen; Spec-Dateien nicht umbenennen.

## Soll-Ist-Teil-Fortschritt 11.11.2026 – #483 @727ca998 · HEAD main `fb5546ea`

- erledigt @`727ca998`: Elternsegment nicht mehr als eigenes Kind (NVDA „Data Center Segment“, HPE „Hybrid Cloud Segment“). `productChildKey` in `shared/segment-children.ts`. Kette UI → `GET /api/segment-children/:ticker` → Server → shared auf main `fb5546ea9768140679e72185ba7ff50860e506de` geprüft.
- erledigt @`dd30e8b7`: Jahres-Tabelle, Sankey, Segment-YoY, KI-Untersegmente mit Fremdmarken-Prüfung. Der Vollblock steht im Nachtrag 10.11. darüber (Docs #481); hier nur der Fortschritt.
- Offen: P2-3 fail-open; eigene Unterbrands; UNTESTED-Flaggschiffe (24-h-KI-Cache). P2-N29-2 erledigt @`63a5cbcf` (FMP-Namenssuche pro brand).
- Spec bleibt OFFEN. Kein Rename. Kein `fertig_`/`Fertig_`. `fertig_`/`Fertig_` nicht zurück auf `Offen_`.

## Soll-Ist-Teil-Fortschritt 11.11.2026 – #482 @63a5cbcf · HEAD main `63a5cbcf`

- #482 (https://github.com/1719842374/Aktienanalyst/pull/482) Squash `63a5cbcf30805280ca921dac3aca1a3ee66f2b2e`. DC Post-Merge KLAR mit Hinweisen (`test-segment-n29-2.ts` 22 PASS). Tester PASS @`6856db4a`: HPE Networking „n/a — Fremdmarke verworfen“, Arista kein Kind. UNTESTED: ungültige FMP-Namenssuche live, Alletra. Ampel 🟡 TEILWEISE.
- Kette auf main geprüft: `SegmentChildrenPanel` → GET `/api/segment-children/:ticker` (`segment-growth-route.ts:701`) → `fmpSearchCompanyName` (`server/fmp.ts`) → `ownClaimBrandQueries` / `reviewKiChildren` (`shared/segment-children.ts`).
- Offen: P2-3 fail-open; eigene Unterbrands; Flaggschiffe (24-h-KI-Cache); P3 Obergrenze `ownClaimBrandQueries` (270 s gegen 90 s).
- Der Abschnitt bei Z.146 bleibt der historische #465-Stand und bleibt OFFEN. Kein Rename. Kein `fertig_`/`Fertig_`. `fertig_`/`Fertig_` nicht zurück auf `Offen_`.
