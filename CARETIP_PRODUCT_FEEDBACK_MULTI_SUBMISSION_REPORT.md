# CareTip Product Feedback — Multi-Submission Audit & Implementation

## Audit answer (before changes)

**Could one MANAGER or EMPLOYEE submit Review A and later Review B and keep both rows?**

**No.** Phase 1 enforced **one record per user**:

| Layer | Evidence |
|--------|----------|
| Database | `CREATE UNIQUE INDEX "platform_product_feedback_user_id_key"` on `user_id` |
| Prisma | `userId String @unique`; `User.platformProductFeedback` one-to-one optional |
| Service | `findUnique({ where: { userId } })` + `update` when a row exists |
| POST | `upsertMyPlatformProductFeedback` — second POST **overwrote** rating/comment |
| GET `/me` | Single `feedback` object |
| Frontend | Assumed one review; **Update feedback** edited via upsert |

**Admin list/summary** already counted **rows** (not unique users), so multiple rows per user only required schema + create semantics.

**Anonymization:** `updateMany` on `userId` clears `comment` only — compatible with many rows per user.

**Rate limit:** `productReviewMeRateLimit` unchanged.

---

## Target behavior (after)

- **POST `/api/product-reviews/me`** → always **INSERT** a new `PlatformProductFeedback`.
- **GET `/api/product-reviews/me`** → `{ latest: <most recent by createdAt> | null }`.
- **User UI:** show latest; **Share new feedback** opens empty form (no edit of old row).
- **Admin:** unchanged list/detail/PATCH per row; summary = all submissions.

---

## Database changes

**Migration:** `20261005173000_platform_product_feedback_per_user_history`

- `DROP INDEX platform_product_feedback_user_id_key`
- `CREATE INDEX platform_product_feedback_user_id_created_at_idx (user_id, created_at DESC)`
- **No data deleted**

**Prisma:** removed `@unique` on `userId`; `User.platformProductFeedback` → `[]`; added `@@index([userId, createdAt(sort: Desc)])`.

---

## API changes

| Endpoint | Before | After |
|----------|--------|--------|
| `GET /api/product-reviews/me` | `{ feedback: T \| null }` | `{ latest: T \| null }` |
| `POST /api/product-reviews/me` | upsert; `{ feedback, created }` | create; `{ feedback }` |

Admin routes, validation, rate limit, auth gates: **unchanged**.

---

## UI changes

- Modal is **composer-only**: no `GET /me` on open; no “latest feedback” or update UI.
- Each sidebar open → empty stars + comment; success then full reset on close.
- API client `latest` remains for dashboard entry CTA only (optional).
- Compact star modal design retained.

---

## Tests

```bash
cd backend && npm run test:platform-product-review
```

Covers: two creates per manager, first row preserved, `latest` points to second, employee isolation, HTTP GET `latest`, admin PATCH per id, guest `/api/feedback/*` regression.

Also run locally after migration:

```bash
cd backend && npx prisma migrate deploy
```

```bash
npm run typecheck
```

---

## Not changed

- `TipFeedback` / `/api/feedback/*` / customer review UI
- Guest feedback flows
- `productReviewMeRateLimit` configuration
