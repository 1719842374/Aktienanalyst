# WORK_PEER_PRICING_POWER.md

> Relativbewertung (Sektion 7) und FMP-Peers.
> Grundsatz: **fehlender Konkurrent ist nur dann material, wenn Moat schwach und Rivalität hoch ist** (Preissetzungsmacht).

---

## Ist

FMP `/stock-peers` sortiert nach Kurs-/Cap-Ähnlichkeit, nicht nach Produktmarkt.
`filterAndSelectPeers` prüft nur Sector/Industry-String.
`CURATED_PEER_FALLBACK` hatte Auto/EV (BYDDY…), **nicht** NVO→LLY.
LLY kommt bei NVO nur per User-Override `peerOverrides.add`.

`scoreMoat()` ist Keyword auf der Firma-Beschreibung:
Brand oder Network → Porter-Rivalität **Niedrig**. Bei NVO/LLY (GLP-1) ist das falsch — beide haben Marke/Patente, die Rivalität ist trotzdem hoch.

Sektion-7-Kopfzeile „Sector Avg“ = `getSectorDefaults`, nicht `peerAvg`.
Gate `RELATIVE_GROWTH` nutzt Peer-Wachstum **immer**, auch bei Wide-Moat.

---

## Soll-Regel (Pricing Power)

```
peerMaterial =
  moat ∈ {None, Narrow}
  OR porter.Rivalität = Hoch
  OR (Produktmarkt hat 1–2 namentliche Duopol-Rivalen)
```

| Lage | Relativ-Sektion | Fehlender LLY-Typ |
|------|-----------------|-------------------|
| Wide + Rivalität Niedrig | Sector-Avg reicht; Peer-Tabelle Dekoration | Warnung, kein Gate |
| Narrow/None **und** Rivalität Hoch | Peer-Set ist die Bewertung | P0: Set unvollständig → Relativ **nicht** für Score/CRV |
| Wide + Rivalität Hoch (NVO/LLY, MSFT Cloud) | beide Spalten: Sector *und* namentlicher Rivale | Rivale Pflicht, Sector allein irreführend |

Ohne `peerMaterial`: FMP-Liste so lassen, Override optional.
Mit `peerMaterial` und leerem/falschem Set: Banner
„Preissetzung — Peer-Set unvollständig, Relativbewertung nicht score-wirksam“.
Gate `RELATIVE_GROWTH` dann nicht ziehen (oder Gewicht 0).

KI darf **keine** Peer-Tickers erfinden. Höchstens Namen vorschlagen;
Aufnahme nur Override oder kuratierte Liste.

---

## NVO-Beispiel

FMP liefert oft keine LLY. GLP-1 = Duopol, Rivalität hoch, Preissetzung gemeinsam.
Relativ ohne LLY misst NVO gegen Zufalls-Pharma statt gegen den Preisanker.
Fallback: `NVO → LLY` (plus optionale Cap-Peers im 5%–20×-Band).

MSFT Wide + Rivalität Cloud hoch: GOOGL/AMZN fehlen lassen ist material;
Xbox-Peer fehlt lassen ist es nicht.
