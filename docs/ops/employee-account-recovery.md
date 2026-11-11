# Employee account recovery

For an employee who can no longer reach their login email. Service: `backend/src/services/accountRecovery.service.ts`.

## How it works

| Step | Who | What happens |
|---|---|---|
| 1 | Employee | Submits `/account/recovery`. The response is the same whether or not the account exists |
| 2 | Employee | Opens the link sent to the new address, within 1 hour |
| 3 | System | Warns the existing address with a cancel link. A 24-hour cooling-off starts |
| 4 | Admin A | Checks identity outside CareTip, then records the method and an evidence reference, with their own MFA code |
| 5 | Admin B | Reviews and approves with a reason and their own MFA code, after cooling-off |
| 6 | System | Swaps the email, ends every session, clears recovery tokens, tells both addresses |

The employee then signs in by using "forgot password" with the new address.

Requests expire after 7 days. Each account can have one open request, and at most three a day.

## Rules the code enforces

- Employees only. Manager and admin accounts can't use this.
- The admin who checks identity can't approve. **Two Super Admins are needed.**
- Both reviewers must prove their own MFA.
- A manager can't review, approve or see the queue.
- The account row stays the same, so employment, tips and payout links don't move.

## Identity checks

Policy decision needed: agree which checks are acceptable and write them down.

Record a **reference**, such as a support ticket number, and never the identity document. Keep the evidence in your existing secure support process.

Methods available: `video_call`, `government_id_check`, `employer_confirmation`, `other_documented`.

An employer's confirmation alone is weak: the manager is the party this process protects against, and H-02 showed why. Use it alongside another check.

## Review queue

`/platform-admin/account-recovery`, or `GET /api/platform/account-recovery`.

## If something goes wrong

| Situation | What to do |
|---|---|
| The existing address cancels | The request ends. Treat it as a possible attack |
| Replacement address now taken | Approval is refused and nothing changes. Reject the request |
| Only one Super Admin exists | Recovery can't complete. Create a second admin first |
| Employee also lost their authenticator | Use the separate MFA reset in `super-admin-procedures.md` |

Every step is in the audit log under `account.recovery.*`.
