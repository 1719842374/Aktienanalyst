# FactPack — LLM vs. Konsenszahlen

> Code: [`server/factpack-validate.ts`](../../server/factpack-validate.ts)
> Test: `npx tsx script/test-factpack-validate.ts`

Zero schreibt „Quelle: FactSet“ unter die Beat-Dots. Im Repo gibt es **keinen** `FACTSET_API_KEY`. Die Validierung nutzt dieselbe Feldliste (EPS actual/consensus/surprise, Revenue analog).

| Fill | Funktion |
|------|----------|
| heute | `buildFactPackFromFmp` aus `fmpAnalystEstimates` + Income + Quote |
| später | `buildFactPackFromFactSet` sobald Client existiert |

## Regel

Zahl im Katalysator-`context` muss im Pack liegen (±3 % bzw. EPS ±0,02). Satz ohne Treffer wird gestrichen. Leeres Pack → Text bleibt, `available:false`.

## Hook in `analyze-route.ts`

Nach `generateCatalystsAndMatchNews`:

```ts
import { applyFactPackToCatalysts, buildFactPackFromFmp } from "./factpack-validate";

const pack = buildFactPackFromFmp({
  ticker: upperTicker,
  estimates: fmpData?.analyst?.estimates,
  quote: fmpData?.quote,
  income: fmpData?.financials?.income,
  price, pe, revenue, revenueGrowthPct: revenueGrowth,
});
catalysts = applyFactPackToCatalysts(llmResult.catalysts, pack);
```

Nebius-Beispiel: „Umsatz 582,3 Mio.“ bleibt nur, wenn das Pack 582.3e6 (±3 %) hat. „Umsatz 9,1 Mrd.“ fliegt.
