# CareTip Performance Insights — Forensic Audit

**Scope:** Team → Performance (overview tab), `BusinessExecutivePerformance`  
**Mode:** Read-only analysis (no code, UI, API, or calculation changes)  
**Date:** 2026-09-27  
**Default analytics timeframe on this page:** `month` (`useBusinessIntelligenceData(..., true)` — no period toggle on Performance)

---

# Executive Summary

CareTip Performance insights are **not AI-generated**. They are **deterministic, client-side rules** in `src/app/lib/businessIntelligence.ts`, fed by `runBusinessIntelligenceEngine()` (`businessIntelligenceEngine.ts`) when `buildBusinessAnalyticsDTO()` builds the analytics bundle (`businessAnalyticsService.ts`). Data originates from `GET /api/business/me/stats` (scoped by timeframe, default **month**), `GET /api/tips/business` (recent tips sample, `take: 100`, `range: month`), and `getBusinessQrAnalytics()` when advanced analytics is enabled.

**Strengths:** Most numeric claims trace to explicit formulas; risks/opportunities carry `evidenceKey` strings; growth uses backend `queryPriorPeriodTipTotals` (equal-length prior window, `status = 'success'` tips only).

**Critical weaknesses:**

1. **Copy vs math:** User-facing English often says “period average,” “this week,” or “monthly average” while the implementation compares **current period total tips vs immediately preceding equal-length window** (month-over-month when timeframe is month), or compares **month participation % vs current calendar-week unique tippers** while labeling both as “over the last week.”
2. **“Risk” is heuristic:** Thresholds (e.g. participation &lt; 50%, growth &lt; −5%) are product constants, not verified business risk models; several items are **observations** dressed as risks.
3. **Recommendations are playbooks:** Mapped from risk/opportunity IDs to generic actions (QR visibility, promote QRs, goals) **without causal evidence** in data.
4. **Volume and duplication:** Up to **6 risks**, **6 opportunities**, **5 recommendations**, **4 executive insight lines**, plus KPI strips — often from the **same signal** (e.g. tip growth).
5. **Mislabeled UI:** “Key insights” shows KPI tiles; narrative insights appear under **“Trends”**; “Business health trends” chart plots a **tip-count proxy**, not employee participation %.

**FINAL VERDICT (preview):** **PARTIALLY TRUSTWORTHY** — core KPIs and growth math are largely reproducible, but many narrative insights are **misworded**, **redundant**, or **unsupported as risks/recommendations**.

---

# Performance Insight Architecture

## End-to-end pipeline

```text
BusinessTeamPerformancePage (tab=overview)
  → useBusinessIntelligenceData(enabled, advancedAnalytics=true, timeframe="month")
    → useBusinessAnalytics({ includeIntelligence: true })
      → fetchBusinessAnalyticsBundle()
          → getBusinessStats(timeframe)     // backend SQL bundle + priorPeriod
          → listBusinessTips(feed params)   // recentTips sample
          → getBusinessQrAnalytics()        // if entitled
      → buildBusinessAnalyticsDTO(bundle)
          → buildBusinessIntelligenceInput(...)
          → runBusinessIntelligenceEngine(input)
  → BusinessExecutivePerformance({ data })
      → Renders: Executive Summary, Business Health, Health Trends chart,
                 Key Insights (KPI tiles), Risks, Opportunities, Recommendations,
                 Trends (executiveInsights lines)
```

## Backend anchors

| Concern | Implementation |
|--------|------------------|
| Period totals | `queryBusinessDashboardSqlBundle` / summary metrics for selected timeframe |
| Prior window | `queryPriorPeriodTipTotals`: duration = `rangeEnd - rangeStart`, prior ends 1 ms before `rangeStart` (`tipChartBuckets.ts`) |
| Employee `tipCount` / `tipsTotal` | Per-employee aggregates for **same period** as stats (`business.service.ts` → `tipsByEmployee`) |
| `activeEmployees` | `operationalPulse.tippingReadyEmployees` ?? `rosterTotal` ?? active roster count |
| `employeesReceivingTips` | `employees.filter(e => e.tipCount > 0).length` (period-scoped) |

## Intelligence generators (caps)

| Output | Function | Max items |
|--------|----------|-----------|
| Risks | `generateExecutiveRisks` | 6 (`slice(0,6)`) |
| Opportunities | `generateOpportunities` | 6 |
| Recommendations | `generateExecutiveRecommendations` | 5 |
| Executive summary clauses | `generateExecutiveSummary` | 3 (UI shows **only clause 0**) |
| Executive insights (narrative) | `generateExecutiveInsights` | 4 |

