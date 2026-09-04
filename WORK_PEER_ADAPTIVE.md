# WORK_PEER_ADAPTIVE.md

> Soll: Konkurrenten laden **ohne** `CURATED_PEER_FALLBACK`.
> Die Map (BYDDY…) bleibt höchstens tot als letzter Notnagel und darf nicht wachsen.

Problem: FMP `/stock-peers` ist Kurs-/Cap-Ähnlichkeit. NVO → oft SNY/PFE/RHHBY, **nicht LLY**.
LLY in eine Map schreiben löst genau einen Ticker.

---

## Was schon da ist (keine neue Lizenz)

| Quelle | Funktion | Feld |
|--------|----------|------|
| FMP Peers | `fmpPeers(ticker)` | Symbole |
| Profil | `fmpProfile` | `sector`, `industry`, `mktCap`, `description` |
| Suche | `fmpSearchTicker(name)` | Name → Symbol |
| Cap-Band | `isPeerMarketCapWithinBand` | 5 % … 20× Subjekt |
| Industry-Test | `isIndustryCompatible` | String-Match |

Kein Screener im Repo. 2-Hop braucht nur `fmpPeers` noch einmal auf den Seeds.

---

## Kette (Reihenfolge fest, alle Aktien gleich)

```
A  Seeds        = fmpPeers(S)                       // 1 Call, schon im Bundle
B  2-Hop        = ∪ fmpPeers(seed) für top 5 Seeds  // +5 Calls, Cache 7 Tage
C  Kandidaten   = unique(A ∪ B) ohne S
D  Filter       = gleiches industry ODER gleiches sector
                 UND Cap in [0.05×, 20×]
                 UND nicht Luxury-vs-Auto (bestehende Regel)
E  Rank         = 1) exact industry
                  2) |log Cap_S − log Cap_i| aufsteigend
                  3) Token-Überlapp Beschreibung ∩ Segmente (optional)
F  Take         = 5, max 8 mit Override
G  Material     = moat ∈ {None,Narrow} OR Rivalität Hoch
                 wenn |F| < 3 und Material → Banner, Gate RELATIVE aus
```

Overrides `+`/`−` **nach** F, wie heute.

KI schreibt **kein** Symbol in F. Höchstens Firmennamen aus 10-K „Competition“
→ `fmpSearchTicker` → nur wenn Industry-Filter in D greift.

---

## Warum 2-Hop LLY findet, ohne NVO zu kennen

FMP hängt LLY typischerweise an andere Large-Cap-Pharma (PFE, SNY, ABBV, NVO-Seeds).
NVO-Seeds ⊃ {PFE, SNY, …} ⇒ `fmpPeers(PFE)` enthält oft LLY ⇒ LLY liegt in B.
D lässt LLY durch: gleiche Industry „Drug Manufacturers“, Cap-Band Mega/Mega.
Richemont fällt in D bei Auto, auch wenn 2-Hop sie anschleppt.

Dasselbe Muster:

| Subjekt | FMP-A oft ohne | 2-Hop + Industry holt |
|---------|----------------|------------------------|
| NVO | LLY | LLY über PFE/SNY |
| MSFT | AMZN | AMZN über GOOGL/ORCL |
| BYDDY | TSLA statt CFR | Industry Auto hält TSLA, wirft CFR |

Kein Ticker steht im Code.

---

## Budget

Heute Analyze-Bundle ≈ 13 FMP-Calls. +5 Peer-Hops nur wenn L1/L2 Peer-Set älter als 7 Tage.
Key: `peers2hop:{TICKER}` in `researcher_cache` TTL 7d (nicht 1d Capex).

Token-Overlap (E3) ist lokal, 0 Calls: Tokens aus `description` + Segmentnamen,
Stopwords (`inc`, `group`, `the`, `company`), Länge ≥ 5.
NVO-Beschreibung „GLP-1 / semaglutide / diabetes / obesity“ ∩ LLY-Beschreibung trifft.
Nicht als alleiniger Filter — nur Rank.

---

## Relativ-Sektion

`peerAvg` nur aus F (nach D).
`sectorAvg` bleibt Defaults, getrennte Spalte.
Gate `RELATIVE_GROWTH` nur wenn `peerMaterial && |F|≥3`.
Sonst Banner: „Peer-Set unvollständig — Relativ nicht score-wirksam.“

---

## DoD

1. `CURATED_PEER_FALLBACK` wird nicht verlängert. NVO-Zeile **verboten**.
2. Fixture: NVO-Graph mit Seeds {PFE,SNY} und PFE-Peers ⊃ {LLY} ⇒ LLY in F.
3. Fixture: BYDDY + CFR im 2-Hop ⇒ CFR fliegt in D.
4. Ohne 2-Hop-Cache keine +5 Calls in der heißen Minute.
5. LLM-Output ∩ F = ∅, außer Search+D.
