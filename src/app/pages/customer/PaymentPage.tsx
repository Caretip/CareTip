import { useNavigate, useSearchParams } from "react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useTipFlow } from "../../context/TipFlowContext";
import { CareTipPageLoader } from "../../components/CareTipPageLoader";

/**
 * Legacy guest payment/review URL.
 * Checkout now starts from tip amount (or repeat-tip). Keep this route so old
 * Stripe cancel links and bookmarks still recover employee context.
 */
export function PaymentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { employeeId: employeeIdCtx } = useTipFlow();
  const employeeIdFromUrl = searchParams.get("employeeId");
  const resolvedEmployeeId = employeeIdFromUrl ?? employeeIdCtx;
  const canceled = searchParams.get("canceled") === "1";

  useEffect(() => {
    if (canceled) {
      toast.message(t("tipFlow.payment.canceledTitle"), {
        description: t("tipFlow.payment.canceledDesc"),
      });
    }

    if (!resolvedEmployeeId) {
      navigate("/", { replace: true });
      return;
    }

    const qs = new URLSearchParams({ employeeId: resolvedEmployeeId });
    const returnSlug = searchParams.get("returnSlug");
    const returnBusinessSlug = searchParams.get("returnBusinessSlug");
    const returnEmployeeSlug = searchParams.get("returnEmployeeSlug");
    if (returnBusinessSlug && returnEmployeeSlug) {
      qs.set("returnBusinessSlug", returnBusinessSlug);
      qs.set("returnEmployeeSlug", returnEmployeeSlug);
      qs.set("direct", "1");
    } else if (returnSlug) {
      qs.set("returnSlug", returnSlug);
      qs.set("direct", "1");
    }
    if (canceled) qs.set("canceled", "1");
    navigate(`/tip-amount?${qs.toString()}`, { replace: true });
  }, [canceled, navigate, resolvedEmployeeId, searchParams, t]);

  return (
    <CareTipPageLoader variant="wait" context="tipPage" registrationKey="payment-legacy-redirect" />
  );
}
