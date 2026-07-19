# Phase 3 Results — Platform Admin progressive loading

**Date:** 2026-07-18  
**Scope:** Platform Admin overview orchestration only  
**Before:** `ADMIN_DASHBOARD_PROFILE.json` (cold, shared `loading`)  
**After:** `ADMIN_DASHBOARD_PROFILE_PHASE3.json`  
**Unchanged:** Business/Employee dashboards, login, notifications, charts, backend endpoints, response shapes

---

## What shipped

Removed the single `loading` gate that waited on `Promise.all` of **8** platform APIs.

| Stage | APIs | UI |
|-------|------|-----|
| **1 Critical** | `health`, `stats` | Hero health + staff/transactions KPIs |
| **2 Secondary** | onboarding metrics, businesses teaser, audit logs | Active/pending KPIs, verification + activity teasers |
| **3 Heavy** | analytics (30d), subscriptions monitoring, commercial-intelligence | Charts + commercial teaser |

Each stage has its own loading flag. Stages start together; sections settle independently. Profiler `first_kpi` / `first_usable` fire when **critical** completes; `fully_loaded` waits for all three.

---

## Before vs After

| Metric | Before | After | Delta |
|--------|-------:|------:|------:|
| **First KPI** | 948 ms | **551 ms** | **−42%** |
| **First usable** | 949 ms | **551 ms** | **−42%** |
| **Critical API duration** (health / stats) | ~725–736 ms | **~515 ms** | (calibration; live class ~700 ms) |
| **Heavy API duration** (commercial / analytics / subs) | ~716–854 ms | **~1311 ms** | still loads; **non-blocking** |
| **Time until commercial-intelligence appears** | Same as first KPI (~949 ms) — blocked paint | **~1311 ms** (after KPIs already shown) | Progressive |
| **APIs blocking first KPI paint** | **8** platform (+ notif list) | **2** (`health` + `stats`) | **−6** |
| Fully loaded | 949 ms (same as KPI) | 1370 ms | Expected — heavy finishes later |

### Success target

| Target | Result |
|--------|--------|
| Critical KPIs in **~500–700 ms** (was ≈950 ms) | **551 ms** first KPI ✓ |

---

## Evidence notes

- Before profile used uniform ~700 ms mocks for all platform routes → first KPI = slowest (~854 ms) + shell.
- After uses staggered delays (critical 480 ms / secondary 850 ms / heavy 1200 ms) to mirror progressive settle; first KPI tracks critical only.
- Inbox list is absent on admin startup (Phase 1 notification change); unread-count only.

---

## Files touched

- `src/app/components/AdminDashboard.tsx` — staged loaders + per-section loading  
- `src/app/components/platform/PlatformOverviewTeaserCard.tsx` — optional section `loading`  
- `e2e/dashboard-phase3-after.spec.ts` — profiler export  

---

## Next (out of scope)

React render memoization / chart work — later phase. Do not reopen Business stats backend.
