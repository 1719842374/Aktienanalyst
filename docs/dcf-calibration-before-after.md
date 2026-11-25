# DCF-Kalibrierung Vorher/Nachher

Synthetisch, kein Kalibrierbeleg

Die 20 Zeilen sind Varianten der MSFT-Fixture mit gesetztem Sektor und Health, keine 20 Firmen. Echte Fixtures gibt es nur 4: MSFT, SHEL.L, VOW3.DE, SPY. Echte Fixtures für mindestens 20 Ticker, nach Sektor gestreut, sind Voraussetzung fürs Einschalten; siehe https://github.com/1719842374/Aktienanalyst/issues/523.

Offline, Flag nur im Prozess an. Kein Prod-Call. Modell stetig. main-Stand der Messung: nach Merge von 5b476265.

AAPL, NVO und TSLA haben kein Offline-Fixture `analysis-<ticker>.json`. Dafür wird kein Score erfunden.

Die 20 kalibrierten Zeilen sind keine 20 verschiedenen Unternehmen. Es gibt lokal nur vier vollständige Analyse-Fixtures. Die Stichprobe setzt auf der MSFT-Fixture Sektor, Branche und Health. Median und Anteil gelten nur für diese 20, nicht für die Bankzeilen.

Median ΔScore (20 kalibrierte Zeilen) (synthetisch): -0.6208
Anteil |ΔScore| > 1: 0 / 20 = 0.0000 %

## Belegte Fixtures

| Ticker | Sektor | Health | ΔScore | ΔEntry | ΔCRV | DCF aus | DCF an | Quelle |
|---|---|---|---:|---:|---:|---:|---:|---|
| MSFT | Technology | Excellent | 0.0000 | 0.0000 | 0.0000 | 427.1680 | 427.1680 | Fixture analysis-MSFT.json |
| SHEL.L | Energy | Moderate | -1.3873 | -4.1387 | -0.5733 | 58.5510 | 46.1348 | Fixture analysis-SHEL.L.json |
| SPY | Financial Services | Weak | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | Fixture analysis-SPY.json |
| VOW3.DE | Consumer Cyclical | Weak | -0.8840 | -15.4907 | -1.2422 | 137.6190 | 101.6567 | Fixture analysis-VOW3.DE-negfcf.json |

## Kalibriert, 20 Zeilen, nach Sektor (synthetisch)

| Ticker | Sektor | Health | ΔScore | ΔEntry | ΔCRV | DCF aus | DCF an | Quelle |
|---|---|---|---:|---:|---:|---:|---:|---|
| MSFT/Technology/Good | Technology | Good | -0.4730 | -17.9482 | -0.2485 | 427.1680 | 364.1318 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Technology/Moderate | Technology | Moderate | -0.7686 | -29.1682 | -0.4038 | 427.1680 | 325.9347 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Healthcare/Good | Healthcare | Good | -0.4730 | -17.9482 | -0.2485 | 427.1680 | 364.1318 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Healthcare/Moderate | Healthcare | Moderate | -0.7686 | -29.1682 | -0.4038 | 427.1680 | 325.9347 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Energy/Good | Energy | Good | -0.4730 | -17.9482 | -0.2485 | 427.1680 | 364.1318 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Energy/Moderate | Energy | Moderate | -0.7686 | -29.1682 | -0.4038 | 427.1680 | 325.9347 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Consumer Defensive/Good | Consumer Defensive | Good | -0.4730 | -17.9482 | -0.2485 | 427.1680 | 364.1318 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Consumer Defensive/Moderate | Consumer Defensive | Moderate | -0.7686 | -29.1682 | -0.4038 | 427.1680 | 325.9347 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Consumer Cyclical/Good | Consumer Cyclical | Good | -0.4730 | -17.9482 | -0.2485 | 427.1680 | 364.1318 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Consumer Cyclical/Moderate | Consumer Cyclical | Moderate | -0.7686 | -29.1682 | -0.4038 | 427.1680 | 325.9347 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Industrials/Good | Industrials | Good | -0.4730 | -17.9482 | -0.2485 | 427.1680 | 364.1318 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Industrials/Moderate | Industrials | Moderate | -0.7686 | -29.1682 | -0.4038 | 427.1680 | 325.9347 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Utilities/Good | Utilities | Good | -0.4730 | -17.9482 | -0.2485 | 427.1680 | 364.1318 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Utilities/Moderate | Utilities | Moderate | -0.7686 | -29.1682 | -0.4038 | 427.1680 | 325.9347 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Real Estate/Good | Real Estate | Good | -0.4730 | -17.9482 | -0.2485 | 427.1680 | 364.1318 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Real Estate/Moderate | Real Estate | Moderate | -0.7686 | -29.1682 | -0.4038 | 427.1680 | 325.9347 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Communication Services/Good | Communication Services | Good | -0.4730 | -17.9482 | -0.2485 | 427.1680 | 364.1318 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Communication Services/Moderate | Communication Services | Moderate | -0.7686 | -29.1682 | -0.4038 | 427.1680 | 325.9347 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Basic Materials/Good | Basic Materials | Good | -0.4730 | -17.9482 | -0.2485 | 427.1680 | 364.1318 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |
| MSFT/Basic Materials/Moderate | Basic Materials | Moderate | -0.7686 | -29.1682 | -0.4038 | 427.1680 | 325.9347 | synthetisch aus analysis-MSFT.json, nur Sektor, Branche und Health gesetzt |

