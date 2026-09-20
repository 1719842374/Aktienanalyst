#!/usr/bin/env python3
"""Restore Tech/Section2/Dashboard from main + numbering transforms."""
from pathlib import Path
import urllib.request, hashlib

BASE = "https://raw.githubusercontent.com/1719842374/Aktienanalyst/main/"
ROOT = Path(__file__).resolve().parents[1]

def get(p: str) -> str:
    return urllib.request.urlopen(BASE + p, timeout=60).read().decode()

def put(p: str, c: str) -> None:
    fp = ROOT / p
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(c)
    print(p, len(c), hashlib.sha256(c.encode()).hexdigest()[:12])

tech = get("client/src/components/sections/TechnicalChart.tsx").replace("id={10}", "number={12}")
assert "number={12}" in tech and len(tech) > 30000 and "PLACEHOLDER" not in tech and "file://" not in tech
put("client/src/components/sections/TechnicalChart.tsx", tech)

s2 = get("client/src/components/sections/Section2.tsx").replace("number={2}", "number={3}").replace("id={2}", "number={3}")
assert "number={3}" in s2 and len(s2) > 30000 and "PLACEHOLDER" not in s2
put("client/src/components/sections/Section2.tsx", s2)

d = get("client/src/pages/Dashboard.tsx")
old = """const SECTIONS = [
  { id: 1, label: "Datenaktualität", icon: BarChart3 },
  { id: 2, label: "Investmentthese", icon: TrendingUp },
  { id: 3, label: "Zyklusanalyse", icon: Activity },
  { id: 4, label: "Bewertung", icon: Calculator },
  { id: 5, label: "DCF-Modell", icon: LineChart },
  { id: 6, label: "CRV", icon: Target },
  { id: 7, label: "Rel. Bewertung", icon: Scale },
  { id: 8, label: "Risikoinversion", icon: AlertTriangle },
  { id: 9, label: "RSL-Momentum", icon: Activity },
  { id: 10, label: "Tech. Analyse", icon: LineChart },
  { id: 11, label: "Moat / Porter", icon: Landmark },
  { id: 12, label: "PESTEL", icon: Globe },
  { id: 13, label: "Makro-Korr.", icon: BarChart3 },
  { id: 14, label: "Reverse DCF", icon: RotateCcw },
  { id: 15, label: "Katalysatoren", icon: Zap },
  { id: 16, label: "Monte Carlo", icon: Dice6 },
  { id: 17, label: "Zusammenfassung", icon: Table2 },
  { id: 18, label: "Management-Score", icon: UserCheck },
];"""
new = """const SECTIONS = [
  { id: 1, label: "Executive Summary", icon: Sparkles },
  { id: 2, label: "Datenaktualität", icon: BarChart3 },
  { id: 3, label: "Investmentthese", icon: TrendingUp },
  { id: 4, label: "Financial Statements", icon: Shield },
  { id: 5, label: "Zyklusanalyse", icon: Activity },
  { id: 6, label: "Bewertung", icon: Calculator },
  { id: 7, label: "DCF-Modell", icon: LineChart },
  { id: 8, label: "CRV", icon: Target },
  { id: 9, label: "Rel. Bewertung", icon: Scale },
  { id: 10, label: "Risikoinversion", icon: AlertTriangle },
  { id: 11, label: "RSL-Momentum", icon: Activity },
  { id: 12, label: "Tech. Analyse", icon: LineChart },
  { id: 13, label: "Moat / Porter", icon: Landmark },
  { id: 14, label: "PESTEL", icon: Globe },
  { id: 15, label: "Makro-Korr.", icon: BarChart3 },
  { id: 16, label: "Reverse DCF", icon: RotateCcw },
  { id: 17, label: "Katalysatoren", icon: Zap },
  { id: 18, label: "Monte Carlo", icon: Dice6 },
  { id: 19, label: "Zusammenfassung", icon: Table2 },
  { id: 20, label: "Management-Score", icon: UserCheck },
];"""
if old not in d:
    raise SystemExit("SECTIONS block missing")
