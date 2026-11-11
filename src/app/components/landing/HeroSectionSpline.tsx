import { Link } from "react-router";
import { BackgroundCircles } from "../ui/background-circles";

/**
 * Hero section using BackgroundCircles with a pulsing QR/phone image.
 * Replaces the previous Card + Spotlight layout.
 */
export function HeroSectionSpline() {
  return (
    <section className="relative overflow-hidden border-b border-white/30">
      <BackgroundCircles
        variant="caretip"
        title={
          <>
            Digital Tipping
            <br />
            <span className="text-accent">Made Simple</span>
          </>
        }
        description="Empower your team to receive tips digitally. Increase earnings, delight guests, and modernize your hospitality business with seamless, contactless tipping."
        centerImageUrl="https://images.stockcake.com/public/6/4/3/6437fcad-ae38-4d33-8d99-8dca4be3287d_large/digital-connection-point-stockcake.jpg"
        centerImageAlt="Digital connection point, QR code and contactless tipping"
      >
        <div className="mt-8 flex flex-col gap-4 sm:flex-row">
          <Link to="/auth">
            <span className="inline-flex touch-manipulation items-center gap-2 rounded-xl bg-accent px-8 py-4 font-semibold text-white shadow-[0_8px_22px_rgba(235,153,44,0.28)] transition-[colors,opacity,box-shadow] hover:bg-accent/90 active:opacity-90">
              Get Started Free
            </span>
          </Link>
          <button
            type="button"
            className="touch-manipulation rounded-xl border border-white/30 bg-white/10 px-8 py-4 font-semibold text-white backdrop-blur-sm transition-[colors,opacity,box-shadow] hover:bg-white/20 active:opacity-90"
          >
            Watch Demo
          </button>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-6 text-sm text-white/70">
          <span className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.35)]" />
            No setup fees
          </span>
          <span className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.35)]" />
            Instant payouts
          </span>
          <span className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.35)]" />
            24/7 support
          </span>
        </div>
      </BackgroundCircles>
    </section>
  );
}