## Ausreißer |ΔScore| > 1

Keine.

## Banken und Versicherer, nicht im Median

| Ticker | Sektor | Health | ΔScore | ΔEntry | ΔCRV | DCF aus | DCF an | Quelle |
|---|---|---|---:|---:|---:|---:|---:|---|
| MSFT/Bank/Banks - Diversified | Financial Services | Moderate | 0.0000 | 0.0000 | 0.0000 | 427.1680 | 427.1680 | synthetisch aus analysis-MSFT.json, Bank/Versicherung, nur Sektor und Branche gesetzt |
| MSFT/Bank/Banks - Regional | Financial Services | Moderate | 0.0000 | 0.0000 | 0.0000 | 427.1680 | 427.1680 | synthetisch aus analysis-MSFT.json, Bank/Versicherung, nur Sektor und Branche gesetzt |
| MSFT/Versicherung/Insurance - Life | Financial Services | Moderate | 0.0000 | 0.0000 | 0.0000 | 427.1680 | 427.1680 | synthetisch aus analysis-MSFT.json, Bank/Versicherung, nur Sektor und Branche gesetzt |
| MSFT/Versicherung/Insurance - Diversified | Financial Services | Moderate | 0.0000 | 0.0000 | 0.0000 | 427.1680 | 427.1680 | synthetisch aus analysis-MSFT.json, Bank/Versicherung, nur Sektor und Branche gesetzt |

## Beleg für Merge mit Flag aus

Bei `DCF_CALIBRATION.enabled: false` gibt es auf den vier echten Fixtures kein Kalibrier-Delta. Score, Entry, CRV und DCF bleiben die unkalibrierte Rechnung. Die Spalte „DCF aus“ in „Belegte Fixtures“ ist dieser eine Wert. Das Δ in derselben Tabelle ist der Unterschied bei eingeschaltetem Flag und gehört nicht zu diesem Beleg.

Die Konstante steht auf false. Die Aufrufer kehren davor zurück:

- `shared/dcf-calibration.ts:21` `enabled: false,`
- `shared/valuation-signal.ts:510` `if (!DCF_CALIBRATION.enabled) return raw;`
- `shared/valuation-signal.ts:519` `if (!DCF_CALIBRATION.enabled) return null;`
- `shared/bias-fixes.ts:516` `if (DCF_CALIBRATION.enabled) {` — bei false wird der Moat-Zweig nicht betreten, `kiDelta` bleibt der bisherige Wert.
- `shared/bias-fixes.ts:525` `if (DCF_CALIBRATION.enabled) {` — bei false bleiben `kiDeltaRoh` und `moatFaktor` vom Rückgabeobjekt weg.
- `shared/bias-fixes.ts:773` `const calibrationPreview = dcfCalibrationPreview(data);` — die Funktion liefert bei false `null`, der Overlay ab Zeile 809 entfällt.
- `shared/bias-fixes.ts:818` `moatKiApplied: DCF_CALIBRATION.enabled ? moat.kiDelta : null,` — bei false `null`.
- `client/src/components/sections/Section5.tsx:143` `() => (DCF_CALIBRATION.enabled ? buildBiasDecision(data).calibration ?? null : null),`
- `client/src/components/sections/Section6.tsx:63` `const calibration = DCF_CALIBRATION.enabled ? bias.calibration ?? null : null;`
- `server/pdf-export.ts:166` `if (!DCF_CALIBRATION.enabled) return "";`
