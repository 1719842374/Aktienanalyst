# WORK.md – Peer-Vergleich: ROIC-Plausibilität & Peer-Auswahl

**Status:** Bug-Report + Fix-Spec (AMZN Peer-Tabelle, LITB, 15.08.2026)  
**Priority:** P1 – verzerrt Peer-Ø und „bester Wert“-Highlight  
**Scope:** `server/news-peers.ts` (ROIC-Extraktion, Peer-Avg), Peer-Filter, `PeerComparison.tsx`

---

## 1. Live-Befund (AMZN Peer-Tabelle)

| Ticker | Mkt Cap | ROIC FY | ROIC 5Y Ø |
|--------|---------|---------|-----------|
| AMZN | $2.8T | 10.7 % | 8.4 % |
| … | … | … | … |
| **LITB** | **$28M** | **469.4 %** | **268.9 %** |
| Ø Peers | — | **99.4 %** | **56.5 %** |

LITB (~$28M Market Cap) kann wirtschaftlich **keinen** nachhaltigen ROIC von >100 % (geschweige 469 %) haben. Der Wert verzerrt:

- Peer-Durchschnitt (99 % / 56 % statt ~einstelliger bis niedriger zweistelliger Werte)
- grünes „bester Wert“-Highlight auf einem Artefakt

---

## 2. Code-Lage (kein Rechenfehler, fehlende Plausibilität)

| Aspekt | Status |
|--------|--------|
| ×100 aus FMP `returnOnInvestedCapital` | korrekt umgesetzt |
| 5Y-Durchschnitt (arithmetisch, mind. 3 Jahre) | korrekt |
| Cap / Flag bei \|ROIC\| > z. B. 100 % | **fehlt** |
| Peer-Auswahl nach Größe (LITB vs. AMZN) | **schwach** – Micro-Cap als Amazon-Peer ist ohnehin fragwürdig |

### Implementierung (`server/news-peers.ts`)

```ts
// FMP liefert 0..1 → Anzeige in %
roicPercent = +(raw * 100).toFixed(1)

// Kein Ober-Cap; negative Extreme (z.B. BYDDY -940%) und positive
// Extreme werden bewusst mitgenommen (Kommentar im Code).
```

Quelle: `/stable/key-metrics` → `returnOnInvestedCapital`.  
Bei Micro-Caps oft **winziger oder verzerrter Invested-Capital-Nenner** → ROIC explodiert. Tool gibt FMP 1:1 durch.

---

## 3. Ursache (Zahlen / Fakten)

| Faktor | Wirkung |
|--------|--------|
| Invested Capital ≈ 0 / sehr klein | Nenner → ROIC → Hunderte % |
| Micro-Cap / dünne Reporting-Qualität | Sondereffekte dominieren eine Periode |
| Kein Sanity-Cap | 469 % wird angezeigt und gemittelt |
| FMP-Peers ohne Market-Cap-Band | LITB ($28M) landet neben AMZN ($2.8T) |

**Kurz:** 469 % = FMP × 100, **kein** valider ökonomischer ROIC. Tool darf das nicht als „besten Wert“ grün und in den Ø lassen.

---

## 4. Fix-Richtung (generisch, keine Ticker-Hardcodes)

### 4.1 ROIC-Sanity (Anzeige + Aggregation)

```text
ROIC_ABS_CAP = 100   // oder Policy 150

function sanitizeRoic(pct: number | null): number | null {
  if (pct == null || !isFinite(pct)) return null
  if (Math.abs(pct) > ROIC_ABS_CAP) return null  // UI: n/a oder Flag
  return pct
}
```

- Optional UI: Tooltip „unplausibel / IC-Nenner (FMP)“ wenn verworfen  
- Gilt für **FY-ROIC und jeden Jahreswert** vor dem 5Y-Ø  
- 5Y-Ø nur über **sanitized** Jahreswerte; wenn < 3 valide Jahre → `roic5Y = null`

### 4.2 Peer-Ø ohne Extreme

Vor `avg(peers.map(p => p.roic))`:

- Werte mit `Math.abs(roic) > ROIC_ABS_CAP` **nicht** in den Mittelwert  
- oder Winsorize (z. B. auf ±100 % kappen) – **Verwerfen bevorzugt** (ehrlicher als künstliches 100 %)

### 4.3 Peer-Filter: Market-Cap-Band

```text
// Nach Industry-Filter, vor fetchPeerComparisonFromTickers:
subjectCap = subject.marketCap
if (subjectCap > 0):
  peer behalten nur wenn
    peer.marketCap >= subjectCap * 0.05   // min 5% der Subjekt-Cap
    AND peer.marketCap <= subjectCap * 20 // max 20× (bei Small-Caps anpassen)
```

Beispiel AMZN ~$2.8T → LITB $28M (Faktor ~100 000) **raus**.  
Band generisch; keine LITB-/AMZN-Sonderliste.

Optional ergänzend: absolute Floor (z. B. Market Cap ≥ $500M), wenn Subjekt Large-Cap ist – weiterhin regelbasiert, nicht ticker-spezifisch.

---

## 5. Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `server/news-peers.ts` | `sanitizeRoic` in `extractRoicPercentFromRow` / `extractRoicFromKeyMetricsRows`; Peer-Avg nur sanitized; optional Cap-Konstante |
| `server/news-peers.ts` → `filterAndSelectPeers` / Aufrufer | Market-Cap-Band nach Profil/Quote |
| `client/.../PeerComparison.tsx` | n/a statt 469 %; kein Grün-Highlight auf verworfenen Werten |
| `script/test-roic.ts` | Cases: \|ROIC\| > 100 → null; 5Y ohne Extreme |

---

## 6. Akzeptanztests

| Case | Erwartung |
|------|-----------|
| LITB-Roh 469 % | Anzeige `n/a` (oder Flag), nicht 469 % |
| AMZN Peer-Ø ROIC | ohne LITB-Artefakt, Größenordnung einstelliger bis niedriger zweistelliger % |
| AAPL ROIC ~52 % | unverändert sichtbar (< Cap) |
| BYDDY stark negativ, aber \|ROIC\| ≤ Cap | bleibt sichtbar; nur \|x\| > Cap → null |
| Peer-Liste AMZN | kein Micro-Cap <$100M (bzw. unter Cap-Band) |

---

## 7. Priority

| Prio | Task |
|------|------|
| **P1** | ROIC-Sanity-Cap (\|ROIC\| > 100 → null) in Extraktion + 5Y + Peer-Ø |
| **P1** | Peer Market-Cap-Band relativ zum Subjekt |
| **P2** | UI-Tooltip bei verworfenem ROIC; Tests in `test-roic.ts` |

---

**Document Owner:** Aktienanalyst Project  
**Created:** 15.08.2026  
**Next Action:** P1 Sanity-Cap + Market-Cap-Band implementieren
