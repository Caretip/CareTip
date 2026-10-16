import type Stripe from "stripe";
import { __setEmployeeTipReleaseTransferListFnForTests } from "../../src/services/employeeTipReleaseTransferLookup.service.js";

/** Empty destination transfer list with complete pagination (mocked Stripe list). */
export function installMockEmptyEmployeeTipTransferList(): void {
  __setEmployeeTipReleaseTransferListFnForTests(async () =>
    ({
      object: "list",
      data: [],
      has_more: false,
      url: "/v1/transfers",
    }) as Stripe.ApiList<Stripe.Transfer>,
  );
}

export function clearMockEmployeeTipStripeTransferList(): void {
  __setEmployeeTipReleaseTransferListFnForTests(null);
}
