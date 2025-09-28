import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { STEP_COMPONENT_REGISTRY, getStepComponent } from "../registry";
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

const COMPLETION_REQUIRED_COMPONENTS = new Set<string>([
  "form",
  "simulation-chat",
  "video",
  "prompt-evaluation",
  "ai-comparison",
  "clarity-map",
  "clarity-prompt",
  "explorateur-world",
  "workshop-context",
  "workshop-comparison",
  "workshop-synthesis",
]);

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

function generateModuleId(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch (error) {
    // Ignore environments where crypto is not available (e.g. SSR)
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
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

  const modules = useMemo(
    () =>
      (compositeConfig.modules ?? []).map((module) => ({
        ...module,
        slot: module.slot ?? "main",
        config: module.config ?? null,
      })),
    [compositeConfig.modules]
  );
  const [modulePayloads, setModulePayloads] = useState<Record<string, unknown>>(
    () => pickInitialPayloads(modules, payload)
  );

  const modulesRequiringCompletion = useMemo(
    () =>
      modules.filter((module) =>
        COMPLETION_REQUIRED_COMPONENTS.has(module.component)
      ),
    [modules]
  );

  const aggregatedPayloads = useMemo(() => {
    const basePayloads = parentContext ? parentContext.payloads : {};
    return {
      ...basePayloads,
      ...modulePayloads,
    };
  }, [modulePayloads, parentContext]);

  const parentCompositeModules = parentContext?.compositeModules;
  const compositeModulesMap = useMemo(() => {
    const base = parentCompositeModules ? { ...parentCompositeModules } : {};
    base[definition.id] = modules;
    return base;
  }, [definition.id, modules, parentCompositeModules]);

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
        modules: modules.map((module) =>
          module.id === moduleId ? { ...module, config: nextModuleConfig } : module
        ),
      };
      onUpdateConfig(nextConfig);
    },
    [compositeConfig, modules, onUpdateConfig]
  );

  const allModulesCompleted = useMemo(
    () =>
      modulesRequiringCompletion.every((module) =>
        Object.prototype.hasOwnProperty.call(modulePayloads, module.id)
      ),
    [modulePayloads, modulesRequiringCompletion]
  );

  const autoAdvance = compositeConfig.autoAdvance ?? false;

  const moduleTypeOptions = useMemo(() => {
    const available = Object.keys(STEP_COMPONENT_REGISTRY).filter(
      (key) => key !== "composite"
    );
    modules.forEach((module) => {
      if (module.component && !available.includes(module.component)) {
        available.push(module.component);
      }
    });
    return Array.from(new Set(available)).sort((a, b) => a.localeCompare(b));
  }, [modules]);

  const [nextModuleType, setNextModuleType] = useState<string>("");

  useEffect(() => {
    if (moduleTypeOptions.length === 0) {
      setNextModuleType("");
      return;
    }
    setNextModuleType((prev) =>
      prev && moduleTypeOptions.includes(prev) ? prev : moduleTypeOptions[0]
    );
  }, [moduleTypeOptions]);

  const handleAddModule = useCallback(() => {
    if (!compositeConfig || !nextModuleType) {
      return;
    }
    const nextModule: CompositeStepModuleDefinition = {
      id: generateModuleId("module"),
      component: nextModuleType,
      slot: "main",
      config: null,
    };
    onUpdateConfig({
      ...compositeConfig,
      modules: [...modules, nextModule],
    });
  }, [compositeConfig, modules, nextModuleType, onUpdateConfig]);

  const handleRemoveModule = useCallback(
    (moduleId: string) => {
      if (!compositeConfig) {
        return;
      }
      const nextModules = modules.filter((module) => module.id !== moduleId);
      onUpdateConfig({
        ...compositeConfig,
        modules: nextModules,
      });
      setModulePayloads((previous) => {
        if (!Object.prototype.hasOwnProperty.call(previous, moduleId)) {
          return previous;
        }
        const nextPayloads = { ...previous };
        delete nextPayloads[moduleId];
        return nextPayloads;
      });
    },
    [compositeConfig, modules, onUpdateConfig]
  );

  const handleMoveModule = useCallback(
    (moduleId: string, direction: -1 | 1) => {
      if (!compositeConfig) {
        return;
      }
      const currentIndex = modules.findIndex((module) => module.id === moduleId);
      if (currentIndex === -1) {
        return;
      }
      const targetIndex = currentIndex + direction;
      if (targetIndex < 0 || targetIndex >= modules.length) {
        return;
      }
      const nextModules = [...modules];
      const [moved] = nextModules.splice(currentIndex, 1);
      nextModules.splice(targetIndex, 0, moved);
      onUpdateConfig({
        ...compositeConfig,
        modules: nextModules,
      });
    },
    [compositeConfig, modules, onUpdateConfig]
  );

  const handleChangeModuleType = useCallback(
    (moduleId: string, nextType: string) => {
      if (!compositeConfig) {
        return;
      }
      const nextModules = modules.map((module) => {
        if (module.id !== moduleId) {
          return module;
        }
        if (module.component === nextType) {
          return module;
        }
        const nextModule: CompositeStepModuleDefinition = {
          id: module.id,
          component: nextType,
          slot: module.slot ?? "main",
          config: null,
        };
        return nextModule;
      });
      onUpdateConfig({
        ...compositeConfig,
        modules: nextModules,
      });
      setModulePayloads((previous) => {
        if (!Object.prototype.hasOwnProperty.call(previous, moduleId)) {
          return previous;
        }
        const nextPayloads = { ...previous };
        delete nextPayloads[moduleId];
        return nextPayloads;
      });
    },
    [compositeConfig, modules, onUpdateConfig]
  );

  useEffect(() => {
    if (!autoAdvance || !isActive) {
      return;
    }
    if (modulesRequiringCompletion.length === 0 || allModulesCompleted) {
      onAdvance(modulePayloads);
    }
  }, [
    autoAdvance,
    allModulesCompleted,
    isActive,
    modulePayloads,
    modulesRequiringCompletion,
    onAdvance,
  ]);

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
            payloads: aggregatedPayloads,
            onAdvance: (childPayload?: unknown) =>
              handleModuleAdvance(module.id, childPayload),
            onUpdateConfig: (nextConfig: unknown) =>
              updateModuleConfig(module.id, nextConfig),
            compositeModules: compositeModulesMap,
          }
        : {
            stepIndex: 0,
            stepCount: modules.length,
            steps: modules.map((item) => ({
              id: item.id,
              component: item.component,
              config: item.config,
            })),
            payloads: aggregatedPayloads,
            isEditMode: effectiveIsEditMode,
            onAdvance: (childPayload?: unknown) =>
              handleModuleAdvance(module.id, childPayload),
            onUpdateConfig: (nextConfig: unknown) =>
              updateModuleConfig(module.id, nextConfig),
            goToStep: () => {},
            activityContext: null,
            compositeModules: compositeModulesMap,
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
    aggregatedPayloads,
    parentContext,
    updateModuleConfig,
    compositeModulesMap,
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
      {effectiveIsEditMode ? (
        <section
          aria-label="Configuration du composite"
          className="space-y-4 rounded-2xl border border-dashed border-orange-200 bg-orange-50/40 p-4"
        >
          <header className="space-y-1">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-orange-700">
              Blocs du composite
            </h3>
            <p className="text-xs text-orange-700/90">
              Ajoutez ou organisez les blocs qui seront rendus dans cette étape.
            </p>
          </header>
          <div className="space-y-3">
            {modules.length === 0 ? (
              <p className="rounded-xl border border-dashed border-orange-200 bg-white/70 p-3 text-xs text-orange-700">
                Aucun bloc n’est configuré pour le moment. Ajoutez un premier bloc pour démarrer.
              </p>
            ) : (
              modules.map((module, index) => {
                const canMoveUp = index > 0;
                const canMoveDown = index < modules.length - 1;
                return (
                  <div
                    key={module.id}
                    className="space-y-3 rounded-xl border border-orange-200 bg-white/70 p-3 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-orange-700">
                        Bloc {index + 1}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleMoveModule(module.id, -1)}
                          disabled={!canMoveUp}
                          className="rounded-full border border-orange-200 px-2 py-1 text-[10px] font-semibold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Monter le bloc ${index + 1}`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveModule(module.id, 1)}
                          disabled={!canMoveDown}
                          className="rounded-full border border-orange-200 px-2 py-1 text-[10px] font-semibold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Descendre le bloc ${index + 1}`}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveModule(module.id)}
                          className="rounded-full border border-red-200 px-2 py-1 text-[10px] font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-100"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-orange-700">
                      Type de bloc
                      <select
                        value={module.component}
                        onChange={(event) => handleChangeModuleType(module.id, event.target.value)}
                        className="rounded-lg border border-orange-200 px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-orange-400 focus:outline-none"
                      >
                        {moduleTypeOptions.length === 0 ? (
                          <option value="">Aucun module disponible</option>
                        ) : (
                          moduleTypeOptions.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-orange-700">
              <span>Ajouter un bloc</span>
              <select
                value={nextModuleType}
                onChange={(event) => setNextModuleType(event.target.value)}
                className="rounded-lg border border-orange-200 px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-orange-400 focus:outline-none"
                disabled={moduleTypeOptions.length === 0}
              >
                {moduleTypeOptions.length === 0 ? (
                  <option value="">Aucun module disponible</option>
                ) : (
                  moduleTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              type="button"
              onClick={handleAddModule}
              disabled={!nextModuleType}
              className="inline-flex items-center justify-center rounded-full border border-orange-300 bg-white px-4 py-2 text-xs font-semibold text-orange-700 transition hover:border-orange-400 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Ajouter ce bloc
            </button>
          </div>
        </section>
      ) : null}
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
