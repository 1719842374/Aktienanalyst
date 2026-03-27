#!/usr/bin/env python3
"""Fetch Google Trends data for 'Recession' search interest (US, 7 days)."""
import json
import sys

try:
    from pytrends.request import TrendReq
    pytrends = TrendReq(hl='en-US', tz=360, timeout=(10, 25))
    pytrends.build_payload(['Recession'], cat=0, timeframe='now 7-d', geo='US')
    df = pytrends.interest_over_time()
    if not df.empty:
        avg = round(float(df['Recession'].mean()), 1)
        latest = int(df['Recession'].iloc[-1])
        peak = int(df['Recession'].max())
        print(json.dumps({"avg": avg, "latest": latest, "peak": peak}))
    else:
        print(json.dumps({"error": "empty dataframe"}))
except Exception as e:
    print(json.dumps({"error": str(e)[:200]}))
