# CARETIP — PWA / Service Worker Facebook OAuth Consistency Audit

**Audit date:** 2026-10-08  
**Mode:** Read-only (no code, cache, SW, Netlify, Render, deploy, commit, or push changes)  
**Production origin:** `https://caretip.de`

---

## Executive Summary

Production uses a **Vite PWA / Workbox** service worker (`/sw.js` → `./workbox-66c29356.js`) with cache prefix **`caretip-pwa-v13`**, **`skipWaiting()`**, and **`clientsClaim()`**. The live precache manifest includes **`assets/index-CpFJTPAW.js`** and **`index.html`** in the **same** SW generation.

A network fetch of `/login` (2026-10-08) references the **same** main bundle: **`/assets/index-CpFJTPAW.js`**. That bundle contains **form POST** Facebook start (`form.method = "POST"`, `form.action` = path argument, `.submit()`), **`start_failed`**, and **`securitypolicyviolation`** handling. It does **not** contain `fetch(..., redirect: "manual")`.

**Classification:** PWA/service worker as **CONFIRMED ROOT CAUSE** of intermittent `start_failed` — **NOT SUPPORTED** with current evidence. As **POSSIBLE CONTRIBUTOR** — only across **deploy boundaries** (an older SW generation could run older precached JS until the new worker activates). **NOT PROVABLE** that the failing Chrome session used a bundle other than `index-CpFJTPAW.js` without DevTools export from that session.

Firefox vs Chrome bundle parity — **NOT PROVABLE** from this environment (no Firefox DevTools access).

---

## Active Service Worker

| Field | Evidence (fetched `https://caretip.de/sw.js`, 2026-10-08) |
|--------|-----------------------------------------------------------|
| **Active script URL** | `https://caretip.de/sw.js` |
| **Workbox runtime** | `https://caretip.de/workbox-66c29356.js` (matches user-reported `workbox-66c29356.js`) |
| **Scope** | Default PWA scope `/` (Vite PWA `scope: '/'` in `vite.config.ts`) |
| **Cache name prefix** | `caretip-pwa-v13` via `setCacheNameDetails({ prefix: "caretip-pwa-v13" })` |
| **Lifecycle hooks in SW** | `self.skipWaiting()` then `s.clientsClaim()` at install/activate path |
| **Registration (app code)** | `registerSW({ immediate: true, onNeedRefresh() { updateSW(true) } })` in `src/main.tsx` (prod, deferred 2–4.5s) and `src/app/lib/deferredStartup.ts` |
| **registerType** | `autoUpdate` (`vite.config.ts`) |
| **Waiting worker / update state** | **NOT PROVABLE** remotely — requires Application → Service Workers in the failing browser session |
| **Second SW (FCM)** | Separate `firebase-messaging-sw.js` + scope `/firebase-cloud-messaging-push-scope` (push only; not the app shell SW) |

**Headers (`sw.js`, `workbox-*.js`):** `Cache-Control: public, max-age=0, must-revalidate` (`public/_headers`).

---

## Cache Names / Versions

| Cache | Purpose |
|--------|---------|
| `caretip-pwa-v13` (+ Workbox suffixes for precache) | Precache: `index.html`, `index-CpFJTPAW.js`, route chunks, fonts, shell assets |
| `caretip-static-images-v13` | Runtime **NetworkFirst** for `/assets/*.{png,jpg,webp,gif}` |
| `caretip-google-fonts` | Runtime **CacheFirst** for Google Fonts |

**Precache `index.html` revision:** `f378833fcc9ffdbf8384c8738c938a61` (in live `sw.js`).  
**Precache includes:** `assets/index-CpFJTPAW.js` (`revision: null` — URL is content-addressed).  
**Also precached (OAuth-related):** `assets/FacebookOAuthCompletePage-B_5BKJro.js`, `assets/LinkedOAuthAccountsSection-ulTzQTwW.js`.  
**Not separately precached by name:** `AuthPage`, `OAuthProviderRow` (auth UI is bundled into the main graph loaded from `index-*.js`).

`cleanupOutdatedCaches: true` in build config — old precache buckets removed when a **new** SW activates.

---

## Chrome Bundle

