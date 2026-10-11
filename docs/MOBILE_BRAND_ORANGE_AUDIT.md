# CareTip Mobile — Brand Orange & Gradient Alignment

Brand consistency correction only. Web is the source of truth. Values below are traced from source, not estimated from screenshots.

## Web primary CTA gradient (source of truth)

| Field | Value |
| --- | --- |
| Start | `#ff9e2d` (`--caretip-brand-orange-light` / `CARETIP_BRAND_ORANGE.light`) |
| End | `#e9781c` (`--caretip-brand-orange` / `CARETIP_BRAND_ORANGE.base`) |
| Direction | `180deg` (top → bottom) |
| Stops | `0%` and `100%` only |
| Opacity | Fill colors are fully opaque. Box-shadows use alpha; they are not part of the fill. |
| Hover (not resting CTA) | `180deg`, `#ffb04a` → `#e9781c` |

**Defined in** `src/styles/caretip-buttons.css` on `.caretip-btn-primary` / `.caretip-cta-primary` (light and dark):

```css
background: linear-gradient(
  180deg,
  var(--caretip-brand-orange-light) 0%,
  var(--caretip-brand-orange) 100%
) !important;
```

**Token values** in `src/styles/caretip-brand.css` and `src/lib/caretipBrand.ts`.

Auth Sign In uses the same class (`caretip-auth-submit caretip-btn-primary`). Auth CSS only adjusts size/radius, not the gradient.

## Mobile token applied

`caretipPrimaryCtaGradient` in `mobile/theme/colors.ts`:

- colors: `["#ff9e2d", "#e9781c"]`
- locations: `[0, 1]`
- start: `{ x: 0.5, y: 0 }` → end: `{ x: 0.5, y: 1 }` (CSS `180deg`)

Used by `mobile/components/auth/AuthContinueButton.tsx` (Sign In and other auth continue CTAs).

Previously this button used a three-stop diagonal `[orangeHover, orange, orangeDeep]` (`#ffb04a` → `#e9781c` → `#d96810`, `start {0,0}` `end {1,1}`), which was a mobile interpretation, not the web CTA.

## Splash background

| Surface | Value |
| --- | --- |
| Window / overlay | `#e9781c` (`brand.orange` / `authBrand.orange`) |
| `app.json` splash `backgroundColor` | `#e9781c` |
| Android `splashscreen_background` | `#e9781c` |
| Logo asset | White mark on **transparent** PNG (`assets/splash-native.png`) |

**Bug:** Android 12 `splashscreen_logo.png` densities were fully opaque `#EB992C` (`rgb(235, 153, 44)`). The system draws that bitmap inside a rounded icon mask on the `#e9781c` window, which read as: orange background → lighter-orange rounded card → white logo.

**Fix:** Regenerated density logos as the same transparent white icon. Hierarchy is now solid `#e9781c` → white logo. JS overlay (`BrandSplashOverlay`) already used the transparent asset on `authBrand.orange`; it was not wrapping the mark in a card `View`.

Re-run `npm run generate:splash` after `expo prebuild` so Expo cannot restore an opaque plate.

## Mobile orange usage audit

| Surface | Before | After |
| --- | --- | --- |
| Splash background | `#e9781c` | unchanged (correct) |
| Native splash logo plate | baked `#EB992C` | removed (transparent PNG) |
| Sign In / auth continue CTA | 3-stop diagonal hover/deep | web 180deg `#ff9e2d` → `#e9781c` |
| Forgot password link | `authBrand.orangeMuted` = `rgba(233, 120, 28, 0.92)` | unchanged (brand base at 92% opacity) |
| Selected/active chrome (tabs, toggles, list accents) | `brand.orange` / `colors.primary` | unchanged |
| Dashboard hero / wallet cards | 3-stop diagonal `orangeLight → orange → orangeDeep` | **kept** — intentional tonal illustration, not the Sign In CTA |
| Generic `Button` primary | solid `colors.primary` (`#e9781c`) | unchanged — not the auth CTA; avoid dashboard redesign |
| Social spinner / field focus | `authBrand.orange` | unchanged |

`#EB992C` remains the web/business **QR default brand** (`DEFAULT_BRAND_PRIMARY_COLOR`). That is tenant QR chrome, not the CareTip product CTA, and was not changed.

## Files changed

- `mobile/theme/colors.ts` — `caretipPrimaryCtaGradient` traced from web
- `mobile/theme/index.ts` — export
- `mobile/theme/authBrand.ts` — CTA comment
- `mobile/components/auth/AuthContinueButton.tsx` — web 180deg two-stop fill
- `mobile/scripts/generate-splash-native.mjs` — also writes transparent Android density logos
- `mobile/android/app/src/main/res/drawable-*/splashscreen_logo.png` — transparent white icon
- `mobile/scripts/brand-cta-runtime.ts` — token + asset regression
- `mobile/package.json` — `test:brand-cta`, `generate:splash`
- `docs/MOBILE_BRAND_ORANGE_AUDIT.md` — this file

## Verification

| Check | Result |
| --- | --- |
| Web gradient traced to `caretip-buttons.css` + brand tokens | Yes |
| Mobile typecheck (`npm run typecheck`) | PASS |
| `npm run test:mobile-runtime` (includes `test:brand-cta`) | PASS |
| Splash on a real device | Not claimed PASS — no device attached (`adb devices` empty) |
| Sign In button on a real device vs web | Not claimed PASS — no device attached |
| Splash logo has no separate colored square in assets | PASS — corners of `splash-native.png` and Android `splashscreen_logo.png` are transparent; zero `#EB992C` fill pixels |
| Unrelated UI | Login/dashboard layout, typography, auth/API/tenant behavior unchanged |
