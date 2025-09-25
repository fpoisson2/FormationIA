import {
  FormEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  MODEL_OPTIONS,
  THINKING_OPTIONS,
  VERBOSITY_OPTIONS,
  type ModelChoice,
  type ThinkingChoice,
  type VerbosityChoice,
} from "../../../../config";
import type { StepComponentProps } from "../../types";
import { StepSequenceContext } from "../../types";

const MODEL_VALUES = new Set<ModelChoice>(MODEL_OPTIONS.map((option) => option.value));
const VERBOSITY_VALUES = new Set<VerbosityChoice>(
  VERBOSITY_OPTIONS.map((option) => option.value)
);
const THINKING_VALUES = new Set<ThinkingChoice>(
  THINKING_OPTIONS.map((option) => option.value)
);

export const DEFAULT_CLARITY_MODEL: ModelChoice =
  MODEL_OPTIONS[0]?.value ?? "gpt-5-nano";
export const DEFAULT_CLARITY_VERBOSITY: VerbosityChoice =
  VERBOSITY_OPTIONS.find((option) => option.value === "medium")?.value ??
  VERBOSITY_OPTIONS[0]?.value ??
  "medium";
export const DEFAULT_CLARITY_THINKING: ThinkingChoice =
  THINKING_OPTIONS.find((option) => option.value === "medium")?.value ??
  THINKING_OPTIONS[0]?.value ??
  "minimal";
export const DEFAULT_CLARITY_DEVELOPER_MESSAGE =
  "Tu es un agent qui transforme une consigne en plan de déplacements sur une grille 10×10.\n" +
  "Réponds uniquement avec un JSON strict {\"plan\":[{\"dir\":\"left|right|up|down\",\"steps\":int}],\"notes\":\"...\"}.\n" +
  "Limite les notes à 80 caractères et évite tout texte supplémentaire.";

export interface ClarityPromptStepPayload {
  instruction: string;
  model: ModelChoice;
  verbosity: VerbosityChoice;
  thinking: ThinkingChoice;
  developerMessage: string;
  exposeSettings: boolean;
  exposeDeveloperMessage: boolean;
}

export interface ClarityPromptStepConfig {
  promptLabel?: string;
  promptPlaceholder?: string;
  defaultModel?: ModelChoice;
  defaultVerbosity?: VerbosityChoice;
  defaultThinking?: ThinkingChoice;
  defaultDeveloperMessage?: string;
  exposeSettings?: boolean;
  exposeDeveloperMessage?: boolean;
  onChange?: (config: ClarityPromptStepConfig) => void;
}

interface NormalizedPromptConfig {
  promptLabel: string;
  promptPlaceholder: string;
  model: ModelChoice;
  verbosity: VerbosityChoice;
  thinking: ThinkingChoice;
  developerMessage: string;
  exposeSettings: boolean;
  exposeDeveloperMessage: boolean;
  onChange?: (config: ClarityPromptStepConfig) => void;
}

function sanitizeConfig(config: unknown): NormalizedPromptConfig {
  if (!config || typeof config !== "object") {
    return {
      promptLabel: "Consigne à transmettre",
      promptPlaceholder: "Décris l'action à effectuer…",
      model: DEFAULT_CLARITY_MODEL,
      verbosity: DEFAULT_CLARITY_VERBOSITY,
      thinking: DEFAULT_CLARITY_THINKING,
      developerMessage: DEFAULT_CLARITY_DEVELOPER_MESSAGE,
      exposeSettings: true,
      exposeDeveloperMessage: false,
    };
  }

  const raw = config as ClarityPromptStepConfig;
  const promptLabel =
    typeof raw.promptLabel === "string" && raw.promptLabel.trim()
      ? raw.promptLabel.trim()
      : "Consigne à transmettre";
  const promptPlaceholder =
    typeof raw.promptPlaceholder === "string" && raw.promptPlaceholder.trim()
      ? raw.promptPlaceholder.trim()
      : "Décris l'action à effectuer…";
  const model =
    typeof raw.defaultModel === "string" && MODEL_VALUES.has(raw.defaultModel as ModelChoice)
      ? (raw.defaultModel as ModelChoice)
      : DEFAULT_CLARITY_MODEL;
  const verbosity =
    typeof raw.defaultVerbosity === "string" &&
    VERBOSITY_VALUES.has(raw.defaultVerbosity as VerbosityChoice)
      ? (raw.defaultVerbosity as VerbosityChoice)
      : DEFAULT_CLARITY_VERBOSITY;
  const thinking =
    typeof raw.defaultThinking === "string" &&
    THINKING_VALUES.has(raw.defaultThinking as ThinkingChoice)
      ? (raw.defaultThinking as ThinkingChoice)
      : DEFAULT_CLARITY_THINKING;
  const developerMessage =
    typeof raw.defaultDeveloperMessage === "string" && raw.defaultDeveloperMessage.trim()
      ? raw.defaultDeveloperMessage
      : DEFAULT_CLARITY_DEVELOPER_MESSAGE;

  return {
    promptLabel,
    promptPlaceholder,
    model,
    verbosity,
    thinking,
    developerMessage,
    exposeSettings: raw.exposeSettings ?? true,
    exposeDeveloperMessage: raw.exposeDeveloperMessage ?? false,
    onChange: raw.onChange,
  };
}

