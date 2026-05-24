import * as React from "react";

import { cn } from "@/lib/utils";

const variants = {
  default:
    "bg-primary text-primary-foreground shadow-[0_3px_14px_rgba(255,61,106,.2),inset_0_1px_0_rgba(255,255,255,.18)] hover:shadow-[0_5px_22px_rgba(255,61,106,.36),inset_0_1px_0_rgba(255,255,255,.18)]",
  secondary: "border border-white/10 bg-white/[.04] text-foreground hover:bg-white/[.07]",
  ghost: "border border-white/[.08] bg-transparent text-muted-foreground hover:bg-white/[.04] hover:text-foreground",
};

const sizes = {
  default: "h-9 px-4",
  sm: "h-8 px-3 text-xs",
  icon: "h-9 w-9",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button };
