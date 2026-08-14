# WORK.md – Bias Fixes & Scoring Logic Overhaul (Aktienanalyst)

**Status:** Draft based on analysis session 14.08.2026  
**Priority:** High – Core bias corrections before further feature work  
**Focus:** Make Inverse / Risk-Adjusted DCF the decision-relevant foundation when classic DCF is extrapolating unsustainable historical growth.

---

## 1. Critical Principle (Anti-Bias Core)

When the **Conservative DCF** is primarily an extrapolation of past EPS / FCF growth **and** one or more of the following risk flags are active, the system **must** switch the decision-relevant valuation base to the **Inverse / Risk-Adjusted / Hardened DCF**:

### Mandatory Switch Triggers (at least 2 required)

| Trigger | Threshold | Rationale |
|---------|-----------|---------|
| Total Expected Damage | ≥ 25% | High probability-weighted downside |
| Moat Rating | `None` or `Narrow` | No structural protection |
| Government Exposure | ≥ 25% | Regulatory price risk |
| DCF Upside vs Analyst Upside | ≥ 80 percentage points difference | Extreme model vs market divergence |
| Existing Gates active | Inventory build-up, Pricing Power erosion, SEC contradictions, etc. | Already implemented reality checks |
| Reverse DCF g* | Significantly below model growth assumptions | Market prices lower growth than model |

**Rule:**  
If ≥ 2 triggers are true → **Hardened / Inverse DCF becomes the base** for:
- Catalyst-Adjusted Target
- Decision-relevant CRV
- Executive Summary / Fazit upside numbers

The unadjusted Conservative DCF may still be shown for transparency (labelled “Unadjusted / Extrapolative”), but must not drive the main upside narrative.

---

## 2. WACC & Growth Hardening Rules

When the switch is triggered, apply the following adjustments **before** calculating the decision-relevant Base DCF:

### 2.1 WACC Adjustment

| Number of Triggers | WACC Uplift | Additional Floors |
|--------------------|-------------|-------------------|
| 2 | +0.50 – 0.75 pp | — |
| 3 | +0.90 – 1.20 pp | — |
| 4+ | +1.40 – 1.80 pp | — |

**Hard Floors (always applied when condition met):**
- Healthcare / Pharma + Gov Exposure ≥ 25% → WACC Floor **7.50%**
- Moat = None + Expected Damage ≥ 30% → WACC Floor **7.80%**

### 2.2 Growth Adjustment

**Near-term Growth (explicit forecast years):**
- Expected Damage 25–35% → –15% relative
- Expected Damage > 35% → –25% relative
- Moat = None → additional –10% relative
- Pricing Power Gate active → additional –10% relative

**Terminal Growth (g):**
- High regulatory exposure → max 2.0 – 2.3%
- Moat = None + high Expected Damage → max 1.8 – 2.0%

Only after these adjustments is the DCF used for Catalyst overlay and Fazit.

---

## 3. Negative Catalyst Classification (K5 Fix)

### Problem
Negative catalysts (▼) currently can receive a positive Brutto-Upside and still contribute positively to the GB-Summe (example K5: +0.87%).

### Required Fix – Variant A (Recommended)

```text
IF catalyst.direction == "negative" OR catalyst.flag == "▼":
    exclude from positive GB-Summe completely
    route only to Downside-Katalysatoren section
    GB contribution to upside = 0
```

**Alternative (Variant B):** Force negative sign on Brutto-Upside for ▼ events.

**Decision:** Implement **Variant A**.

---

## 4. Moat-Weighted Management & Thesis Scores

Management-Score and Thesis-Score must influence the overall score, but the strength of that influence depends on Moat quality.

### Moat Multiplier Table

| Moat Rating | Multiplier for Mgmt + Thesis Impact | Effect |
|-------------|-------------------------------------|------|
| Strong / Wide | 0.40 – 0.55 | Weaknesses heavily dampened |
| Moderate | 0.70 – 0.85 | Normal impact |
| Narrow / Limited | 1.00 – 1.15 | Full to slightly amplified |
| None | 1.20 – 1.40 | Weaknesses amplified |

**Formula sketch:**
```text
mgmt_adj = (Management_Score - 5.0) * mgmt_weight
thesis_adj = (Thesis_Score - 5.0) * thesis_weight

weighted_adj = (mgmt_adj * 0.60 + thesis_adj * 0.40) * moat_multiplier
```

This prevents strong-moat companies from being over-penalized and weak-moat companies from being under-penalized.

---

## 5. PESTEL Integration

PESTEL Exposure Score (0–10) is converted into a multiplicative dampening factor on the quantitative base score:

| PESTEL Exposure | Dampening Factor |
|-----------------|------------------|
| 0 – 3 (Low) | 1.00 |
| 4 – 6 (Medium) | 0.92 – 0.96 |
| 7 – 8 (High) | 0.82 – 0.88 |
| 9 – 10 (Very High) | 0.70 – 0.78 |

Additional flag: If Political = High **and** Government Exposure ≥ 25% → mandatory mention in Executive Summary.

---

## 6. Overall Score Formula (Target Architecture)

```text
Gesamtscore =
    (Quantitative_Base_Score × PESTEL_Factor)
  + (Management_Adjustment × Moat_Multiplier)
  + (Thesis_Adjustment × Moat_Multiplier)
  + Technical_Score_Component          # soft, not hard gate
  + Catalyst_Adjustment                # only positive GB after K5 fix
```

**Notes:**
- No hard binary gates that can produce extreme bull/bear flips.
- Technical analysis remains a separate soft component.
- Inverse / Hardened DCF feeds into Quantitative_Base_Score when triggers are active.

---

## 7. Executive Summary Requirements

The top Executive Summary must:

1. Show clear overall Ampel / recommendation.
2. Contain 3–5 sentences covering:
   - Business model / Moat quality
   - Valuation (explicitly stating whether Base DCF is hardened / inverse-based)
   - Technical / timing situation
3. Prominently surface the largest Red Flags (no Moat, high Expected Damage, DCF extrapolation risk, weak Management Score if applicable).
4. Only use the **decision-relevant** (hardened) valuation numbers for upside statements.

---

## 8. Implementation Priority

| Priority | Task | Status |
|----------|------|------|
| P0 | Negative catalyst (▼) exclusion from positive GB (Variant A) | To do |
| P0 | Inverse / Hardened DCF becomes base when ≥2 triggers active | To do |
| P0 | WACC uplift + Growth reduction rules | To do |
| P1 | Moat multiplier for Management + Thesis scores | To do |
| P1 | PESTEL dampening factor | To do |
| P1 | Executive Summary forced to use hardened numbers + Red Flag priority | To do |
| P2 | Fine-tune exact weights after testing on 10–15 names | Later |

---

## 9. Open Decisions (for next iteration)

- Exact numeric weights inside Management vs Thesis split (currently sketched 60/40).
- Exact WACC uplift ranges per trigger count (calibration needed).
- Whether Thesis Strength Score should also receive its own Moat-scaled treatment.

---

**Document Owner:** Aktienanalyst Project  
**Last Updated:** 14.08.2026  
**Next Action:** Implement P0 items (K5 fix + Inverse DCF as base + WACC/Growth hardening)
