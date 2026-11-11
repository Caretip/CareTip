# Super Admin procedures

Only Super Admins can approve or reject account registrations. No lower role exists, and none should be added without a design review.

## Check the current state

Read-only. Prints counts, never addresses:

```
cd backend
npm run admin:posture
```

Exit code 0 means at least two active admins, all with MFA.

## Add a second Super Admin

Needs a named person, a reason, and sign-off from the business owner.

1. Use a **new, dedicated email** for that person. The script refuses any address that already has a non-admin account. Admin accounts must never double as manager or employee accounts.
2. Use a strong one-time password, passed through the environment rather than as an argument, so it stays out of shell history.
3. Run from a secure machine:

```
cd backend
ALLOW_MULTIPLE_SUPER_ADMINS=true \
ALLOW_ADMIN_SEED_IN_PRODUCTION=true \
ADMIN_SEED_SECRET=<operator value> \
ADMIN_SEED_OPERATOR="<who is running this>" \
ADMIN_SEED_REASON="<why, with ticket reference>" \
ADMIN_INITIAL_PASSWORD=<one-time password> \
npm run admin:create -- new.admin@example.com
```

4. The new admin signs in at `/platform-admin/login`, enrols their authenticator straight away, and changes the password.
5. Run `npm run admin:posture` again.
6. Remove those variables from the shell.

The script writes `platform.admin.created_by_script` to the audit log with the operator and reason.

**Until step 4 is done, the password alone can enrol MFA.** Hand over the password securely and enrol immediately.

## Lost authenticator

**Normal replacement, old device still working:** `POST /api/auth/2fa/replace/start` needs a session, the password and a current code. Then confirm with a code from the new device.

**Device lost:** another Super Admin calls `POST /api/platform/users/:userId/mfa-reset` with a reason and their own MFA code. An admin can't reset their own factor. The target is signed out everywhere, and is told by email.

1. Confirm the person's identity outside CareTip first.
2. Reset.
3. They sign in and enrol again straight away, because the password alone can enrol until they do.

**The only Super Admin lost their device:** there's no in-app recovery. This is why a second admin matters. It needs a reviewed database operation by an authorised engineer: clear the three `two_factor_*` values on that account, end its sessions, and record the action in writing.

## Rules

- Each admin has their own account. Never share one.
- Review `platform.*`, `mfa.*` and `account.recovery.*` audit entries regularly.
- Remove admin access the same day someone leaves.
