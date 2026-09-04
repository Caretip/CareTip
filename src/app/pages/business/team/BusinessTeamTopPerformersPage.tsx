import { Navigate } from "react-router";

/** Legacy URL — Performance workspace, Leaderboard & Awards tab. */
export function BusinessTeamTopPerformersPage() {
  return <Navigate to="/dashboard/team/performance?tab=leaderboard" replace />;
}
