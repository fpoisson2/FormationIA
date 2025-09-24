import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ClarityGrid,
  GRID_SIZE,
  PlanPreview,
  START_POSITION,
  createRunId,
  formatDuration,
  gridKey,
  useClarityPlanExecution,
} from "../../../clarity";
import type {
  ClientStats,
  GridCoord,
  PlanAction,
} from "../../../clarity";
import { useStepSequence } from "../..";
import type { StepComponentProps } from "../../types";

import type { ClarityMapStepPayload } from "./ClarityMapStep";

export interface ClarityControlStepPayload {
  runId: string;
  instruction: string;
  plan: PlanAction[];
  notes: string;
  stats: ClientStats | null;
  trail: GridCoord[];
}

export interface ClarityControlStepConfig {
  mapStepId: string;
  prompt?: string;
  instructionLabel?: string;
  instructionPlaceholder?: string;
  successMessage?: string;
  blockedMessage?: string;
  onChange?: (config: ClarityControlStepConfig) => void;
}

interface NormalizedClarityControlConfig {
  mapStepId: string;
  prompt: string;
  instructionLabel: string;
  instructionPlaceholder: string;
  successMessage: string;
  blockedMessage: string;
  onChange?: (config: ClarityControlStepConfig) => void;
}

function clampToGrid(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(GRID_SIZE - 1, Math.round(value)));
}

function sanitizeGridCoord(value: unknown): GridCoord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as { x?: unknown; y?: unknown };
  if (typeof source.x !== "number" || typeof source.y !== "number") {
    return null;
  }
  return { x: clampToGrid(source.x), y: clampToGrid(source.y) };
}

function sanitizeMapPayload(payload: unknown): ClarityMapStepPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const source = payload as Partial<ClarityMapStepPayload>;
  const runId = typeof source.runId === "string" && source.runId.trim() ? source.runId : createRunId();
  const target = sanitizeGridCoord(source.target);
  if (!target) {
    return null;
  }
  const blocked = Array.isArray(source.blocked)
    ? source.blocked
        .map(sanitizeGridCoord)
        .filter((coord): coord is GridCoord => Boolean(coord))
        .filter((coord, index, list) =>
          (coord.x !== START_POSITION.x || coord.y !== START_POSITION.y) &&
          (coord.x !== target.x || coord.y !== target.y) &&
          list.findIndex((candidate) => candidate?.x === coord.x && candidate?.y === coord.y) === index
        )
    : [];
  const instruction =
    typeof source.instruction === "string" && source.instruction.trim()
      ? source.instruction.trim()
      : undefined;
  return { runId, target, blocked, instruction };
}

function sanitizeControlConfig(config: unknown): NormalizedClarityControlConfig {
  if (!config || typeof config !== "object") {
    return {
      mapStepId: "",
      prompt: "Formule une consigne précise pour guider le modèle.",
      instructionLabel: "Consigne à transmettre",
      instructionPlaceholder: "Exemple : Avance de 3 cases vers la droite puis 2 vers le bas.",
      successMessage: "🎉 Le plan atteint l’objectif !",
      blockedMessage: "Le plan n'a pas atteint l'objectif. Précise directions et distances.",
    };
  }
  const raw = config as ClarityControlStepConfig;
  const mapStepId = typeof raw.mapStepId === "string" ? raw.mapStepId : "";
  const prompt =
    typeof raw.prompt === "string" && raw.prompt.trim()
      ? raw.prompt.trim()
      : "Formule une consigne précise pour guider le modèle.";
  const instructionLabel =
    typeof raw.instructionLabel === "string" && raw.instructionLabel.trim()
      ? raw.instructionLabel.trim()
      : "Consigne à transmettre";
  const instructionPlaceholder =
    typeof raw.instructionPlaceholder === "string" && raw.instructionPlaceholder.trim()
      ? raw.instructionPlaceholder.trim()
      : "Exemple : Avance de 3 cases vers la droite puis 2 vers le bas.";
  const successMessage =
    typeof raw.successMessage === "string" && raw.successMessage.trim()
      ? raw.successMessage.trim()
      : "🎉 Le plan atteint l’objectif !";
  const blockedMessage =
    typeof raw.blockedMessage === "string" && raw.blockedMessage.trim()
      ? raw.blockedMessage.trim()
      : "Le plan n'a pas atteint l'objectif. Précise directions et distances.";
  return {
    mapStepId,
    prompt,
    instructionLabel,
    instructionPlaceholder,
    successMessage,
    blockedMessage,
    onChange: raw.onChange,
  };
}