d = d.replace(old, new)
d = d.replace(
    "// Canonical Monte Carlo run — computed once and shared by Section16 (display)\n  // and Section17 (summary) so both show identical figures instead of two",
    "// Canonical Monte Carlo run — computed once and shared by Section18 (display)\n  // and Section19 (summary) so both show identical figures instead of two",
)
d = d.replace(
    "// Section 15 -- nur wenn vorhanden (undefined bei aelteren",
    "// Section 17 -- nur wenn vorhanden (undefined bei aelteren",
)
# remap mounts high→low to avoid double-hit
subs = [
    ("setSectionRef(18)\"><SectionErrorBoundary sectionId={18} sectionLabel=\"Management-Score\"",
     "setSectionRef(20)\"><SectionErrorBoundary sectionId={20} sectionLabel=\"Management-Score\""),
    ("setSectionRef(17)\"><SectionErrorBoundary sectionId={17} sectionLabel=\"Zusammenfassung\"",
     "setSectionRef(19)\"><SectionErrorBoundary sectionId={19} sectionLabel=\"Zusammenfassung\""),
    ("setSectionRef(16)\"><SectionErrorBoundary sectionId={16} sectionLabel=\"Monte Carlo\"",
     "setSectionRef(18)\"><SectionErrorBoundary sectionId={18} sectionLabel=\"Monte Carlo\""),
    ("setSectionRef(15)\"><SectionErrorBoundary sectionId={15} sectionLabel=\"Katalysatoren\"",
     "setSectionRef(17)\"><SectionErrorBoundary sectionId={17} sectionLabel=\"Katalysatoren\""),
    ("setSectionRef(14)\"><SectionErrorBoundary sectionId={14} sectionLabel=\"Reverse DCF\"",
     "setSectionRef(16)\"><SectionErrorBoundary sectionId={16} sectionLabel=\"Reverse DCF\""),
    ("setSectionRef(13)\"><SectionErrorBoundary sectionId={13} sectionLabel=\"Makro-Korr.\"",
     "setSectionRef(15)\"><SectionErrorBoundary sectionId={15} sectionLabel=\"Makro-Korr.\""),
    ("setSectionRef(12)\"><SectionErrorBoundary sectionId={12} sectionLabel=\"PESTEL\"",
     "setSectionRef(14)\"><SectionErrorBoundary sectionId={14} sectionLabel=\"PESTEL\""),
    ("setSectionRef(11)\"><SectionErrorBoundary sectionId={11} sectionLabel=\"Moat / Porter\"",
     "setSectionRef(13)\"><SectionErrorBoundary sectionId={13} sectionLabel=\"Moat / Porter\""),
    ("setSectionRef(10)\"><SectionErrorBoundary sectionId={10} sectionLabel=\"Tech. Analyse\"",
     "setSectionRef(12)\"><SectionErrorBoundary sectionId={12} sectionLabel=\"Tech. Analyse\""),
    ("setSectionRef(9)\"><SectionErrorBoundary sectionId={9} sectionLabel=\"RSL-Momentum\"",
     "setSectionRef(11)\"><SectionErrorBoundary sectionId={11} sectionLabel=\"RSL-Momentum\""),
    ("setSectionRef(8)\"><SectionErrorBoundary sectionId={8} sectionLabel=\"Risikoinversion\"",
     "setSectionRef(10)\"><SectionErrorBoundary sectionId={10} sectionLabel=\"Risikoinversion\""),
    ("setSectionRef(7)\"><SectionErrorBoundary sectionId={7} sectionLabel=\"Rel. Bewertung\"",
     "setSectionRef(9)\"><SectionErrorBoundary sectionId={9} sectionLabel=\"Rel. Bewertung\""),
    ("setSectionRef(6)\"><SectionErrorBoundary sectionId={6} sectionLabel=\"CRV\"",
     "setSectionRef(8)\"><SectionErrorBoundary sectionId={8} sectionLabel=\"CRV\""),
    ("setSectionRef(5)\"><SectionErrorBoundary sectionId={5} sectionLabel=\"DCF-Modell\"",
     "setSectionRef(7)\"><SectionErrorBoundary sectionId={7} sectionLabel=\"DCF-Modell\""),
    ("setSectionRef(4)\"><SectionErrorBoundary sectionId={4} sectionLabel=\"Bewertung\"",
     "setSectionRef(6)\"><SectionErrorBoundary sectionId={6} sectionLabel=\"Bewertung\""),
    ("setSectionRef(3)\"><SectionErrorBoundary sectionId={3} sectionLabel=\"Zyklusanalyse\"",
     "setSectionRef(5)\"><SectionErrorBoundary sectionId={5} sectionLabel=\"Zyklusanalyse\""),
    ("<SectionErrorBoundary sectionId=\"FS\" sectionLabel=\"Financial Statements\"><FinancialStatements data={data} /></SectionErrorBoundary>",
     "<div ref={setSectionRef(4)}><SectionErrorBoundary sectionId={4} sectionLabel=\"Financial Statements\"><FinancialStatements data={data} /></SectionErrorBoundary></div>"),
    ("setSectionRef(2)\"><SectionErrorBoundary sectionId={2} sectionLabel=\"Investmentthese\"",
     "setSectionRef(3)\"><SectionErrorBoundary sectionId={3} sectionLabel=\"Investmentthese\""),
    ("setSectionRef(1)\"><SectionErrorBoundary sectionId={1} sectionLabel=\"Datenaktualität\"",
     "setSectionRef(2)\"><SectionErrorBoundary sectionId={2} sectionLabel=\"Datenaktualität\""),
    ("<ExecSummaryCard data={data} />",
     "<div ref={setSectionRef(1)}><ExecSummaryCard data={data} /></div>"),
]
for a, b in subs:
    if a not in d:
        raise SystemExit("missing: " + a[:80])
    d = d.replace(a, b, 1)
assert "setSectionRef(19)" in d and "setSectionRef(20)" in d
assert "PLACEHOLDER" not in d and "file://" not in d
put("client/src/pages/Dashboard.tsx", d)
print("OK")
