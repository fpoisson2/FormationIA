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
  triggerId?: string;
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
  const instruction = typeof raw.instruction === "string" ? raw.instruction : "";
  const triggerId = typeof raw.triggerId === "string" && raw.triggerId.trim() ? raw.triggerId.trim() : undefined;

  return { instruction, triggerId };
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
  const lastPublishedRef = useRef<string | null>(null);

  useEffect(() => {
    setInstruction(sanitizedPayload.instruction);
    setTriggerId(sanitizedPayload.triggerId);
  }, [sanitizedPayload.instruction, sanitizedPayload.triggerId]);

  const publishPayload = useCallback(
    (payload: ClarityPromptStepPayload) => {
      const normalized = {
        instruction: payload.instruction,
        triggerId: payload.triggerId ?? null,
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
    publishPayload({ instruction: trimmed, triggerId });
  }, [instruction, publishPayload, shouldAutoPublish, triggerId]);

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

      const trimmed = instruction.trim();
      if (!trimmed) {
        return;
      }

      publishPayload({ instruction: trimmed, triggerId });
    },
    [instruction, publishPayload, shouldAutoPublish, triggerId]
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
    publishPayload({ instruction: trimmed, triggerId: nextTriggerId });
  }, [instruction, publishPayload, shouldAutoPublish]);

  const trimmedInstruction = instruction.trim();
  const buttonDisabled = !trimmedInstruction;
  const helperText = shouldAutoPublish
    ? "Clique sur \"Lancer la consigne\" pour envoyer le prompt au module carte."
    : "Clique sur \"Continuer\" pour transmettre la consigne au module suivant.";

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

      <p className="text-sm text-[color:var(--brand-charcoal)]">{helperText}</p>
    </form>
  );
}
