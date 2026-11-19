import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageShellProps = {
  children: ReactNode;
  className?: string;
  /** Wider ops pages (orders, menu, reports). Default 1400. */
  maxWidth?: "md" | "lg" | "xl" | "full";
};

const MAX_WIDTH: Record<NonNullable<PageShellProps["maxWidth"]>, string> = {
  md: "max-w-4xl",
  lg: "max-w-6xl",
  xl: "max-w-[1400px]",
  full: "max-w-none",
};

/** Shared page container for dashboard routes (layout already pads horizontally). */
export function PageShell({
  children,
  className,
  maxWidth = "xl",
}: PageShellProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full space-y-5 pb-6 animate-fade-in sm:space-y-6",
        MAX_WIDTH[maxWidth],
        className,
      )}
    >
      {children}
    </div>
  );
}

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  icon,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:h-11 sm:w-11">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