export function ClarityControlStep({
  config,
  payload,
  isEditMode,
  onAdvance,
  onUpdateConfig,
}: StepComponentProps): JSX.Element {
  const normalizedConfig = useMemo(() => sanitizeControlConfig(config), [config]);
  const { payloads } = useStepSequence();
  const mapPayload = useMemo(() => {
    if (!normalizedConfig.mapStepId) {
      return null;
    }
    return sanitizeMapPayload(payloads?.[normalizedConfig.mapStepId]);
  }, [normalizedConfig.mapStepId, payloads]);

  const initialInstruction = useMemo(() => {
    if (typeof payload === "object" && payload && "instruction" in (payload as Record<string, unknown>)) {
      const instructionValue = (payload as { instruction?: unknown }).instruction;
      if (typeof instructionValue === "string") {
        return instructionValue;
      }
    }
    return mapPayload?.instruction ?? "";
  }, [mapPayload, payload]);

  const [instruction, setInstruction] = useState(initialInstruction);
  const [localMessage, setLocalMessage] = useState("");

  useEffect(() => {
    setInstruction(initialInstruction);
  }, [initialInstruction]);

  const { execute, status, isLoading, message, plan, notes, stats, trail } = useClarityPlanExecution();

  const visited = useMemo(() => {
    const set = new Set<string>();
    (trail.length ? trail : [START_POSITION]).forEach((coord) => {
      set.add(gridKey(coord));
    });
    return set;
  }, [trail]);

  const playerPosition = trail.length ? trail[trail.length - 1] : START_POSITION;

  const feedbackMessage = useMemo(() => {
    const baseMessage = message || localMessage;
    if (status === "success") {
      return normalizedConfig.successMessage || baseMessage;
    }
    if (status === "blocked") {
      return normalizedConfig.blockedMessage || baseMessage;
    }
    return baseMessage;
  }, [localMessage, message, normalizedConfig.blockedMessage, normalizedConfig.successMessage, status]);

  const handleConfigChange = useCallback(
    (next: ClarityControlStepConfig) => {
      normalizedConfig.onChange?.(next);
      onUpdateConfig(next);
    },
    [normalizedConfig, onUpdateConfig]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setLocalMessage("");
      if (!mapPayload) {
        setLocalMessage("Configure la carte avant de lancer l’IA.");
        return;
      }
      const trimmed = instruction.trim();
      if (!trimmed) {
        setLocalMessage("Indique une consigne détaillée (directions et nombres de cases).");
        return;
      }
      try {
        const outcome = await execute({
          instruction: trimmed,
          goal: mapPayload.target,
          blocked: mapPayload.blocked,
          runId: mapPayload.runId,
          start: START_POSITION,
        });
        onAdvance({
          runId: mapPayload.runId,
          instruction: trimmed,
          plan: outcome.plan,
          notes: outcome.notes,
          stats: outcome.stats,
          trail: outcome.trail,
        });
      } catch (error) {
        setLocalMessage((error as Error).message || "Impossible d’exécuter la consigne.");
      }
    },
    [execute, instruction, mapPayload, onAdvance]
  );

  const statsSummary = useMemo(() => {
    if (!stats) {
      return null;
    }
    return [
      { label: "Tentatives", value: stats.attempts },
      { label: "Pas effectués", value: stats.stepsExecuted },
      { label: "Chemin optimal", value: stats.optimalPathLength ?? "–" },
      {
        label: "Surcoût",
        value:
          typeof stats.surcout === "number" ? `${stats.surcout > 0 ? "+" : ""}${stats.surcout}` : "–",
      },
      { label: "Durée", value: formatDuration(stats.durationMs) },
      { label: "Succès", value: stats.success ? "Oui" : "Non" },
    ];
  }, [stats]);

  return (
    <div className="space-y-6">
      {isEditMode && (
        <fieldset className="rounded-2xl border border-dashed border-white/40 bg-white/40 p-4 text-sm text-[color:var(--brand-charcoal)]">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
            Configuration
          </legend>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Étape carte
              </span>
              <input
                type="text"
                value={normalizedConfig.mapStepId}
                onChange={(event) =>
                  handleConfigChange({ ...normalizedConfig, mapStepId: event.target.value.trim() })
                }
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Prompt affiché
              </span>
              <textarea
                value={normalizedConfig.prompt}
                onChange={(event) =>
                  handleConfigChange({ ...normalizedConfig, prompt: event.target.value })
                }
                rows={3}
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Message succès
              </span>
              <input
                type="text"
                value={normalizedConfig.successMessage}
                onChange={(event) =>
                  handleConfigChange({ ...normalizedConfig, successMessage: event.target.value })
                }
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Message blocage
              </span>
              <input
                type="text"
                value={normalizedConfig.blockedMessage}
                onChange={(event) =>
                  handleConfigChange({ ...normalizedConfig, blockedMessage: event.target.value })
                }
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              />
            </label>
          </div>
        </fieldset>
      )}

      {!mapPayload ? (
        <div className="rounded-2xl border border-white/60 bg-white/70 p-6 text-sm text-[color:var(--brand-charcoal)]">
          Sélectionne une étape carte valide pour lancer cette séquence.
        </div>
      ) : (
        <form className="space-y-6" onSubmit={handleSubmit}>
          <p className="rounded-2xl bg-white/70 p-4 text-sm text-[color:var(--brand-charcoal)]">
            {normalizedConfig.prompt}
          </p>

          <div className="space-y-3">
            <ClarityGrid
              player={playerPosition}
              target={mapPayload.target}
              blocked={mapPayload.blocked}
              visited={visited}
            />
            {feedbackMessage && (
              <div className="rounded-2xl bg-[color:var(--brand-yellow)]/30 p-3 text-sm text-[color:var(--brand-charcoal)]">
                {feedbackMessage}
              </div>
            )}
          </div>

          <label className="flex flex-col gap-2 text-sm text-[color:var(--brand-charcoal)]">
            <span className="font-semibold text-[color:var(--brand-black)]">
              {normalizedConfig.instructionLabel}
            </span>
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={normalizedConfig.instructionPlaceholder}
              rows={5}
              disabled={isLoading}
              className="rounded-2xl border border-white/60 bg-white/80 px-4 py-3 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
            />
          </label>

          <div className="flex justify-end">
            <button type="submit" className="cta-button cta-button--primary" disabled={isLoading}>
              {isLoading ? "Exécution…" : "Lancer le plan"}
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <PlanPreview plan={plan} notes={notes} />
            {statsSummary ? (
              <div className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-[color:var(--brand-black)]">Statistiques</h3>
                <ul className="mt-4 space-y-2 text-sm text-[color:var(--brand-charcoal)]">
                  {statsSummary.map((item) => (
                    <li key={item.label} className="flex justify-between">
                      <span>{item.label}</span>
                      <span className="font-semibold text-[color:var(--brand-black)]">{item.value}</span>
                    </li>
                  ))}
                </ul>
                {stats?.ambiguity && (
                  <p className="mt-3 rounded-xl bg-[color:var(--brand-yellow)]/30 p-3 text-xs text-[color:var(--brand-charcoal)]">
                    Ambiguïté détectée : {stats.ambiguity}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-white/60 bg-white/50 p-6 text-sm text-[color:var(--brand-charcoal)]/70">
                Les statistiques seront affichées après l’exécution.
              </div>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
