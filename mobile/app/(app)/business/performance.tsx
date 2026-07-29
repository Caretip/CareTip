import { lazyScreen } from "@/components/navigation/LazyScreen";

export default lazyScreen(() =>
  import("@/features/business/BusinessPerformanceScreen").then((m) => ({
    default: m.BusinessPerformanceScreen,
  })),
);
