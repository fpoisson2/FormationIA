import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import InfoCard from "../../../../components/InfoCard";
import {
  MODEL_OPTIONS,
  THINKING_OPTIONS,
  VERBOSITY_OPTIONS,
  type ModelConfig,
} from "../../../../config";
import type { StepComponentProps } from "../../types";
import { useStepSequence } from "../..";
import type { WorkshopContextStepState } from "./WorkshopContextStep";
import {
  runComparisonRequests,
  type ComparisonVariant,
  type VariantRequestParameters,
} from "../runComparisonRequests";

interface WorkshopComparisonStepConfig {
  contextStepId: string;
  defaultConfigA?: ModelConfig;
  defaultConfigB?: ModelConfig;
}

interface WorkshopComparisonPayload {
  configA: ModelConfig;
  configB: ModelConfig;
  summaryA: string;
  summaryB: string;
}

const isModelConfig = (value: unknown): value is ModelConfig => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as ModelConfig;
  return (
    typeof candidate.model === "string" &&
    typeof candidate.verbosity === "string" &&
    typeof candidate.thinking === "string"
  );
};

const normalizeConfig = (config: unknown): WorkshopComparisonStepConfig => {
  if (!config || typeof config !== "object") {
    return { contextStepId: "" };
  }
  const base = config as WorkshopComparisonStepConfig;
  const fallbackModel = MODEL_OPTIONS[0]?.value ?? "gpt-5-nano";
  const fallbackConfig: ModelConfig = {
    model: fallbackModel,
    verbosity: "medium",
    thinking: "minimal",
  };
  return {
    contextStepId:
      typeof base.contextStepId === "string" ? base.contextStepId : "",
    defaultConfigA: isModelConfig(base.defaultConfigA)
      ? base.defaultConfigA
      : fallbackConfig,
    defaultConfigB: isModelConfig(base.defaultConfigB)
      ? base.defaultConfigB
      : {
          model: MODEL_OPTIONS[1]?.value ?? fallbackModel,
          verbosity: "high",
          thinking: "high",
        },
  };
};

const buildInitialState = (
  payload: unknown,
  defaults: WorkshopComparisonStepConfig
): WorkshopComparisonPayload => {
  if (
    payload &&
    typeof payload === "object" &&
    "configA" in payload &&
    "configB" in payload
  ) {
    const typed = payload as WorkshopComparisonPayload;
    if (isModelConfig(typed.configA) && isModelConfig(typed.configB)) {
      return {
        configA: typed.configA,
        configB: typed.configB,
        summaryA: typeof typed.summaryA === "string" ? typed.summaryA : "",
        summaryB: typeof typed.summaryB === "string" ? typed.summaryB : "",
      };
    }
  }

  return {
    configA: defaults.defaultConfigA ?? {
      model: MODEL_OPTIONS[0]?.value ?? "gpt-5-nano",
      verbosity: "medium",
      thinking: "minimal",
    },
    configB: defaults.defaultConfigB ?? {
      model: MODEL_OPTIONS[1]?.value ?? MODEL_OPTIONS[0]?.value ?? "gpt-5-nano",
      verbosity: "high",
      thinking: "high",
    },
    summaryA: "",
    summaryB: "",
  };
};

export type WorkshopComparisonStepState = WorkshopComparisonPayload;

