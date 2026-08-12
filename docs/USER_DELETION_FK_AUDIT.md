# CareTip — User deletion & `businesses_user_id_fkey` audit

## Status

| Label | Result |
| --- | --- |
| Schema change | **NOT REQUIRED** |
| `ON DELETE CASCADE` | **NOT ADDED** (would be incorrect) |
| Application deletion architecture | **CORRECT** — reuse existing flows |
| Constraint `businesses_user_id_fkey` | **INTENTIONAL** (`ON DELETE RESTRICT`) |

---

## 1. Root cause

A direct SQL / Prisma hard delete of a `User` failed because that user is still the **required owner** of a `Business` row:

```text
Business.userId → User.id
DB constraint: businesses_user_id_fkey
Prisma: onDelete: Restrict
```

PostgreSQL correctly refused the delete. This is **not** a broken foreign key; it is the lifecycle Slice D ownership contract.

---

## 2. Affected relationship

| Item | Value |
| --- | --- |
| Table | `businesses` |
| Column | `user_id` (`Business.userId`) |
| References | `users.id` |
| Cardinality | **1:1** (`@unique`, required `String`) |
| Meaning | Sole **manager/owner** of the venue |
| `onDelete` | **Restrict** — owner cannot be removed while the Business exists |

Schema comment (`backend/prisma/schema.prisma`):

> Slice D: Restrict — owner User cannot be deleted while Business exists.

Staff accounts are **not** this FK. Staff use nullable `Employee.userId` with `onDelete: SetNull`.

---

## 3. Correct deletion behavior

| Question | Answer |
| --- | --- |
| Can a User be hard-deleted while their Business remains? | **No** |
| Should deleting a User cascade-delete the Business? | **No** (tips/refunds must not be wiped; ledger uses Restrict on Business) |
| Should `Business.userId` become null? | **No** — column is required; ownership must be transferred or Business removed first |
| Production Art. 17 path | **Soft revoke + anonymize in place** — not hard `DELETE FROM users` |
| Empty test tenant | Hard-delete **Business first**, then staff Users, then owner (`deleteBusinessCascadeUsers`) |

### Intended User-related FK behaviors (summary)

| Relation | onDelete | Intent |
| --- | --- | --- |
| `Business.userId` | **Restrict** | Protect owner link / prevent orphan venue |
| `Employee.userId` | SetNull | Staff membership can detach; tip history stays on Employee/Business |
| Auth satellites (OAuth, refresh, settings, notifications, …) | Cascade | Safe to drop with User |
| Audit / support author fields | SetNull | Preserve operational records without blocking User delete |
| `Transaction` / `TipRefund` → Business | Restrict | Never cascade-wipe financial history |

---

## 4. Tables involved (User references)

**Restrict (blocks User delete):**

- `businesses.user_id`

**Cascade with User (auth / prefs / tokens):**

- `oauth_accounts`, `user_settings`, push tokens, notifications, refresh/password/email/mobile-handoff tokens, employee invites created/redeemed by that user (see Prisma)

**SetNull:**

- `employees.user_id`, audit log actor, support ticket authors, announcement creator, sponsored-grant approver, …

**Not a Prisma FK (plain id strings):**

- `users.legal_hold_set_by_user_id`, `businesses.legal_hold_set_by_user_id`

---

## 5. Existing application workflows (**reuse these**)

Do **not** invent a second deletion stack.

| Goal | Supported path |
| --- | --- |
| Production account erasure | `requestAccountErasure` → `erasure_pending` → anonymize jobs (`anonymization.service.ts`). Blocks if live sole owner Business / active sub / pending tips. |
| Leave venue, keep Business | `transferBusinessOwnership` then erase former owner |
| Soft-close empty/draft venue | Platform soft-delete (`softDeleteBusinessForAdmin`) — keeps `userId`; does **not** free Restrict for hard User delete |
| Wipe empty **test** business + users | `deleteBusinessCascadeUsers(businessId)` in `business.service.ts` (also platform hard-delete for empty ledger) |

`deleteBusinessCascadeUsers` already documents and implements the correct order:

1. Refuse if tips/refunds exist  
2. Delete **Business** first (children cascade where allowed)  
3. Delete staff Users  
4. Delete **owner** User  

---

## 6. Schema migration?

**None.** Changing Restrict → Cascade or making `userId` nullable would weaken ownership and risk destructive or orphaned venues. Do not alter FKs to make manual `DELETE FROM users` succeed.

---

## 7. Safe procedure — development / test users

### A) Manager with **empty** tip ledger (preferred cleanup)

```ts
// Use existing service (scripts / platform admin tool)
await deleteBusinessCascadeUsers(businessId);
```

Manual dependency order (same semantics):

1. Confirm `transactions` / `tip_refunds` count for `business_id` is **0**  
2. `DELETE` the `businesses` row (or Prisma `business.delete`)  
3. Delete leftover staff `users`  
4. Delete the owner `users` row  

### B) Manager with tip history

1. Create/use another MANAGER user  
2. Transfer ownership (`transferBusinessOwnership`)  
3. Then erase/anonymize or (only if still needed) hard-delete the **former** owner  
4. **Do not** hard-delete the Business (ledger Restrict)

### C) Employee test user

1. Soft-remove / anonymize (detaches `employees.user_id`) **or** set `employees.user_id = NULL`  
2. Then hard-delete the User if required for local cleanup  

### D) What **not** to do

- `DELETE FROM users WHERE id = …` while any `businesses.user_id` points at them  
- Adding `ON DELETE CASCADE` on `businesses_user_id_fkey`  
- Nulling `businesses.user_id` without a schema + ownership redesign  

---

## 8. Production safety considerations

- Prefer **erasure request + anonymization**, not SQL deletes.  
- Sole owners must **transfer** or **soft-close** (per product gates) before erasure proceeds.  
- Soft-closed Business can still reference the owner User — Restrict remains; anonymization scrubs PII **in place**.  
- Financial rows are protected by Restrict on Business — hard venue wipe is only for empty ledgers.  
- Platform admin–owned businesses are refused by `deleteBusinessCascadeUsers`.  
- Legal holds block anonymization paths — do not bypass with SQL.

---

## 9. Verification

| Check | Result |
| --- | --- |
| `npx prisma validate` | **PASS** — schema valid |
| `npm run test:lifecycle-slice-d` | **PASS** (includes T-F02-a: owner delete Restricted by `businesses_user_id_fkey`) |
| `npm run test:lifecycle-slice-d1` | **PASS** (empty hard-delete via `deleteBusinessCascadeUsers`; tip/refund Restrict) |

---

## Conclusion

The FK violation is **expected and correct**. Fix the **operation** (delete/transfer Business first, or use erasure/anonymize), not the constraint.
