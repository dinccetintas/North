"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** A form's submit button that disables itself while the server action runs, so one click is one request. */
export function SubmitButton({ children, className = "retro-button", testId, disabled = false, ...data }: { children: ReactNode; className?: string; testId?: string; disabled?: boolean } & Record<`data-${string}`, string>) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} data-testid={testId} disabled={disabled || pending} aria-disabled={disabled || pending} {...data}>
      {pending ? "…" : children}
    </button>
  );
}