function sanitizePayload(
  payload: unknown,
  config: NormalizedPromptConfig
): ClarityPromptStepPayload {
  if (!payload || typeof payload !== "object") {
    return {
      instruction: "",
      model: config.model,
      verbosity: config.verbosity,
      thinking: config.thinking,
      developerMessage: config.developerMessage,
      exposeSettings: config.exposeSettings,
      exposeDeveloperMessage: config.exposeDeveloperMessage,
    };
  }

  const raw = payload as Partial<ClarityPromptStepPayload> & Record<string, unknown>;

  const model =
    typeof raw.model === "string" && MODEL_VALUES.has(raw.model as ModelChoice)
      ? (raw.model as ModelChoice)
      : config.model;
  const verbosity =
    typeof raw.verbosity === "string" && VERBOSITY_VALUES.has(raw.verbosity as VerbosityChoice)
      ? (raw.verbosity as VerbosityChoice)
      : config.verbosity;
  const thinking =
    typeof raw.thinking === "string" && THINKING_VALUES.has(raw.thinking as ThinkingChoice)
      ? (raw.thinking as ThinkingChoice)
      : config.thinking;
  const developerMessage =
    typeof raw.developerMessage === "string" && raw.developerMessage.trim().length > 0
      ? raw.developerMessage
      : config.developerMessage;

  return {
    instruction: typeof raw.instruction === "string" ? raw.instruction : "",
    model,
    verbosity,
    thinking,
    developerMessage,
    exposeSettings:
      typeof raw.exposeSettings === "boolean" ? raw.exposeSettings : config.exposeSettings,
    exposeDeveloperMessage:
      typeof raw.exposeDeveloperMessage === "boolean"
        ? raw.exposeDeveloperMessage
        : config.exposeDeveloperMessage,
  };
}

