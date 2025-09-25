import {
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
}

export interface ClarityPromptStepConfig {
  promptLabel?: string;
  promptPlaceholder?: string;
  onChange?: (config: ClarityPromptStepConfig) => void;
}

interface NormalizedPromptConfig {
  promptLabel: string;
  promptPlaceholder: string;
  onChange?: (config: ClarityPromptStepConfig) => void;
}

function sanitizeConfig(config: unknown): NormalizedPromptConfig {
  if (!config || typeof config !== "object") {
    return {
      promptLabel: "Consigne à transmettre",
      promptPlaceholder: "Décris l'action à effectuer…",
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

  return {
    promptLabel,
    promptPlaceholder,
    onChange: raw.onChange,
  };
}

function sanitizePayload(payload: unknown): ClarityPromptStepPayload {
  if (!payload || typeof payload !== "object") {
    return { instruction: "" };
  }

  const raw = payload as Partial<ClarityPromptStepPayload>;
  if (typeof raw.instruction !== "string") {
    return { instruction: "" };
  }

  return { instruction: raw.instruction };
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
  const lastPublishedRef = useRef<string | null>(null);

  useEffect(() => {
    setInstruction(sanitizedPayload.instruction);
  }, [sanitizedPayload.instruction]);

  useEffect(() => {
    if (!shouldAutoPublish) {
      lastPublishedRef.current = null;
      return;
    }

    const trimmed = instruction.trim();
    const payloadToSend: ClarityPromptStepPayload = { instruction: trimmed };
    const serialized = JSON.stringify(payloadToSend);
    if (lastPublishedRef.current === serialized) {
      return;
    }

    lastPublishedRef.current = serialized;
    onAdvance(payloadToSend);
  }, [instruction, onAdvance, shouldAutoPublish]);

  const handleConfigChange = useCallback(
    (patch: Partial<ClarityPromptStepConfig>) => {
      const nextConfig: ClarityPromptStepConfig = {
        promptLabel: patch.promptLabel ?? normalizedConfig.promptLabel,
        promptPlaceholder: patch.promptPlaceholder ?? normalizedConfig.promptPlaceholder,
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

      onAdvance({ instruction: instruction.trim() });
    },
    [instruction, onAdvance, shouldAutoPublish]
  );

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
          className="min-h-[120px] rounded-2xl border border-white/30 bg-white/20 px-4 py-3 text-base text-white shadow-sm placeholder:text-white/60 focus:border-[color:var(--brand-red)] focus:outline-none"
        />
      </label>

      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-white/70">
          {shouldAutoPublish
            ? "Les modifications sont partagées automatiquement dans le module composite."
            : "La consigne sera transmise au module suivant lorsque tu continues."}
        </p>
        {!shouldAutoPublish && (
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-[color:var(--brand-red)]/30 transition hover:bg-[color:var(--brand-red-dark)]"
          >
            Soumettre
          </button>
        )}
      </div>
    </form>
  );
}
