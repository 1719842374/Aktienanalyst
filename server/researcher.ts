// === Researcher Module ===
//
// 4-Tab autonomous research mode for the Stock Analyst Pro dashboard.
// Hybrid architecture: REAL data via FRED macro snapshot / FMP screener,
// LLM (Claude 3.5 Haiku) only for SYNTHESIS and INTERPRETATION,
// never for generating numeric facts.
//
// Tabs:
//   1. /api/researcher/macro       — Country Macro Pulse (US/EU/Asia)
//   2. /api/researcher/sectors     — Sector Opportunity Map (12 megatrends, scored)
//   3. /api/researcher/screener    — Undervalued Stock Screener (FMP + LLM moat scoring)
//   4. /api/researcher/capex       — Capex & Fiscal Tracker (programmes per region)
//
// All 4 endpoints use a shared 7-day file cache mirroring the main dashboard's
// caching contract — same TTL, same per-request cache-key strategy. Cache is
// keyed on the relevant input parameters (country/region/filter) so different
// requests do not collide.
//
// Anti-bias mechanic for Tab 2 (Sector Opportunity):
//   The LLM is REQUIRED to score each of 12 fixed megatrend categories on a
//   1-10 scale. It cannot just return "AI is hottest" — it must explicitly
//   evaluate Defense, Renewables, Biotech, Robotics, Cloud, Semis, Consumer,
//   Infrastructure, Financials, Real Estate, Transport, and Materials in
//   every response. Ranking emerges from the scores, not from LLM bias.

import type { Express } from "express";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { callLLMJson } from "./llm-openrouter";
import { diskResearcherGet, diskResearcherSet, diskResearcherDelete } from "./disk-cache";
import { fetchMacroSnapshot } from "./fmp-macro";
import { fetchSectorRotationLive, SECTOR_ROTATION_CACHE_TAB } from "./sector-rotation";
