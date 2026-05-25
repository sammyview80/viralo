import * as React from "react";

import { cn } from "@/lib/utils";

const variants = {
  ready: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  warn: "border-amber-300/20 bg-amber-300/10 text-amber-200",
  error: "border-red-400/20 bg-red-400/10 text-red-300",
  muted: "border-white/10 bg-white/[.04] text-zinc-400",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variants;
}

function Badge({ className, variant = "muted", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10.5px] font-semibold",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
