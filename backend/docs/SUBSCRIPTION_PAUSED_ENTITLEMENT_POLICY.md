# Stripe `paused` subscription entitlement policy

## Stripe meaning

When Stripe reports `subscription.status === "paused"`, collection on an existing subscription is paused. It is **not** canceled, not past_due, and not evidence of payment success.

## CareTip mirror

| Stripe status | Mirror `Subscription.status` | Product entitlements (`isSubscriptionMirrorEntitled`) | Block new checkout / delete |
|---------------|------------------------------|------------------------------------------------------|-----------------------------|
| `paused`      | `paused`                     | **No**                                               | **Yes** (subscription exists) |
| `active`      | `active`                     | Yes (subject to cancel grace)                        | Yes |
| `trialing`    | `trialing`                   | Yes                                                  | Yes |
| `past_due`    | `past_due`                   | Yes                                                  | Yes |
| `canceled`    | `canceled`                   | Grace only until period end                            | No (unless grace) |

Mapping is implemented in `mapStripeSubscriptionStatus`. Webhooks, checkout activation, and billing reconciliation all use the same mapper and `applyStripeMirrorTransactional`.

## Fail-closed rules

- **Stripe API outage** (`verification_failed`, `skipped_stripe_unavailable`): checkout does **not** start; delete guard blocks when verification is required. No mirror row is inferred as `paused`.
- **Reconciliation** repairs mirror status from a **verified** Stripe retrieve only; paused Stripe → paused mirror clears `Business.subscriptionTier` via `resolveBusinessTierDualWrite` (not entitled).
- **Legacy tier**: `Business.subscriptionTier` is dual-written only when the mirror is entitled; paused mirrors must not retain a paid tier after sync.

## Schema

`SubscriptionStatus.paused` requires migration `20261011200000_subscription_status_paused`. Do not apply to shared production without a planned deploy.