## Determinism

All generators are **rule-based and deterministic** (no LLM). Wording comes from i18n keys under `business.team.performance.executive.*` in `src/i18n/locales/en.json`.

---

# Complete Insight Inventory

**Legend — Verdict column:** A=Critical, B=Important, C=Observation, D=Weak, E=Unsupported, F=Redundant, G=Misleading  

**Note:** Only insights that **can** appear are listed; runtime shows subsets when conditions fail. IDs are audit IDs, not necessarily equal to code `id` fields (code `id` noted).

| ID | Section | Current text (EN template) | Source metric | Calculation | Comparison | Trigger | Evidence | Actionability | Confidence | Verdict |
|----|---------|---------------------------|---------------|-------------|------------|---------|----------|---------------|------------|---------|
| UI-KPI-01 | Executive Summary | Growth rate % | `period.totalTips`, `priorPeriod.totalTips` | `comparableGrowthPercent` | Equal-length prior window | `growthComparable` | High if prior &gt; 0 | Monitor tips | High | B |
| UI-KPI-02 | Executive Summary | Employee participation % | `employeesReceivingTips`, `activeEmployees` | `receiving/active*100` | None (level) | Always | High | Staff coverage | High | B |
| UI-KPI-03 | Executive Summary | Goal completion % | `employeeGoals` or `pulse` | Avg goal % or on-track ratio | Implicit 50% in risks only | Always | Medium if no goals | Goals program | Medium | B |
| UI-KPI-04 | Executive Summary | Period tip count | `period.tipCount` | SQL count | None | Always | High | Volume | High | D (KPI) |
| SUM-01 | Executive Summary (line) | Revenue up {{percent}}% vs **period average** | Revenue growth | Prior-window % | Prior equal window | `growthComparable && growthPercent > 5` | Math yes; **wording no** | Directional | Medium | G |
| SUM-02 | Executive Summary | Revenue declined {{percent}}% vs **period average** | Same | Same | Prior window | `growthPercent < -5` (comparable implied) | Math yes; **wording no** | Directional | Medium | G |
| SUM-03 | Executive Summary | Revenue stable this period | `period.tipCount` | Clause fallback | N/A | Tips &gt; 0, growth not &gt;5 or &lt;−5 | High | Low | High | D |
| SUM-04 | Executive Summary | QR scan activity grew {{percent}}% in second half | `qr.scanTrend` | Half-series momentum | First vs second half of trend array | `qrMomentum > 10` | Medium (QR sample) | QR ops | Medium | C |
| SUM-05 | Executive Summary | QR scan activity declined (second half) | QR risk flag | Same momentum | Half split | Risk `qr-scan-decline` | Medium | QR ops | Medium | F |
| SUM-06 | Executive Summary | Participation {{from}}% → {{to}}% **over last week** | Period vs week participation | See PART-01 | Month % vs calendar week % | Participation risks | **Mislabeled period** | Engagement | Low | G |
| SUM-07 | Executive Summary | Only {{percent}}% received tips | Period participation | Period rollup | Threshold 50% risk context | Low participation risk | High | Staffing | Medium | C |
| SUM-08 | Executive Summary | Participation strong at {{percent}}% | Snapshot participation | ≥ 70% | Level | No participation risk | High | Positive signal | Medium | D |
| SUM-09 | Executive Summary | Goals at {{percent}}%, below target | Goal completion | Avg / pulse | **Target = 50% in code** | `goal-completion-risk` | Medium | Goals | Medium | C |
| SUM-10 | Executive Summary | Collecting enough activity… | None | Empty clauses | N/A | No clauses | N/A | Wait | High | B |
| HLTH-01 | Business Health | Score /100 + grade | 6 components × ~16.67 cap | Weighted sum | Grade 85/70/50 | Always | Formula documented in code | Interpret composite | Medium | C |
| HLTH-02 | Business Health | Growth % repeated | Same as KPI-01 | Same | Prior window | Always shown | High | Redundant with SUM | High | F |
| TREND-01 | Business Health Trends | Chart “participation” | `dailyTipDistribution` | `round(amount/avgTip)` proxy | Per day | Chart | **Not participation %** | Misleading label | Low | G |
| KEY-01 | Key Insights (tiles) | Tip growth % | `snapshot.growthRate` | Same as growth | Prior window | If comparable | High | Same as KPI | High | F |
| KEY-02 | Key Insights | Participation % | Snapshot | Period % | None | Always | High | F |
| KEY-03 | Key Insights | Peak period HH:00 | `peakHour` or `recentTips` hours | Max count hour | Sample | If peak found | Medium (sample) | Scheduling | Medium | B |
| INS-01 | Trends (executiveInsights) | Tips +{{percent}}% **this week vs monthly average** | Revenue growth | **Prior window %** | **Not monthly average** | `growthComparable && growth≠0` | Math ok; **copy wrong** | Low | Low | G |
| INS-02 | Trends | Peak activity between {{period}} | Peak hour | SQL or recentTips | N/A | `peakPeriod ≠ —` | Medium | Ops timing | Medium | C |
| INS-03 | Trends | {{table}} +{{percent}}% vs average | `recentTips` by table | Lift vs mean tip in sample | Recent sample only | `lift > 0` | Low if sample small | Table focus | Low | D |
| INS-04 | Trends | Participation {{from}}→{{to}}% **last week** | PART-01 | Month vs week | Δ &gt; 8 pp | See PART-01 | Low | Engagement | Low | G |
| INS-05 | Trends | QR scans +{{percent}}% second half | QR momentum | Half trend | In QR period | `> 10` | Medium | QR | Medium | C |
| RISK-01 | Risks | Tip volume declined {{percent}}% **this week vs period average** | Revenue growth | Prior window % | Prior window | `comparable && growth < -5` | Math; **wording** | Recover volume | Medium | G |
| RISK-02 | Risks | Only {{percent}}% received tips | Period participation | Level | **&lt; 50%** | `periodParticipation < 50` | High | Observation; **risk threshold arbitrary** | Medium | C |
| RISK-03 | Risks | Participation {{from}}→{{to}}% **last week** | PART-01 | Month vs calendar week | Δ &gt; 8 pp | Same as INS-04 | Low | **Not WoW** | Low | G |
| RISK-04 | Risks | Goal completion {{percent}}%, below target | Goals | &lt; **50%** | Code target 50% | `goalCompletion > 0 && < 50` | Medium | Goals | Medium | C |
| RISK-05 | Risks | No tips despite active staff | `period.tipCount` | Zero tips | Period | `tipCount===0 && active>0` | High | **Clear operational signal** | High | A |
| RISK-06 | Risks | QR scans declined {{percent}}% | QR momentum | &lt; **−15%** | Half trend | scans &gt; 0 | Medium | QR | Medium | C |
| RISK-07 | Risks | {{location}} low scans vs average | `scansByLocation` | Weakest &lt; 35% of mean | ≥2 locations, ≥10 scans | Heuristic | Medium | Placement | Low | C |
| RISK-08 | Risks | Avg rating {{rating}}, below target | Employee ratings | Avg rated; **&lt; 3.5**, ≥3 rated | Static threshold | Medium | Feedback | Medium | C |
| OPP-01 | Opportunities | Participation {{percent}}% — room to grow | Period % | &lt; **80%** | Level | Duplicates RISK-02 band | Medium | C | F |
| OPP-02 | Opportunities | Enable team goals | `pulse.goalsTracked` | &lt; half of active | Roster | Medium | Hypothesis | D |
| OPP-03 | Opportunities | Tips +{{percent}}% — keep momentum | Revenue growth | &gt; **10%** | Prior window | Same as INS-01 | Medium | F |
| OPP-04 | Opportunities | QR scans grew {{percent}}% | QR momentum | &gt; **15%** | Half trend | Medium | C | F |
| OPP-05 | Opportunities | Top location scans | Max location count | ≥5 scans | Leader | Descriptive | D |
| OPP-06 | Opportunities | Top table scans | Max table | ≥3 scans | Descriptive | D |
| OPP-07 | Opportunities | {{name}} {{share}}% of tips | Top earner share | ≥ **15%** | Period tips | High | Recognition | B |
| OPP-08 | Opportunities | {{table}} {{share}}% recent tip revenue | `recentTips` tables | Share ≥ **20%** | Recent sample | Sample-limited | D |
| REC-01 | Recommendations | Increase QR visibility… | From RISK-01 | Playbook | N/A | `tip-volume-decline` | **No causal proof** | Hypothesis | Low | E |
| REC-02 | Recommendations | Promote individual team QR codes | Participation risks/OPP-01 | Playbook | N/A | Participation | **Correlation only** | Hypothesis | Low | E |
| REC-03 | Recommendations | Enable/review team goals | RISK-04 | Playbook | N/A | Goals | Plausible | Low | E |
| REC-04 | Recommendations | Review QR placement | QR risks | Playbook | N/A | QR | Plausible | Low | E |
| REC-05 | Recommendations | Review guest feedback | RISK-08 | Playbook | N/A | Ratings | Plausible | Medium | E |
| REC-06 | Recommendations | Keep QRs visible — momentum | OPP-03 | Playbook + growth % | N/A | Growth | **Unsupported causal** | Low | E |
| REC-07 | Recommendations | Replicate top location | OPP-05 | Playbook | N/A | Top location | Hypothesis | Low | E |
| REC-08 | Recommendations | Recognize {{name}} | OPP-07 | Playbook | N/A | Top earner | **Actionable praise** | Medium | B |