| Field | Value | Source |
|--------|--------|--------|
| **HTML entry** | `/login` document | `curl https://caretip.de/login` 2026-10-08 |
| **Main bundle** | `/assets/index-CpFJTPAW.js` | Same HTML |
| **CSS** | `/assets/index-DHjCVyQK.css` | Same HTML |
| **SHA-256 (bundle file)** | `524cac2e72270d69d90874eec1264e461e3c48472d2b364a7ef74cd96d84f272` | Downloaded from production |
| **Response source in user session** | Service Worker / disk cache | User-reported DevTools — **not independently verified** |
| **Matches known bundle** | **YES** — live site and live `sw.js` precache both name `index-CpFJTPAW.js` | Automated |

**Facebook implementation in `index-CpFJTPAW.js` (minified, audited 2026-10-08):**

| Pattern | Present |
|---------|---------|
| `form.method = "POST"` | Yes (minified) |
| `form.action` = `/api/auth/facebook/start` (path arg) | Yes |
| `.submit()` | Yes |
| `securitypolicyviolation` + `form-action` | Yes |
| `start_failed` | Yes (1×) |
| `redirect: "manual"` | No |

---

## Firefox Bundle

| Field | Chrome | Firefox |
|--------|--------|---------|
| Service Worker | Workbox `/sw.js` (user-confirmed) | **NOT PROVABLE** here |
| Worker version | `caretip-pwa-v13` + `workbox-66c29356.js` | **NOT PROVABLE** |
| App bundle | `index-CpFJTPAW.js` (live site + precache) | **NOT PROVABLE** |
| Bundle hash | SHA-256 above (network download) | **NOT PROVABLE** |
| Source | User: SW / disk cache | **NOT PROVABLE** |
| Cache | Precache + runtime per `sw.js` | **NOT PROVABLE** |
| HTML version | Network `/login` matches `index-CpFJTPAW.js` | **NOT PROVABLE** |

**Do Chrome and Firefox execute the same Facebook OAuth code?** **NOT PROVABLE** without Firefox Application panel + loaded script list. If both load `index-CpFJTPAW.js` from the **same** active SW generation, code is **identical** (single build artifact).

---

## Facebook OAuth Implementation Comparison

| Implementation aspect | In loaded production `index-CpFJTPAW.js` | In repo @ `085456ed` `facebookOAuthRedirectWeb.ts` |
|----------------------|------------------------------------------|-----------------------------------------------------|
| Transport | Form POST | Form POST |
| Action URL | Same-origin path (not `getApiAbsoluteUrl` in start snippet) | `/api/auth/facebook/start` |
| Failure URL | `/auth/facebook/complete?error=start_failed` | Same |
| `start_failed` producer | Client only (`navigateToFacebookStartFailure`) | Same |

`FacebookOAuthCompletePage-B_5BKJro.js` does **not** contain the string `start_failed` (completion page imports constant from main graph / shared module at runtime).

---

## Update Lifecycle (from source + live `sw.js`)

| Behavior | Config / evidence |
|----------|-------------------|
| **autoUpdate** | `registerType: 'autoUpdate'` |
| **skipWaiting** | **Yes** — in generated `sw.js` |
| **clientsClaim** | **Yes** — in generated `sw.js` |
| **Reload on update** | `onNeedRefresh` → `updateSW(true)` (reload when new version detected) |
| **Deferred registration** | `main.tsx` schedules SW register after 2s (desktop) / 4.5s (mobile) — first paint window may run **without** SW, then SW takes control |
| **Tab stuck on old worker** | **POSSIBLE** only between deploy and SW install/activate, or if `updateSW(true)` not yet run; `skipWaiting` limits but does not eliminate race on **already-open** tabs during deploy |
| **Old tab + new deploy** | Old SW serves **consistent** old precache (HTML + JS from **same** manifest), not mixed new HTML + old JS within one manifest |

---

## Cache-Control Behavior

| Resource | Policy |
|----------|--------|
| `/assets/*` | `public, max-age=31536000, immutable` (`public/_headers`) |
| `/sw.js`, `/workbox-*.js` | `max-age=0, must-revalidate` |
| SPA HTML (`/*` Netlify) | `max-age=0, must-revalidate` (observed on `/login`) |
| Navigation `/login` under SW | Often **precached `index.html`** via `NavigationRoute` → `index.html` (not denylisted) |

**Implication:** For navigations handled by the SW, the **shell HTML** may come from **precache**, not the network. Script URLs in that HTML point into the **same** precache generation → **low risk of HTML/JS mismatch inside one SW version**. **Higher risk:** user still on **previous SW generation** after a deploy (stale but **internally consistent**) until update activates.

---

## Service Worker Cache Graph (OAuth-related)

