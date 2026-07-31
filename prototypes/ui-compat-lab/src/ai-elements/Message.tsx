import type { UIMessage } from "ai";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      className={cn(
        "group flex w-full max-w-[95%] flex-col gap-2",
        from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
        className,
      )}
      data-role={from}
      {...props}
    />
  );
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({ children, className, ...props }: MessageContentProps) {
  return (
    <div
      className={cn(
        "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm text-slate-900",
        "group-[.is-user]:ml-auto group-[.is-user]:rounded-md group-[.is-user]:bg-slate-200 group-[.is-user]:px-4 group-[.is-user]:py-3",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