### PART-01 (shared definition — participation decline)

| Field | Implementation |
|-------|----------------|
| **Period participation (`from`)** | `round(employeesReceivingTips / activeEmployees * 100)` where receiving = staff with **period** `tipCount > 0` |
| **Week participation (`to`)** | Unique `employeeId` in `recentTips` whose `createdAt` falls on **current venue calendar week** (Mon–Sun keys) / `activeEmployees` |
| **Trigger** | `weekParticipation < periodParticipation - 8` (and both &gt; 0) |
| **Labeled as** | “over the last week” (EN) |
| **Actual comparison** | **Month-to-date (or selected period) coverage vs current-week tippers**, using a **max 100-tip recent feed**, not prior-week participation |

---

# Factual Verification

## Revenue growth (895%-style claims)

| Check | Result |
|-------|--------|
| Formula | `round((current - prior) / prior * 100)` when `prior > 0` |
| Zero/near-zero prior | `growthComparable = false`; growth displayed as **0** / “—” in KPI when not comparable |
| Period boundaries | Backend timeframe range for `period`; prior window equal length immediately before |
| Timezone | Venue timezone for chart buckets; prior totals use `created_at` UTC instants from SQL |
| Wording “week” / “monthly average” | **Not implemented** — default page timeframe is **month**, so growth is **month vs previous month** (equal length), not week vs month average |

