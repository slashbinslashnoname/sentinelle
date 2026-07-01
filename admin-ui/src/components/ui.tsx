import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  variant = "default",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost" }) {
  const styles = {
    default:
      "border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700",
    primary: "bg-primary-600 text-white hover:bg-primary-700 border border-primary-600",
    danger: "text-primary-700 dark:text-primary-500 hover:bg-primary-50 dark:hover:bg-zinc-800 border border-transparent",
    ghost: "hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-transparent",
  }[variant];
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-default",
        styles,
        className,
      )}
      {...props}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {help && <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{help}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputBase =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputBase, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputBase, props.className)} />;
}

export function Badge({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    detected: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    refunded: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
    "part refunded": "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
    expired: "bg-primary-100 text-primary-700 dark:bg-primary-500/15 dark:text-primary-500",
    canceled: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
  };
  const label = status === "detected" ? "detected ⏳" : status;
  return (
    <span className={cx("inline-block rounded-full px-2 py-0.5 text-xs font-medium", map[status] ?? map.canceled)}>
      {label}
    </span>
  );
}

export function CopyBlock({ text }: { text: string }) {
  return (
    <div className="relative">
      <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-100 dark:bg-zinc-950 p-3 pr-16 text-xs">
        {text}
      </pre>
      <Button
        variant="default"
        className="absolute right-2 top-2 px-2 py-1 text-xs"
        onClick={() => navigator.clipboard.writeText(text)}
      >
        copy
      </Button>
    </div>
  );
}

export function Spinner() {
  return <span className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</span>;
}