export function ClarityPromptStep({
  config,
  payload,
  isEditMode,
  onAdvance,
  onUpdateConfig,
  definition,
}: StepComponentProps): JSX.Element {
  const sequenceContext = useContext(StepSequenceContext);
  const activeStepId = sequenceContext?.steps?.[sequenceContext.stepIndex]?.id;
  const shouldAutoPublish = Boolean(sequenceContext) && activeStepId !== definition.id;

  const normalizedConfig = useMemo(() => sanitizeConfig(config), [config]);
  const sanitizedPayload = useMemo(
    () => sanitizePayload(payload, normalizedConfig),
    [payload, normalizedConfig]
  );

  const [instruction, setInstruction] = useState<string>(sanitizedPayload.instruction);
  const [model, setModel] = useState<ModelChoice>(sanitizedPayload.model);
  const [verbosity, setVerbosity] = useState<VerbosityChoice>(sanitizedPayload.verbosity);
  const [thinking, setThinking] = useState<ThinkingChoice>(sanitizedPayload.thinking);
  const [developerMessage, setDeveloperMessage] = useState<string>(
    sanitizedPayload.developerMessage
  );
  const [exposeSettings, setExposeSettings] = useState<boolean>(sanitizedPayload.exposeSettings);
  const [exposeDeveloperMessage, setExposeDeveloperMessage] = useState<boolean>(
    sanitizedPayload.exposeDeveloperMessage
  );
  const lastPublishedRef = useRef<string | null>(null);

  useEffect(() => {
    setInstruction(sanitizedPayload.instruction);
  }, [sanitizedPayload.instruction]);

  useEffect(() => {
    setModel(sanitizedPayload.model);
  }, [sanitizedPayload.model]);

  useEffect(() => {
    setVerbosity(sanitizedPayload.verbosity);
  }, [sanitizedPayload.verbosity]);

  useEffect(() => {
    setThinking(sanitizedPayload.thinking);
  }, [sanitizedPayload.thinking]);

  useEffect(() => {
    setDeveloperMessage(sanitizedPayload.developerMessage);
  }, [sanitizedPayload.developerMessage]);

  useEffect(() => {
    setExposeSettings(sanitizedPayload.exposeSettings);
  }, [sanitizedPayload.exposeSettings]);

  useEffect(() => {
    setExposeDeveloperMessage(sanitizedPayload.exposeDeveloperMessage);
  }, [sanitizedPayload.exposeDeveloperMessage]);

  const buildPayload = useCallback(
    (overrides?: Partial<ClarityPromptStepPayload>): ClarityPromptStepPayload => {
      const trimmedInstruction = instruction.trim();
      const trimmedDeveloperMessage = developerMessage.trim();
      return {
        instruction: trimmedInstruction,
        model,
        verbosity,
        thinking,
        developerMessage:
          trimmedDeveloperMessage.length > 0
            ? trimmedDeveloperMessage
            : normalizedConfig.developerMessage,
        exposeSettings,
        exposeDeveloperMessage,
        ...overrides,
      };
    },
    [
      developerMessage,
      exposeDeveloperMessage,
      exposeSettings,
      instruction,
      model,
      normalizedConfig.developerMessage,
      thinking,
      verbosity,
    ]
  );

  useEffect(() => {
    if (!shouldAutoPublish) {
      lastPublishedRef.current = null;
      return;
    }

    const payloadToSend = buildPayload();
    const serialized = JSON.stringify(payloadToSend);
    if (lastPublishedRef.current === serialized) {
      return;
    }

    lastPublishedRef.current = serialized;
    onAdvance(payloadToSend);
  }, [buildPayload, onAdvance, shouldAutoPublish]);

  const handleConfigChange = useCallback(
    (patch: Partial<ClarityPromptStepConfig>) => {
      const nextConfig: ClarityPromptStepConfig = {
        promptLabel: patch.promptLabel ?? normalizedConfig.promptLabel,
        promptPlaceholder: patch.promptPlaceholder ?? normalizedConfig.promptPlaceholder,
        defaultModel: patch.defaultModel ?? normalizedConfig.model,
        defaultVerbosity: patch.defaultVerbosity ?? normalizedConfig.verbosity,
        defaultThinking: patch.defaultThinking ?? normalizedConfig.thinking,
        defaultDeveloperMessage:
          patch.defaultDeveloperMessage ?? normalizedConfig.developerMessage,
        exposeSettings: patch.exposeSettings ?? normalizedConfig.exposeSettings,
        exposeDeveloperMessage:
          patch.exposeDeveloperMessage ?? normalizedConfig.exposeDeveloperMessage,
      };

      normalizedConfig.onChange?.(nextConfig);
      onUpdateConfig(nextConfig);
    },
    [normalizedConfig, onUpdateConfig]
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (shouldAutoPublish) {
        return;
      }

      onAdvance(buildPayload());
    },
    [buildPayload, onAdvance, shouldAutoPublish]
  );

  const activeModelOption = useMemo(
    () => MODEL_OPTIONS.find((option) => option.value === model),
    [model]
  );
  const activeVerbosityOption = useMemo(
    () => VERBOSITY_OPTIONS.find((option) => option.value === verbosity),
    [verbosity]
  );
  const activeThinkingOption = useMemo(
    () => THINKING_OPTIONS.find((option) => option.value === thinking),
    [thinking]
  );

  const structuredPreview = useMemo(() => {
    const payloadPreview: Record<string, unknown> = {
      instruction: instruction.trim(),
      model,
      verbosity,
      thinking,
      exposeSettings,
      exposeDeveloperMessage,
    };
    const trimmedMessage = developerMessage.trim();
    const fallbackMessage = normalizedConfig.developerMessage.trim();
    if (trimmedMessage || fallbackMessage) {
      payloadPreview.developerMessage = trimmedMessage || fallbackMessage;
    }
    return JSON.stringify(payloadPreview, null, 2);
  }, [
    developerMessage,
    exposeDeveloperMessage,
    exposeSettings,
    instruction,
    model,
    normalizedConfig.developerMessage,
    thinking,
    verbosity,
  ]);

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {isEditMode && (
        <fieldset className="rounded-2xl border border-dashed border-white/30 bg-[color:var(--brand-charcoal)]/20 p-4 text-sm text-white/80">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-white/70">
            Configuration
          </legend>
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/60">
                Libellé
              </span>
              <input
                type="text"
                value={normalizedConfig.promptLabel}
                onChange={(event) => handleConfigChange({ promptLabel: event.target.value })}
                className="rounded-lg border border-white/40 bg-[color:var(--brand-charcoal)]/40 px-3 py-2 text-sm text-white placeholder:text-white/60 focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/40"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/60">
                Placeholder
              </span>
              <input
                type="text"
                value={normalizedConfig.promptPlaceholder}
                onChange={(event) => handleConfigChange({ promptPlaceholder: event.target.value })}
                className="rounded-lg border border-white/40 bg-[color:var(--brand-charcoal)]/40 px-3 py-2 text-sm text-white placeholder:text-white/60 focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/40"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/60">
                Modèle par défaut
              </span>
              <select
                value={normalizedConfig.model}
                onChange={(event) =>
                  handleConfigChange({ defaultModel: event.target.value as ModelChoice })
                }
                className="rounded-lg border border-white/40 bg-[color:var(--brand-charcoal)]/40 px-3 py-2 text-sm text-white focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/40"
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="text-[color:var(--brand-charcoal)]">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/60">
                Verbosité par défaut
              </span>
              <select
                value={normalizedConfig.verbosity}
                onChange={(event) =>
                  handleConfigChange({
                    defaultVerbosity: event.target.value as VerbosityChoice,
                  })
                }
                className="rounded-lg border border-white/40 bg-[color:var(--brand-charcoal)]/40 px-3 py-2 text-sm text-white focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/40"
              >
                {VERBOSITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="text-[color:var(--brand-charcoal)]">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/60">
                Raisonnement par défaut
              </span>
              <select
                value={normalizedConfig.thinking}
                onChange={(event) =>
                  handleConfigChange({ defaultThinking: event.target.value as ThinkingChoice })
                }
                className="rounded-lg border border-white/40 bg-[color:var(--brand-charcoal)]/40 px-3 py-2 text-sm text-white focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/40"
              >
                {THINKING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="text-[color:var(--brand-charcoal)]">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/60">
                Message développeur par défaut
              </span>
              <textarea
                rows={4}
                value={normalizedConfig.developerMessage}
                onChange={(event) =>
                  handleConfigChange({ defaultDeveloperMessage: event.target.value })
                }
                className="min-h-[120px] rounded-xl border border-white/40 bg-[color:var(--brand-charcoal)]/40 px-3 py-2 text-sm text-white placeholder:text-white/60 focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/40"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={normalizedConfig.exposeSettings}
                onChange={(event) => handleConfigChange({ exposeSettings: event.target.checked })}
                className="h-4 w-4 rounded border-white/50 text-[color:var(--brand-red)] focus:ring-[color:var(--brand-red)]"
              />
              <span className="text-xs font-semibold uppercase tracking-wide text-white/60">
                Afficher la configuration IA
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={normalizedConfig.exposeDeveloperMessage}
                onChange={(event) =>
                  handleConfigChange({ exposeDeveloperMessage: event.target.checked })
                }
                className="h-4 w-4 rounded border-white/50 text-[color:var(--brand-red)] focus:ring-[color:var(--brand-red)]"
              />
              <span className="text-xs font-semibold uppercase tracking-wide text-white/60">
                Montrer le message développeur
              </span>
            </label>
          </div>
          <div className="mt-4 rounded-xl border border-white/30 bg-black/30 p-4 text-xs">
            <div className="flex items-center justify-between gap-3 text-white/70">
              <span className="font-semibold uppercase tracking-wide">Payload partagé</span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                Lecture seule
              </span>
            </div>
            <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 text-[11px] leading-relaxed text-white/80">
              {structuredPreview}
            </pre>
          </div>
        </fieldset>
      )}

      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-white/90">{normalizedConfig.promptLabel}</span>
        <textarea
          required
          rows={4}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={normalizedConfig.promptPlaceholder}
          className="min-h-[120px] rounded-2xl border border-white/30 bg-[color:var(--brand-charcoal)]/40 px-4 py-3 text-base text-white shadow-sm placeholder:text-white/60 focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/40"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-white/70">
            Modèle
          </span>
          <select
            value={model}
            onChange={(event) => setModel(event.target.value as ModelChoice)}
            className="rounded-xl border border-white/30 bg-[color:var(--brand-charcoal)]/40 px-3 py-2 text-sm text-white focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/40"
          >
            {MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="text-[color:var(--brand-charcoal)]">
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-white/70">
            Verbosité
          </span>
          <select
            value={verbosity}
            onChange={(event) => setVerbosity(event.target.value as VerbosityChoice)}
            className="rounded-xl border border-white/30 bg-[color:var(--brand-charcoal)]/40 px-3 py-2 text-sm text-white focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/40"
          >
            {VERBOSITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="text-[color:var(--brand-charcoal)]">
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-white/70">
            Raisonnement
          </span>
          <select
            value={thinking}
            onChange={(event) => setThinking(event.target.value as ThinkingChoice)}
            className="rounded-xl border border-white/30 bg-[color:var(--brand-charcoal)]/40 px-3 py-2 text-sm text-white focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/40"
          >
            {THINKING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="text-[color:var(--brand-charcoal)]">
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-white/70">
          Message développeur transmis au modèle
        </span>
        <textarea
          rows={4}
          value={developerMessage}
          onChange={(event) => setDeveloperMessage(event.target.value)}
          className="min-h-[120px] rounded-2xl border border-white/30 bg-[color:var(--brand-charcoal)]/40 px-4 py-3 text-sm text-white shadow-sm placeholder:text-white/60 focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/40"
        />
      </label>

      {(exposeSettings || exposeDeveloperMessage) && (
        <div className="rounded-2xl border border-white/25 bg-black/30 p-4 text-sm text-white/80 shadow-inner">
          <div className="flex flex-col gap-3">
            {exposeSettings && (
              <dl className="grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-white/50">Modèle</dt>
                  <dd className="mt-1 font-medium text-white/90">
                    {activeModelOption?.label ?? model}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-white/50">Verbosité</dt>
                  <dd className="mt-1 font-medium text-white/90">
                    {activeVerbosityOption?.label ?? verbosity}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-white/50">Raisonnement</dt>
                  <dd className="mt-1 font-medium text-white/90">
                    {activeThinkingOption?.label ?? thinking}
                  </dd>
                </div>
              </dl>
            )}
            {exposeDeveloperMessage && (
              <div>
                <p className="text-xs uppercase tracking-wide text-white/50">
                  Brief développeur visible pour l’apprenant·e
                </p>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 text-xs leading-relaxed text-white/90">
                  {developerMessage.trim() || normalizedConfig.developerMessage}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-white/70">
          {shouldAutoPublish
            ? "Les modifications sont partagées automatiquement dans le module composite."
            : "Clique sur “Envoyer la requête” pour transmettre la consigne au module suivant."}
        </p>
        {!shouldAutoPublish && (
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-[color:var(--brand-red)]/30 transition hover:bg-[color:var(--brand-red-dark)]"
          >
            Envoyer la requête
          </button>
        )}
      </div>
    </form>
  );
}
