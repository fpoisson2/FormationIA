import { ChangeEvent, useCallback, useEffect, useMemo, useState, useId } from "react";

import InfoCard from "../../../components/InfoCard";
import {
  MODEL_OPTIONS,
  THINKING_OPTIONS,
  VERBOSITY_OPTIONS,
  type ModelConfig,
} from "../../../config";
import { useStepSequence } from "..";
import type { StepComponentProps } from "../types";
import {
  runComparisonRequests,
  type ComparisonVariant,
  type VariantRequestParameters,
} from "./runComparisonRequests";

export type DualModelComparisonVariant = ComparisonVariant;

export interface DualModelComparisonVariantConfig {
  title?: string;
  defaultConfig?: ModelConfig;
  requestPreset?: Record<string, unknown>;
}

export interface DualModelComparisonInfoCardConfig {
  tone?: "red" | "black" | "sand" | "white";
  title: string;
  description: string;
}

export interface DualModelComparisonLaunchCtaConfig {
  idle?: string;
  loading?: string;
  missingContext?: string;
}

export interface DualModelComparisonStatusConfig {
  idle?: string;
  loading?: string;
  success?: string;
}

export interface DualModelComparisonSelectLabelsConfig {
  model?: string;
  verbosity?: string;
  thinking?: string;
}

export interface DualModelComparisonSummaryConfig {
  empty?: string;
  loading?: string;
  resetLabel?: string;
}

export interface DualModelComparisonCopyConfig {
  badge?: string;
  title?: string;
  description?: string;
  backCtaLabel?: string;
  promptLabel?: string;
  promptPlaceholder?: string;
  promptHelper?: string;
  launchCta?: DualModelComparisonLaunchCtaConfig;
  variantTitles?: Partial<Record<DualModelComparisonVariant, string>>;
  variantTitlePattern?: string;
  variantStatus?: DualModelComparisonStatusConfig;
  selectLabels?: DualModelComparisonSelectLabelsConfig;
  summary?: DualModelComparisonSummaryConfig;
  proceedCtaLabel?: string;
  infoCards?: DualModelComparisonInfoCardConfig[];
}

export interface DualModelComparisonRequestConfig {
  endpoint?: string;
  systemPrompt?: string;
}

export interface DualModelComparisonConfig {
  contextStepId?: string;
  contextField?: string;
  copy?: DualModelComparisonCopyConfig;
  request?: DualModelComparisonRequestConfig;
  variants?: Partial<Record<DualModelComparisonVariant, DualModelComparisonVariantConfig>>;
  defaultConfigA?: ModelConfig;
  defaultConfigB?: ModelConfig;
}

export interface DualModelComparisonPayload {
  configA: ModelConfig;
  configB: ModelConfig;
  summaryA: string;
  summaryB: string;
  prompt: string;
}

export type DualModelComparisonStepState = DualModelComparisonPayload;

interface NormalizedVariantConfig {
  title: string;
  defaultConfig: ModelConfig;
  preset?: Record<string, unknown>;
}

interface NormalizedLaunchCtaConfig {
  idle: string;
  loading: string;
  missingContext: string;
}

interface NormalizedStatusConfig {
  idle: string;
  loading: string;
  success: string;
}

interface NormalizedSelectLabelsConfig {
  model: string;
  verbosity: string;
  thinking: string;
}

interface NormalizedSummaryConfig {
  empty: string;
  loading: string;
  resetLabel: string;
}

interface NormalizedCopyConfig {
  badge?: string;
  title: string;
  description?: string;
  backCtaLabel?: string;
  promptLabel: string;
  promptPlaceholder: string;
  promptHelper?: string;
  launchCta: NormalizedLaunchCtaConfig;
  variantTitles: Record<DualModelComparisonVariant, string>;
  variantStatus: NormalizedStatusConfig;
  selectLabels: NormalizedSelectLabelsConfig;
  summary: NormalizedSummaryConfig;
  proceedCtaLabel: string;
  infoCards: DualModelComparisonInfoCardConfig[];
}

interface NormalizedDualModelComparisonConfig {
  contextStepId: string;
  contextField: string;
  copy: NormalizedCopyConfig;
  request: Required<Pick<DualModelComparisonRequestConfig, "endpoint">> &
    Pick<DualModelComparisonRequestConfig, "systemPrompt">;
  variants: Record<DualModelComparisonVariant, NormalizedVariantConfig>;
}

