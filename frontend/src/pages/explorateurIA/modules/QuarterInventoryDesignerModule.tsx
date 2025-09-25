import { useCallback, useId, useMemo } from "react";
import type { ChangeEvent } from "react";

import {
  registerExplorateurIAModule,
  type ExplorateurIAModuleConfig,
  type ExplorateurIAModuleProps,
} from "./registry";

export interface ExplorateurQuarterInventoryConfig
  extends ExplorateurIAModuleConfig {
  type: "explorateur-quarter-inventory";
  quarterId: string;
  enabled: boolean;
  title: string;
  description: string;
  hint: string;
  icon: string;
}

function sanitizeQuarterInventoryConfig(
  config: ExplorateurIAModuleConfig
): ExplorateurQuarterInventoryConfig {
  const base =
    config && typeof config === "object"
      ? (config as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const quarterId =
    typeof base.quarterId === "string" ? base.quarterId : "";
  const enabled = Boolean(base.enabled);
  const title = typeof base.title === "string" ? base.title : "";
  const description =
    typeof base.description === "string" ? base.description : "";
  const hint = typeof base.hint === "string" ? base.hint : "";
  const icon =
    typeof base.icon === "string" && base.icon.trim().length > 0
      ? base.icon
      : "🎁";

  return {
    ...base,
    type: "explorateur-quarter-inventory",
    quarterId,
    enabled,
    title,
    description,
    hint,
    icon,
  } satisfies ExplorateurQuarterInventoryConfig;
}

export function ExplorateurQuarterInventoryDesignerModule({
  config,
  onUpdateConfig,
}: ExplorateurIAModuleProps): JSX.Element {
  const ids = {
    enabled: useId(),
    title: useId(),
    description: useId(),
    hint: useId(),
    icon: useId(),
  };

  const sanitized = useMemo(
    () => sanitizeQuarterInventoryConfig(config),
    [config]
  );

  const emit = useCallback(
    (patch: Partial<ExplorateurQuarterInventoryConfig>) => {
      onUpdateConfig({ ...sanitized, ...patch });
    },
    [onUpdateConfig, sanitized]
  );

  const handleToggle = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      emit({ enabled: event.target.checked });
    },
    [emit]
  );

  const handleTitleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      emit({ title: event.target.value });
    },
    [emit]
  );

  const handleDescriptionChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      emit({ description: event.target.value });
    },
    [emit]
  );

  const handleHintChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      emit({ hint: event.target.value });
    },
    [emit]
  );

  const handleIconChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      emit({ icon: event.target.value });
    },
    [emit]
  );

  const disabled = !sanitized.enabled;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-orange-200 bg-white/80 p-4 shadow-sm">
        <p className="text-sm text-orange-700">
          Définissez la récompense obtenue en terminant ce quartier.
        </p>
      </div>
      <div className="space-y-4">
        <label
          className="flex items-center gap-3 text-sm font-semibold text-orange-800"
          htmlFor={ids.enabled}
        >
          <input
            id={ids.enabled}
            type="checkbox"
            checked={sanitized.enabled}
            onChange={handleToggle}
            className="h-4 w-4 rounded border-orange-300 text-orange-500 focus:ring-orange-300"
          />
          Activer un objet d'inventaire
        </label>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <label
              className="block text-sm font-semibold text-orange-800"
              htmlFor={ids.icon}
            >
              Icône
            </label>
            <input
              id={ids.icon}
              type="text"
              value={sanitized.icon}
              onChange={handleIconChange}
              disabled={disabled}
              placeholder="Emoji ou pictogramme"
              className="w-full rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm text-orange-900 shadow-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-200 disabled:cursor-not-allowed disabled:bg-orange-100 disabled:text-orange-500"
            />
          </div>
          <div className="space-y-2">
            <label
              className="block text-sm font-semibold text-orange-800"
              htmlFor={ids.title}
            >
              Nom de l'objet
            </label>
            <input
              id={ids.title}
              type="text"
              value={sanitized.title}
              onChange={handleTitleChange}
              disabled={disabled}
              placeholder="Nom de la récompense"
              className="w-full rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm text-orange-900 shadow-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-200 disabled:cursor-not-allowed disabled:bg-orange-100 disabled:text-orange-500"
            />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <label
              className="block text-sm font-semibold text-orange-800"
              htmlFor={ids.description}
            >
              Description
            </label>
            <textarea
              id={ids.description}
              value={sanitized.description}
              onChange={handleDescriptionChange}
              disabled={disabled}
              rows={3}
              placeholder="Décrivez la récompense et son utilité."
              className="w-full rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm text-orange-900 shadow-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-200 disabled:cursor-not-allowed disabled:bg-orange-100 disabled:text-orange-500"
            />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <label
              className="block text-sm font-semibold text-orange-800"
              htmlFor={ids.hint}
            >
              Indice pour les joueurs
            </label>
            <textarea
              id={ids.hint}
              value={sanitized.hint}
              onChange={handleHintChange}
              disabled={disabled}
              rows={2}
              placeholder="Comment obtenir l'objet ?"
              className="w-full rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm text-orange-900 shadow-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-200 disabled:cursor-not-allowed disabled:bg-orange-100 disabled:text-orange-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

registerExplorateurIAModule(
  "explorateur-quarter-inventory",
  ExplorateurQuarterInventoryDesignerModule
);

