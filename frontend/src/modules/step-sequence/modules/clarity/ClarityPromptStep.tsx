import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { StepComponentProps } from "../../types";
import { StepSequenceContext } from "../../types";

export interface ClarityPromptStepPayload {
  instruction: string;
  triggerId?: string;
  model?: string;
  verbosity?: "low" | "medium" | "high";
  thinking?: "minimal" | "medium" | "high";
  developerPrompt?: string;
}

export interface ClarityPromptStepConfig {
  promptLabel?: string;
  promptPlaceholder?: string;
  model?: string;
  verbosity?: "low" | "medium" | "high";
  thinking?: "minimal" | "medium" | "high";
  developerPrompt?: string;
  settingsMode?: "hidden" | "read-only" | "editable";
  helperTextEnabled?: boolean;
  autoPublishHelperText?: string;
  manualPublishHelperText?: string;
  onChange?: (config: ClarityPromptStepConfig) => void;
}

interface NormalizedPromptConfig {
  promptLabel: string;
  promptPlaceholder: string;
  model: string;
  verbosity: "low" | "medium" | "high";
  thinking: "minimal" | "medium" | "high";
  developerPrompt: string;
  settingsMode: "hidden" | "read-only" | "editable";
  helperTextEnabled: boolean;
  autoPublishHelperText: string;
  manualPublishHelperText: string;
  onChange?: (config: ClarityPromptStepConfig) => void;
}