const VARIANTS: DualModelComparisonVariant[] = ["A", "B"];

const DEFAULT_VARIANT_TITLES: Record<DualModelComparisonVariant, string> = {
  A: "Profil A",
  B: "Profil B",
};

const DEFAULT_LAUNCH_CTA: NormalizedLaunchCtaConfig = {
  idle: "Lancer les deux requêtes",
  loading: "Réponses en cours…",
  missingContext: "Ajoutez un prompt avant de lancer la génération.",
};

const DEFAULT_STATUS: NormalizedStatusConfig = {
  idle: "En attente",
  loading: "Réponse en cours…",
  success: "Réponse générée",
};

const DEFAULT_SELECT_LABELS: NormalizedSelectLabelsConfig = {
  model: "Profil IA",
  verbosity: "Verbosité attendue",
  thinking: "Effort de raisonnement",
};

const DEFAULT_SUMMARY: NormalizedSummaryConfig = {
  empty: "Résultat en attente.",
  loading: "Initialisation du flux…",
  resetLabel: "Réinitialiser l’aperçu",
};

const DEFAULT_COPY: NormalizedCopyConfig = {
  title: "Comparez deux configurations IA",
  promptLabel: "Décrivez la consigne à soumettre",
  promptPlaceholder: "Décrivez le besoin ou la tâche attendue pour vos deux variantes.",
  launchCta: DEFAULT_LAUNCH_CTA,
  variantTitles: { ...DEFAULT_VARIANT_TITLES },
  variantStatus: DEFAULT_STATUS,
  selectLabels: DEFAULT_SELECT_LABELS,
  summary: DEFAULT_SUMMARY,
  proceedCtaLabel: "Passer à l’étape suivante",
  infoCards: [],
};

