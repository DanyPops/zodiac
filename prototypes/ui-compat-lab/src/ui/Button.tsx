import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Button({ className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex size-8 items-center justify-center border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
        className,
      )}
      type={type}
      {...props}
    />
  );
}
