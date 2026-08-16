"""
robust_stats.py
---------------
Generische robuste Statistik-Utilities für Finanz-Analysen
(Reverse-DCF-Basket, Peer-Vergleiche, etc.).

Python-Referenzimplementierung (identisch zur TypeScript-Version
in client/src/lib/robustStats.ts).

Methoden:
- Quantile R-7 (Excel PERCENTILE.INC / NumPy linear)
- Winsorisierung
- Winsorized Median
- Getrimmter Mittelwert (optional)

Keine externen Abhängigkeiten außer der Standardbibliothek.
"""

from __future__ import annotations
from typing import Sequence, List, Optional
import math
import unittest


def quantile_r7(data: Sequence[float], p: float) -> float:
    """
    Quantile nach Hyndman-Fan Typ 7 (R-7).
    Identisch mit Excel PERCENTILE.INC und NumPy method='linear'.
    """
    if not 0.0 <= p <= 1.0:
        raise ValueError("p muss im Intervall [0, 1] liegen")

    sorted_data = sorted(x for x in data if math.isfinite(x))
    n = len(sorted_data)
    if n == 0:
        raise ValueError("Keine endlichen Werte")
    if n == 1:
        return float(sorted_data[0])
    if p == 0.0:
        return float(sorted_data[0])
    if p == 1.0:
        return float(sorted_data[-1])

    h = p * (n - 1)
    h_floor = math.floor(h)
    h_ceil = math.ceil(h)
    frac = h - h_floor

    return float(sorted_data[h_floor] * (1.0 - frac) + sorted_data[h_ceil] * frac)


def winsorize(
    data: Sequence[float],
    lower: float = 0.05,
    upper: float = 0.95,
) -> List[float]:
    """
    Winsorisierung: Extreme Werte werden auf die Quantile gesetzt.
    Beobachtungen bleiben erhalten (n ändert sich nicht).
    """
    if not 0.0 <= lower < upper <= 1.0:
        raise ValueError("Es muss 0 <= lower < upper <= 1 gelten")

    clean = [x for x in data if math.isfinite(x)]
    if len(clean) < 4:
        return clean[:]  # zu klein → keine Winsorisierung

    q_low = quantile_r7(clean, lower)
    q_high = quantile_r7(clean, upper)

    return [max(q_low, min(q_high, x)) for x in clean]


def winsorized_median(
    data: Sequence[float],
    lower: float = 0.05,
    upper: float = 0.95,
) -> Optional[float]:
    """
    Empfohlene Aggregationsfunktion für Peer-Baskets:
    Median der winsorisierten Werte.
    """
    w = winsorize(data, lower, upper)
    if not w:
        return None
    s = sorted(w)
    mid = len(s) // 2
    if len(s) % 2 == 0:
        return (s[mid - 1] + s[mid]) / 2.0
    return float(s[mid])


def trimmed_mean(
    data: Sequence[float],
    proportiontocut: float = 0.05,
) -> Optional[float]:
    """
    Getrimmter Mittelwert (optional).
    Entfernt den Anteil proportiontocut unten und oben.
    Bei kleinen n oft wirkungslos → Winsorisierung bevorzugen.
    """
    clean = sorted(x for x in data if math.isfinite(x))
    n = len(clean)
    if n == 0:
        return None

    k = int(math.floor(proportiontocut * n))
    if 2 * k >= n:
        return None  # zu aggressiv

    trimmed = clean[k : n - k]
    return sum(trimmed) / len(trimmed)


def compute_basket_growth(
    revenue_cagrs: Sequence[float],
    eps_cagrs: Sequence[float],
    lower: float = 0.05,
    upper: float = 0.95,
) -> Optional[float]:
    """
    g_basket = 0.6 * winsorized_median(Revenue-CAGR) + 0.4 * winsorized_median(EPS-CAGR)
    """
    g_rev = winsorized_median(revenue_cagrs, lower, upper)
    g_eps = winsorized_median(eps_cagrs, lower, upper)

    if g_rev is None and g_eps is None:
        return None
    if g_rev is None:
        return g_eps
    if g_eps is None:
        return g_rev
    return 0.6 * g_rev + 0.4 * g_eps


# ---------------------------------------------------------------------------
# Unit-Tests
# ---------------------------------------------------------------------------

class TestRobustStats(unittest.TestCase):
    DATA = [-18.2, 3.1, 8.4, 11.0, 13.7, 15.9, 21.4, 94.6]

    def test_quantile_r7_excel_compatibility(self):
        q05 = quantile_r7(self.DATA, 0.05)
        q95 = quantile_r7(self.DATA, 0.95)
        self.assertAlmostEqual(q05, -10.745, places=3)
        self.assertAlmostEqual(q95, 68.98, places=2)

    def test_quantile_edge_cases(self):
        self.assertEqual(quantile_r7([5.0], 0.5), 5.0)
        self.assertEqual(quantile_r7(self.DATA, 0.0), -18.2)
        self.assertEqual(quantile_r7(self.DATA, 1.0), 94.6)

    def test_winsorize_5_95(self):
        w = winsorize(self.DATA, 0.05, 0.95)
        self.assertEqual(len(w), 8)
        self.assertAlmostEqual(min(w), -10.745, places=3)
        self.assertAlmostEqual(max(w), 68.98, places=2)

    def test_winsorized_median(self):
        med = winsorized_median(self.DATA)
        self.assertAlmostEqual(med, 12.35, places=2)

    def test_small_sample_no_winsorize(self):
        small = [1.0, 2.0, 100.0]
        w = winsorize(small)
        self.assertEqual(w, [1.0, 2.0, 100.0])

    def test_trimmed_mean(self):
        tm = trimmed_mean(self.DATA, 0.05)
        classic_mean = sum(self.DATA) / len(self.DATA)
        self.assertAlmostEqual(tm, classic_mean, places=5)

        tm2 = trimmed_mean(self.DATA, 0.125)
        self.assertAlmostEqual(tm2, 12.25, places=2)

    def test_compute_basket_growth(self):
        rev = [0.04, 0.09, 0.11, 0.14, 0.16, 0.22, 0.87, -0.12]
        eps = [0.03, 0.08, 0.10, 0.13, 0.15, 0.20, 0.70, -0.15]
        g = compute_basket_growth(rev, eps)
        self.assertIsNotNone(g)
        self.assertTrue(0 < g < 0.5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
