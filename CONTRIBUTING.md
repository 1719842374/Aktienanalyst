# Contributing to Stock Analyst Pro

Thanks for your interest in improving Stock Analyst Pro. This guide walks you through the contribution workflow, code style, and our anti-bias engineering principles.

---

## Ground Rules

1. **Objectivity first.** Every feature must respect the [Anti-Bias Protocol](#anti-bias-protocol) — no selective upside without symmetric downside.
2. **Show your math.** All calculations must be transparent via the `RechenWeg` component or the `steps[]` array in calculation functions.
3. **No ticker or sector hardcoding.** Detection logic must be rule-based and work for all stocks globally.
4. **Caching is a first-class citizen.** Expensive operations (LLM calls, API fetches) must be cached — target the 7-day window used throughout the app.
5. **German & English together.** User-facing strings are in German. Code comments, commit messages, and technical docs are in English or mixed — be consistent within a single file.

---

## Development Setup

### Prerequisites
- Node.js 20+
- npm 10+
- A free [Financial Modeling Prep](https://financialmodelingprep.com/) API key (`FMP_API_KEY`)
- An [OpenRouter](https://openrouter.ai/) API key for the LLM-powered catalyst mode (`OPENROUTER_API_KEY`)

### Quick start

```bash
git clone https://github.com/1719842374/Aktienanalyst.git
cd Aktienanalyst
npm install
cp .env.example .env   # then edit with your keys
npm run dev
```

Open [http://localhost:5000](http://localhost:5000).

### Build for production

```bash
npm run build
NODE_ENV=production node dist/index.cjs
```

---

## Project Structure

```
Aktienanalyst/
├── client/src/
│   ├── pages/           # Route components (Dashboard, Researcher, BTC, Gold, Recession, Screener, Compare)
│   ├── components/
│   │   └── sections/    # 17 stock-analysis sections (Section1 … Section17)
│   └── lib/
│       ├── calculations.ts  # DCF, Monte Carlo, CRV, WACC, Catalyst logic
│       └── formatters.ts
├── server/
│   ├── routes.ts        # Main /api/analyze endpoint + all other routes
│   ├── researcher.ts    # 4-tab Researcher mode + Daily Briefing
│   ├── regression-scan.ts
│   ├── fmp.ts           # FMP API wrapper (search, quotes, financials)
│   ├── llm-openrouter.ts
│   └── recession.ts
├── shared/
│   └── schema.ts        # Zod schemas shared by client + server
└── .cache/              # 7-day JSON cache (gitignored)
```

---

## Anti-Bias Protocol

Any pull request that introduces user-facing recommendations must follow these rules:

1. **Symmetric risk.** If a component shows upside catalysts, it must show equivalent downside catalysts.
2. **Plausibility gates.** Valuation outputs must be plausibility-checked (example: `selectCatalystBase` falls back from DCF to Analyst PT if DCF × (1 + Σ GB%) < 70% of current price).
3. **Source transparency.** Every number must have a visible Rechenweg (calculation trace) — use the `<RechenWeg />` component with a `steps[]` array.
4. **Regression Scan.** Before merging DCF/Catalyst changes, run `POST /api/regression-scan` locally and verify the 5 edge-case tickers (IFX.DE, TSLA, VWAGY, MSFT, AMZN) produce plausible results.

---

## Coding Style

### TypeScript
- Strict mode (already enforced by `tsconfig.json`)
- Prefer named exports; default exports only for React page components
- No `any` unless justified in a comment
- Functions over 100 lines should be split

### React
- Functional components only
- `useMemo` for expensive calcs inside render
- All interactive elements need a `data-testid` attribute

### Tailwind
- Mobile-first (`class` then `sm:class` then `md:class`)
- Use CSS custom properties from `index.css` for colors; avoid `hex` literals
- Reach for `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` patterns for KPI tiles

### Commit messages

Format: `<type>(<scope>): <short summary>`

Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `chore`, `test`

Example:
```
fix(dcf): growth-player handling in calculateFCFFDCF

- 3-phase projection with high-growth detection
- EV/EBITDA terminal fallback when FCFF distorted
- 15% safety floor for pre-profitability stocks
```

---

## Pull Request Workflow

1. **Fork → branch.** `git checkout -b feat/my-feature`
2. **Write code + tests.** If you add or modify calculation functions, manually verify against the 5 regression-scan tickers.
3. **Run the build.** `npm run build` must pass with zero warnings.
4. **Screenshot major UI changes** at mobile (375px) and desktop (1440px).
5. **Open a PR** using the PR template — include screenshots, a test checklist, and any configuration changes.
6. **Wait for review.** A maintainer will verify the anti-bias protocol and run the regression scan.

---

## Testing a Pull Request

```bash
# 1. Build must pass
npm run build

# 2. Regression scan (if DCF / Catalyst / WACC changed)
curl -X POST http://localhost:5000/api/regression-scan | jq

# 3. Researcher still works for all 3 regions
curl -X POST http://localhost:5000/api/researcher/macro -H 'Content-Type: application/json' -d '{"region":"US"}'
curl -X POST http://localhost:5000/api/researcher/macro -H 'Content-Type: application/json' -d '{"region":"EU"}'
curl -X POST http://localhost:5000/api/researcher/macro -H 'Content-Type: application/json' -d '{"region":"ASIA"}'

# 4. International ticker analysis
curl -X POST http://localhost:5000/api/analyze -H 'Content-Type: application/json' -d '{"ticker":"BAJAJ-AUTO.NS"}'
```

---

## Reporting Bugs

Use the [Bug Report issue template](./.github/ISSUE_TEMPLATE/bug_report.md). Include:

- Exact ticker (and region, if non-US)
- Expected vs. actual DCF / Catalyst values
- Browser + viewport size (mobile issues must include 375px screenshot)
- Any `steps[]` from the Rechenweg

---

## Security

For security-sensitive issues (exposed API keys, DoS vulnerabilities, etc.), see [SECURITY.md](./SECURITY.md) — do **not** open a public GitHub issue.

---

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).
