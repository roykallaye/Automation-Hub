import { Check } from "lucide-react";

import { useI18n } from "../../i18n";

export type WizardStepMeta = {
  key: string;
  title: string;
};

export function StepProgress({
  steps,
  currentIndex,
}: {
  steps: WizardStepMeta[];
  currentIndex: number;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white/86 p-4 shadow-glass backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase text-slate-500">{t("wizard.progress")}</p>
        <p className="text-xs font-bold text-slate-800">
          {t("wizard.progressCount", { current: currentIndex + 1, total: steps.length })}
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 xl:block xl:space-y-2 xl:overflow-visible xl:pb-0">
        {steps.map((step, index) => {
          const active = index === currentIndex;
          const complete = index < currentIndex;
          return (
            <div aria-current={active ? "step" : undefined}
              key={step.key}
              className={[
                "flex min-w-fit items-center gap-3 rounded-lg border px-3 py-2 text-sm font-semibold transition xl:min-w-0",
                active
                  ? "border-ink bg-ink text-white"
                  : complete
                    ? "border-zinc-200 bg-zinc-100 text-zinc-800"
                    : "border-transparent bg-white/45 text-zinc-500",
              ].join(" ")}
            >
              <span
                className={[
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs",
                  active
                    ? "bg-white/10 text-white"
                    : complete
                      ? "bg-white text-zinc-950 ring-1 ring-zinc-200"
                      : "bg-zinc-100 text-zinc-500",
                ].join(" ")}
              >
                {complete ? (
                  <Check aria-hidden="true" className="setup-step-check h-3.5 w-3.5" />
                ) : (
                  index + 1
                )}
              </span>
              <span>{step.title}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
