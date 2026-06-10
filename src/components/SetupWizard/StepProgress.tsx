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
  return (
    <div className="rounded-xl border border-white/65 bg-white/55 p-4 shadow-glass backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase text-slate-500">Progress</p>
        <p className="text-xs font-bold text-slate-800">
          {currentIndex + 1} of {steps.length}
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 xl:block xl:space-y-2 xl:overflow-visible xl:pb-0">
        {steps.map((step, index) => {
          const active = index === currentIndex;
          const complete = index < currentIndex;
          return (
            <div
              key={step.key}
              className={[
                "flex min-w-fit items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold xl:min-w-0",
                active
                  ? "bg-slate-950 text-white"
                  : complete
                    ? "bg-emerald-50 text-emerald-900"
                    : "bg-white/55 text-slate-600",
              ].join(" ")}
            >
              <span
                className={[
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs",
                  active
                    ? "bg-teal-200 text-slate-950"
                    : complete
                      ? "bg-emerald-200 text-emerald-950"
                      : "bg-slate-100 text-slate-600",
                ].join(" ")}
              >
                {index + 1}
              </span>
              <span>{step.title}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
