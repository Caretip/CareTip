/**
 * Single source of truth for the CareTip SPA Content-Security-Policy.
 * Synced to public/_headers and vercel.json — keep identical.
 *
 * Domain rationale (connect-src):
 * | Host pattern | Feature | Breakage if removed |
 * |--------------|---------|---------------------|
 * | 'self' | Dev Vite proxy (/api, /socket.io); same-origin prod | All API + socket in dev |
 * | caretip.de / www / *.caretip.de | Production SPA + optional same-site API | Prod API on subdomain |
 * | *.onrender.com + wss | VITE_API_URL backend + Socket.IO | Login, dashboard, realtime |
 * | oauth2.googleapis.com, www.googleapis.com, accounts.google.com | @react-oauth/google | Google sign-in |
 * | firebase*.googleapis.com, *.googleapis.com | FCM web push + Firebase SDK | Push notifications |
 * | assets.calendly.com (script/style/connect) | Request Demo Calendly popup widget |
 * | calendly.com / *.calendly.com (frame/connect) | Calendly booking iframe + API |
 * | connect.facebook.net | Facebook JS SDK (facebookOAuthWeb.ts) |
 * | graph.facebook.com, www.facebook.com | FB.login dialog + SDK Graph calls from browser |
 * | www.facebook.com / facebook.com (frame-src) | Facebook Login dialog iframe |
 * | www.facebook.com / m / web / facebook.com (form-action) | Redirect OAuth: POST /api/auth/facebook/start → 302 → Facebook |
 *
 * Intentionally permissive (accepted risk):
 * | Directive | Value | Reason |
 * |-----------|-------|--------|
 * | style-src | 'unsafe-inline' | Tailwind, Radix, Vite inline styles, animations |
 * | style-src | https://accounts.google.com | Google Identity Services (gsi/style) for GIS button |
 * | img-src | https: | Marketing/onboarding images (Unsplash, Stockcake, Supabase logos, etc.) |
 */

/** @type {readonly string[]} */
export const SPA_CONNECT_SRC = [
  "'self'",
  "https://caretip.de",
  "https://www.caretip.de",
  "https://*.caretip.de",
  "wss://*.caretip.de",
  "https://*.onrender.com",
  "wss://*.onrender.com",
  "https://oauth2.googleapis.com",
  "https://www.googleapis.com",
  "https://accounts.google.com",
  "https://firebase.googleapis.com",
  "https://firebaseinstallations.googleapis.com",
  "https://fcmregistrations.googleapis.com",
  "https://*.googleapis.com",
  "https://*.ingest.sentry.io",
  "https://*.ingest.de.sentry.io",
];

/** Facebook Login (JS SDK) — see src/app/lib/facebookOAuthWeb.ts */
export const SPA_FACEBOOK_CONNECT_SRC = [
  "https://connect.facebook.net",
  "https://graph.facebook.com",
  "https://www.facebook.com",
];

/** Facebook OAuth redirect (form POST → 302 → dialog/oauth). Keep in sync with violation handler. */
export const SPA_FACEBOOK_FORM_ACTION_SRC = [
  "'self'",
  "https://www.facebook.com",
  "https://m.facebook.com",
  "https://web.facebook.com",
  "https://facebook.com",
];

/** @type {readonly string[]} */
export const SPA_IMG_SRC = ["'self'", "data:", "blob:", "https:"];

/** Full SPA CSP header value (semicolon-separated). */
export const SPA_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com https://www.gstatic.com https://assets.calendly.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com https://assets.calendly.com",
  `img-src ${SPA_IMG_SRC.join(" ")}`,
  "font-src 'self'",
  `connect-src ${SPA_CONNECT_SRC.join(" ")} https://calendly.com https://*.calendly.com https://assets.calendly.com ${SPA_FACEBOOK_CONNECT_SRC.join(" ")}`,
  "frame-src https://accounts.google.com https://calendly.com https://*.calendly.com https://www.facebook.com https://facebook.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  `form-action ${SPA_FACEBOOK_FORM_ACTION_SRC.join(" ")}`,
].join("; ");
