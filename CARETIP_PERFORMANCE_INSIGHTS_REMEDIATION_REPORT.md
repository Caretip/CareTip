# CareTip Performance Insights — Remediation Report

**Date:** 2026-09-27  
**Basis:** `CARETIP_PERFORMANCE_INSIGHTS_FORENSIC_AUDIT.md` (PARTIALLY TRUSTWORTHY)  
**Scope:** Deterministic BI narrative layer + Performance overview UI (no financial KPI formula changes, no new APIs/LLM).

---

## 1. Audit findings used

- Growth copy described “week / period average” while math uses **prior equal-length window**.
- **Month % vs calendar-week %** was labeled “last week participation” — **removed** (approach B: no reliable WoW participation).
- Chart labeled “participation” but plotted **tip-count proxy** — **replaced with daily tip volume (€)**.
- Most “risks” were **threshold heuristics**, not operational proof — **removed** except **no tips with active staff**.
- Recommendations were **generic playbooks** — **removed entirely**.
- Opportunities duplicated KPIs — **generator returns empty**; section **hidden** in UI.
- Executive summary generated up to 3 clauses — **capped at 1** factual clause.
- Business health **grade labels de-emphasized**; score shown as composite index with hint (formula unchanged).

---

## 2. Files changed

| File | Change |
|------|--------|
| `src/app/lib/businessIntelligence.ts` | Risks, opportunities, recommendations, insights, summary, `tipVolumeTrend` |
| `src/app/components/business/BusinessExecutivePerformance.tsx` | Quieter UI, empty states, deduplicated sections |
| `src/app/components/business/insights/ExecutiveHealthTrends.tsx` | Chart = daily tip € |
| `src/app/hooks/useBusinessAnalytics.ts` | Default `tipVolumeTrend` |
| `src/i18n/locales/en.json` | Factual copy + empty states + hints |
| `src/i18n/locales/de.json` | Same (DE) |
| `scripts/performance-insights-remediation-runtime.ts` | Regression tests |
| `package.json` | `test:performance-insights-remediation` |

---

## 3. Insight rules changed

| Generator | Before | After |
|-----------|--------|-------|
| `generateExecutiveRisks` | Up to 6 heuristic risks | **Only** `no-tip-activity` (max 2 cap) |
| `generateOpportunities` | Up to 6 items | **Always `[]`** |
| `generateExecutiveRecommendations` | Up to 5 playbooks | **Always `[]`** |
| `generateExecutiveInsights` | Growth, participation, QR, table, peak (max 4) | **Peak hour only** (max 1) |
| `generateExecutiveSummary` | Up to 3 mixed clauses | **1 clause**: no-tip → growth → stable → collecting |
| `buildTrendChartSeries` | `participationTrend` proxy | **`tipVolumeTrend`** (€ per day) |

**Unchanged:** `computeRevenueAnalytics`, `comparableGrowthPercent`, `computeBusinessHealthScore` formula, snapshot KPIs, backend prior-period SQL.

---

## 4. Insights removed

All removed items are **no longer generated** (legacy i18n keys may remain unused).

- Tip volume decline risk (−5% threshold)
- Low participation / participation “decline” / goal / QR / location / satisfaction risks
- All opportunities (growth, QR, top location/table/employee, etc.)
- All recommendations (QR visibility, momentum, goals, etc.)
- Executive insight: tip growth, participation WoW, table lift, QR momentum
- Summary clauses: QR, participation, goals (multi-clause)

---

## 5. Insights retained

| Insight | Where shown |
|---------|-------------|
| Growth % KPI | Executive summary grid (+ hint) |
| Participation %, goals %, tip count | Executive summary grid |
| Composite health score /100 | Business health strip (no grade label) |
| Daily tip volume chart | Tip volume trend section |
| Peak hour | Key insights (if known) + optional Trends line |
| No tips + active staff | Risk list + summary clause when applicable |

---

## 6. Exact wording changes (EN)