**Reproducibility:** Yes from `period.totalTips`, `priorPeriod.totalTips` in stats payload.

## Employee participation %

| Check | Result |
|-------|--------|
| Numerator | Count of employees with period `tipCount > 0` |
| Denominator | Tipping-ready (or roster) count |
| Includes inactive? | Employees array is roster-shaped; inactive may still appear depending on API filter |
| **100% → 56% narrative** | Factually means period % vs **week** % per PART-01, **not** “was 100% last week” |

## Goal completion “below target”

| Check | Result |
|-------|--------|
| Target in UI | “below target” |
| Target in code | **50%** (`goal-completion-risk`, summary clause) — not business-configured |

## Guest satisfaction “below your target”

| Check | Result |
|-------|--------|
| Target in code | **3.5** stars, minimum **3** rated employees |

## QR momentum

| Check | Result |
|-------|--------|
| Formula | Split `scanTrend` array in half; % change in scan counts |
| Meaning | Second half of **analytics QR period**, not necessarily calendar week |

## Table lift insight

Uses **`recentTips` only** (bounded sample), not full `tableRankings` SQL — lift can disagree with period rankings.

---

# Comparison Verification

| Claim pattern | Stated comparison | Actual comparison | Valid? |
|---------------|-------------------|-------------------|--------|
| Revenue % in summary/risks/insights | Period average / this week | Prior equal-length window | **No — misworded** |
| Participation decline | Last week | Period % vs current calendar week % | **No — misworded** |
| QR growing | Second half of period | First vs second half of `scanTrend` | **Yes** if QR timeframe aligns |
| Top tipping table | Recent revenue | `recentTips` subset | **Partial period/sample** |
| Employee excellence share | Period tips | Full period employee totals | **Yes** |
| Health trend chart | Employee participation | Estimated daily tip count proxy | **No — mislabeled** |

**Partial periods:** Current month vs full prior month is standard MoM but **early in month** can exaggerate swings; not qualified in UI.