```
sw.js (caretip-pwa-v13)
├── precache: index.html  (revision f378833f…)
├── precache: assets/index-CpFJTPAW.js  ← main app + Facebook start (O6)
├── precache: assets/FacebookOAuthCompletePage-B_5BKJro.js  (lazy route)
├── precache: assets/LinkedOAuthAccountsSection-ulTzQTwW.js  (link flow)
└── navigateFallback → index.html (deny: /api, /uploads, /socket.io)
```

**OAuth start code path:** Executed from **main bundle** (`index-CpFJTPAW.js`), not a separate precached “OAuth chunk” name.

**Problematic states:**

| State | Supported by evidence? |
|--------|-------------------------|
| OLD HTML + OLD OAuth in **same** SW | Yes — entire precache snapshot old |
| NEW network HTML + OLD JS (split) | **Unlikely** for SW-handled navigations using precached `index.html` |
| OLD SW + NEW assets on CDN | **POSSIBLE** if tab bypasses SW for scripts — **NOT PROVEN**; hashed assets are immutable on CDN |
| SW serves stale `index-CpFJTPAW.js` | Yes — by design until SW updates; content is still **current-generation** code for that SW |

---

## Evidence Connecting PWA to OAuth Failure

| Claim | Classification |
|--------|----------------|
| SW can serve `index-CpFJTPAW.js` from precache/disk | **CONFIRMED** (precache list + user DevTools) |
| That bundle can emit `start_failed` | **CONFIRMED** (CSP / `submit()` paths — not SW-specific) |
| SW causes **different** Facebook code than `index-CpFJTPAW.js` on **same** SW generation | **NOT SUPPORTED** |
| SW explains **intermittent** failure while Facebook still opens | **NOT SUPPORTED** as direct cause — reaching Facebook implies successful form POST navigation; `start_failed` is a **separate client navigation** (see `CARETIP-FACEBOOK-PRODUCTION-LOCAL-DIFF-AUDIT.md`) |
| Stale **pre-085456ed** bundle via old SW could explain old `fetch`/`getApiAbsoluteUrl` bugs | **POSSIBLE** only if failing session used **old** `index-*.js` hash — **NOT PROVEN** |
| PWA explains Chrome ≠ Firefox | **NOT PROVABLE** |

---

## Control Test (private window) — procedure only

**NOT EXECUTED** in this audit (no browser automation). Recommended recorder fields:

1. **Normal session:** SW status (active/waiting), `index-*.js` URL, Size/Time, Initiator, “from ServiceWorker” column.  
2. **Private session:** Same + whether SW registers at all (should, after deferred register).  
3. Compare hashes / filenames — **do not clear caches as a fix**.

---

## Root Cause Classification (PWA / SW)

| Label | Verdict |
|--------|---------|
| **CONFIRMED ROOT CAUSE** of `start_failed` | **NOT SUPPORTED** |
| **HIGH CONFIDENCE CONTRIBUTOR** | **NOT SUPPORTED** for current `index-CpFJTPAW.js` + form POST |
| **POSSIBLE CONTRIBUTOR** | Stale **whole** SW generation after deploy; deferred SW registration timing; unrelated to reaching Facebook in the same navigation |
| **NOT SUPPORTED** | Within-SW HTML/JS OAuth mismatch |
| **NOT PROVABLE** | Firefox parity; failing-session bundle hash; waiting worker state |

---

## Recommended Fix (DO NOT IMPLEMENT)

1. **Evidence first:** In the failing Chrome session, record **exact** `index-*.js` filename and whether `start_failed` appears **before** or **after** Facebook in Preserve log (PWA does not change that distinction).  
2. **If bundle ≠ `index-CpFJTPAW.js`:** treat as deploy/SW staleness — bump `cacheId` / force reload policy on auth-critical releases (product decision).  
3. **If bundle = `index-CpFJTPAW.js`:** investigate **client** `start_failed` paths (CSP `form-action`, retry on login page), not Workbox.  
4. Deploy uncommitted `[CareTip:FacebookOAuth]` logging to correlate `priorStartFailure` with SW generation (optional future work).

---

## References (read-only)

- `vite.config.ts` — `VitePWA`, `cacheId: 'caretip-pwa-v13'`, `globPatterns`, `navigateFallbackDenylist`  
- `src/main.tsx` — deferred `registerSW`  
- `public/_headers` — asset vs SW cache policy  
- Live `https://caretip.de/sw.js` — precache manifest  
- Prior audit: `CARETIP-FACEBOOK-PRODUCTION-LOCAL-DIFF-AUDIT.md`
