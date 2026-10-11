# CareTip — Cross-Platform Employee Invite Code Audit

## Status legend

| Label | Meaning |
| --- | --- |
| **AUDITED** | Inspected |
| **IMPLEMENTED** | Changed in this task |
| **TESTED** | Covered by automated checks |
| **NOT CHANGED** | Intentionally left alone |
| **NOT VERIFIED** | Device/E2E not run |

---

## 1. Root cause (web → mobile failure)

Mobile Join treated a **successful** validate response as invalid.

| Layer | Contract |
| --- | --- |
| Backend / Web | `GET /api/business/invite/validate` → `{ ok: true, businessName, … }` |
| Mobile (before) | Checked `validation.valid` (field **does not exist**) |

So every successful validate failed client-side with “invalid/expired”, even for live web-generated codes.

**Secondary hardening:** invite codes were only `.trim()`’d on mobile; backend normalizes with uppercase + strip spaces/hyphens. Mobile now mirrors that. Validate is also treated as a **public** API path (no Bearer attach / refresh).

---

## 2. Existing web invite endpoints / services (**AUDITED** · **NOT CHANGED**)

| Action | Endpoint | Service |
| --- | --- | --- |
| Generate | `POST /api/business/generate-invite` | `employeeInvite.service` / `business.controller` |
| Validate | `GET /api/business/invite/validate?code=` | same |
| Redeem | `POST /api/auth/register` or `POST /api/auth/oauth` with `inviteCode` | `registerEmployeeWithInvite` |

- 8-char multi-use codes, 7-day TTL, business from invite record (not client `businessId`)
- Generate revokes prior active invites for that business
- Manager + verified email required to generate

Web UI: `StaffManagementPage` — **unchanged**.

---

## 3. Existing mobile endpoints / services

| Action | Before | After |
| --- | --- | --- |
| Generate | Missing | `POST /api/business/generate-invite` via `generateBusinessInviteCode` |
| Validate | Same path, wrong `ok`/`valid` | Fixed + normalize + public path |
| Redeem | register / oauth with `inviteCode` | Same + normalize |

No second invite system. No mobile-only codes.

---

## 4. Changes implemented (**IMPLEMENTED**)

1. Fix Join to require `validation.ok`
2. Align `InviteValidation` type with backend `{ ok }`
3. Shared `normalizeInviteCode` (trim, upper, strip spaces/hyphens)
4. Mark `/api/business/invite/validate` as public in API client
5. Normalize invite on validate / register / oauth
6. Team Management: Add employee → Generate / Copy / Share invite (backend expiry only)
7. i18n EN/DE for team invite UX
8. Regression scripts: `test:employee-invite`, auth-entry asserts

---

## 5. Mobile Team Management

`TeamManagementScreen` now includes:

- **Add employee** section
- **Generate invite code** / regenerate
- Shows code + **Expires** when backend returns `expiresAt`
- **Copy code** + **Share invite**

Roster list unchanged otherwise.

---

## 6. Cross-platform compatibility

| Direction | Expected |
| --- | --- |
| Web-generated → Mobile redeem | Works (validate `ok` + same register/oauth) |
| Mobile-generated → Web redeem | Works (same `generate-invite` + Join/register) |

One database `EmployeeInvite` / legacy `Business.inviteCode` SSOT.

---

## 7. Tenant isolation (**AUDITED** · preserved)

- Generate: manager JWT → own `Business` only
- Redeem: `businessId` from locked invite row, not client
- Mobile generate does **not** send `businessId`
- **NOT CHANGED:** backend ownership / Restrict rules

---

## 8. Tests

| Test | Result |
| --- | --- |
| `npm run typecheck` (mobile) | **PASS** |
| `npm run test:employee-invite` | **PASS** |
| `npm run test:auth-entry` | **PASS** |
| `npm run test:mobile-runtime` | **PASS** (includes employee-invite) |
| `npm run lint` (expo) | Pre-existing config failure (lints ignored `app/` glob) — **not introduced by this change** |
| Device E2E web↔mobile redeem | **NOT VERIFIED** |

---

## 9. Remaining limitations

- Backend still maps expired/revoked/unknown to the same message (“Invalid or expired invite code”) — mobile cannot invent finer errors.
- Codes are multi-use until expiry/revoke; no “already used” single-use message.
- Deep-link invite open on mobile still not implemented.
- Email “add employee” activation path is separate from shareable codes (**NOT CHANGED**).

---

## Files changed

- `mobile/features/auth/JoinScreen.tsx`
- `mobile/features/auth/AcceptInviteScreen.tsx`
- `mobile/features/business/TeamManagementScreen.tsx`
- `mobile/types/auth.ts`
- `mobile/services/auth/authService.ts`
- `mobile/services/api/client.ts`
- `mobile/services/api/businessService.ts`
- `mobile/constants/endpoints.ts`
- `mobile/utils/normalizeInviteCode.ts`
- `mobile/services/share/shareService.ts`
- `mobile/i18n/locales/en.ts`, `de.ts`, `types.ts`
- `mobile/scripts/employee-invite-runtime.ts`, `auth-entry-runtime.ts`
- `mobile/package.json`
- `docs/MOBILE_EMPLOYEE_INVITE_CROSS_PLATFORM_AUDIT.md`
