# Finance API Response Formats

## finance_quotes
Returns: { content: "markdown table", csv_files: [...] }
The content includes a markdown table with columns matching requested fields.
CSV files have the raw data.

## finance_company_profile  
Returns: { content: "markdown text" }
Contains sector, industry, CEO, employees, country, website, IPO date, description.

## finance_analyst_research
Returns: { content: "markdown with consensus + price targets", csv_files: [...] }
Consensus table: consensus_rating, total_ratings, bullish_count, bullish_pct, neutral_count, neutral_pct, bearish_count, bearish_pct, avg_price_target, median_price_target, high_price_target, low_price_target
Price targets table: id, date, firm, analyst, action, rating_current, rating_prior, price_target_current, price_target_prior, sentiment

## finance_financials
Returns: { content: "markdown tables per statement", csv_files: [...] }
Each CSV has the raw financial data with date, period, and requested metrics.
Numbers are raw (not abbreviated): 416,161,000,000

## finance_ohlcv_histories
Returns: { content: "...", csv_files: [...] }
CSV with date, open, high, low, close, volume columns.

## finance_estimates
Returns consensus analyst estimates for future periods.

## finance_fundamentals
Returns pre-computed valuation multiples (P/E, EV/EBITDA, etc.) as time-series.
