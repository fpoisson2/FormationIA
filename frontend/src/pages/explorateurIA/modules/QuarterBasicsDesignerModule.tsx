import { useCallback, useId, useMemo } from "react";
import type { ChangeEvent } from "react";

import {
  registerExplorateurIAModule,
  type ExplorateurIAModuleConfig,
  type ExplorateurIAModuleProps,
} from "./registry";

export interface ExplorateurQuarterBasicsConfig extends ExplorateurIAModuleConfig {
  type: "explorateur-quarter-basics";
  quarterId: string;
  label: string;
  color: string;
  buildingNumber: number | null;
  isGoal: boolean;
}

function sanitizeQuarterBasicsConfig(
  config: ExplorateurIAModuleConfig
): ExplorateurQuarterBasicsConfig {
  const base =
    config && typeof config === "object"
      ? (config as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const quarterId =
    typeof base.quarterId === "string" ? base.quarterId : "";
  const label = typeof base.label === "string" ? base.label : "";
  const color =
    typeof base.color === "string" && base.color.trim().length > 0
      ? base.color
      : "#06d6a0";
  const isGoal = Boolean(base.isGoal);
  const buildingNumber = isGoal
    ? null
    : typeof base.buildingNumber === "number" &&
      Number.isFinite(base.buildingNumber)
    ? Math.max(1, Math.trunc(base.buildingNumber))
    : null;

  return {
    ...base,
    type: "explorateur-quarter-basics",
    quarterId,
    label,
    color,
    buildingNumber,
    isGoal,
  } satisfies ExplorateurQuarterBasicsConfig;
}

function formatBuildingNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "";
  }
  return String(value);
}

export function ExplorateurQuarterBasicsDesignerModule({
  config,
  onUpdateConfig,
}: ExplorateurIAModuleProps): JSX.Element {
  const ids = {
    label: useId(),
    color: useId(),
    number: useId(),
    goal: useId(),
  };

  const sanitized = useMemo(
    () => sanitizeQuarterBasicsConfig(config),
    [config]
  );

  const emit = useCallback(
    (patch: Partial<ExplorateurQuarterBasicsConfig>) => {
      onUpdateConfig({ ...sanitized, ...patch });
    },
    [onUpdateConfig, sanitized]
  );

  const handleLabelChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      emit({ label: event.target.value });
    },
    [emit]
  );

  const handleColorChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      emit({ color: event.target.value });
    },
    [emit]
  );

  const handleBuildingNumberChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      if (!raw || raw.trim().length === 0) {
        emit({ buildingNumber: null });
        return;
      }
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        emit({ buildingNumber: Math.max(1, Math.trunc(parsed)) });
      }
    },
    [emit]
  );

  const handleGoalToggle = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextIsGoal = event.target.checked;
      emit({ isGoal: nextIsGoal, buildingNumber: nextIsGoal ? null : sanitized.buildingNumber });
    },
    [emit, sanitized.buildingNumber]
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-orange-200 bg-white/80 p-4 shadow-sm">
        <p className="text-sm text-orange-700">
          Ajustez les informations principales du quartier
          {sanitized.quarterId ? (
            <span className="ml-1 font-semibold text-orange-800">
              {sanitized.quarterId}
            </span>
          ) : null}
          .
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <label
            className="block text-sm font-semibold text-orange-800"
            htmlFor={ids.label}
          >
            Nom du quartier
          </label>
          <input
            id={ids.label}
            type="text"
            value={sanitized.label}
            onChange={handleLabelChange}
            placeholder="Quartier"
            className="w-full rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm text-orange-900 shadow-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
        </div>
        <div className="space-y-2">
          <label
            className="block text-sm font-semibold text-orange-800"
            htmlFor={ids.color}
          >
            Couleur principale
          </label>
          <div className="flex items-center gap-3">
            <input
              id={ids.color}
              type="color"
              value={sanitized.color}
              onChange={handleColorChange}
              className="h-11 w-16 cursor-pointer rounded-xl border border-orange-200 bg-white"
            />
            <span className="text-xs font-mono text-orange-700">
              {sanitized.color}
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <label
            className="block text-sm font-semibold text-orange-800"
            htmlFor={ids.number}
          >
            Numéro du défi
          </label>
          <input
            id={ids.number}
            type="number"
            min={1}
            step={1}
            value={formatBuildingNumber(sanitized.buildingNumber)}
            onChange={handleBuildingNumberChange}
            disabled={sanitized.isGoal}
            placeholder="1"
            className="w-full rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm text-orange-900 shadow-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-200 disabled:cursor-not-allowed disabled:bg-orange-100 disabled:text-orange-500"
          />
          {sanitized.isGoal ? (
            <p className="text-xs text-orange-600">
              L'objectif final n'affiche pas de numéro de défi.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label
            className="flex items-center gap-3 text-sm font-semibold text-orange-800"
            htmlFor={ids.goal}
          >
            <input
              id={ids.goal}
              type="checkbox"
              checked={sanitized.isGoal}
              onChange={handleGoalToggle}
              className="h-4 w-4 rounded border-orange-300 text-orange-500 focus:ring-orange-300"
            />
            Quartier objectif final
          </label>
          <p className="text-xs text-orange-600">
            Lorsqu'un quartier est marqué comme objectif final, il n'a plus de numéro
            et ne propose pas de récompense d'inventaire.
          </p>
        </div>
      </div>
    </div>
  );
}

registerExplorateurIAModule(
  "explorateur-quarter-basics",
  ExplorateurQuarterBasicsDesignerModule
);

