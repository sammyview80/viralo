/**
 * ViraloLogo — app icon + optional wordmark matching the brand identity.
 *
 * <ViraloLogo />                  icon only, default 32px
 * <ViraloLogo size={40} />        icon only, custom size
 * <ViraloLogo wordmark />         icon + "viralo" wordmark
 * <ViraloLogo wordmark size={30} textSize="text-xl" />
 */

import { cn } from "@/lib/utils";

interface ViraloLogoProps {
  /** Icon box size in px */
  size?: number;
  /** Show "viralo" wordmark next to the icon */
  wordmark?: boolean;
  /** Tailwind text-size class for the wordmark */
  textSize?: string;
  /** Extra classes on the outer wrapper */
  className?: string;
  /** Hide wordmark (collapse animation) */
  collapsed?: boolean;
}

/** The app icon SVG — play button + circular orbit arrow + growth arrow + speed lines */
function ViraloIcon({ size }: { size: number }) {
  const r = Math.round(size * 0.28125); // corner radius ≈ 9px at 32px
  return (
    <div
      style={{ width: size, height: size, borderRadius: r }}
      className="flex-none grid place-items-center bg-gradient-to-br from-[#f84778] to-[#ff8c3a] shadow-[0_4px_16px_rgba(248,71,120,.30),inset_0_1px_0_rgba(255,255,255,.18)]"
    >
      <svg
        width={Math.round(size * 0.56)}
        height={Math.round(size * 0.56)}
        viewBox="0 0 24 24"
        fill="none"
      >
        {/* Speed lines (left) */}
        <line x1="1" y1="10" x2="5" y2="10" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
        <line x1="2" y1="13" x2="5.5" y2="13" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.5" />
        <line x1="1" y1="16" x2="4.5" y2="16" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.35" />

        {/* Circular orbit arrow — arc from bottom-left to top-right, arrowhead at top */}
        <path
          d="M5.5 17.5 A8 8 0 1 1 18.5 7"
          stroke="white"
          strokeWidth="1.9"
          strokeLinecap="round"
          fill="none"
        />
        {/* Arrowhead on orbit */}
        <polyline points="15.5,4.5 18.5,7 15.5,9" stroke="white" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" fill="none" />

        {/* Play triangle (center) */}
        <polygon points="9.5,9 9.5,15 15,12" fill="white" />

        {/* Growth arrow (top-right diagonal) */}
        <line x1="17" y1="5" x2="22" y2="2" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.9" />
        <polyline points="19,2 22,2 22,5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.9" />
      </svg>
    </div>
  );
}

/** "viralo" wordmark with orange dot replacing the i-tittle */
function ViraloWordmark({ textSize = "text-[16px]", className }: { textSize?: string; className?: string }) {
  return (
    <span className={cn("relative inline-flex items-baseline font-display font-bold tracking-[-0.01em] leading-none", textSize, className)}>
      {/* v i r a l o — render "v" then "i" with custom dot then "ralo" */}
      <span>v</span>
      <span className="relative">
        {/* hide native i-dot via font-variant trick — we overlay our own */}
        <span style={{ textDecoration: "none" }}>i</span>
        <span
          className="absolute bg-gradient-to-br from-[#f84778] to-[#ff8c3a] rounded-full"
          style={{
            width: "0.18em",
            height: "0.18em",
            top: "-0.08em",
            left: "50%",
            transform: "translateX(-50%)",
          }}
        />
      </span>
      <span>ralo</span>
    </span>
  );
}

export function ViraloLogo({ size = 32, wordmark = false, textSize, collapsed = false, className }: ViraloLogoProps) {
  return (
    <div className={cn("flex items-center", collapsed ? "gap-0" : "gap-2.5", className)}>
      <ViraloIcon size={size} />
      {wordmark && (
        <div
          className={cn(
            "overflow-hidden transition-[opacity,width] duration-300",
            collapsed ? "w-0 opacity-0 pointer-events-none" : "opacity-100"
          )}
          style={collapsed ? undefined : { width: "auto" }}
        >
          <ViraloWordmark textSize={textSize} />
        </div>
      )}
    </div>
  );
}

/** Standalone icon only — convenience re-export */
export { ViraloIcon };

/** Standalone wordmark only — convenience re-export */
export { ViraloWordmark };