function sanitizeConfig(config: unknown): NormalizedPromptConfig {
  if (!config || typeof config !== "object") {
    return {
      promptLabel: "Consigne à transmettre",
      promptPlaceholder: "Décris l'action à effectuer…",
      model: "gpt-5-mini",
      verbosity: "medium",
      thinking: "medium",
      developerPrompt: "",
      settingsMode: "hidden",
      helperTextEnabled: true,
      autoPublishHelperText: "Clique sur \"Lancer la consigne\" pour envoyer le prompt au module carte.",
      manualPublishHelperText: "Clique sur \"Continuer\" pour transmettre la consigne au module suivant.",
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

  const model = typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : "gpt-5-mini";

  const verbosity = raw.verbosity === "low" || raw.verbosity === "medium" || raw.verbosity === "high"
    ? raw.verbosity
    : "medium";

  const thinking = raw.thinking === "minimal" || raw.thinking === "medium" || raw.thinking === "high"
    ? raw.thinking
    : "medium";

  const developerPrompt = typeof raw.developerPrompt === "string" ? raw.developerPrompt : "";

  const settingsMode =
    raw.settingsMode === "hidden" || raw.settingsMode === "read-only" || raw.settingsMode === "editable"
      ? raw.settingsMode
      : "hidden";
  const helperTextEnabled = raw.helperTextEnabled !== false;
  const autoPublishHelperText =
    typeof raw.autoPublishHelperText === "string" && raw.autoPublishHelperText.trim()
      ? raw.autoPublishHelperText.trim()
      : "Clique sur \"Lancer la consigne\" pour envoyer le prompt au module carte.";
  const manualPublishHelperText =
    typeof raw.manualPublishHelperText === "string" && raw.manualPublishHelperText.trim()
      ? raw.manualPublishHelperText.trim()
      : "Clique sur \"Continuer\" pour transmettre la consigne au module suivant.";

  return {
    promptLabel,
    promptPlaceholder,
    model,
    verbosity,
    thinking,
    developerPrompt,
    settingsMode,
    helperTextEnabled,
    autoPublishHelperText,
    manualPublishHelperText,
    onChange: raw.onChange,
  };
}

function sanitizePayload(payload: unknown): ClarityPromptStepPayload {
  if (!payload || typeof payload !== "object") {
    return { instruction: "" };
  }

  const raw = payload as Partial<ClarityPromptStepPayload>;
  const instruction = typeof raw.instruction === "string" ? raw.instruction : "";
  const triggerId = typeof raw.triggerId === "string" && raw.triggerId.trim() ? raw.triggerId.trim() : undefined;
  const model = typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : undefined;
  const verbosity =
    raw.verbosity === "low" || raw.verbosity === "medium" || raw.verbosity === "high"
      ? raw.verbosity
      : undefined;
  const thinking =
    raw.thinking === "minimal" || raw.thinking === "medium" || raw.thinking === "high"
      ? raw.thinking
      : undefined;
  const developerPrompt = typeof raw.developerPrompt === "string" ? raw.developerPrompt : undefined;

  return { instruction, triggerId, model, verbosity, thinking, developerPrompt };
}

function generateTriggerId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Ignore environments without crypto support.
  }
  return `trigger-${Math.random().toString(36).slice(2, 12)}`;
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
  const sanitizedPayload = useMemo(() => sanitizePayload(payload), [payload]);

  const [instruction, setInstruction] = useState<string>(sanitizedPayload.instruction);
  const [triggerId, setTriggerId] = useState<string | undefined>(sanitizedPayload.triggerId);
  const [model, setModel] = useState<string>(sanitizedPayload.model ?? normalizedConfig.model);
  const [verbosity, setVerbosity] = useState<"low" | "medium" | "high">(
    sanitizedPayload.verbosity ?? normalizedConfig.verbosity
  );
  const [thinking, setThinking] = useState<"minimal" | "medium" | "high">(
    sanitizedPayload.thinking ?? normalizedConfig.thinking
  );
  const [developerPrompt, setDeveloperPrompt] = useState<string>(
    sanitizedPayload.developerPrompt ?? normalizedConfig.developerPrompt
  );
  const [settingsMode, setSettingsMode] = useState<"hidden" | "read-only" | "editable">(
    normalizedConfig.settingsMode
  );
  const lastPublishedRef = useRef<string | null>(null);

  useEffect(() => {
    setInstruction(sanitizedPayload.instruction);
    setTriggerId(sanitizedPayload.triggerId);
    setModel(sanitizedPayload.model ?? normalizedConfig.model);
    setVerbosity(sanitizedPayload.verbosity ?? normalizedConfig.verbosity);
    setThinking(sanitizedPayload.thinking ?? normalizedConfig.thinking);
    setDeveloperPrompt(sanitizedPayload.developerPrompt ?? normalizedConfig.developerPrompt);
    setSettingsMode(normalizedConfig.settingsMode);
  }, [
    normalizedConfig.developerPrompt,
    normalizedConfig.model,
    normalizedConfig.thinking,
    normalizedConfig.verbosity,
    normalizedConfig.settingsMode,
    sanitizedPayload.developerPrompt,
    sanitizedPayload.instruction,
    sanitizedPayload.model,
    sanitizedPayload.thinking,
    sanitizedPayload.triggerId,
    sanitizedPayload.verbosity,
  ]);

  const publishPayload = useCallback(
    (payload: ClarityPromptStepPayload) => {
      const normalized = {
        instruction: payload.instruction,
        triggerId: payload.triggerId ?? null,
        model: payload.model ?? null,
        verbosity: payload.verbosity ?? null,
        thinking: payload.thinking ?? null,
        developerPrompt: payload.developerPrompt ?? null,
      };
      const serialized = JSON.stringify(normalized);
      if (lastPublishedRef.current === serialized) {
        return;
      }

      lastPublishedRef.current = serialized;
      onAdvance(payload);
    },
    [onAdvance]
  );

  useEffect(() => {
    if (!shouldAutoPublish) {
      lastPublishedRef.current = null;
      return;
    }

    const trimmed = instruction.trim();
    publishPayload({
      instruction: trimmed,
      triggerId,
      model,
      verbosity,
      thinking,
      developerPrompt,
    });
  }, [
    developerPrompt,
    instruction,
    model,
    publishPayload,
    shouldAutoPublish,
    thinking,
    triggerId,
    verbosity,
  ]);

  const handleConfigChange = useCallback(
    (patch: Partial<ClarityPromptStepConfig>) => {
      const nextConfig: ClarityPromptStepConfig = {
        promptLabel: patch.promptLabel ?? normalizedConfig.promptLabel,
        promptPlaceholder: patch.promptPlaceholder ?? normalizedConfig.promptPlaceholder,
        model: patch.model ?? model,
        verbosity: patch.verbosity ?? verbosity,
        thinking: patch.thinking ?? thinking,
        developerPrompt: patch.developerPrompt ?? developerPrompt,
        settingsMode: patch.settingsMode ?? settingsMode,
        helperTextEnabled:
          typeof patch.helperTextEnabled === "boolean"
            ? patch.helperTextEnabled
            : normalizedConfig.helperTextEnabled,
        autoPublishHelperText:
          typeof patch.autoPublishHelperText === "string"
            ? patch.autoPublishHelperText
            : normalizedConfig.autoPublishHelperText,
        manualPublishHelperText:
          typeof patch.manualPublishHelperText === "string"
            ? patch.manualPublishHelperText
            : normalizedConfig.manualPublishHelperText,
      };

      normalizedConfig.onChange?.(nextConfig);
      onUpdateConfig(nextConfig);

      if (typeof patch.model === "string") {
        setModel(patch.model);
      }
      if (patch.verbosity) {
        setVerbosity(patch.verbosity as "low" | "medium" | "high");
      }
      if (patch.thinking) {
        setThinking(patch.thinking as "minimal" | "medium" | "high");
      }
      if (typeof patch.developerPrompt === "string") {
        setDeveloperPrompt(patch.developerPrompt);
      }
      if (patch.settingsMode) {
        setSettingsMode(patch.settingsMode as "hidden" | "read-only" | "editable");
      }
    },
    [developerPrompt, model, normalizedConfig, onUpdateConfig, settingsMode, thinking, verbosity]
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (shouldAutoPublish) {
        return;
      }

      const trimmed = instruction.trim();
      if (!trimmed) {
        return;
      }

      publishPayload({
        instruction: trimmed,
        triggerId,
        model,
        verbosity,
        thinking,
        developerPrompt,
      });
    },
    [
      developerPrompt,
      instruction,
      model,
      publishPayload,
      shouldAutoPublish,
      thinking,
      triggerId,
      verbosity,
    ]
  );

  const handleExecute = useCallback(() => {
    if (!shouldAutoPublish) {
      return;
    }
    const trimmed = instruction.trim();
    if (!trimmed) {
      return;
    }
    const nextTriggerId = generateTriggerId();
    setTriggerId(nextTriggerId);
    publishPayload({
      instruction: trimmed,
      triggerId: nextTriggerId,
      model,
      verbosity,
      thinking,
      developerPrompt,
    });
  }, [
    developerPrompt,
    instruction,
    model,
    publishPayload,
    shouldAutoPublish,
    thinking,
    verbosity,
  ]);

  const trimmedInstruction = instruction.trim();
  const buttonDisabled = !trimmedInstruction;
  const helperText = shouldAutoPublish
    ? normalizedConfig.autoPublishHelperText
    : normalizedConfig.manualPublishHelperText;
  const shouldShowHelperText = normalizedConfig.helperTextEnabled && helperText.trim().length > 0;

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {isEditMode && (
        <fieldset className="rounded-2xl border border-dashed border-white/40 bg-white/40 p-4 text-sm text-[color:var(--brand-charcoal)]">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
            Configuration
          </legend>
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Libellé
              </span>
              <input
                type="text"
                value={normalizedConfig.promptLabel}
                onChange={(event) => handleConfigChange({ promptLabel: event.target.value })}
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Placeholder
              </span>
              <input
                type="text"
                value={normalizedConfig.promptPlaceholder}
                onChange={(event) => handleConfigChange({ promptPlaceholder: event.target.value })}
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Modèle par défaut
              </span>
              <select
                value={model}
                onChange={(event) => handleConfigChange({ model: event.target.value })}
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              >
                <option value="gpt-5-nano">gpt-5-nano</option>
                <option value="gpt-5-mini">gpt-5-mini</option>
                <option value="gpt-5">gpt-5</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Verbosité par défaut
              </span>
              <select
                value={verbosity}
                onChange={(event) =>
                  handleConfigChange({ verbosity: event.target.value as "low" | "medium" | "high" })
                }
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              >
                <option value="low">Faible</option>
                <option value="medium">Moyenne</option>
                <option value="high">Élevée</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Raisonnement par défaut
              </span>
              <select
                value={thinking}
                onChange={(event) =>
                  handleConfigChange({ thinking: event.target.value as "minimal" | "medium" | "high" })
                }
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              >
                <option value="minimal">Minimal</option>
                <option value="medium">Standard</option>
                <option value="high">Approfondi</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Prompt développeur (optionnel)
              </span>
              <textarea
                value={developerPrompt}
                onChange={(event) => handleConfigChange({ developerPrompt: event.target.value })}
                rows={3}
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Affichage des paramètres pour l’utilisateur
              </span>
              <select
                value={settingsMode}
                onChange={(event) =>
                  handleConfigChange({ settingsMode: event.target.value as "hidden" | "read-only" | "editable" })
                }
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              >
                <option value="hidden">Masquer</option>
                <option value="read-only">Afficher en lecture seule</option>
                <option value="editable">Autoriser l’édition</option>
              </select>
            </label>
            <label className="flex items-center gap-2 md:col-span-2">
              <input
                type="checkbox"
                checked={normalizedConfig.helperTextEnabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  handleConfigChange({ helperTextEnabled: event.target.checked })
                }
                className="h-4 w-4 rounded border border-white/60 text-[color:var(--brand-red)] focus:border-[color:var(--brand-red)] focus:outline-none"
              />
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Afficher le texte d’aide sous les boutons
              </span>
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Texte d’aide (mode automatique)
              </span>
              <textarea
                value={normalizedConfig.autoPublishHelperText}
                onChange={(event) => handleConfigChange({ autoPublishHelperText: event.target.value })}
                rows={2}
                disabled={!normalizedConfig.helperTextEnabled}
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Texte d’aide (mode manuel)
              </span>
              <textarea
                value={normalizedConfig.manualPublishHelperText}
                onChange={(event) => handleConfigChange({ manualPublishHelperText: event.target.value })}
                rows={2}
                disabled={!normalizedConfig.helperTextEnabled}
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          </div>
        </fieldset>
      )}

      <div className="space-y-3">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-[color:var(--brand-black)]">{normalizedConfig.promptLabel}</span>
          <textarea
            required
            rows={4}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={normalizedConfig.promptPlaceholder}
            className="min-h-[120px] rounded-2xl border border-white/60 bg-white px-4 py-3 text-base text-[color:var(--brand-charcoal)] shadow-sm placeholder:text-[color:var(--brand-charcoal)]/50 focus:border-[color:var(--brand-red)] focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          {shouldAutoPublish && (
            <button
              type="button"
              onClick={handleExecute}
              disabled={buttonDisabled}
              className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-[color:var(--brand-red)]/30 transition hover:bg-[color:var(--brand-red-dark)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Lancer la consigne
            </button>
          )}
          {!shouldAutoPublish && (
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-black)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-black/90"
            >
              Continuer
            </button>
          )}
        </div>
      </div>

      {shouldShowHelperText && <p className="text-sm text-[color:var(--brand-charcoal)]">{helperText}</p>}

      {settingsMode !== "hidden" && (
        <div className="rounded-2xl border border-white/40 bg-white/70 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-[color:var(--brand-black)]">Paramètres IA</h3>
          {settingsMode === "editable" ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-[color:var(--brand-charcoal)]">
                Modèle
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  className="rounded-lg border border-white/60 bg-white px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                >
                  <option value="gpt-5-nano">gpt-5-nano</option>
                  <option value="gpt-5-mini">gpt-5-mini</option>
                  <option value="gpt-5">gpt-5</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-[color:var(--brand-charcoal)]">
                Verbosité
                <select
                  value={verbosity}
                  onChange={(event) => setVerbosity(event.target.value as "low" | "medium" | "high")}
                  className="rounded-lg border border-white/60 bg-white px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                >
                  <option value="low">Faible</option>
                  <option value="medium">Moyenne</option>
                  <option value="high">Élevée</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-[color:var(--brand-charcoal)]">
                Raisonnement
                <select
                  value={thinking}
                  onChange={(event) => setThinking(event.target.value as "minimal" | "medium" | "high")}
                  className="rounded-lg border border-white/60 bg-white px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                >
                  <option value="minimal">Minimal</option>
                  <option value="medium">Standard</option>
                  <option value="high">Approfondi</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-[color:var(--brand-charcoal)] md:col-span-2">
                Prompt développeur
                <textarea
                  value={developerPrompt}
                  onChange={(event) => setDeveloperPrompt(event.target.value)}
                  rows={3}
                  className="rounded-lg border border-white/60 bg-white px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                  placeholder="Ex: Ajouter des instructions système spécifiques"
                />
              </label>
            </div>
          ) : (
            <dl className="mt-3 grid gap-2 text-sm text-[color:var(--brand-charcoal)]">
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <dt className="font-semibold text-[color:var(--brand-black)]">Modèle</dt>
                <dd>{model}</dd>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <dt className="font-semibold text-[color:var(--brand-black)]">Verbosité</dt>
                <dd>
                  {verbosity === "low" ? "Faible" : verbosity === "medium" ? "Moyenne" : "Élevée"}
                </dd>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <dt className="font-semibold text-[color:var(--brand-black)]">Raisonnement</dt>
                <dd>
                  {thinking === "minimal" ? "Minimal" : thinking === "medium" ? "Standard" : "Approfondi"}
                </dd>
              </div>
              {developerPrompt && (
                <div className="grid gap-1">
                  <dt className="font-semibold text-[color:var(--brand-black)]">Prompt développeur</dt>
                  <dd className="rounded-xl bg-white/60 px-3 py-2 text-xs text-[color:var(--brand-charcoal)]">
                    {developerPrompt}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}
    </form>
  );
}