const INFO_CARD_TONES = new Set(["red", "black", "sand", "white"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isModelConfig = (value: unknown): value is ModelConfig => {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    typeof value.model === "string" &&
    typeof value.verbosity === "string" &&
    typeof value.thinking === "string"
  );
};

const normalizeInfoCards = (
  infoCards: DualModelComparisonInfoCardConfig[] | undefined
): DualModelComparisonInfoCardConfig[] => {
  if (!Array.isArray(infoCards)) {
    return [];
  }

  return infoCards
    .map((card) => {
      if (!isPlainObject(card)) {
        return null;
      }
      const title = typeof card.title === "string" ? card.title.trim() : "";
      const description =
        typeof card.description === "string" ? card.description.trim() : "";
      if (!title || !description) {
        return null;
      }
      const tone =
        typeof card.tone === "string" && INFO_CARD_TONES.has(card.tone)
          ? card.tone
          : undefined;
      return { title, description, tone } satisfies DualModelComparisonInfoCardConfig;
    })
    .filter((card): card is DualModelComparisonInfoCardConfig => Boolean(card));
};

const normalizeCopy = (
  copy: DualModelComparisonCopyConfig | undefined
): NormalizedCopyConfig => {
  const base: NormalizedCopyConfig = {
    ...DEFAULT_COPY,
    launchCta: { ...DEFAULT_COPY.launchCta },
    variantTitles: { ...DEFAULT_COPY.variantTitles },
    variantStatus: { ...DEFAULT_COPY.variantStatus },
    selectLabels: { ...DEFAULT_COPY.selectLabels },
    summary: { ...DEFAULT_COPY.summary },
    infoCards: [],
  };

  if (!copy || !isPlainObject(copy)) {
    return base;
  }

  if (typeof copy.badge === "string" && copy.badge.trim()) {
    base.badge = copy.badge;
  }

  if (typeof copy.title === "string" && copy.title.trim()) {
    base.title = copy.title;
  }

  if (typeof copy.description === "string") {
    base.description = copy.description;
  }

  if (typeof copy.backCtaLabel === "string" && copy.backCtaLabel.trim()) {
    base.backCtaLabel = copy.backCtaLabel;
  }

  if (typeof copy.promptLabel === "string" && copy.promptLabel.trim()) {
    base.promptLabel = copy.promptLabel;
  }

  if (
    typeof copy.promptPlaceholder === "string" &&
    copy.promptPlaceholder.trim()
  ) {
    base.promptPlaceholder = copy.promptPlaceholder;
  }

  if (typeof copy.promptHelper === "string" && copy.promptHelper.trim()) {
    base.promptHelper = copy.promptHelper;
  }

  if (copy.launchCta && isPlainObject(copy.launchCta)) {
    if (typeof copy.launchCta.idle === "string" && copy.launchCta.idle.trim()) {
      base.launchCta.idle = copy.launchCta.idle;
    }
    if (
      typeof copy.launchCta.loading === "string" &&
      copy.launchCta.loading.trim()
    ) {
      base.launchCta.loading = copy.launchCta.loading;
    }
    if (
      typeof copy.launchCta.missingContext === "string" &&
      copy.launchCta.missingContext.trim()
    ) {
      base.launchCta.missingContext = copy.launchCta.missingContext;
    }
  }

  const pattern =
    typeof copy.variantTitlePattern === "string" &&
    copy.variantTitlePattern.includes("{variant}")
      ? copy.variantTitlePattern
      : undefined;

  if (copy.variantTitles && isPlainObject(copy.variantTitles)) {
    VARIANTS.forEach((variant) => {
      const value = copy.variantTitles?.[variant];
      if (typeof value === "string" && value.trim()) {
        base.variantTitles[variant] = value;
      }
    });
  }

  if (pattern) {
    VARIANTS.forEach((variant) => {
      if (!base.variantTitles[variant]) {
        base.variantTitles[variant] = pattern.replace(/\{variant\}/g, variant);
      }
    });
  }

  if (copy.variantStatus && isPlainObject(copy.variantStatus)) {
    if (
      typeof copy.variantStatus.idle === "string" &&
      copy.variantStatus.idle.trim()
    ) {
      base.variantStatus.idle = copy.variantStatus.idle;
    }
    if (
      typeof copy.variantStatus.loading === "string" &&
      copy.variantStatus.loading.trim()
    ) {
      base.variantStatus.loading = copy.variantStatus.loading;
    }
    if (
      typeof copy.variantStatus.success === "string" &&
      copy.variantStatus.success.trim()
    ) {
      base.variantStatus.success = copy.variantStatus.success;
    }
  }

  if (copy.selectLabels && isPlainObject(copy.selectLabels)) {
    if (
      typeof copy.selectLabels.model === "string" &&
      copy.selectLabels.model.trim()
    ) {
      base.selectLabels.model = copy.selectLabels.model;
    }
    if (
      typeof copy.selectLabels.verbosity === "string" &&
      copy.selectLabels.verbosity.trim()
    ) {
      base.selectLabels.verbosity = copy.selectLabels.verbosity;
    }
    if (
      typeof copy.selectLabels.thinking === "string" &&
      copy.selectLabels.thinking.trim()
    ) {
      base.selectLabels.thinking = copy.selectLabels.thinking;
    }
  }

  if (copy.summary && isPlainObject(copy.summary)) {
    if (typeof copy.summary.empty === "string" && copy.summary.empty.trim()) {
      base.summary.empty = copy.summary.empty;
    }
    if (typeof copy.summary.loading === "string" && copy.summary.loading.trim()) {
      base.summary.loading = copy.summary.loading;
    }
    if (
      typeof copy.summary.resetLabel === "string" &&
      copy.summary.resetLabel.trim()
    ) {
      base.summary.resetLabel = copy.summary.resetLabel;
    }
  }

  if (
    typeof copy.proceedCtaLabel === "string" &&
    copy.proceedCtaLabel.trim()
  ) {
    base.proceedCtaLabel = copy.proceedCtaLabel;
  }

  base.infoCards = normalizeInfoCards(copy.infoCards);

  return base;
};

const getFallbackConfig = (
  variant: DualModelComparisonVariant
): ModelConfig => {
  const fallbackModel = MODEL_OPTIONS[0]?.value ?? "gpt-5-nano";
  if (variant === "A") {
    return {
      model: fallbackModel,
      verbosity: "medium",
      thinking: "minimal",
    };
  }
  return {
    model: MODEL_OPTIONS[1]?.value ?? fallbackModel,
    verbosity: "high",
    thinking: "high",
  };
};

const normalizeVariantPreset = (
  preset: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!isPlainObject(preset)) {
    return undefined;
  }
  return { ...preset };
};

