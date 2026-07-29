import { lazyScreen } from "@/components/navigation/LazyScreen";

export default lazyScreen(() =>
  import("@/features/business/BusinessLeaderboardScreen").then((m) => ({
    default: m.BusinessLeaderboardScreen,
  })),
);
