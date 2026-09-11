/**
 * Release platform-held employee payables after the recipient account is ready.
 * Idempotent: unique transactionId, unique stripeTransferId, Stripe idempotency key.
 */
import Stripe from "stripe";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
} from "@prisma/client";
import { prisma } from "../prisma.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import { logServerError } from "../utils/httpErrors.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { remainingPayableCents } from "./employeeTipPayable.service.js";
import { isEmployeeRecipientReady } from "./employeeTipRouting.service.js";

type CreateTransferFn = (
  params: Stripe.TransferCreateParams,
  options: Stripe.RequestOptions,
) => Promise<Pick<Stripe.Transfer, "id" | "amount">>;
type CreateReversalFn = (
  transferId: string,
  params: Stripe.TransferReversalCreateParams,
  options: Stripe.RequestOptions,
) => Promise<Pick<Stripe.TransferReversal, "id" | "amount">>;

let createTransferFnForTests: CreateTransferFn | null = null;
let createReversalFnForTests: CreateReversalFn | null = null;

export function __setEmployeeTipTransferCreateFnForTests(fn: CreateTransferFn | null): void {
  createTransferFnForTests = fn;
}

export function __setEmployeeTipTransferReversalFnForTests(fn: CreateReversalFn | null): void {
  createReversalFnForTests = fn;
}

async function createTransfer(
  params: Stripe.TransferCreateParams,
  options: Stripe.RequestOptions,
): Promise<Pick<Stripe.Transfer, "id" | "amount">> {
  if (createTransferFnForTests) return createTransferFnForTests(params, options);
  return getStripeClient().transfers.create(params, options);
}

export async function reverseReleasedEmployeeTransfer(params: {
  payableId: string;
  stripeTransferId: string;
  amountCents: number;
  cumulativeReversedCents: number;
}): Promise<void> {
  if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) return;
  const reversalParams: Stripe.TransferReversalCreateParams = {
    amount: params.amountCents,
    metadata: { caretip_payable_id: params.payableId },
  };
  const options: Stripe.RequestOptions = {
    idempotencyKey: `emp_tip_reversal:${params.payableId}:${params.cumulativeReversedCents}`,
  };
  if (createReversalFnForTests) {
    await createReversalFnForTests(params.stripeTransferId, reversalParams, options);
    return;
  }
  await getStripeClient().transfers.createReversal(params.stripeTransferId, reversalParams, options);
}

export async function releaseHeldPlatformPayablesForEmployee(employeeId: string): Promise<{
  attempted: number;
  released: number;
  skipped: number;
}> {
  if (!employeeId.trim() || !isStripeConfigured()) {
    return { attempted: 0, released: 0, skipped: 0 };
  }

  return runSerializedByKey(`employee-tip-release:${employeeId}`, async () => {
    const account = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId },
      select: {
        stripeAccountId: true,
        stripeConnectStatus: true,
        stripePayoutsEnabled: true,
        employee: { select: { isDeleted: true, isActive: true, activationStatus: true } },
      },
    });
    if (!account || !isEmployeeRecipientReady(account)) {
      return { attempted: 0, released: 0, skipped: 0 };
    }
    if (
      account.employee.isDeleted ||
      !account.employee.isActive ||
      account.employee.activationStatus !== "active"
    ) {
      return { attempted: 0, released: 0, skipped: 0 };
    }

    const dest = account.stripeAccountId.trim();
    const held = await prisma.employeeTipPayable.findMany({
      where: {
        employeeId,
        chargeModel: EmployeeTipChargeModel.platform_hold,
        routingMode: EmployeeTipPayoutMode.direct_to_employee,
        status: {
          in: [
            EmployeeTipPayableStatus.held_platform,
            EmployeeTipPayableStatus.transfer_failed,
            EmployeeTipPayableStatus.transferring,
          ],
        },
        stripeTransferId: null,
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    let released = 0;
    let skipped = 0;
    for (const row of held) {
      const amount = remainingPayableCents(row);
      if (amount <= 0) {
        skipped += 1;
        continue;
      }

      if (row.status !== EmployeeTipPayableStatus.transferring) {
        const claimed = await prisma.employeeTipPayable.updateMany({
          where: {
            id: row.id,
            stripeTransferId: null,
            chargeModel: EmployeeTipChargeModel.platform_hold,
            routingMode: EmployeeTipPayoutMode.direct_to_employee,
            status: {
              in: [EmployeeTipPayableStatus.held_platform, EmployeeTipPayableStatus.transfer_failed],
            },
          },
          data: { status: EmployeeTipPayableStatus.transferring },
        });
        if (claimed.count !== 1) {
          skipped += 1;
          continue;
        }
      }

      try {
        const transferParams: Stripe.TransferCreateParams = {
          amount,
          currency: "eur",
          destination: dest,
          metadata: {
            caretip_employee_id: employeeId,
            caretip_business_id: row.businessId,
            caretip_payable_id: row.id,
            caretip_transaction_id: row.transactionId,
          },
        };
        if (row.stripeChargeId?.startsWith("ch_")) {
          transferParams.source_transaction = row.stripeChargeId;
        }
        const transfer = await createTransfer(transferParams, {
          idempotencyKey: `emp_tip_release:${row.id}`,
        });
        await prisma.employeeTipPayable.update({
          where: { id: row.id },
          data: {
            status: EmployeeTipPayableStatus.transferred,
            transferredCents: amount,
            stripeTransferId: transfer.id,
            stripeDestinationAccountId: dest,
            lastTransferError: null,
          },
        });
        released += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 180) : "transfer_failed";
        logServerError("employeeTipRelease.transfer", err, { payableId: row.id, employeeId });
        await prisma.employeeTipPayable.update({
          where: { id: row.id },
          data: {
            status: EmployeeTipPayableStatus.transfer_failed,
            lastTransferError: message,
          },
        });
      }
    }

    return { attempted: held.length, released, skipped };
  });
}
