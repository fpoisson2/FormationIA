import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getStepComponent } from "../registry";
import { StepSequenceContext, isCompositeStepDefinition } from "../types";
import type {
  CompositeStepConfig,
  CompositeStepModuleDefinition,
  StepComponentProps,
  StepDefinition,
  StepSequenceContextValue,
} from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCompositeConfig(value: unknown): value is CompositeStepConfig {
  if (!isRecord(value)) {
    return false;
  }
  if (!Array.isArray((value as CompositeStepConfig).modules)) {
    return false;
  }
  return (value as CompositeStepConfig).modules.every((module) => {
    if (!module || typeof module !== "object") {
      return false;
    }
    const typed = module as CompositeStepModuleDefinition;
    return typeof typed.id === "string" && typeof typed.component === "string";
  });
}

function pickInitialPayloads(
  modules: CompositeStepModuleDefinition[],
  payload: unknown
): Record<string, unknown> {
  if (!isRecord(payload)) {
    return {};
  }
  const typedPayload = payload as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  modules.forEach((module) => {
    if (Object.prototype.hasOwnProperty.call(typedPayload, module.id)) {
      result[module.id] = typedPayload[module.id];
    }
  });
  return result;
}

export function CompositeStep({
  definition,
  config,
  payload,
  isActive,
  isEditMode,
  onAdvance,
  onUpdateConfig,
}: StepComponentProps): JSX.Element | null {
  const parentContext = useContext(StepSequenceContext);

  const compositeConfig = useMemo(() => {
    if (isCompositeConfig(config)) {
      return config;
    }
    if (isCompositeStepDefinition(definition) && isCompositeConfig(definition.composite)) {
      return definition.composite;
    }
    return undefined;
  }, [config, definition]);

  if (!compositeConfig) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        `Composite step "${definition.id}" is missing a valid configuration.`
      );
    }
    return null;
  }

  const modules = compositeConfig.modules ?? [];
  const [modulePayloads, setModulePayloads] = useState<Record<string, unknown>>(
    () => pickInitialPayloads(modules, payload)
  );

  useEffect(() => {
    setModulePayloads(pickInitialPayloads(modules, payload));
  }, [modules, payload]);

  const effectiveIsEditMode = parentContext?.isEditMode ?? isEditMode;

  const handleModuleAdvance = useCallback(
    (moduleId: string, modulePayload?: unknown) => {
      setModulePayloads((previous) => ({
        ...previous,
        [moduleId]: modulePayload,
      }));
    },
    []
  );

  const updateModuleConfig = useCallback(
    (moduleId: string, nextModuleConfig: unknown) => {
      if (!compositeConfig) {
        return;
      }
      const nextConfig: CompositeStepConfig = {
        ...compositeConfig,
        modules: compositeConfig.modules.map((module) =>
          module.id === moduleId ? { ...module, config: nextModuleConfig } : module
        ),
      };
      onUpdateConfig(nextConfig);
    },
    [compositeConfig, onUpdateConfig]
  );

  const allModulesCompleted = useMemo(
    () =>
      modules.every((module) =>
        Object.prototype.hasOwnProperty.call(modulePayloads, module.id)
      ),
    [modulePayloads, modules]
  );

  const autoAdvance = compositeConfig.autoAdvance ?? false;

  useEffect(() => {
    if (!autoAdvance || !isActive) {
      return;
    }
    if (modules.length === 0 || allModulesCompleted) {
      onAdvance(modulePayloads);
    }
  }, [autoAdvance, allModulesCompleted, isActive, modulePayloads, modules, onAdvance]);

  const renderedModules = useMemo(() => {
    return modules.map((module) => {
      const StepComponent = getStepComponent(module.component);
      if (!StepComponent) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn(
            `Composite step cannot resolve module "${module.component}".`
          );
        }
        return { module, element: null } as const;
      }

      const moduleDefinition: StepDefinition = {
        id: module.id,
        component: module.component,
        config: module.config,
      };

      const childContext: StepSequenceContextValue = parentContext
        ? {
            ...parentContext,
            payloads: {
              ...parentContext.payloads,
              [module.id]: modulePayloads[module.id],
            },
            onAdvance: (childPayload?: unknown) =>
              handleModuleAdvance(module.id, childPayload),
            onUpdateConfig: (nextConfig: unknown) =>
              updateModuleConfig(module.id, nextConfig),
          }
        : {
            stepIndex: 0,
            stepCount: modules.length,
            steps: modules.map((item) => ({
              id: item.id,
              component: item.component,
              config: item.config,
            })),
            payloads: { [module.id]: modulePayloads[module.id] },
            isEditMode: effectiveIsEditMode,
            onAdvance: (childPayload?: unknown) =>
              handleModuleAdvance(module.id, childPayload),
            onUpdateConfig: (nextConfig: unknown) =>
              updateModuleConfig(module.id, nextConfig),
            goToStep: () => {},
            activityContext: null,
          };

      const moduleProps: StepComponentProps = {
        definition: moduleDefinition,
        config: module.config,
        payload: modulePayloads[module.id],
        isActive,
        isEditMode: effectiveIsEditMode,
        onAdvance: (childPayload?: unknown) =>
          handleModuleAdvance(module.id, childPayload),
        onUpdateConfig: (nextConfig: unknown) =>
          updateModuleConfig(module.id, nextConfig),
      };

      return {
        module,
        element: (
          <StepSequenceContext.Provider
            key={module.id}
            value={childContext}
          >
            <StepComponent {...moduleProps} />
          </StepSequenceContext.Provider>
        ),
      } as const;
    });
  }, [
    effectiveIsEditMode,
    handleModuleAdvance,
    isActive,
    modules,
    modulePayloads,
    parentContext,
    updateModuleConfig,
  ]);

  const partitioned = useMemo(() => {
    const main: JSX.Element[] = [];
    const sidebar: JSX.Element[] = [];
    const footer: JSX.Element[] = [];
    renderedModules.forEach(({ module, element }) => {
      if (!element) return;
      if (module.slot === "sidebar") {
        sidebar.push(element);
      } else if (module.slot === "footer") {
        footer.push(element);
      } else {
        main.push(element);
      }
    });
    return { main, sidebar, footer };
  }, [renderedModules]);

  const continueLabel = compositeConfig.continueLabel ?? "Continuer";

  return (
    <div className="space-y-6">
      {partitioned.sidebar.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-6">{partitioned.main}</div>
          <aside className="space-y-6">{partitioned.sidebar}</aside>
        </div>
      ) : (
        <div className="space-y-6">{partitioned.main}</div>
      )}
      {partitioned.footer.length > 0 ? (
        <div className="space-y-6">{partitioned.footer}</div>
      ) : null}
      {!autoAdvance && modules.length > 0 ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onAdvance(modulePayloads)}
            disabled={!allModulesCompleted}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--brand-black)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {continueLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
