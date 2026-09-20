import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "ghost" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ className, variant = "default", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "bg-accent px-4 text-accent-foreground hover:bg-accent-strong",
        variant === "ghost" && "border border-line/12 bg-surface-soft px-4 text-foreground hover:bg-surface-raised",
        variant === "icon" && "size-11 border border-line/12 bg-surface-soft text-muted-foreground hover:bg-surface-raised hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}