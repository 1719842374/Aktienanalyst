# WORK_PEER_PRICING_POWER.md

## Ist `CURATED_PEER_FALLBACK` Hardcode?

**Ja.** In [`server/news-peers.ts`](./server/news-peers.ts) steht eine Ticker-Map:

```
BYDDY, NIO, LI, XPEV, GELYF  → gegenseitig + TSLA
```

Kein NVO, kein LLY. Die Map greift nur, wenn der Ticker *als Subjekt* genau so heißt. FMP-Industry-Filter allein findet LLY bei NVO nicht, weil FMP Kursnachbarn liefert, keine GLP-1-Rivalen.

Das ist absichtlich eine **Ausnahmeliste** für bekannte FMP-Fehlgriffe (Luxury in Auto), keine adaptive Konkurrenzsuche. Jede neue Zeile `NVO: ["LLY", …]` ist wieder Hardcode.

Soll statt wachsender Map:

- Relativ nur score-wirksam wenn `peerMaterial` (Moat low **oder** Rivalität hoch).
- Fehlender Duopol-Rivale → Banner, Gate aus, nicht 200 Ticker pflegen.
- User-Override `+LLY` bleibt der adaptive Weg ohne Repo-Edit.
- KI darf den Namen nennen, nicht in die Peer-Tabelle schreiben.