| Key | New meaning |
|-----|-------------|
| `executive.summary.revenueHealthy` | Tips up {{percent}}% vs **previous equal-length period** |
| `executive.summary.revenueDeclining` | Tips down {{percent}}% vs **previous equal-length period** |
| `executive.summary.noTipActivity` | No tips despite active staff |
| `executive.growthComparisonHint` | Compared with the previous equal-length period |
| `executive.healthIndexHint` | Composite index — not a single KPI |
| `executive.tipVolumeTrendTitle` | Daily tip volume |
| `executive.risksEmpty` | No significant risks detected… |
| `executive.recommendationsEmpty` | No specific recommendation… |

DE equivalents in `de.json`.

---

## 7. Participation handling

- **Removed** `computeWeekParticipationPct` and all month-vs-week narratives.
- **Period participation %** remains a **level KPI** only (`employeesReceivingTips / activeEmployees` for the selected period).
- No participation “trend” or WoW claim until reliable data exists.

---

## 8. Business Health handling

- **Score formula unchanged.**
- UI no longer shows **grade word** (Excellent/Fair) or duplicate growth in health strip.
- Visible hint: composite index, not authoritative “health grade.”

---

## 9. Recommendation handling

- Generator returns **zero** recommendations.
- UI shows **recommendations empty state** when none (always for now).

---

## 10. Duplication reduction

| Signal | Before | After |
|--------|--------|-------|
| Growth % | KPI + health + opp + risk + insight + rec | **KPI + optional 1-line summary** |
| Participation | KPI + key insights + risks + summary | **KPI only** |
| Opportunities section | Up to 6 bullets | **Hidden** (empty generator) |
| Trends section | Multiple lines | **Peak only**, section hidden if empty |

---

## 11. Tests executed

```bash
npm run test:performance-insights-remediation
npm run typecheck
```

**Result:** 16/16 remediation checks passed; typecheck passed.

---

## 12. Build result

`npm run typecheck` — **pass**. Full `npm run build` not re-run (same as prior UI sessions); BI changes are TS-only + i18n.

---

## 13. Remaining limitations

- Legacy unused i18n strings (old risks/opportunities/recommendations) remain in JSON for safety; not displayed.
- Health score still computed; interpretability limited — only de-emphasized in UI.
- Peak hour may use `recentTips` sample when SQL `peakHour` absent.
- Performance page timeframe remains default **month** (no toggle).

---

## Final table — insight disposition

| Insight | Final status | Evidence | Reason |
|---------|--------------|----------|--------|
| Growth % (prior window) | **Retained** | `comparableGrowthPercent(period, priorPeriod)` | Factual KPI + optional summary |
| Period participation % | **Retained** | Period employee `tipCount > 0` / active roster | Level metric only |
| Goal completion % | **Retained** | Goals / pulse | KPI only |
| Period tip count | **Retained** | SQL `period.tipCount` | Volume KPI |
| No tips + active staff | **Retained** | `tipCount===0 && activeEmployees>0` | Strong operational signal |
| Daily tip volume chart | **Changed** | `dailyTipDistribution.amount` | Honest label (€/day) |
| Peak hour | **Retained** | `peakHour` or recentTips hours | Scheduling signal |
| Composite health score | **Changed (UI)** | 6-component formula | De-emphasized grade claims |
| Tip decline risk (−5%) | **Removed** | Was prior-window % | Heuristic, not verified risk |
| Participation risks / WoW | **Removed** | Invalid comparison | Misleading per audit |
| QR / goals / rating risks | **Removed** | Heuristic thresholds | Unsupported as risks |
| All opportunities | **Removed** | Decorative / duplicate | Dedup |
| All recommendations | **Removed** | No causal evidence | Playbooks |
| Growth narrative insights | **Removed** | Duplicate KPI | Dedup |
| Participation narrative insights | **Removed** | Invalid metric | Misleading |
| QR / table lift insights | **Removed** | Weak sample / duplicate | Low trust |
| Multi-clause executive summary | **Removed** | Redundant | One factual clause max |

---

**Principle applied:** Fewer claims the product can defend — not more sentences.
