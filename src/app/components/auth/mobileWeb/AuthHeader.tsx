import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AuthHeaderProps = {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  className?: string;
};

export function AuthHeader({ title, subtitle, icon, className }: AuthHeaderProps) {
  return (
    <header className={cn("mw-auth-header", className)}>
      {icon ? <div className="mw-auth-header__icon">{icon}</div> : null}
      <h1 className="mw-auth-header__title">{title}</h1>
      {subtitle ? <p className="mw-auth-header__subtitle">{subtitle}</p> : null}
    </header>
  );
}
