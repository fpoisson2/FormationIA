import { useCallback, useMemo, useState, type ChangeEvent } from "react";

import type { ExplorateurIAModuleConfig, ExplorateurIAModuleProps } from "./registry";
import { registerExplorateurIAModule } from "./registry";

export interface DecisionPathOptionConfig {
  id: string;
  title: string;
  impact: string;
  next: string | null;
}

export interface DecisionPathStepConfig {
  id: string;
  prompt: string;
  options: DecisionPathOptionConfig[];
}

export interface DecisionPathModuleConfig extends ExplorateurIAModuleConfig {
  type: "decision-path";
  title?: string;
  introduction?: string;
  steps: DecisionPathStepConfig[];
}

export interface DecisionPathResult {
  selectedOptions: string[];
  visitedSteps: string[];
}

const DEFAULT_STEPS: DecisionPathStepConfig[] = [
  {
    id: "announce",
    prompt: "Votre équipe doit annoncer un nouveau projet. Quelle stratégie choisissez-vous ?",
    options: [
      {
        id: "A",
        title: "Annonce rapide",
        impact: "+ vitesse / – profondeur",
        next: "follow-up",
      },
      {
        id: "B",
        title: "Annonce équilibrée",
        impact: "+ clarté / – temps",
        next: "follow-up",
      },
      {
        id: "C",
        title: "Annonce personnalisée",
        impact: "+ pertinence / – effort",
        next: "follow-up",
      },
    ],
  },
  {
    id: "follow-up",
    prompt: "Le public réagit vivement. Quelle action de suivi priorisez-vous ?",
    options: [
      {
        id: "A",
        title: "FAQ automatisée",
        impact: "+ échelle / – nuance",
        next: null,
      },
      {
        id: "B",
        title: "Atelier interactif",
        impact: "+ engagement / – logistique",
        next: null,
      },
      {
        id: "C",
        title: "Messages ciblés",
        impact: "+ efficacité / – données",
        next: null,
      },
    ],
  },
];

export const DEFAULT_DECISION_PATH_CONFIG: DecisionPathModuleConfig = {
  type: "decision-path",
  title: "Tracez votre parcours de décision",
  introduction:
    "Chaque choix révèle des compromis différents. Expérimentez plusieurs trajectoires pour comparer les impacts.",
  steps: DEFAULT_STEPS,
};

function sanitizeSteps(steps: DecisionPathStepConfig[] | undefined): DecisionPathStepConfig[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    return DEFAULT_STEPS.map((step) => ({
      ...step,
      options: step.options.map((option) => ({ ...option })),
    }));
  }
  return steps.map((step, index) => ({
    id: typeof step.id === "string" ? step.id : `step-${index + 1}`,
    prompt:
      typeof step.prompt === "string"
        ? step.prompt
        : DEFAULT_STEPS[index % DEFAULT_STEPS.length].prompt,
    options: Array.isArray(step.options) && step.options.length
      ? step.options.map((option, optionIndex) => ({
          id:
            typeof option?.id === "string" && option.id.trim()
              ? option.id.trim()
              : String.fromCharCode(65 + optionIndex),
          title:
            typeof option?.title === "string"
              ? option.title
              : DEFAULT_STEPS[index % DEFAULT_STEPS.length].options[
                  optionIndex % DEFAULT_STEPS[index % DEFAULT_STEPS.length].options.length
                ].title,
          impact:
            typeof option?.impact === "string"
              ? option.impact
              : DEFAULT_STEPS[index % DEFAULT_STEPS.length].options[
                  optionIndex % DEFAULT_STEPS[index % DEFAULT_STEPS.length].options.length
                ].impact,
          next:
            typeof option?.next === "string" && option.next.trim()
              ? option.next.trim()
              : null,
        }))
      : DEFAULT_STEPS[index % DEFAULT_STEPS.length].options.map((option) => ({
          ...option,
        })),
  }));
}

function sanitizeDecisionConfig(config: unknown): DecisionPathModuleConfig {
  if (!config || typeof config !== "object") {
    return { ...DEFAULT_DECISION_PATH_CONFIG };
  }
  const base = config as Partial<DecisionPathModuleConfig>;
  return {
    type: "decision-path",
    title:
      typeof base.title === "string"
        ? base.title
        : DEFAULT_DECISION_PATH_CONFIG.title,
    introduction:
      typeof base.introduction === "string"
        ? base.introduction
        : DEFAULT_DECISION_PATH_CONFIG.introduction,
    steps: sanitizeSteps(base.steps),
  };
}

