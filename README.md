# CareTip

CareTip is a hospitality tipping platform: guests scan QR codes, pay tips by card (Stripe), and businesses and staff see payouts and analytics in a web app.

## Stack

- **Frontend:** React, Vite, TypeScript
- **Backend:** Node.js, Express, Prisma, PostgreSQL
- **Auth & storage:** Supabase (where configured), Firebase (push notifications)

## Getting started

1. Clone the repository and install dependencies at the repo root and under `backend/`.
2. Copy `backend/.env.example` to `backend/.env` and fill in required values (database, Stripe, etc.).
3. Run database migrations from `backend/` (`npx prisma migrate deploy` or `migrate dev` for local work).
4. Start the API (`npm run dev` in `backend/`) and the web app (`npm run dev` at the repo root).

Demo and admin seed scripts read credentials from environment variables only; see `backend/.env.example` for placeholders.

## Scripts

- Root `package.json` — frontend dev, build, and tests
- `backend/package.json` — API, Prisma, and backend tests

## License

Proprietary — CareTip Limited. All rights reserved.