**Insufficient prior volume:** Growth hidden (`—`) when prior € = 0; health score still uses **0** growth component (does not distinguish “unknown” vs “flat”).

---

# Risk Verification

| Risk ID | Explicit “risk” rule? | Threshold | Justified as business risk? |
|---------|------------------------|-----------|-----------------------------|
| tip-volume-decline | Growth &lt; −5% vs prior | −5% / −15% severity | **Observation + arbitrary cutoff** — not validated risk |
| low-participation-risk | &lt; 50% period participation | 50% | **Product threshold**, not employer-defined minimum |
| participation-decline | 8 pp month vs week | 8 pp | **Mixed periods** — not sustained trend |
| goal-completion-risk | &lt; 50% | 50% | Internal target only |
| no-tip-activity | Zero tips, active staff | Hard zero | **Strong operational risk signal** |
| qr-scan-decline | Momentum &lt; −15% | −15% | Heuristic |
| location-underperformance | &lt; 35% of mean scans | 35%, ≥10 scans | Heuristic |
| satisfaction-decline | Avg &lt; 3.5 | 3.5 stars | Heuristic |

**Classification:** Most risks are **OBSERVATION — NOT A VERIFIED RISK** except **no-tip-activity** (and arguably **large sustained tip decline** if wording were fixed and period qualified).

**UI:** Empty risk section renders **nothing** — no “no significant risks” copy.

---

# Recommendation Verification

| Rec | Trigger | Evidence → action link | Classification |
|-----|---------|------------------------|----------------|
| boostVisibility | Tip decline risk | Decline → QR visibility | **Unsupported causal claim** |
| promoteTeamQrs | Low/declining participation | Low tippers → personal QRs | **Plausible hypothesis** |
| enableGoals | Low goal completion | Low % → enable goals | **Plausible hypothesis** |
| reviewQrPlacement | QR/location risks | Scan heuristic → placement | **Plausible hypothesis** |
| reviewFeedback | Low ratings | Low avg → read feedback | **Plausible hypothesis** |
| maintainMomentum | Tip growth opportunity | Growth → keep QRs visible | **Unsupported causal claim** |
| replicateLocation | Top location | Leader → copy | **Hypothesis** |
| recognizePerformer | Top earner share | Concentration → recognition | **Supported as management action** (non-causal) |

Code comment: *“derived only from detected risks and opportunities — never invented”* — true for **triggering**, false for **action efficacy**.

---

# Causality Audit

| Statement | Classification |
|-----------|----------------|
| Increase QR visibility to recover tip volume | **Unsupported causal claim** |
| Promote team QR codes (participation) | **Plausible hypothesis** |
| Enable goals to improve completion | **Plausible hypothesis** |
| Keep QRs visible to maintain momentum | **Unsupported causal claim** |
| Replicate top location | **Plausible hypothesis** |
| Recognize top earner | **Non-causal management suggestion** (appropriate) |

**Rule:** Correlation (growth, scans, participation) must not be shown as proven mechanism; current EN copy often implies it.

---

# Data Sufficiency Audit

| Signal | Sufficiency concerns |
|--------|---------------------|
| Growth % | Unstable when prior tiny; suppressed when prior = 0; large % from small bases **not capped** |
| Week participation | `recentTips` cap **100**; busy venues under-count unique week tippers |
| Peak hour (fallback) | From `recentTips`, not full period if `peakHour` missing |
| Table lift / top tipping table | Recent sample bias |
| QR location risk | Needs ≥2 locations, ≥10 total scans |
| Ratings risk | Needs ≥3 rated employees |
| New business | Prior window may be empty → no growth; many clauses → “collecting data” |
| Participation trend chart | Derived proxy, not headcount participation |
| Goals | `goalsTracked: 0` in summary payload path — opportunities may still suggest goals from pulse elsewhere when loaded |

---

# Duplicate / Redundancy Audit

| Underlying signal | Appears in |
|-------------------|------------|
| Revenue growth % | Executive KPI grid, Business Health growth, Key Insights tile, SUM-01/02, INS-01, RISK-01, OPP-03, REC-06 |
| Period participation level | KPI grid, Key Insights, RISK-02, OPP-01, SUM-07, health component |
| Participation month vs week | RISK-03, INS-04, SUM-06 |
| QR momentum | SUM-04/05, RISK-06, OPP-04, INS-05 |
| Top employee share | OPP-07, REC-08 |

