import type { ButtonHTMLAttributes } from "react";
import { cx } from "../../lib/cx.ts";

const variants = {
  primary: "bg-ink text-panel border-ink hover:opacity-90",
  secondary: "bg-panel text-ink border-line hover:bg-line-2",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-line-2 hover:text-ink",
  danger: "bg-panel text-down border-line hover:bg-line-2",
};

const sizes = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 gap-2",
  icon: "h-8 w-8 justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export function Button({ variant = "secondary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center rounded-lg border font-medium whitespace-nowrap transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
