import * as React from "react";
import { cn } from "@/lib/cn";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 w-full rounded-md border border-rule-2 bg-raised px-3 text-sm text-ink",
      "placeholder:text-muted",
      "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
      "disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