Executive summary **computes up to 3 clauses** but UI shows **only the first** — other clauses are discarded in presentation.

---

# Business Health Score Audit

**Formula** (`computeBusinessHealthScore`):

- Six components, each capped at `100/6 ≈ 16.67`.
- **Revenue growth:** `16.67/2 + (growthPercent/100)*(16.67/2)`, floored at 0; uses **0** when not comparable.
- **Employee participation:** `(receiving/active) * 16.67`.
- **Goal completion:** From `employeeGoals` average % or pulse on-track ratio.
- **Active employees:** Roster size heuristic (caps with tip activity bonus).
- **Guest feedback:** Mean star / 5 × cap.
- **Tip activity:** Base + tip count / 50 scaling.

**Grades:** ≥85 excellent, ≥70 good, ≥50 fair, else needs attention.

| Audit question | Finding |
|----------------|---------|
| Mathematically defined? | Yes |
| Weights documented to user? | Partial (`healthExplain` — sr-only) |
| “Fair” justified? | **Label is arbitrary band on opaque composite** |
| Stable? | Swings with growth % and tip count thresholds |
| Owner-interpretable? | **Weak** — mixes growth, roster size, and activity in one number |

**Do not redesign** — flag: composite score is **monitoring index**, not an industry-standard health metric; grade words imply more than formula delivers.

---

# Executive Summary Audit

| Criterion | Finding |
|-----------|---------|
| Factual | First clause often **factually wrong wording** for correct math |
| Concise | Yes (one line) |
| Decision-useful | Moderate for KPI grid; narrative line unreliable |
| Redundant | KPI grid repeats snapshot |
| Over-interpretive | “Period average,” “last week,” “target” |

**Bug-class behavior:** `revenueDeclining` branch uses `growthPercent < -5` without requiring `growthComparable` in source — mitigated because non-comparable forces `growthPercent = 0`.

---

# Insights That Should Remain

| Insight | Evidence | Why it matters | Decision | Wording |
|---------|----------|----------------|----------|---------|
| Period tip growth % (KPI) | Prior window SQL | Track MoM momentum | Pricing/hours/staffing | “Vs previous {{timeframe}} period” |
| Period participation % (KPI) | Period employee tip counts | Coverage of team | Who needs support | Keep; define numerator/denominator in tooltip |
| No tips with active staff (risk) | `tipCount===0` | Payment/QR failure | Urgent ops check | Keep as **alert**, not buried in list |
| Period tip count (KPI) | SQL | Volume | Baseline | Keep in KPI row only |
| Peak hour (if from SQL) | `peakHour` | Staffing | Scheduling | Qualify “venue period” |
| Top earner share (optional) | Period totals | Concentration / recognition | REC-08 style | One line max |

---

# Insights That Should Be Removed

| Text / item | Reason | Category |
|-------------|--------|----------|
| INS-01 / OPP-03 tip growth narrative duplicates | Same signal 3–5× | Redundant |
| Participation “last week” (RISK-03, INS-04, SUM-06) | Wrong comparison | Misleading |
| maintainMomentum / generic QR visibility recs | No causal evidence | Unsupported |
| low-participation **opportunity** when risk already fired | Duplicate band | Redundant |
| Table lift from recent sample | Unstable | Weak |
| Top table/location scan “opportunities” | Decorative leaderboards | Decorative |
| Team goals opportunity without goals data | Generic | Decorative |
| QR momentum in summary + insights + opp | Triplicate | Redundant |
| Health chart labeled participation | Wrong metric | Misleading |

---

# Insights That Need Rewording

| Current | Issue | Recommended direction |
|---------|-------|------------------------|
| “Compared to the period average” | Prior window, not average | “Compared to the previous {{period}}” |
| “This week vs monthly average” | Month vs prior month | “Vs previous month” (or selected timeframe) |
| “Over the last week” (participation) | Month % vs this calendar week | Remove or replace with true WoW if implemented |
| “Below target” (goals/ratings) | Hidden 50% / 3.5 | “Below 50%” / “Below 3.5 stars” or configurable target |
| “Employee participation trend” chart | Tip-count proxy | Rename chart or compute real participation |
| Section “Key insights” vs “Trends” | Mislabel | Align titles with content |

---

# Proposed Minimal Insight Set

**Principle:** FEWER + MORE IMPORTANT + FACTUAL + ACTIONABLE.

