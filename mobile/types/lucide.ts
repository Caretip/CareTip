import type { ComponentType } from "react";

/** Shared Lucide icon component shape (avoids importing the lucide barrel in Metro). */
export type LucideIcon = ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;