function DecisionPathModule({
  config,
  payload,
  onAdvance,
  isEditMode,
  onUpdateConfig,
}: ExplorateurIAModuleProps) {
  const typedConfig = useMemo(() => sanitizeDecisionConfig(config), [config]);
  const steps = typedConfig.steps;
  const [currentStepId, setCurrentStepId] = useState(() => steps[0]?.id ?? "");
  const [path, setPath] = useState<string[]>(() => {
    if (payload && typeof payload === "object") {
      const result = payload as DecisionPathResult;
      return Array.isArray(result.selectedOptions) ? [...result.selectedOptions] : [];
    }
    return [];
  });

  const [visited, setVisited] = useState<string[]>(() => {
    if (payload && typeof payload === "object") {
      const result = payload as DecisionPathResult;
      return Array.isArray(result.visitedSteps) ? [...result.visitedSteps] : [];
    }
    return [];
  });

  const currentStep = useMemo(
    () => steps.find((step) => step.id === currentStepId) ?? steps[0],
    [currentStepId, steps]
  );

  const handleChoice = useCallback(
    (option: DecisionPathOptionConfig) => {
      if (!currentStep) {
        return;
      }
      setPath((prev) => [...prev, option.id]);
      setVisited((prev) => [...prev, currentStep.id]);
      if (option.next) {
        setCurrentStepId(option.next);
        return;
      }
      const result: DecisionPathResult = {
        selectedOptions: [...path, option.id],
        visitedSteps: [...visited, currentStep.id],
      };
      onAdvance(result);
    },
    [currentStep, onAdvance, path, visited]
  );

  const handleReset = useCallback(() => {
    setPath([]);
    setVisited([]);
    setCurrentStepId(steps[0]?.id ?? "");
  }, [steps]);

  const handleStepPromptChange = useCallback(
    (index: number, value: string) => {
      const nextSteps = steps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, prompt: value } : step
      );
      onUpdateConfig({ ...typedConfig, steps: nextSteps });
    },
    [onUpdateConfig, steps, typedConfig]
  );

  const handleOptionChange = useCallback(
    (
      stepIndex: number,
      optionIndex: number,
      field: keyof DecisionPathOptionConfig,
      value: string
    ) => {
      const nextSteps = steps.map((step, index) => {
        if (index !== stepIndex) return step;
        const nextOptions = step.options.map((option, optIndex) => {
          if (optIndex !== optionIndex) return option;
          if (field === "next") {
            return { ...option, next: value === "" ? null : value };
          }
          return { ...option, [field]: value };
        });
        return { ...step, options: nextOptions };
      });
      onUpdateConfig({ ...typedConfig, steps: nextSteps });
    },
    [onUpdateConfig, steps, typedConfig]
  );

  const stepIdOptions = steps.map((step) => step.id);

  if (isEditMode) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Titre</span>
            <input
              className="w-full rounded-md border border-slate-300 p-2"
              value={typedConfig.title ?? ""}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                onUpdateConfig({ ...typedConfig, title: event.target.value })
              }
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Introduction</span>
            <textarea
              className="h-24 w-full rounded-md border border-slate-300 p-2"
              value={typedConfig.introduction ?? ""}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                onUpdateConfig({
                  ...typedConfig,
                  introduction: event.target.value,
                })
              }
            />
          </label>
        </div>
        <div className="space-y-4">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">
                  Étape {index + 1} — {step.id}
                </h3>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">Prompt</span>
                <textarea
                  className="h-20 w-full rounded-md border border-slate-300 p-2"
                  value={step.prompt}
                  onChange={(event) =>
                    handleStepPromptChange(index, event.target.value)
                  }
                />
              </label>
              <div className="space-y-3">
                {step.options.map((option, optionIndex) => (
                  <div
                    key={option.id}
                    className="rounded-xl border border-slate-200 p-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block space-y-1 text-sm">
                        <span className="font-medium text-slate-600">Identifiant</span>
                        <input
                          className="w-full rounded-md border border-slate-300 p-2"
                          value={option.id}
                          onChange={(event) =>
                            handleOptionChange(
                              index,
                              optionIndex,
                              "id",
                              event.target.value
                            )
                          }
                        />
                      </label>
                      <label className="block space-y-1 text-sm">
                        <span className="font-medium text-slate-600">Étape suivante</span>
                        <select
                          className="w-full rounded-md border border-slate-300 p-2"
                          value={option.next ?? ""}
                          onChange={(event) =>
                            handleOptionChange(
                              index,
                              optionIndex,
                              "next",
                              event.target.value
                            )
                          }
                        >
                          <option value="">Fin du parcours</option>
                          {stepIdOptions.map((stepId) => (
                            <option key={stepId} value={stepId}>
                              {stepId}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="mt-3 block space-y-1 text-sm">
                      <span className="font-medium text-slate-600">Titre</span>
                      <input
                        className="w-full rounded-md border border-slate-300 p-2"
                        value={option.title}
                        onChange={(event) =>
                          handleOptionChange(
                            index,
                            optionIndex,
                            "title",
                            event.target.value
                          )
                        }
                      />
                    </label>
                    <label className="mt-3 block space-y-1 text-sm">
                      <span className="font-medium text-slate-600">Impact</span>
                      <textarea
                        className="h-20 w-full rounded-md border border-slate-300 p-2"
                        value={option.impact}
                        onChange={(event) =>
                          handleOptionChange(
                            index,
                            optionIndex,
                            "impact",
                            event.target.value
                          )
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!currentStep) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Aucune étape configurée pour ce parcours.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {typedConfig.title ? (
        <h2 className="text-lg font-semibold text-slate-900">{typedConfig.title}</h2>
      ) : null}
      {typedConfig.introduction ? (
        <p className="text-sm text-slate-600">{typedConfig.introduction}</p>
      ) : null}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Étape {steps.findIndex((step) => step.id === currentStep.id) + 1} / {steps.length}
        </div>
        <p className="mt-2 text-base text-slate-700">{currentStep.prompt}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {currentStep.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => handleChoice(option)}
            className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50"
          >
            <div className="text-sm font-semibold text-slate-800">{option.title}</div>
            <p className="mt-2 text-xs text-slate-600">{option.impact}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <div>
          Trajectoire actuelle :
          <span className="ml-2 font-semibold text-slate-700">
            {path.length ? path.join(" → ") : "Aucune sélection"}
          </span>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-full border border-slate-300 px-3 py-1 font-semibold text-slate-600 hover:bg-slate-100"
        >
          Recommencer
        </button>
      </div>
    </div>
  );
}

registerExplorateurIAModule("decision-path", DecisionPathModule);
