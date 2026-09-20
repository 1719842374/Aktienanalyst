#!/usr/bin/env python3
"""Restore full TechnicalChart/Section2/Dashboard on numbering branch from main + transforms."""
from pathlib import Path
import subprocess, hashlib

ROOT = Path(__file__).resolve().parents[1]

def git_show(path: str) -> str:
    return subprocess.check_output(["git", "show", f"origin/main:{path}"], text=True)

def write(path: str, content: str) -> None:
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    print(path, len(content), hashlib.sha256(content.encode()).hexdigest()[:16])

# TechnicalChart: id={10} -> number={12}
tech = git_show("client/src/components/sections/TechnicalChart.tsx")
tech = tech.replace("id={10}", "number={12}")
assert "number={12}" in tech and "PLACEHOLDER" not in tech and "file://" not in tech
assert len(tech) > 30000
write("client/src/components/sections/TechnicalChart.tsx", tech)

# Section2: number={2} -> number={3} (main already uses number=)
s2 = git_show("client/src/components/sections/Section2.tsx")
s2 = s2.replace("number={2}", "number={3}").replace("id={2}", "number={3}")
assert "number={3}" in s2 and "PLACEHOLDER" not in s2 and len(s2) > 30000
write("client/src/components/sections/Section2.tsx", s2)

# Dashboard: SECTIONS 1-20 + mount refs
dash = git_show("client/src/pages/Dashboard.tsx")
old_sections = """const SECTIONS = [
  { id: 1, label: \"Datenaktualität\", icon: BarChart3 },
  { id: 2, label: \"Investmentthese\", icon: TrendingUp },
  { id: 3, label: \"Zyklusanalyse\", icon: Activity },
  { id: 4, label: \"Bewertung\", icon: Calculator },
  { id: 5, label: \"DCF-Modell\", icon: LineChart },
  { id: 6, label: \"CRV\", icon: Target },
  { id: 7, label: \"Rel. Bewertung\", icon: Scale },
  { id: 8, label: \"Risikoinversion\", icon: AlertTriangle },
  { id: 9, label: \"RSL-Momentum\", icon: Activity },
  { id: 10, label: \"Tech. Analyse\", icon: LineChart },
  { id: 11, label: \"Moat / Porter\", icon: Landmark },
  { id: 12, label: \"PESTEL\", icon: Globe },
  { id: 13, label: \"Makro-Korr.\", icon: BarChart3 },
  { id: 14, label: \"Reverse DCF\", icon: RotateCcw },
  { id: 15, label: \"Katalysatoren\", icon: Zap },
  { id: 16, label: \"Monte Carlo\", icon: Dice6 },
  { id: 17, label: \"Zusammenfassung\", icon: Table2 },
  { id: 18, label: \"Management-Score\", icon: UserCheck },
];"""
new_sections = """const SECTIONS = [
  { id: 1, label: \"Executive Summary\", icon: Sparkles },
  { id: 2, label: \"Datenaktualität\", icon: BarChart3 },
  { id: 3, label: \"Investmentthese\", icon: TrendingUp },
  { id: 4, label: \"Financial Statements\", icon: Shield },
  { id: 5, label: \"Zyklusanalyse\", icon: Activity },
  { id: 6, label: \"Bewertung\", icon: Calculator },
  { id: 7, label: \"DCF-Modell\", icon: LineChart },
  { id: 8, label: \"CRV\", icon: Target },
  { id: 9, label: \"Rel. Bewertung\", icon: Scale },
  { id: 10, label: \"Risikoinversion\", icon: AlertTriangle },
  { id: 11, label: \"RSL-Momentum\", icon: Activity },
  { id: 12, label: \"Tech. Analyse\", icon: LineChart },
  { id: 13, label: \"Moat / Porter\", icon: Landmark },
  { id: 14, label: \"PESTEL\", icon: Globe },
  { id: 15, label: \"Makro-Korr.\", icon: BarChart3 },
  { id: 16, label: \"Reverse DCF\", icon: RotateCcw },
  { id: 17, label: \"Katalysatoren\", icon: Zap },
  { id: 18, label: \"Monte Carlo\", icon: Dice6 },
  { id: 19, label: \"Zusammenfassung\", icon: Table2 },
  { id: 20, label: \"Management-Score\", icon: UserCheck },
];"""
if old_sections not in dash:
    raise SystemExit("SECTIONS block not found on main Dashboard")
