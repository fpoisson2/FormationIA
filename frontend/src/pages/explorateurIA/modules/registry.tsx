import { useMemo } from "react";
import type { ComponentType } from "react";

import { registerStepComponent } from "../../../modules/step-sequence/registry";
import type { StepComponentProps } from "../../../modules/step-sequence/types";

export interface ExplorateurIAModuleConfig {
  type: string;
  [key: string]: unknown;
}

export interface ExplorateurIAModuleProps
  extends Omit<StepComponentProps, "config" | "onUpdateConfig"> {
  config: ExplorateurIAModuleConfig;
  onUpdateConfig: (config: ExplorateurIAModuleConfig) => void;
}

type ExplorateurIAModuleComponent = ComponentType<ExplorateurIAModuleProps>;

const MODULE_REGISTRY = new Map<string, ExplorateurIAModuleComponent>();

export function registerExplorateurIAModule(
  type: string,
  component: ExplorateurIAModuleComponent
): void {
  MODULE_REGISTRY.set(type, component);
}

function getExplorateurIAModule(
  type: string
): ExplorateurIAModuleComponent | undefined {
  return MODULE_REGISTRY.get(type);
}

function sanitizeModuleConfig(
  config: unknown,
  fallbackType: string
): ExplorateurIAModuleConfig {
  if (config && typeof config === "object") {
    const typed = config as Record<string, unknown>;
    const nextType =
      typeof typed.type === "string" && typed.type.length > 0
        ? typed.type
        : fallbackType;
    return { ...typed, type: nextType } as ExplorateurIAModuleConfig;
  }
  return { type: fallbackType };
}

function ExplorateurIACustomStep(props: StepComponentProps): JSX.Element | null {
  const { definition, config, onUpdateConfig, ...rest } = props;
  const moduleType =
    (config && typeof config === "object" && (config as { type?: string }).type) ||
    "unknown";

  const sanitizedConfig = useMemo(
    () => sanitizeModuleConfig(config, moduleType),
    [config, moduleType]
  );

  const ModuleComponent = getExplorateurIAModule(sanitizedConfig.type);

  const handleUpdate = (next: ExplorateurIAModuleConfig) => {
    const nextConfig: ExplorateurIAModuleConfig = {
      ...next,
      type: next.type || sanitizedConfig.type,
    };
    onUpdateConfig?.(nextConfig);
  };

  if (!ModuleComponent) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        `Explorateur IA: aucun module personnalisé enregistré pour "${sanitizedConfig.type}".`
      );
    }
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Module personnalisé « {sanitizedConfig.type} » introuvable.
      </div>
    );
  }

  return (
    <ModuleComponent
      {...rest}
      definition={definition}
      config={sanitizedConfig}
      onUpdateConfig={handleUpdate}
    />
  );
}

registerStepComponent("custom", ExplorateurIACustomStep);
