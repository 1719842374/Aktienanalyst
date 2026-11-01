# Offen_WORK_BITCOIN_MINER_MAP.md — Bitcoin-Miner-Lokalisierung auf der Weltkarte

> **Stand: 18.10.2026**  
> Dedizierte Spec für den Bitcoin-Miner-Layer auf einer 2D-Weltkarte im Researcher- oder BTC-Dashboard.  
> Fokus auf geografische Hashrate-/Power-Verteilung mit konkreten Zahlen und Datenquellen.

**Ziel:** Sichtbar machen, wo die globale Bitcoin-Mining-Power konzentriert ist (Länder/Regionen/Farms), inklusive Hashrate, MW und Profitabilitäts-Kontext.

---

## Soll-Zustand

- 2D-Weltkarte mit Markern oder Bubbles für Mining-Standorte.
- Größe/Farbe = geschätzte Hashrate-Anteil (%) oder Power Capacity (MW).
- Klick auf Region/Standort → Side-Panel:
  - Liste der Miner (z. B. MARA, RIOT, CLSK, BITF, IREN, HUT, CIFR).
  - Aktuelle Hashrate (EH/s).
  - Power Capacity (MW).
  - Stromkosten-Kontext / Hashprice (aus bestehender Pipeline).
  - Regulatorischer / energetischer Hinweis (kurz).

### Beispiel-Regionen & Fakten (Stand ~2026)
- **USA (Texas, Georgia etc.):** ~35–40 % der globalen Hashrate. Große Farms von MARA, RIOT, CLSK.
- **Kazakhstan:** Weiterhin relevant trotz regulatorischer Schwankungen.
- **Canada:** Stabile Wasserkraft-Standorte (z. B. BITF, HUT).
- **Paraguay / Lateinamerika:** Wachsende Wasserkraft-Farms.
- **Oman / Middle East:** Neuere große Projekte.
- Einzelne Farms: 100–500+ MW möglich.

---

## Datenquellen & Fakten

| Quelle                              | Was sie liefert                          | Nutzung                     |
|-------------------------------------|------------------------------------------|-----------------------------|
| Unternehmensberichte / IR           | Farm-Standorte, MW, Hashrate             | Primär für Marker          |
| Cambridge Bitcoin Electricity Consumption Index | Hashrate-Verteilung nach Land     | Aggregierte Länder-Ebene   |
| Bestehende `btc-miner.ts` Pipeline  | Hashprice, Breakeven, Profitabilität     | Zahlen im Side-Panel        |
| Öffentliche Farm-Listen             | Bekannte Standorte (Texas, etc.)         | Initialer Datensatz        |

- Typische Metriken im Panel: Hashrate in EH/s, MW, geschätzter Anteil an globaler Hashrate (%), Strompreis-Hinweis.
- Caching: Analog zu anderen Researcher-/BTC-Endpunkten.

---

## Technische Umsetzung

- Frontend: Layer in der bestehenden Geo-Map-Komponente oder eigener Tab im BTC-Dashboard.
- Backend: Erweiterung `GET /api/researcher/geo-map?layer=miner` oder `GET /api/btc/miner-map`.
- Datenfluss: UI → API → Miner-Standort-Daten + `btc-miner.ts` Zahlen → Side-Panel.
- Verknüpfung: Link vom Side-Panel zum bestehenden BTC-Miner-Dashboard.

### Acceptance Criteria
- Mindestens 8–10 Mining-Regionen/Standorte sichtbar und klickbar.
- Side-Panel zeigt konkrete Zahlen (Hashrate, MW, Miner-Namen).
- Layer ist unabhängig von Capex/Sektor umschaltbar.
- Fallback bei fehlenden Standortdaten.
- Keine Performance-Probleme.

**Priorität:** Hoch  
**Aufwand:** 1,5–2 Tage

---

## Nächste Schritte
1. Initialen Standort-Datensatz (Top-Farms/Länder) zusammenstellen.
2. Backend-Endpoint mit Anbindung an `btc-miner.ts`.
3. Marker + Side-Panel implementieren.
4. Mit Capex-/Sektor-Map kombinieren oder separat halten.
5. Nach Umsetzung auf `fertig_` umbenennen.

---

*Erstellt am 18.10.2026 – detaillierte Bitcoin-Miner-Map-Spec mit Zahlen, Datenquellen und Fakten.  
Repo: https://github.com/1719842374/Aktienanalyst*
