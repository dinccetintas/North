export const WIZARD_STEP_COUNT = 4;

/** "Step n of 4 · Label" plus the title and a one-line explanation. */
export function WizardHeader({ step, label, title, children }: { step: number; label: string; title: string; children: React.ReactNode }) {
  return (
    <header>
      <p className="mono-label text-faint" data-testid="wizard-step-label">
        Step {step} of {WIZARD_STEP_COUNT} · {label}
      </p>
      <h1 className="mt-2 text-4xl">{title}</h1>
      <p className="mt-3 text-muted">{children}</p>
    </header>
  );
}

export const inputClass = "hairline bg-bg px-3 py-3 outline-none focus:border-deep";