dash = dash.replace(old_sections, new_sections)
dash = dash.replace(
    "// Canonical Monte Carlo run — computed once and shared by Section16 (display)\n  // and Section17 (summary) so both show identical figures instead of two",
    "// Canonical Monte Carlo run — computed once and shared by Section18 (display)\n  // and Section19 (summary) so both show identical figures instead of two",
)
dash = dash.replace(
    "// Section 15 -- nur wenn vorhanden (undefined bei aelteren",
    "// Section 17 -- nur wenn vorhanden (undefined bei aelteren",
)
reps = [
    ('<div ref={setSectionRef(18)}><SectionErrorBoundary sectionId={18} sectionLabel="Management-Score"><ManagementScoreSection data={data} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(20)}><SectionErrorBoundary sectionId={20} sectionLabel="Management-Score"><ManagementScoreSection data={data} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(17)}><SectionErrorBoundary sectionId={17} sectionLabel="Zusammenfassung"><SummarySection data={data} sharedMonteCarlo={sharedMonteCarlo} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(19)}><SectionErrorBoundary sectionId={19} sectionLabel="Zusammenfassung"><SummarySection data={data} sharedMonteCarlo={sharedMonteCarlo} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(16)}><SectionErrorBoundary sectionId={16} sectionLabel="Monte Carlo"><MonteCarloSection data={data} sharedResult={sharedMonteCarlo} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(18)}><SectionErrorBoundary sectionId={18} sectionLabel="Monte Carlo"><MonteCarloSection data={data} sharedResult={sharedMonteCarlo} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(15)}><SectionErrorBoundary sectionId={15} sectionLabel="Katalysatoren"><CatalystsSection',
     '<div ref={setSectionRef(17)}><SectionErrorBoundary sectionId={17} sectionLabel="Katalysatoren"><CatalystsSection'),
    ('<div ref={setSectionRef(14)}><SectionErrorBoundary sectionId={14} sectionLabel="Reverse DCF"><ReverseDCFSection data={data} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(16)}><SectionErrorBoundary sectionId={16} sectionLabel="Reverse DCF"><ReverseDCFSection data={data} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(13)}><SectionErrorBoundary sectionId={13} sectionLabel="Makro-Korr."><MacroCorrelationsSection data={data} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(15)}><SectionErrorBoundary sectionId={15} sectionLabel="Makro-Korr."><MacroCorrelationsSection data={data} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(12)}><SectionErrorBoundary sectionId={12} sectionLabel="PESTEL"><PestelSection data={data} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(14)}><SectionErrorBoundary sectionId={14} sectionLabel="PESTEL"><PestelSection data={data} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(11)}><SectionErrorBoundary sectionId={11} sectionLabel="Moat / Porter"><MoatPorterSection data={data} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(13)}><SectionErrorBoundary sectionId={13} sectionLabel="Moat / Porter"><MoatPorterSection data={data} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(10)}><SectionErrorBoundary sectionId={10} sectionLabel="Tech. Analyse"><TechnicalChart data={data} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(12)}><SectionErrorBoundary sectionId={12} sectionLabel="Tech. Analyse"><TechnicalChart data={data} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(9)}><SectionErrorBoundary sectionId={9} sectionLabel="RSL-Momentum"><Section9 data={data} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(11)}><SectionErrorBoundary sectionId={11} sectionLabel="RSL-Momentum"><Section9 data={data} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(8)}><SectionErrorBoundary sectionId={8} sectionLabel="Risikoinversion"><Section8 data={data} useLLM={useLLM} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(10)}><SectionErrorBoundary sectionId={10} sectionLabel="Risikoinversion"><Section8 data={data} useLLM={useLLM} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(7)}><SectionErrorBoundary sectionId={7} sectionLabel="Rel. Bewertung"><Section7 data={data} onPeerOverridesChange={(overrides) => { if (currentTickerRef.current) startAnalyze({ ticker: currentTickerRef.current, llm: useLLMRef.current, force: true, peerOverrides: overrides }); }} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(9)}><SectionErrorBoundary sectionId={9} sectionLabel="Rel. Bewertung"><Section7 data={data} onPeerOverridesChange={(overrides) => { if (currentTickerRef.current) startAnalyze({ ticker: currentTickerRef.current, llm: useLLMRef.current, force: true, peerOverrides: overrides }); }} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(6)}><SectionErrorBoundary sectionId={6} sectionLabel="CRV"><Section6 data={data} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(8)}><SectionErrorBoundary sectionId={8} sectionLabel="CRV"><Section6 data={data} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(5)}><SectionErrorBoundary sectionId={5} sectionLabel="DCF-Modell"><Section5 data={data} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(7)}><SectionErrorBoundary sectionId={7} sectionLabel="DCF-Modell"><Section5 data={data} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(4)}><SectionErrorBoundary sectionId={4} sectionLabel="Bewertung"><Section4 data={data} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(6)}><SectionErrorBoundary sectionId={6} sectionLabel="Bewertung"><Section4 data={data} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(3)}><SectionErrorBoundary sectionId={3} sectionLabel="Zyklusanalyse"><Section3 data={data} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(5)}><SectionErrorBoundary sectionId={5} sectionLabel="Zyklusanalyse"><Section3 data={data} /></SectionErrorBoundary></div>'),
    ('<SectionErrorBoundary sectionId="FS" sectionLabel="Financial Statements"><FinancialStatements data={data} /></SectionErrorBoundary>',
     '<div ref={setSectionRef(4)}><SectionErrorBoundary sectionId={4} sectionLabel="Financial Statements"><FinancialStatements data={data} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(2)}><SectionErrorBoundary sectionId={2} sectionLabel="Investmentthese"><Section2 data={data} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(3)}><SectionErrorBoundary sectionId={3} sectionLabel="Investmentthese"><Section2 data={data} /></SectionErrorBoundary></div>'),
    ('<div ref={setSectionRef(1)}><SectionErrorBoundary sectionId={1} sectionLabel="Datenaktualität"><Section1 data={data} onRefresh={() => { if (currentTickerRef.current) startAnalyze({ ticker: currentTickerRef.current, llm: useLLMRef.current, force: true }); }} /></SectionErrorBoundary></div>',
     '<div ref={setSectionRef(2)}><SectionErrorBoundary sectionId={2} sectionLabel="Datenaktualität"><Section1 data={data} onRefresh={() => { if (currentTickerRef.current) startAnalyze({ ticker: currentTickerRef.current, llm: useLLMRef.current, force: true }); }} /></SectionErrorBoundary></div>'),
    ('<ExecSummaryCard data={data} />',
     '<div ref={setSectionRef(1)}><ExecSummaryCard data={data} /></div>'),
]
for a, b in reps:
    if a not in dash:
        raise SystemExit("missing fragment: " + a[:100])
    dash = dash.replace(a, b, 1)
assert "setSectionRef(19)" in dash and "setSectionRef(20)" in dash
assert "PLACEHOLDER" not in dash and "file://" not in dash
write("client/src/pages/Dashboard.tsx", dash)
print("OK")