const normalizeVariants = (
  config: DualModelComparisonConfig,
  copy: NormalizedCopyConfig
): Record<DualModelComparisonVariant, NormalizedVariantConfig> => {
  const variants: Record<DualModelComparisonVariant, NormalizedVariantConfig> = {
    A: {
      title: copy.variantTitles.A,
      defaultConfig:
        (config.defaultConfigA && isModelConfig(config.defaultConfigA)
          ? config.defaultConfigA
          : undefined) ?? getFallbackConfig("A"),
    },
    B: {
      title: copy.variantTitles.B,
      defaultConfig:
        (config.defaultConfigB && isModelConfig(config.defaultConfigB)
          ? config.defaultConfigB
          : undefined) ?? getFallbackConfig("B"),
    },
  };

  if (!config.variants || !isPlainObject(config.variants)) {
    return variants;
  }

  VARIANTS.forEach((variant) => {
    const variantConfig = config.variants?.[variant];
    if (!variantConfig || !isPlainObject(variantConfig)) {
      return;
    }

    if (
      typeof variantConfig.title === "string" &&
      variantConfig.title.trim()
    ) {
      variants[variant].title = variantConfig.title;
    }

    if (
      variantConfig.defaultConfig &&
      isModelConfig(variantConfig.defaultConfig)
    ) {
      variants[variant].defaultConfig = variantConfig.defaultConfig;
    }

    if (variantConfig.requestPreset) {
      variants[variant].preset = normalizeVariantPreset(
        variantConfig.requestPreset
      );
    }
  });

  return variants;
};

const normalizeConfig = (
  config: unknown
): NormalizedDualModelComparisonConfig => {
  const baseConfig: DualModelComparisonConfig =
    isPlainObject(config) ? (config as DualModelComparisonConfig) : {};

  const copy = normalizeCopy(baseConfig.copy);

  const request: NormalizedDualModelComparisonConfig["request"] = {
    endpoint:
      typeof baseConfig.request?.endpoint === "string" &&
      baseConfig.request.endpoint.trim()
        ? baseConfig.request.endpoint
        : "/summary",
  };

  if (
    typeof baseConfig.request?.systemPrompt === "string" &&
    baseConfig.request.systemPrompt.trim()
  ) {
    request.systemPrompt = baseConfig.request.systemPrompt;
  }

  const contextField =
    typeof baseConfig.contextField === "string" &&
    baseConfig.contextField.trim()
      ? baseConfig.contextField
      : "sourceText";

  const contextStepId =
    typeof baseConfig.contextStepId === "string"
      ? baseConfig.contextStepId
      : "";

  const variants = normalizeVariants(baseConfig, copy);

  return {
    contextStepId,
    contextField,
    copy,
    request,
    variants,
  };
};

const buildInitialState = (
  payload: unknown,
  defaults: NormalizedDualModelComparisonConfig,
  fallbackPrompt: string
): DualModelComparisonPayload => {
  if (
    payload &&
    typeof payload === "object" &&
    "configA" in payload &&
    "configB" in payload
  ) {
    const typed = payload as DualModelComparisonPayload;
    if (isModelConfig(typed.configA) && isModelConfig(typed.configB)) {
      const promptFromPayload =
        typeof typed.prompt === "string" ? typed.prompt : "";
      return {
        configA: { ...typed.configA },
        configB: { ...typed.configB },
        summaryA: typeof typed.summaryA === "string" ? typed.summaryA : "",
        summaryB: typeof typed.summaryB === "string" ? typed.summaryB : "",
        prompt: promptFromPayload.trim().length ? promptFromPayload : fallbackPrompt,
      };
    }
  }

  return {
    configA: { ...defaults.variants.A.defaultConfig },
    configB: { ...defaults.variants.B.defaultConfig },
    summaryA: "",
    summaryB: "",
    prompt: fallbackPrompt,
  };
};

