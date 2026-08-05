import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type AuthButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: string;
  variant?: "primary" | "secondary";
  children: ReactNode;
};

export function AuthButton({
  loading = false,
  loadingLabel,
  variant = "primary",
  className,
  disabled,
  children,
  ...props
}: AuthButtonProps) {
  return (
    <button
      type={props.type ?? "submit"}
      className={cn(
        "mw-auth-btn",
        variant === "secondary" && "mw-auth-btn--secondary",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? loadingLabel ?? children : children}
    </button>
  );
}
