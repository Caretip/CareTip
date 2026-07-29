import { lazyScreen } from "@/components/navigation/LazyScreen";

export default lazyScreen(() =>
  import("@/features/business/BusinessAnalyticsScreen").then((m) => ({
    default: m.BusinessAnalyticsScreen,
  })),
);
