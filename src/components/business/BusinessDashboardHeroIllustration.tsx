import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  title?: string;
};

/**
 * Lightweight, brand-aligned SVG for Business Dashboard hero.
 * Communicates: QR usage + payments + performance without heavy assets.
 */
export function BusinessDashboardHeroIllustration({ className, title = "CareTip business preview" }: Props) {
  return (
    <div
      className={cn(
        "relative isolate w-full overflow-hidden rounded-xl",
        "bg-gradient-to-b from-neutral-950 via-neutral-950 to-black",
        "ring-1 ring-white/10 shadow-[0_18px_55px_rgba(0,0,0,0.40)]",
        "caretip-hero-fadein",
        className,
      )}
      aria-label={title}
      role="img"
    >
      <div className="caretip-hero-ambient pointer-events-none absolute inset-0 z-[0]" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(700px circle at 20% 25%, rgba(235,153,44,0.20), transparent 55%), radial-gradient(900px circle at 70% 65%, rgba(235,153,44,0.14), transparent 60%), radial-gradient(1100px circle at 50% 120%, rgba(255,255,255,0.05), transparent 55%)",
        }}
        aria-hidden
      />

      <svg
        className="relative z-[2] block h-auto w-full"
        viewBox="0 0 900 540"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <linearGradient id="ct_orange" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#eb992c" stopOpacity="1" />
            <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="ct_panel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0B0B0B" />
            <stop offset="100%" stopColor="#050505" />
          </linearGradient>
          <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="
                1 0 0 0 0
                0 0.8 0 0 0
                0 0 0.2 0 0
                0 0 0 0.55 0"
              result="glow"
            />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Subtle grid */}
        <g opacity="0.18">
          {Array.from({ length: 13 }).map((_, i) => (
            <line key={`v-${i}`} x1={80 + i * 60} y1="40" x2={80 + i * 60} y2="500" stroke="#ffffff" strokeWidth="1" />
          ))}
          {Array.from({ length: 9 }).map((_, i) => (
            <line key={`h-${i}`} x1="80" y1={60 + i * 55} x2="820" y2={60 + i * 55} stroke="#ffffff" strokeWidth="1" />
          ))}
        </g>

        {/* Main card */}
        <rect x="80" y="70" width="740" height="400" rx="28" fill="url(#ct_panel)" stroke="rgba(255,255,255,0.10)" />

        {/* Header */}
        <g transform="translate(120 112)">
          <rect x="0" y="0" width="210" height="36" rx="18" fill="rgba(235,153,44,0.18)" stroke="rgba(235,153,44,0.35)" />
          <circle cx="20" cy="18" r="7" fill="url(#ct_orange)" />
          <rect x="38" y="13" width="140" height="10" rx="5" fill="rgba(255,255,255,0.75)" />

          <rect x="520" y="3" width="80" height="30" rx="15" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.10)" />
          <rect x="616" y="3" width="80" height="30" rx="15" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.10)" />
        </g>

        {/* QR block */}
        <g transform="translate(140 184)">
          <rect x="0" y="0" width="186" height="186" rx="22" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.10)" />
          <rect x="18" y="18" width="150" height="150" rx="18" fill="rgba(0,0,0,0.55)" stroke="rgba(235,153,44,0.35)" filter="url(#softGlow)" />

          {/* Simple QR pattern */}
          <g fill="rgba(235,153,44,0.92)">
            <rect x="34" y="34" width="34" height="34" rx="6" />
            <rect x="118" y="34" width="34" height="34" rx="6" />
            <rect x="34" y="118" width="34" height="34" rx="6" />
            {[
              [84, 44],
              [92, 52],
              [76, 60],
              [92, 76],
              [76, 84],
              [100, 92],
              [84, 100],
              [108, 108],
              [92, 116],
              [76, 108],
              [100, 124],
              [116, 92],
            ].map(([x, y], i) => (
              <rect key={i} x={x} y={y} width="10" height="10" rx="2" />
            ))}
          </g>

          {/* Caption pill */}
          <rect x="0" y="204" width="186" height="38" rx="19" fill="rgba(235,153,44,0.16)" stroke="rgba(235,153,44,0.30)" />
          <rect x="18" y="216" width="120" height="12" rx="6" fill="rgba(255,255,255,0.78)" />
          <rect x="146" y="214" width="22" height="16" rx="8" fill="url(#ct_orange)" />
        </g>

        {/* Performance chart */}
        <g transform="translate(370 188)">
          <rect x="0" y="0" width="410" height="166" rx="22" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.10)" />
          <path
            d="M26 122 C 74 98, 110 132, 160 94 C 206 58, 246 112, 296 78 C 334 52, 360 66, 384 44"
            fill="none"
            stroke="url(#ct_orange)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="caretip-hero-stroke"
          />
          <path
            d="M26 138 C 74 118, 110 146, 160 110 C 206 78, 246 124, 296 96 C 334 74, 360 84, 384 66"
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {[
            { x: 60, h: 46 },
            { x: 98, h: 72 },
            { x: 136, h: 56 },
            { x: 174, h: 98 },
            { x: 212, h: 64 },
          ].map((b, i) => (
            <rect
              key={i}
              x={b.x}
              y={148 - b.h}
              width="18"
              height={b.h}
              rx="7"
              fill="rgba(235,153,44,0.22)"
              stroke="rgba(235,153,44,0.18)"
            />
          ))}
        </g>

        {/* Tip / payment cards */}
        <g transform="translate(370 372)">
          <rect x="0" y="0" width="198" height="86" rx="22" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.10)" />
          <circle cx="34" cy="43" r="18" fill="rgba(235,153,44,0.18)" stroke="rgba(235,153,44,0.35)" />
          <path d="M28 43h12" stroke="url(#ct_orange)" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M34 36v14" stroke="url(#ct_orange)" strokeWidth="3.5" strokeLinecap="round" />
          <rect x="64" y="26" width="96" height="10" rx="5" fill="rgba(255,255,255,0.75)" />
          <rect x="64" y="46" width="132" height="10" rx="5" fill="rgba(255,255,255,0.22)" />

          <rect x="212" y="0" width="198" height="86" rx="22" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.10)" />
          <rect x="238" y="22" width="146" height="14" rx="7" fill="rgba(255,255,255,0.75)" />
          <rect x="238" y="46" width="112" height="10" rx="5" fill="rgba(255,255,255,0.22)" />
          <circle cx="376" cy="56" r="10" fill="url(#ct_orange)" />
        </g>
      </svg>
    </div>
  );
}

