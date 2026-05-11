<!--
Thanks for your contribution! Please fill out the sections below so reviewers
can quickly understand what's changing and why.
-->

## Summary

One- or two-line description of what this PR does.

## Type of Change

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📝 Documentation update
- [ ] 🎨 UI / UX refinement
- [ ] ♻️ Refactor (no functional change)
- [ ] 🔧 Configuration / tooling

## Related Issue(s)

Closes #XXX, fixes #YYY

## What changed

- Bullet list of concrete changes (files / functions / endpoints)
- …

## Anti-Bias Protocol Checklist

For any change that touches valuations, recommendations, or catalysts:

- [ ] Symmetric risk — upside view has a corresponding downside view
- [ ] Plausibilitäts-Gate respected (e.g., `selectCatalystBase` used for Catalyst Targets)
- [ ] Rechenweg / `steps[]` updated to reflect new logic
- [ ] No ticker or sector hardcoding (detection is rule-based)
- [ ] 7-day cache layer respected (no double LLM credits)

## Testing

- [ ] `npm run build` passes
- [ ] Regression scan ran locally: `curl -X POST localhost:5000/api/regression-scan` — no new anomalies
- [ ] Researcher endpoints work for all 3 regions (US / EU / ASIA)
- [ ] At least one international ticker tested (`BAJAJ-AUTO.NS`, `0700.HK`, etc.)
- [ ] Manual UI smoke test at mobile (375px) and desktop (1440px)

## Screenshots / Recordings

<!-- For UI changes, attach screenshots at both mobile (375px) and desktop (1440px). Use before/after pairs if applicable. -->

| Before | After |
| ------ | ----- |
|        |       |

## Configuration / Migration

- [ ] No new env variables
- [ ] New env variables (list below)
- [ ] Cache invalidation required (which files / `.cache/*`)
- [ ] Database / schema change

## Deployment Notes

Anything special the maintainer should do after merge?

- [ ] Standard build & deploy
- [ ] Restart server explicitly
- [ ] Force-refresh certain caches
- [ ] Update Cron job task description (which cron ID?)

## Checklist

- [ ] My code follows the style of this project (TypeScript strict, no `any` unless justified, Tailwind mobile-first)
- [ ] I've added `data-testid` attributes to new interactive elements
- [ ] I've added or updated comments for any non-obvious logic
- [ ] I've updated the README if this changes user-facing behavior
- [ ] No secrets, API keys, or `.env` content in the diff