export function DualModelComparisonStep({
  config,
  payload,
  onAdvance,
  isEditMode,
}: StepComponentProps): JSX.Element {
  const { payloads, goToStep } = useStepSequence();

  const normalizedConfig = useMemo(() => normalizeConfig(config), [config]);

  const contextState = useMemo(() => {
    const base = normalizedConfig.contextStepId
      ? payloads[normalizedConfig.contextStepId]
      : undefined;
    if (base && typeof base === "object") {
      const record = base as Record<string, unknown>;
      const raw = record[normalizedConfig.contextField];
      if (typeof raw === "string") {
        return { sourceText: raw };
      }
      if (
        normalizedConfig.contextField !== "sourceText" &&
        typeof record.sourceText === "string"
      ) {
        return { sourceText: record.sourceText };
      }
    }
    return { sourceText: "" };
  }, [payloads, normalizedConfig.contextField, normalizedConfig.contextStepId]);

  const initialState = useMemo(
    () => buildInitialState(payload, normalizedConfig, contextState.sourceText),
    [payload, normalizedConfig, contextState.sourceText]
  );

  const [configA, setConfigA] = useState<ModelConfig>(initialState.configA);
  const [configB, setConfigB] = useState<ModelConfig>(initialState.configB);
  const [summaryA, setSummaryA] = useState(initialState.summaryA);
  const [summaryB, setSummaryB] = useState(initialState.summaryB);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);
  const [promptText, setPromptText] = useState(initialState.prompt);
  const [promptError, setPromptError] = useState<string | null>(null);

  const promptFieldId = useId();

  useEffect(() => {
    setConfigA(initialState.configA);
    setConfigB(initialState.configB);
    setSummaryA(initialState.summaryA);
    setSummaryB(initialState.summaryB);
    setPromptText(initialState.prompt);
    setPromptError(null);
  }, [
    initialState.configA,
    initialState.configB,
    initialState.summaryA,
    initialState.summaryB,
    initialState.prompt,
  ]);

  const handleConfigChange = useCallback(
    (
      side: DualModelComparisonVariant,
      field: keyof ModelConfig,
      event: ChangeEvent<HTMLSelectElement>
    ) => {
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
    () => !promptText.trim() || isEditMode,
    [promptText, isEditMode]
  );

  const canProceed = useMemo(
    () => Boolean(summaryA.trim() && summaryB.trim()),
    [summaryA, summaryB]
  );

  const handleLaunch = useCallback(async () => {
    const trimmedPrompt = promptText.trim();
    if (!trimmedPrompt || isEditMode) {
      const message = normalizedConfig.copy.launchCta.missingContext;
      setPromptError(message);
      setErrorA(message);
      setErrorB(message);
      return;
    }

    setPromptError(null);

    const variants: Record<DualModelComparisonVariant, VariantRequestParameters> = {
      A: {
        config: configA,
        handlers: {
          setSummary: setSummaryA,
          setError: setErrorA,
          setLoading: setLoadingA,
        },
        preset: normalizedConfig.variants.A.preset,
      },
      B: {
        config: configB,
        handlers: {
          setSummary: setSummaryB,
          setError: setErrorB,
          setLoading: setLoadingB,
        },
        preset: normalizedConfig.variants.B.preset,
      },
    };

    await runComparisonRequests(trimmedPrompt, variants, {
      endpoint: normalizedConfig.request.endpoint,
      systemPrompt: normalizedConfig.request.systemPrompt,
    });
  }, [
    configA,
    configB,
    normalizedConfig.request.endpoint,
    normalizedConfig.request.systemPrompt,
    normalizedConfig.variants.A.preset,
    normalizedConfig.variants.B.preset,
    normalizedConfig.copy.launchCta.missingContext,
    promptText,
    isEditMode,
  ]);

  const handleAdvance = useCallback(() => {
    if (!canProceed || isEditMode) {
      return;
    }
    onAdvance({
      configA,
      configB,
      summaryA,
      summaryB,
      prompt: promptText.trim(),
    });
  }, [
    canProceed,
    configA,
    configB,
    isEditMode,
    onAdvance,
    summaryA,
    summaryB,
    promptText,
  ]);

  return (
    <div className="space-y-12">
      <section className="page-section landing-panel bg-white/95 animate-section">
        <div className="space-y-3">
          <label
            htmlFor={promptFieldId}
            className="text-sm font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]"
          >
            {normalizedConfig.copy.promptLabel}
          </label>
          <textarea
            id={promptFieldId}
            value={promptText}
            onChange={(event) => {
              setPromptText(event.target.value);
              setPromptError(null);
            }}
            placeholder={normalizedConfig.copy.promptPlaceholder}
            className="min-h-[160px] w-full rounded-3xl border border-white/60 bg-white/80 p-4 text-sm text-[color:var(--brand-black)] shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
            disabled={isEditMode}
          />
          {normalizedConfig.copy.promptHelper && (
            <p className="text-xs text-[color:var(--brand-charcoal)]/80">
              {normalizedConfig.copy.promptHelper}
            </p>
          )}
          {promptError && (
            <p className="text-xs text-red-600">{promptError}</p>
          )}
        </div>
      </section>

      <section className="page-section landing-panel bg-white/95 animate-section">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            {normalizedConfig.copy.badge && (
              <span className="brand-chip bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
                {normalizedConfig.copy.badge}
              </span>
            )}
            <h2 className="text-2xl leading-tight text-[color:var(--brand-black)]">
              {normalizedConfig.copy.title}
            </h2>
            {normalizedConfig.copy.description && (
              <p className="text-sm text-[color:var(--brand-charcoal)]">
                {normalizedConfig.copy.description}
              </p>
            )}
          </div>
          {normalizedConfig.copy.backCtaLabel && normalizedConfig.contextStepId && (
            <button
              type="button"
              onClick={() =>
                normalizedConfig.contextStepId &&
                goToStep(normalizedConfig.contextStepId)
              }
              className="cta-button cta-button--light disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={isEditMode}
            >
              {normalizedConfig.copy.backCtaLabel}
            </button>
          )}
        </div>
        <div className="my-6 section-divider" />
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between animate-section-delayed">
          <button
            type="button"
            onClick={handleLaunch}
            className="cta-button cta-button--primary disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={loadingA || loadingB || disabled}
          >
            {loadingA || loadingB
              ? normalizedConfig.copy.launchCta.loading
              : normalizedConfig.copy.launchCta.idle}
          </button>
        </div>
        <div className="my-6 section-divider" />
        <div className="grid gap-6 md:grid-cols-2 animate-section-delayed">
          {VARIANTS.map((variant) => {
            const isA = variant === "A";
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
            ) => handleConfigChange(variant, field, event);

            return (
              <div
                key={variant}
                className="flex flex-col gap-4 rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-[color:var(--brand-black)]">
                    {normalizedConfig.variants[variant].title}
                  </h3>
                  <span className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                    {loadingValue
                      ? normalizedConfig.copy.variantStatus.loading
                      : summaryValue
                      ? normalizedConfig.copy.variantStatus.success
                      : normalizedConfig.copy.variantStatus.idle}
                  </span>
                </div>
                <div className="grid gap-3 text-sm">
                  <label
                    className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]"
                    htmlFor={`model-${variant}`}
                  >
                    {normalizedConfig.copy.selectLabels.model}
                  </label>
                  <select
                    id={`model-${variant}`}
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
                    htmlFor={`verbosity-${variant}`}
                  >
                    {normalizedConfig.copy.selectLabels.verbosity}
                  </label>
                  <select
                    id={`verbosity-${variant}`}
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
                    htmlFor={`thinking-${variant}`}
                  >
                    {normalizedConfig.copy.selectLabels.thinking}
                  </label>
                  <select
                    id={`thinking-${variant}`}
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
                      ? normalizedConfig.copy.summary.loading
                      : normalizedConfig.copy.summary.empty}
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
                    {normalizedConfig.copy.summary.resetLabel}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {normalizedConfig.copy.infoCards.length > 0 && (
        <>
          <div className="section-divider" />
          <section className="grid gap-4 animate-section md:grid-cols-2 lg:grid-cols-4">
            {normalizedConfig.copy.infoCards.map((card, index) => (
              <InfoCard
                key={`${card.title}-${index}`}
                tone={card.tone}
                title={card.title}
                description={card.description}
              />
            ))}
          </section>
        </>
      )}

      <div className="section-divider" />
      <div className="flex justify-end animate-section">
        <button
          type="button"
          onClick={handleAdvance}
          className="cta-button cta-button--light disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={!canProceed || isEditMode}
        >
          {normalizedConfig.copy.proceedCtaLabel}
        </button>
      </div>
    </div>
  );
}
