/**
 * Unit Tests — BTC Miner Formulas
 * Framework: Vitest (already in project deps via Vite)
 *
 * Tests cover:
 *  1. calcBreakevenPrice — Antminer S19 XP reference miner
 *  2. calcPuellMultiple  — rolling 365d average
 *  3. detectCrossover   — Hash Ribbons MA30/MA60
 *  4. calcDifficultyRibbonCompression — coefficient of variation
 *  5. calcMinerScore    — composite 0-100 signal
 */

import { describe, it, expect } from 'vitest';
import {
  calcBreakevenPrice,
  calcPuellMultiple,
  detectCrossover,
  calcDifficultyRibbonCompression,
  calcMinerScore,
  rollingAvg,
} from '../../../../server/btc-miner';

// ─────────────────────────────────────────────────────────────────────────────
describe('calcBreakevenPrice', () => {
  it('returns 0 for zero or negative hashrate', () => {
    expect(calcBreakevenPrice(0)).toBe(0);
    expect(calcBreakevenPrice(-1)).toBe(0);
  });

  it('returns a positive number for realistic network hashrate', () => {
    // Current network ≈ 600–800 EH/s (July 2026)
    const price = calcBreakevenPrice(700);
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThan(200_000); // sanity upper bound
  });

  it('breakeven increases as network hashrate increases', () => {
    // More hashrate → miner earns less BTC → needs higher price to break even
    const low = calcBreakevenPrice(400);
    const high = calcBreakevenPrice(800);
    expect(high).toBeGreaterThan(low);
  });

  it('formula check: 700 EH/s should be roughly $15k–$60k breakeven range', () => {
    const p = calcBreakevenPrice(700);
    expect(p).toBeGreaterThan(10_000);
    expect(p).toBeLessThan(80_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('rollingAvg', () => {
  it('returns null for indices before window is filled', () => {
    const result = rollingAvg([1, 2, 3, 4, 5], 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(2);
    expect(result[4]).toBeCloseTo(4);
  });

  it('handles window = 1 (passthrough)', () => {
    const result = rollingAvg([10, 20, 30], 1);
    expect(result).toEqual([10, 20, 30]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('calcPuellMultiple', () => {
  it('returns null for insufficient price history (< 365 days)', () => {
    const { puellMultiple } = calcPuellMultiple([
      { date: '2024-01-01', price: 40000 },
    ]);
    expect(puellMultiple).toBeNull();
  });

  it('returns a positive number for 400+ days of stable prices', () => {
    const prices = Array.from({ length: 400 }, (_, i) => ({
      date: new Date(2023, 0, 1 + i).toISOString().split('T')[0],
      price: 40000,
    }));
    const { puellMultiple } = calcPuellMultiple(prices);
    // With constant price the Puell Multiple should be exactly 1.0
    expect(puellMultiple).not.toBeNull();
    expect(puellMultiple!).toBeCloseTo(1.0, 2);
  });

  it('puellHistory length is priceHistory.length - 364', () => {
    const prices = Array.from({ length: 500 }, (_, i) => ({
      date: new Date(2023, 0, 1 + i).toISOString().split('T')[0],
      price: 50000 + i * 10,
    }));
    const { puellHistory } = calcPuellMultiple(prices);
    expect(puellHistory.length).toBe(500 - 364);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('detectCrossover', () => {
  const nulls = (n: number) => Array(n).fill(null);

  it('detects a recent bullish crossover (ma30 crosses above ma60)', () => {
    // ma30 was below ma60, then crossed above
    const ma30: (number | null)[] = [...nulls(59), 95, 98, 102];
    const ma60: (number | null)[] = [...nulls(59), 100, 100, 100];
    // At index 61: ma30 (102) > ma60 (100), prev: ma30 (98) <= ma60 (100) → crossover
    expect(detectCrossover(ma30, ma60)).toBe(true);
  });

  it('returns false when ma30 has been above ma60 for a long time (no recent cross)', () => {
    // Crossover happened > 30 days ago
    const ma30: (number | null)[] = Array.from({ length: 100 }, (_, i) =>
      i < 30 ? null : 110
    );
    const ma60: (number | null)[] = Array.from({ length: 100 }, (_, i) =>
      i < 59 ? null : 100
    );
    // ma30 has been above ma60 for 40 steps — outside 30-day lookback
    expect(detectCrossover(ma30, ma60)).toBe(false);
  });

  it('returns false when in capitulation (ma30 < ma60)', () => {
    const ma30: (number | null)[] = [...nulls(59), 80, 79, 78];
    const ma60: (number | null)[] = [...nulls(59), 100, 100, 100];
    expect(detectCrossover(ma30, ma60)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('calcDifficultyRibbonCompression', () => {
  it('returns 0 for fewer than 200 data points', () => {
    const diffs = Array.from({ length: 100 }, (_, i) => ({ difficulty: 1e13 + i * 1e9 }));
    expect(calcDifficultyRibbonCompression(diffs)).toBe(0);
  });

  it('returns close to 1 for perfectly constant difficulty (max compression)', () => {
    const diffs = Array.from({ length: 250 }, () => ({ difficulty: 5e13 }));
    const score = calcDifficultyRibbonCompression(diffs);
    expect(score).toBeGreaterThan(0.95);
  });

  it('returns a lower score for widely spread difficulty values', () => {
    // Exponentially growing difficulty → wide ribbons → low compression
    const diffs = Array.from({ length: 250 }, (_, i) => ({ difficulty: 1e12 * (1 + i * 0.1) }));
    const score = calcDifficultyRibbonCompression(diffs);
    expect(score).toBeLessThan(0.5);
  });

  it('result is always in [0, 1]', () => {
    for (let trial = 0; trial < 5; trial++) {
      const diffs = Array.from({ length: 250 }, (_, i) => ({
        difficulty: 1e12 + Math.random() * 1e13 * (trial + 1),
      }));
      const s = calcDifficultyRibbonCompression(diffs);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('calcMinerScore', () => {
  it('returns a score between 0 and 100', () => {
    const s = calcMinerScore(1.2, false, false, 30000, 105000, 0.5);
    expect(s.value).toBeGreaterThanOrEqual(0);
    expect(s.value).toBeLessThanOrEqual(100);
  });

  it('gives high score for extreme buy conditions', () => {
    // Puell < 0.5, Hash Ribbons buy signal, BTC 3× above breakeven, high ribbon compression
    const s = calcMinerScore(0.3, false, true, 20000, 105000, 0.9);
    expect(s.value).toBeGreaterThan(75);
  });

  it('gives low score for capitulation conditions', () => {
    // Puell > 4, capitulation active, BTC below breakeven, no compression
    const s = calcMinerScore(5.0, true, false, 120000, 90000, 0.0);
    expect(s.value).toBeLessThan(40);
  });

  it('includes all four signal components', () => {
    const s = calcMinerScore(1.0, false, false, 40000, 100000, 0.5);
    expect(s.signals).toHaveProperty('puell');
    expect(s.signals).toHaveProperty('hashRibbons');
    expect(s.signals).toHaveProperty('breakeven');
    expect(s.signals).toHaveProperty('diffRibbon');
  });

  it('handles null Puell gracefully', () => {
    expect(() => calcMinerScore(null, false, false, 30000, 100000, 0.5)).not.toThrow();
  });
});