export function WorkshopComparisonStep({
  config,
  payload,
  onAdvance,
  isEditMode,
}: StepComponentProps): JSX.Element {
  const { payloads, goToStep } = useStepSequence();

  const typedConfig = useMemo(() => normalizeConfig(config), [config]);

  const contextState = useMemo(() => {
    const base = payloads[typedConfig.contextStepId];
    if (
      base &&
      typeof base === "object" &&
      "sourceText" in base &&
      typeof (base as WorkshopContextStepState).sourceText === "string"
    ) {
      return base as WorkshopContextStepState;
    }
    return { sourceText: "" };
  }, [payloads, typedConfig.contextStepId]);

  const initialState = useMemo(
    () => buildInitialState(payload, typedConfig),
    [payload, typedConfig]
  );

  const [configA, setConfigA] = useState<ModelConfig>(initialState.configA);
  const [configB, setConfigB] = useState<ModelConfig>(initialState.configB);
  const [summaryA, setSummaryA] = useState(initialState.summaryA);
  const [summaryB, setSummaryB] = useState(initialState.summaryB);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);

  useEffect(() => {
    setConfigA(initialState.configA);
    setConfigB(initialState.configB);
    setSummaryA(initialState.summaryA);
    setSummaryB(initialState.summaryB);
  }, [initialState.configA, initialState.configB, initialState.summaryA, initialState.summaryB]);

  useEffect(() => {
    if (!contextState.sourceText.trim() && typedConfig.contextStepId) {
      goToStep(typedConfig.contextStepId);
    }
  }, [contextState.sourceText, goToStep, typedConfig.contextStepId]);

  const handleConfigChange = useCallback(
    (side: "A" | "B", field: keyof ModelConfig, event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value as ModelConfig[keyof ModelConfig];
      if (side === "A") {
        setConfigA((prev) => ({ ...prev, [field]: value }));
      } else {
        setConfigB((prev) => ({ ...prev, [field]: value }));
      }
    },
    []
  );

  const disabled = useMemo(
    () => !contextState.sourceText.trim() || isEditMode,
    [contextState.sourceText, isEditMode]
  );

  const canProceed = useMemo(
    () => Boolean(summaryA.trim() && summaryB.trim()),
    [summaryA, summaryB]
  );

  const handleLaunch = useCallback(async () => {
    if (disabled) {
      setErrorA("Ajoutez un texte source avant de lancer la génération.");
      setErrorB("Ajoutez un texte source avant de lancer la génération.");
      return;
    }

    const variants: Record<ComparisonVariant, VariantRequestParameters> = {
      A: {
        config: configA,
        handlers: {
          setSummary: setSummaryA,
          setError: setErrorA,
          setLoading: setLoadingA,
        },
      },
      B: {
        config: configB,
        handlers: {
          setSummary: setSummaryB,
          setError: setErrorB,
          setLoading: setLoadingB,
        },
      },
    };

    await runComparisonRequests(contextState.sourceText, variants, {
      endpoint: "/summary",
    });
  }, [configA, configB, contextState.sourceText, disabled]);

  const handleAdvance = useCallback(() => {
    if (!canProceed || isEditMode) {
      return;
    }
    onAdvance({
      configA,
      configB,
      summaryA,
      summaryB,
    });
  }, [canProceed, configA, configB, isEditMode, onAdvance, summaryA, summaryB]);

  return (
    <div className="space-y-12">
      <section className="page-section landing-panel bg-white/95 animate-section">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <span className="brand-chip bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
              Étape 2
            </span>
            <h2 className="text-2xl leading-tight text-[color:var(--brand-black)]">
              Réglez deux configurations et observez la production en direct
            </h2>
            <p className="text-sm text-[color:var(--brand-charcoal)]">
              Choisissez un modèle, la verbosité et l’effort de raisonnement pour vos variantes A et B. Suivez le flux en direct pour annoter les idées fortes et les tentatives plus audacieuses.
            </p>
          </div>
          <button
            type="button"
            onClick={() => typedConfig.contextStepId && goToStep(typedConfig.contextStepId)}
            className="cta-button cta-button--light disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={isEditMode}
          >
            Revenir à l’étape 1
          </button>
        </div>
        <div className="my-6 section-divider" />
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between animate-section-delayed">
          <button
            type="button"
            onClick={handleLaunch}
            className="cta-button cta-button--primary disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={loadingA || loadingB || disabled}
          >
            {loadingA || loadingB ? "Réponses en cours…" : "Lancer les deux requêtes"}
          </button>
        </div>
        <div className="my-6 section-divider" />
        <div className="grid gap-6 md:grid-cols-2 animate-section-delayed">
          {["A", "B"].map((side) => {
            const isA = side === "A";
            const configValue = isA ? configA : configB;
            const summaryValue = isA ? summaryA : summaryB;
            const setSummary = isA ? setSummaryA : setSummaryB;
            const loadingValue = isA ? loadingA : loadingB;
            const setLoading = isA ? setLoadingA : setLoadingB;
            const errorValue = isA ? errorA : errorB;
            const setError = isA ? setErrorA : setErrorB;
            const profile = MODEL_OPTIONS.find(
              (option) => option.value === configValue.model
            );

            const handleChange = (
              field: keyof ModelConfig,
              event: ChangeEvent<HTMLSelectElement>
            ) => handleConfigChange(side as "A" | "B", field, event);

            return (
              <div
                key={side}
                className="flex flex-col gap-4 rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-[color:var(--brand-black)]">
                    Profil {side}
                  </h3>
                  <span className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                    {loadingValue
                      ? "Réponse en cours…"
                      : summaryValue
                      ? "Réponse générée"
                      : "En attente"}
                  </span>
                </div>
                <div className="grid gap-3 text-sm">
                  <label
                    className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]"
                    htmlFor={`model-${side}`}
                  >
                    Profil IA
                  </label>
                  <select
                    id={`model-${side}`}
                    value={configValue.model}
                    onChange={(event) => handleChange("model", event)}
                    className="rounded-full border border-white/60 bg-white/80 px-4 py-2 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
                    disabled={isEditMode}
                  >
                    {MODEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {profile?.helper && (
                    <p className="text-xs text-[color:var(--brand-charcoal)]/70">
                      {profile.helper}
                    </p>
                  )}

                  <label
                    className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]"
                    htmlFor={`verbosity-${side}`}
                  >
                    Verbosité attendue
                  </label>
                  <select
                    id={`verbosity-${side}`}
                    value={configValue.verbosity}
                    onChange={(event) => handleChange("verbosity", event)}
                    className="rounded-full border border-white/60 bg-white/80 px-4 py-2 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
                    disabled={isEditMode}
                  >
                    {VERBOSITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <label
                    className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]"
                    htmlFor={`thinking-${side}`}
                  >
                    Effort de raisonnement
                  </label>
                  <select
                    id={`thinking-${side}`}
                    value={configValue.thinking}
                    onChange={(event) => handleChange("thinking", event)}
                    className="rounded-full border border-white/60 bg-white/80 px-4 py-2 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
                    disabled={isEditMode}
                  >
                    {THINKING_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {errorValue ? (
                  <p className="rounded-2xl bg-red-50 p-3 text-xs text-red-600">{errorValue}</p>
                ) : (
                  <div className="min-h-[140px] rounded-3xl bg-[rgba(18,18,18,0.05)] p-4 text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
                    {summaryValue
                      ? summaryValue
                      : loadingValue
                      ? "Initialisation du flux…"
                      : "Résultat en attente."}
                  </div>
                )}
                {isEditMode && (
                  <button
                    type="button"
                    className="cta-button cta-button--light"
                    onClick={() => {
                      setSummary("");
                      setError(null);
                      setLoading(false);
                    }}
                  >
                    Réinitialiser l’aperçu
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="section-divider" />
      <section className="grid gap-4 animate-section md:grid-cols-2 lg:grid-cols-4">
        <InfoCard
          tone="red"
          title="Profils IA"
          description="Comparez un profil rapide (orienté temps de réponse) et un profil expert (orienté profondeur). L’objectif est d’observer comment la même consigne peut livrer deux angles différents."
        />
        <InfoCard
          tone="black"
          title="Verbosité"
          description={'De "Succinct" à "Détaillé", comparez comment l’IA sélectionne, enrichit ou condense les informations clés.'}
        />
        <InfoCard
          tone="sand"
          title="Effort de raisonnement"
          description={'Réglez le raisonnement de "Minimal" à "Analytique" pour visualiser la quantité d’arguments explicités.'}
        />
        <InfoCard
          tone="white"
          title="Astuce multi-plateforme"
          description="Dans les interfaces ChatGPT ou Gemini, vous pouvez également choisir le moteur utilisé (ex. « Rapide », « Avancé »). Recherchez l’option « Modèle » ou « Quality » dans les réglages pour reproduire vos comparaisons."
        />
      </section>

      <div className="section-divider" />
      <div className="flex justify-end animate-section">
        <button
          type="button"
          onClick={handleAdvance}
          className="cta-button cta-button--light disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={!canProceed || isEditMode}
        >
          Passer à l’étape 3
        </button>
      </div>
    </div>
  );
}

