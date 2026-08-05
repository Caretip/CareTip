import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AuthCardProps = {
  children: ReactNode;
  className?: string;
  variant?: "default" | "otp";
};

export function AuthCard({ children, className, variant = "default" }: AuthCardProps) {
  return (
    <div
      className={cn(
        "mw-auth-card",
        variant === "otp" && "mw-auth-card--otp",
        className,
      )}
    >
      {children}
    </div>
  );
}
