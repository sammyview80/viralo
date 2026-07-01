import type { SVGAttributes } from "react";

export type IconProps = { size?: number; className?: string } & SVGAttributes<SVGElement>;

function Icon({ d, size = 18, children, className, ...rest }: IconProps & { d?: string; children?: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} {...rest}>
      {d ? <path d={d} /> : children}
    </svg>
  );
}

export const Icons = {
  Bolt:     (p: IconProps) => <Icon {...p} d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />,
  Video:    (p: IconProps) => <Icon {...p}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></Icon>,
  Film:     (p: IconProps) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" /></Icon>,
  Rocket:   (p: IconProps) => <Icon {...p}><path d="M4.5 16.5a4.5 4.5 0 0 0 3 3l1.5-3-1.5-1.5z" /><path d="M14 7s3-4 7-4c0 4-4 7-4 7l-3 3-3-3z" /><path d="M14 13l-3-3-7 7 3 3z" /></Icon>,
  Brain:    (p: IconProps) => <Icon {...p}><path d="M9 3a3 3 0 0 0-3 3v.5A2.5 2.5 0 0 0 3.5 9 2.5 2.5 0 0 0 5 11.4 2.5 2.5 0 0 0 4 13.5 2.5 2.5 0 0 0 6.5 16 2.5 2.5 0 0 0 9 18.5 2.5 2.5 0 0 0 12 21V3a3 3 0 0 0-3 0z" /><path d="M15 3a3 3 0 0 1 3 3v.5A2.5 2.5 0 0 1 20.5 9 2.5 2.5 0 0 1 19 11.4 2.5 2.5 0 0 1 20 13.5 2.5 2.5 0 0 1 17.5 16 2.5 2.5 0 0 1 15 18.5 2.5 2.5 0 0 1 12 21" /></Icon>,
  Branch:   (p: IconProps) => <Icon {...p}><circle cx="6" cy="3" r="2" /><circle cx="6" cy="21" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 5v14M18 8a6 6 0 0 1-6 6H6" /></Icon>,
  Calendar: (p: IconProps) => <Icon {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></Icon>,
  Chart:    (p: IconProps) => <Icon {...p}><path d="M3 21h18M5 17V9M10 17V5M15 17v-7M20 17v-5" /></Icon>,
  Flame:    (p: IconProps) => <Icon {...p} d="M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1 1 2 1 3-3z" />,
  Gear:     (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Icon>,
  Globe:    (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Icon>,
  ChevronR: (p: IconProps) => <Icon {...p} d="M9 6l6 6-6 6" />,
  ChevronL: (p: IconProps) => <Icon {...p} d="M15 6l-6 6 6 6" />,
  Sparkle:  (p: IconProps) => <Icon {...p}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></Icon>,
  Search:   (p: IconProps) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Icon>,
  Bell:     (p: IconProps) => <Icon {...p}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></Icon>,
  Help:       (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4" /><path d="M12 17h0" /></Icon>,
  CreditCard: (p: IconProps) => <Icon {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></Icon>,
  Sun:        (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></Icon>,
  Moon:       (p: IconProps) => <Icon {...p} d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
} as const;

export type IconKey = keyof typeof Icons;
