export type FbLoginOutcome =
  | "connected_with_token"
  | "connected_without_token"
  | "not_authorized"
  | "unknown"
  | "other_status";
