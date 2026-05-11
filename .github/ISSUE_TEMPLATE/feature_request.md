---
name: Feature Request
about: Suggest a new section, calculation method, or dashboard
title: "[FEATURE] "
labels: enhancement
assignees: ''
---

## Feature Summary

One-sentence description of what you'd like to add.

## Problem It Solves

What current limitation or gap does this address? Be concrete — e.g., "DCF doesn't account for SaaS rule-of-40 metrics" or "No way to compare 3+ tickers side by side".

## Proposed Solution

Describe how the feature would work:

- **Where** in the UI does it live? (new section, new page, new tab in Researcher?)
- **What inputs** does it need? (financial data, user parameters, LLM calls?)
- **What outputs** does it produce? (KPI tile, table, chart, action recommendation?)

## Anti-Bias Check

If this feature surfaces a valuation, recommendation, or upside catalyst, how does it preserve **symmetric risk**?

- Does it have a corresponding downside view?
- Does it require Plausibilitäts-Gate logic?
- Is it source-transparent (Rechenweg / steps[])?

## Alternatives Considered

What other approaches did you think about? Why is your proposed solution better?

## References / Methodology

Links to:
- Damodaran / academic papers
- Other tools that implement this (Stratosphere, Stockanalysis.com, Tikr, …)
- Books / Stratechery / Substack posts

## Effort Estimate

Rough effort sense (you don't need to be precise):
- [ ] Small (1 file, < 50 lines)
- [ ] Medium (2–3 files, 50–200 lines)
- [ ] Large (new module, > 200 lines, possibly new endpoint)

## Additional Context

Mockups, screenshots, sample data — anything that helps the maintainer visualize the feature.
