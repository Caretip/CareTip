/** Consecutive days without an eligible tip before CareTip pauses QR receiving. */
export const EMPLOYEE_STRIPE_INACTIVITY_DAYS = 45;

/** Consecutive days without an eligible tip before the employee warning notification. */
export const EMPLOYEE_STRIPE_INACTIVITY_WARNING_DAYS = 35;

/** Stored on Employee.receivingPausedReason — not manager isActive. */
export const EMPLOYEE_RECEIVING_PAUSED_NO_ELIGIBLE_TIP = "no_eligible_tip";
