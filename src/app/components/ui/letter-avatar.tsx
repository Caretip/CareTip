import { cn } from "./utils";

/** CareTip brand orange — initial fallback circles */
export const CARETIP_BRAND_ORANGE = "#eb992c";

interface LetterAvatarProps {
  name: string;
  className?: string;
  size?: "sm" | "md" | "lg" | "full";
  /** @deprecated Prefer default brand orange; use for legacy teal accents only */
  tone?: "brand" | "teal";
}

const sizeClasses: Record<string, string> = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
  full: "w-full h-full text-2xl min-w-0",
};

/** Renders the first letter of name on a colored background. Use when avatar/profile_image is null or image failed to load. */
export function LetterAvatar({ name, className, size = "md", tone = "brand" }: LetterAvatarProps) {
  const letter = (name?.trim() || "?")[0].toUpperCase();
  const isFull = size === "full";
  const bg = CARETIP_BRAND_ORANGE;
  return (
    <div
      className={cn(
        "flex items-center justify-center font-semibold text-white shrink-0",
        isFull ? "rounded-none" : "rounded-full",
        sizeClasses[size] ?? sizeClasses.md,
        className
      )}
      style={{ backgroundColor: bg }}
      aria-hidden
    >
      {letter}
    </div>
  );
}