### Layer 1 — Core KPIs (always)

1. Period tips (€ and count) — timeframe labeled **Month** (or expose toggle later).
2. Growth vs prior equal window — only when `growthComparable`.
3. Employee participation (period) — with definition footnote.
4. Goal completion — when goals exist; else hide.

### Layer 2 — One trend

5. Tips over time (existing daily distribution) — **not** mislabeled participation proxy.

### Layer 3 — Observations (0–2 bullets)

6. Peak hour (period SQL) — if present.
7. Optional: top earner % of period tips — if ≥15% **and** ≥N tips.

### Layer 4 — Verified risks (0–2)

8. **No tips this period** with active staff — always prioritize.
9. Optional: tip volume down &gt;X% vs prior **only** with comparable prior and minimum tip count — phrased as **alert**, not generic “risk.”

### Layer 5 — Recommendations (0–1)

10. Only **recognize performer** or **investigate zero tips** — tied to explicit facts.

### Empty states

- Risks: **“No significant risks detected from the available data.”**
- Recommendations: **“No specific recommendation based on the current data.”**

### Risks section count

**Recommended:** **0–2** items typical; **1** strong item (no activity) when applicable; **never** fill to 6.

### Recommendations section count

**Recommended:** **0–1**; avoid QR/goals boilerplate unless product later links evidence.

### Business Health score

Keep as **secondary index** with visible component breakdown or suppress grade adjective until explained.

---

# Required Logic Corrections

**List only — do not implement in this audit.**

1. Align all growth copy with `comparableGrowthPercent` and selected `timeframe` (remove “week/monthly average”).
2. Replace or remove month-vs-week participation “decline” until true like-for-like WoW exists.
3. Cap or qualify extreme growth percentages when prior period is small.
4. Separate **observation** vs **risk** types in data model; risks require explicit rule name + threshold in UI.
5. Strip causal verbs from recommendations unless A/B or product analytics support them.
6. Deduplicate: one signal → one surface (growth appears once).
7. Fix participation trend series to use real unique tippers per day or rename metric.
8. Executive summary: show merged factual sentence or let user see all clauses — not arbitrary first clause.
9. `generateExecutiveSummary` declining branch: require `growthComparable` explicitly.
10. Week participation: use full-period data or larger feed than `take: 100`.
11. Goal/rating “target” copy must match configured or disclosed constants.
12. Empty risk/recommendation sections should state none detected.
13. Performance page should declare analytics period (month) near insights.
14. Table/location QR “opportunities” should not fire as insights without comparative benchmark.
15. Health score: when `!growthComparable`, do not treat growth component as 0 “flat” without qualification.

---

# UI Implications

- **No code changed in this audit.** Product should expect:
  - Fewer list rows in Risks / Opportunities / Recommendations.
  - Clear **period label** on every %.
  - Evidence lines (`evidenceKey`) are more accurate than headline copy — users may not read them.
  - “Key insights” KPI row duplicates Executive Summary metrics — consolidate visually.
  - `ExecutiveInsightLines` under **“Trends”** confuses information architecture.
  - `healthExplain` is screen-reader only — owners do not hear the weighting disclaimer.

---

# Final Findings

1. The Performance page is driven by a **transparent rules engine**, not generative AI — trust comes from **wording and deduplication**, not mystery.
2. **Numeric tip growth and period participation** are the most trustworthy outputs when prior period exists and roster definitions are understood.
3. **Participation decline / “last week”** narratives are the highest-severity **misleading** issue.
4. **“Period average”** language is **incorrect** for the implemented prior-window comparison.
5. **Risks and recommendations over-fire** (up to 6+5) with **generic playbooks** — violates FEWER + FACTUAL + ACTIONABLE goal.
6. **Business Health** is a composite index; grade labels over-claim precision.
7. **Duplication** makes the page feel like an “AI coach” though logic is deterministic rules.

---

# FINAL VERDICT

**PARTIALLY TRUSTWORTHY**

Core KPIs and backend prior-period growth math are largely **reproducible and fact-based**, but a material share of narrative insights, risk labels, and recommendations are **misworded**, **redundant**, or **unsupported causal guidance**. The product should shrink to a minimal evidence-based set, fix comparison language, and separate data from interpretation before owners can treat Performance as a trustworthy analytics surface.

---

*End of audit — `CARETIP_PERFORMANCE_INSIGHTS_FORENSIC_AUDIT.md`*
