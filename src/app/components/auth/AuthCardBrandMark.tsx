import { Link } from "react-router";
import { CareTipLogo } from "../CareTipLogo";
import { cn } from "@/lib/utils";

type AuthCardBrandMarkProps = {
  className?: string;
  /** Link home (default). Set false for non-interactive mark. */
  linkHome?: boolean;
};

/**
 * Primary CareTip wordmark for auth form panels — sits on the card surface, no pill/card chrome.
 */
export function AuthCardBrandMark({ className, linkHome = true }: AuthCardBrandMarkProps) {
  const mark = (
    <CareTipLogo
      size="auth"
      variant="wordmark"
      tone="auto"
      align="center"
      className="caretip-auth-card-brand__logo"
    />
  );

  return (
    <div className={cn("caretip-auth-card-brand", className)}>
      {linkHome ? (
        <Link
          to="/"
          className="caretip-auth-card-brand__link touch-manipulation rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
          aria-label="CareTip"
        >
          {mark}
        </Link>
      ) : (
        mark
      )}
    </div>
  );
}
