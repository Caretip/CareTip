import type { CareTipPageLoaderProps } from "./CareTipPageLoader";
import { CareTipPageLoader } from "./CareTipPageLoader";

export type PageLoaderProps = Pick<
  CareTipPageLoaderProps,
  "message" | "className" | "variant" | "context" | "registrationKey"
>;

/**
 * Registers fullscreen loading with the global branded overlay.
 * Use `variant="section"` or `"compact"` for in-dashboard placeholders.
 * Do not pass a second sentence — `message` replaces the default tagline.
 */
export function PageLoader({
  message,
  className,
  variant = "wait",
  context,
  registrationKey,
}: PageLoaderProps) {
  return (
    <CareTipPageLoader
      variant={variant}
      message={message}
      context={context}
      className={className}
      registrationKey={registrationKey}
    />
  );
}
