import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-[9px] border border-white/[.07] bg-white/[.035] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition focus-visible:border-[#ff3d6a]/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ff3d6a]/10 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
