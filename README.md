# CareTip Limited — The Digital Gratitude Ecosystem

**Tagline:** *One Scan. Instant Tip.*

CareTip is a **PERN** platform (**PostgreSQL**, **Express**, **React**, **Node.js**) that connects in-person hospitality with digital tipping: **QR journeys**, **card-based tips** (Stripe), and **real-time** updates for staff and businesses.

---

## Table of contents

1. [What you get](#what-you-get)
2. [Repository layout](#repository-layout)
3. [Quick start](#quick-start)
4. [Environment variables](#environment-variables)
5. [Transactional email (Resend)](#transactional-email-resend)
6. [Authentication & verification](#authentication--verification)
7. [Technical architecture](#technical-architecture)
8. [Branding & UI](#branding--ui)
9. [Database & migrations](#database--migrations)
10. [Useful scripts](#useful-scripts)
11. [Deployment & production notes](#deployment--production-notes)
12. [Admin system & security](#admin-system--security)
13. [Compliance & privacy (product patterns)](#compliance--privacy-product-patterns)
14. [Troubleshooting](#troubleshooting)
15. [License & contact](#license--contact)

---

## What you get

### Smart QR routing

- **Staff slugs:** Each team member can have a public **`/staff/[slug]`** (or equivalent app routes) for tipping.
- **Business flows:** Venue/table QR paths route guests through **select staff → amount → payment** where the product supports it.

### Repeat tipping (returning guests — no login)

CareTip supports a lightweight **repeat tip** experience for returning guests without accounts:

- **No auth required**: uses a client-side `tipSessionId` (stored locally) to recognize a returning guest.
- **Stores last successful tip**: after Stripe success verification, the app stores the last tipped staff member and amount.
- **Welcome-back UI on business QR landing**: when a guest opens the same business QR landing page again, they’ll see:
  - “Welcome back”
  - the last tipped employee + amount
  - a **“Tip again”** button that jumps straight into the existing payment flow
  - a **“Choose different staff”** option to continue normally
- **Safe fallback**: if the employee no longer exists or isn’t valid for that business, repeat tip is ignored and the normal QR flow shows.

Implementation is **frontend-only** (no schema changes, no changes to Stripe/auth flows). Local storage keys:

- `caretip_tipSessionId`
- `caretip_repeatTipData`
- `caretip_pendingTipData` (temporary; promoted on verified success)

### Real-time feedback

- **Socket.io** complements REST so clients can receive events such as new tips without constant polling.

### Operations & trust

- **PostgreSQL** is the system of record for businesses, employees, tips, and Stripe references.
- **CSV exports** for reconciliation (`json2csv` on the API).
- **Profile photos & logos** via **Supabase Storage** when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set; otherwise local `./uploads` with `PUBLIC_API_BASE_URL`. Verification flows for businesses where the product requires them.

---

## Repository layout

```
caretip_project/
├── src/                      # React 18 SPA (Vite, Tailwind, React Router)
├── public/                   # Static assets, PWA icons (prebuild may regenerate)
├── backend/
│   ├── prisma/               # schema.prisma, migrations, seed
│   └── src/                  # Express API, services, Socket.io, webhooks
├── scripts/                  # Root-level helpers (e.g. admin creation wrapper)
├── package.json              # Frontend scripts
├── backend/package.json      # API scripts
├── README.md                 # This file — product + full-stack overview
└── backend/README.md         # Backend-only: Prisma, migrations, API table
```

---

## Quick start

### Prerequisites

- **Node.js** 18+ (20 LTS recommended)
- **PostgreSQL** (local or hosted, e.g. Supabase pooler URL)
- Optional: **Stripe**, **Supabase Storage** (avatars/logos), **Resend** (see [Environment variables](#environment-variables))

### 1. Install

```bash
# Frontend (repo root)
npm install

# Backend
cd backend && npm install && cd ..
```

### 2. Configure environment

- **Backend:** copy `backend/.env.example` → `backend/.env` (and optionally a repo-root `.env`; see [load order](#environment-variables)).
- **Frontend:** repo-root `.env` or `.env.local` for `VITE_*` variables.

Quick sanity check for the API:

```bash
cd backend && npm run env:check
```

### 3. Database

```bash
cd backend
npm run db:generate
# Prefer migrations for anything long-lived:
npm run db:migrate
# Or quick dev sync (see backend/README.md for caveats):
# npm run db:push
```

### Walkthrough demo (product tour)

`npm run db:seed` (from `backend/`) provisions a **clean SaaS demo**: **5 businesses** (varied onboarding, KYC, and subscription states), **5 employees per business**, tips, feedback, goals, notifications, table QRs on the primary venue, and platform admin audit rows.

| Role | Sign-in URL | Email | Password |
|------|-------------|-------|----------|
| **Business (manager)** | `/login` → Business | `<MANAGER_EMAIL>` | `<PASSWORD>` |
| **Employee (primary demo)** | `/login` → Staff | `<EMPLOYEE_EMAIL>` | `<PASSWORD>` |
| **Platform admin** | `/platform-admin/login` | `<ADMIN_EMAIL>` | `<PASSWORD>` |
| **Additional platform admins** | `/platform-admin/login` | `<TEAM_ADMIN_EMAIL>` | `<PASSWORD>` |

Credentials are created by the local seed scripts. **Do not publish real emails or passwords** in documentation or shared channels — read them from your local seed configuration or secure vault after seeding.

All platform admins share the **same** dashboard and platform data. Each has a separate login, MFA (Google Authenticator), sessions, and audit trail. Seed with `npm run admin:seed-team` (from `backend/`).

| Field | Value |
|-------|-------|
| **Primary venue** | Demo hospitality venue — onboarding **approved**, KYC **verified**, **premium** |
| **Other demo businesses** | Additional venues in varied onboarding / KYC / subscription states (managers use `<MANAGER_DEMO_EMAIL>` pattern from the seed) |
| **Staff (primary venue)** | Multiple seeded employees; emails follow the seed’s `<STAFF_DEMO_EMAIL>` pattern |

Amber ribbons on the **business**, **employee**, and **platform admin** shells mark walkthrough accounts. The admin shell reads all five demo businesses from the database.

### 4. Run locally

**Terminal A — API (default port 3001):**

```bash
cd backend
npm run dev
```

**Terminal B — Vite:**

```bash
npm run dev
```

- App: usually `http://localhost:5173`
- API: `http://localhost:3001` (or `PORT` from `backend/.env`)

If **`VITE_API_URL` is unset**, Vite proxies `/api` and `/socket.io` to `http://localhost:3001`. If you set `VITE_API_URL`, the browser calls that origin directly (configure CORS and use a reachable host for phone/LAN testing).

### 5. Production build (frontend)

```bash
npm run build
```

Backend: `cd backend && npm run build && npm start`.

---

## Environment variables

The API loads **repo root `.env` first**, then **`backend/.env`** (backend wins on duplicate keys). See `backend/src/loadEnv.ts` for details.

### Backend — required for auth

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (Supabase **pooler** recommended; see `backend/.env.example`) |
| `JWT_SECRET` | Secret used to sign JWT access tokens |

### Backend — URLs used in emails and links

| Variable | Purpose |
|----------|---------|
| `FRONTEND_URL` | Origin of the SPA (no trailing slash), e.g. `https://your-app.vercel.app`. Used in **password reset**, **email verification**, and **employee activation** links. If wrong, links in emails point at the wrong host. |

### Backend — transactional email (Resend)

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Resend API key (`re_...`). **Required in production** (`NODE_ENV=production`); optional in development (links logged to console). |
| `RESEND_FROM` | **Transactional sender** (activation, password reset, verification, notifications). **Required in production.** Must be `you@verified-domain.com` or `CareTip <you@verified-domain.com>` (typically `CareTip <noreply@mail.caretip.de>`). **Invalid:** a bare domain like `caretip.de` (Resend **422**). `RESEND_FROM_EMAIL` is an alias. In development only, invalid/missing values fall back to a dev sender with a warning. Demo/Support lead From defaults to `hello@` / `support@` on the same verified domain (optional overrides: `RESEND_FROM_LEADS`, `RESEND_FROM_SUPPORT`). |

Add your domain in the **Resend dashboard → Domains**, complete the DNS records Resend shows for **that account** (records are not portable between Resend accounts), then set `RESEND_FROM` to an address on that domain.

### Backend — optional

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Card payments and webhooks |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_STORAGE_BUCKET` | Avatars & logos to Supabase Storage (public bucket `caretip` by default) |
| `PORT` | API port (default **3001**) |
| `ADMIN_SEED_SECRET` | Required for `npm run admin:create` (≥ 8 characters) |
| `AUTH_LOGIN_MAX_PER_WINDOW` | Login rate limit tuning |

### Frontend (Vite) — repo root `.env` / `.env.local`

| Variable | Example | Purpose |
|----------|---------|---------|
| `VITE_API_URL` | *(omit in local dev)* | If **unset**, Vite **proxies** `/api` and `/socket.io` to `http://localhost:3001`. If set, the browser calls this base URL directly. |
| **`BASE_URL`** | `https://caretip.de` | **Preferred** public SPA origin for **QR codes and share links** (read at `vite build` / dev start; not hardcoded). Baked as `import.meta.env.VITE_CARETIP_APP_ORIGIN`. |
| `VITE_BASE_URL` / `NEXT_PUBLIC_BASE_URL` / `NEXT_PUBLIC_APP_URL` / `VITE_APP_URL` | `https://caretip.de` | Fallbacks if `BASE_URL` is unset (same “URL only” rules). |
| `VITE_GOOGLE_CLIENT_ID` | `*.apps.googleusercontent.com` | Google Sign-In, if enabled in your build |

---

## Transactional email (Resend)

All outbound mail goes through **`backend/src/services/resendClient.ts`** (same HTTP pattern as the working password-reset path).

| Flow | Trigger | Link shape in email |
|------|---------|---------------------|
| **Email verification** | After password **business** or **employee** signup; resend from login or check-email page | `{FRONTEND_URL}/verify-email?token={RAW_TOKEN}` |
| **Employee activation** | After owner creates staff with activation (dashboard) | `{FRONTEND_URL}/activate?token={RAW_TOKEN}` |
| **Password reset** | Forgot-password request | `{FRONTEND_URL}/reset-password/{RAW_TOKEN}` |

**Security model (unchanged):**

- **Database:** stores a **one-way hash** of the token (SHA-256 of the raw secret).
- **Email:** contains only the **raw** token in the URL (never the hash).

Sign-up and resend paths **await** sending where appropriate so short-lived serverless invocations still complete the Resend request before the HTTP response returns.

---

## Authentication & verification

These are **separate product flows** but they share consistent user state:

| Flow | Who | What happens |
|------|-----|----------------|
| **Email verification** | Users who sign up with **email + password** (manager or employee invite signup) | `User.emailVerified` stays false until they open the verification link. Login returns a structured **`EMAIL_NOT_VERIFIED`** response so the UI can show a clear message and **resend** options. |
| **Employee activation** | Staff invited from the **business dashboard** | User row may exist with **no password** until they complete **`/activate`**. Completing activation sets password, marks **`emailVerified`**, and sets employee **`activationStatus`** to **active**. No separate “verify inbox” step for that path beyond the activation link itself. |

**Resend verification email (API):**

- `POST /api/auth/resend-verification-email` — body `{ email, password }` (proves identity without a session).
- `POST /api/auth/resend-verification-email/session` — **Bearer JWT**; for the **check-email** screen right after signup.

**Maintenance (optional DB repair):** `npm run db:sync-active-employee-email-verified` in `backend/` fixes legacy rows where an employee is **active** but `email_verified` was still false (see `employeeActivationConsistency.service.ts`).

---

## Technical architecture

| Layer | Stack |
|--------|--------|
| **Frontend** | React 18, Vite, Tailwind CSS, Lucide, React Router, Socket.io client, PWA (Vite PWA plugin) |
| **Backend** | Node.js, Express, Socket.io, JWT, Prisma |
| **Database** | PostgreSQL + Prisma (`backend/prisma`) |
| **Payments** | Stripe (Payment Intents, webhooks); businesses may store `stripeAccountId` for Connect-style flows |
| **Media** | Supabase Storage (optional; bucket should allow public read for logo/avatar URLs) |

> The ORM is **Prisma** (not Sequelize). After schema or env changes, run **`npm run db:generate`** in `backend/`.

---

## Branding & UI

| Role | Hex | Usage |
|------|-----|--------|
| **Stormy Teal** | `#197278` | Primary actions, QR framing |
| **Dark Slate Grey** | `#283D3B` | Body text |
| **Tomato Jam** | `#C44536` | Accent / urgency (sparingly) |

---

## Database & migrations

- **Schema:** `backend/prisma/schema.prisma`
- **Deep dive (reset vs migrate, baselining, role enum):** **`backend/README.md`**

Typical production deploy:

```bash
cd backend && npm run db:migrate:deploy
```

---

## Useful scripts

| Location | Command | Purpose |
|----------|---------|---------|
| Root | `npm run dev` | Vite dev server |
| Root | `npm run build` | Production SPA build |
| Root | `npm run typecheck` | TypeScript check (frontend) |
| Root | `npm run dev:api` | Run backend dev from root |
| `backend/` | `npm run dev` | API + hot reload (`tsx watch`) |
| `backend/` | `npm run env:check` | Print whether critical env vars are set |
| `backend/` | `npm run db:generate` | Regenerate Prisma client |
| `backend/` | `npm run db:migrate` | Dev migrations |
| `backend/` | `npm run db:migrate:deploy` | CI / production migrations |
| `backend/` | `npm run db:sync-active-employee-email-verified` | One-off repair: active employees + unverified email |
| Root | `npm run playwright:install` | Download Playwright browsers (retries, timeouts, cache clear — see script) |
| Root | `npm run test:e2e` | Playwright E2E (runs `pretest:e2e` install unless `SKIP_PLAYWRIGHT_INSTALL=true`) |
| Root | `npm run test:e2e:with-server` | Start Vite, then Playwright (see `scripts/playwright-with-server.mjs`) |

### Playwright (E2E)

1. **One-time (or after Playwright upgrades):** `npm run playwright:install`  
   Uses `scripts/install-playwright.mjs`: tries normal install → `--force` → Azure mirror → full install, with **hard timeout** and **stall detection** (no output for several minutes kills that attempt). Clears `%LOCALAPPDATA%\ms-playwright` (Windows) or the macOS/Linux cache between retries.

2. **Do not block daily dev:** `npm run dev` does **not** install browsers. To skip the automatic step before tests: set **`SKIP_PLAYWRIGHT_INSTALL=true`** in `.env` (then install browsers manually when you want E2E).

3. **Hanging downloads:** free disk space; set **`HTTPS_PROXY` / `HTTP_PROXY`** if required; set **`PLAYWRIGHT_DOWNLOAD_HOST`** (see `.env.example`). Or use **`PLAYWRIGHT_USE_SYSTEM_CHROME=true`** / **`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`** so tests use an existing Chrome/Chromium.

4. **Run tests:** Terminal A `npm run dev` → Terminal B `npm run test:e2e`, or a single shot: `npm run test:e2e:with-server`.

---

## Deployment & production notes

### Split hosting (common)

- **Frontend:** e.g. Vercel / Netlify → set **`VITE_API_URL`** to your **API** public URL. For production QR codes, set **`BASE_URL=https://caretip.de`** (or `NEXT_PUBLIC_APP_URL`) on the **frontend** build so links are not tied to a preview hostname. `vercel.json` redirects **`caretip-project.vercel.app`** → **`https://caretip.de`** when both point at this project.
- **Backend:** e.g. Railway, Render, Fly, VPS → set **`FRONTEND_URL`** to the **same SPA origin** users open in the browser (emails and redirects depend on it).

### Resend

- Set **`RESEND_API_KEY`** and a valid **`RESEND_FROM`** (see [Environment variables](#environment-variables)).
- When **`NODE_ENV=production`**, the API **refuses to start** if `RESEND_API_KEY` or `RESEND_FROM` is missing or invalid. Verify with **`GET /health`** (`email.configured` must be `true`).

### Vercel (Hobby) + private GitHub

Deployments can be **blocked** if the **commit author** is not the GitHub user linked to the Vercel team. Use a commit email verified on that GitHub account, or upgrade for team collaboration. (This is a Vercel policy, not something enforced in this repo.)

---

## Admin system & security

CareTip separates **business / staff** accounts from **platform operators** (`SUPER_ADMIN` + `isPlatformAdmin`).

### Why public admin signup does not exist

`POST /api/auth/register` **rejects** attempts to create `SUPER_ADMIN`, set `isPlatformAdmin`, or disable `isActive`. Business signups become **`MANAGER`**. Employees are admitted only via business invite (or manager-created employee) and then activate with password or OAuth — OAuth never creates employment by itself.

### Roles (UI vs database)

| UI / product | `User.role` in PostgreSQL |
|--------------|---------------------------|
| Business owner | `MANAGER` |
| Staff | `EMPLOYEE` |
| Platform operator | `SUPER_ADMIN` |

Platform routes require **`SUPER_ADMIN`**, **`isPlatformAdmin`**, and **`isActive`**, re-checked from the database (not JWT alone). **`audit_logs`** records sensitive platform access.

### Create the first platform admin

```bash
cd backend
# Set ADMIN_SEED_SECRET in backend/.env (≥ 8 characters), then:
npm run admin:create -- you@example.com 'strong-unique-password'
```

From repo root you can also use `node scripts/createAdmin.js` (wrapper sets `cwd` to `backend`). In **production**, the script refuses unless **`ALLOW_ADMIN_SEED_IN_PRODUCTION=true`**. By default only **one** `SUPER_ADMIN` exists unless you allow multiples (see `backend/README.md`).

### Additional platform admins (shared dashboard, separate logins)

Team operators each get their own `SUPER_ADMIN` account (`isPlatformAdmin: true`) — **no** new tenant, organization, or duplicated data. MFA (Google Authenticator) is configured **per account** on first sign-in at `/platform-admin/login`.

```bash
cd backend
# ADMIN_SEED_SECRET required (≥ 8 characters)
npm run admin:seed-team
```

Idempotent: creates missing accounts, updates role flags, never duplicates users. Existing passwords and MFA secrets are **preserved** on re-run. To force new temporary passwords: `npm run admin:seed-team -- --reset-passwords`.

Configure seeded admin emails/passwords via environment variables (never commit real values):

| Variable | Purpose |
|----------|---------|
| `ALBERTINA_ADMIN_TEMP_PASSWORD` / `FANNY_ADMIN_TEMP_PASSWORD` | Temporary passwords for seeded team admins (min. 12 characters) |

Verify after seeding:

```bash
npm run admin:verify -- '<TEAM_ADMIN_EMAIL>' '<PASSWORD>'
```

### Security measures (summary)

| Measure | Purpose |
|--------|---------|
| `isActive` | Revoke access without deleting users |
| DB-backed platform checks | Do not trust JWT claims alone |
| `audit_logs` | Compliance trail |
| Rate limits on `POST /login` and `POST /signin` | Brute-force mitigation (`AUTH_LOGIN_MAX_PER_WINDOW`) |

---

## Compliance & privacy (product patterns)

| Capability | Concept in the product |
|------------|-------------------------|
| Data portability | Authenticated exports where implemented |
| Right to erasure | Account delete flows as designed per route |
| Password quality | Strong password rules client + server |

*Legal wording for your jurisdiction is outside this README.*

---

## Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| **422 from Resend** `Invalid from field` | `RESEND_FROM` must be `email@domain` or `Name <email@domain>`, not a bare domain. |
| **Emails never arrive** | `RESEND_API_KEY`, domain verification in Resend, spam folder, `FRONTEND_URL` correctness (links may still “work” but point to the wrong site). |
| **Prisma P1001 / DB unreachable** | Pooler URL, Supabase paused project, Windows DNS (`NODE_OPTIONS=--dns-result-order=ipv4first`). |
| **`Environment variable not found: DATABASE_URL`** | Put `DATABASE_URL` in `backend/.env` or run Prisma via `npm run prisma -- …` / `db:*` scripts so both env files load. |
| **Login “email not verified”** | Complete `/verify-email`, or use **resend** from the login or check-email UI. |
| **Stale Prisma client** | `cd backend && npm run db:prisma:reset-client` |
| **Playwright “Executable doesn't exist … headless_shell”** | Run `npm run playwright:install`. If installs hang, see [Playwright (E2E)](#playwright-e2e): proxies, `PLAYWRIGHT_DOWNLOAD_HOST`, system Chrome, or `SKIP_PLAYWRIGHT_INSTALL` + manual install. |

More backend-specific migration and enum recovery steps live in **`backend/README.md`**.

---

## License & contact

Proprietary — **CareTip Limited**. Use the legal and support contacts configured for your deployment.

---

*Built with care for hospitality teams everywhere.*
