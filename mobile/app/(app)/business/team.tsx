import { lazyScreen } from "@/components/navigation/LazyScreen";

export default lazyScreen(() =>
  import("@/features/business/TeamManagementScreen").then((m) => ({
    default: m.TeamManagementScreen,
  })),
);
