import type { AppConfigStatus } from "../types";

export function DeveloperDetails({ configStatus }: { configStatus: AppConfigStatus | null }) {
  const alignmentItems =
    configStatus?.preflight.items.filter(
      (item) =>
        item.itemType === "alignment" &&
        (item.status === "warning" ||
          item.status === "permissionProblem" ||
          item.status === "missingConfiguration"),
    ) ?? [];

  return (
    <details className="mt-5 border-t border-white/60 pt-5">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        Advanced details
      </summary>
      <div className="mt-3 space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
            InnPilot setup file
          </p>
          <p className="break-words rounded-md bg-white/55 px-3 py-2 text-xs font-medium leading-5 text-slate-600">
            {configStatus?.configPath ?? "Setup path unavailable."}
          </p>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold text-slate-800">Safety settings</p>
          <div className="space-y-2 text-xs font-medium text-slate-700">
            <SettingLine label="Dry run default" value={configStatus?.config.safety.dryRunDefault} />
            <SettingLine
              label="Confirm file moves"
              value={configStatus?.config.safety.requireConfirmationForFileMoves}
            />
            <SettingLine label="Redact logs" value={configStatus?.config.safety.redactLogs} />
          </div>
        </div>
        {alignmentItems.length > 0 && (
          <div>
            <p className="mb-3 text-sm font-semibold text-slate-800">Setup alignment</p>
            <div className="space-y-2">
              {alignmentItems.map((item) => (
                <div
                  key={item.key}
                  className="rounded-md bg-white/55 px-3 py-2 text-xs font-medium leading-5 text-slate-700"
                >
                  <p className="font-semibold text-slate-900">{item.label}</p>
                  <p className="mt-1 break-words">{item.message}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function SettingLine({ label, value }: { label: string; value?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-white/55 px-3 py-2">
      <span>{label}</span>
      <span className="font-bold text-slate-900">
        {typeof value === "boolean" ? (value ? "On" : "Off") : "Unknown"}
      </span>
    </div>
  );
}
