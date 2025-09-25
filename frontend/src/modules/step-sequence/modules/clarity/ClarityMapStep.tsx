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

import {
  ClarityGrid,
  GRID_SIZE,
  PlanPreview,
  START_POSITION,
  createRandomObstacles,
  createRandomTarget,
  createRunId,
  gridKey,
  useClarityPlanExecution,
} from "../../../clarity";
import type {
  ClientStats,
  GridCoord,
  PlanAction,
  RunStatus,
} from "../../../clarity";
import type {
  CompositeStepModuleDefinition,
  StepComponentProps,
} from "../../types";
import { StepSequenceContext } from "../../types";

import type { ClarityPromptStepPayload } from "./ClarityPromptStep";

export interface ClarityMapStepPayload {
  runId: string;
  target: GridCoord;
  blocked: GridCoord[];
  instruction?: string;
  plan?: PlanAction[];
  notes?: string;
  stats?: ClientStats | null;
  trail?: GridCoord[];
  status?: RunStatus;
  message?: string;
}

export interface ClarityMapStepConfig {
  obstacleCount?: number;
  initialTarget?: GridCoord | null;
  promptStepId?: string;
  allowInstructionInput?: boolean;
  instructionLabel?: string;
  instructionPlaceholder?: string;
  onChange?: (config: ClarityMapStepConfig) => void;
}

interface NormalizedClarityMapConfig {
  obstacleCount: number;
  initialTarget: GridCoord | null;
  promptStepId: string;
  allowInstructionInput: boolean;
  instructionLabel: string;
  instructionPlaceholder: string;
  onChange?: (config: ClarityMapStepConfig) => void;
}

const MIN_OBSTACLE_COUNT = 0;
const MAX_OBSTACLE_COUNT = 24;
const DEFAULT_OBSTACLE_COUNT = 6;

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

function sanitizeBlocked(value: unknown, target: GridCoord): GridCoord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const obstacles: GridCoord[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const coord = sanitizeGridCoord(item);
    if (!coord) {
      continue;
    }

    const key = gridKey(coord);
    if (
      seen.has(key) ||
      (coord.x === START_POSITION.x && coord.y === START_POSITION.y) ||
      (coord.x === target.x && coord.y === target.y)
    ) {
      continue;
    }

    seen.add(key);
    obstacles.push(coord);
  }

  return obstacles;
}

function sanitizePlanActions(value: unknown): PlanAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const actions: PlanAction[] = [];
  value.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const source = item as { dir?: unknown; steps?: unknown };
    const dir = source.dir;
    const stepsValue = source.steps;
    if (
      (dir === "left" || dir === "right" || dir === "up" || dir === "down") &&
      typeof stepsValue === "number" &&
      Number.isFinite(stepsValue)
    ) {
      actions.push({ dir, steps: Math.max(1, Math.round(stepsValue)) });
    }
  });

  return actions;
}

function sanitizeTrail(value: unknown): GridCoord[] {
  if (!Array.isArray(value)) {
    return [START_POSITION];
  }

  const trail: GridCoord[] = [];
  value.forEach((item) => {
    const coord = sanitizeGridCoord(item);
    if (coord) {
      trail.push(coord);
    }
  });

  if (trail.length === 0) {
    trail.push(START_POSITION);
  }

  return trail;
}

function sanitizeStatsPayload(value: unknown): ClientStats | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Partial<ClientStats>;
  if (
    typeof source.runId !== "string" ||
    typeof source.attempts !== "number" ||
    typeof source.stepsExecuted !== "number" ||
    typeof source.durationMs !== "number"
  ) {
    return null;
  }

  const optimalPathLength =
    typeof source.optimalPathLength === "number" || source.optimalPathLength === null
      ? source.optimalPathLength ?? null
      : null;
  const surcout =
    typeof source.surcout === "number" || source.surcout === null ? source.surcout ?? null : null;

  return {
    runId: source.runId,
    attempts: source.attempts,
    stepsExecuted: source.stepsExecuted,
    optimalPathLength,
    surcout,
    success: Boolean(source.success),
    finalPosition:
      sanitizeGridCoord(source.finalPosition) ?? {
        x: START_POSITION.x,
        y: START_POSITION.y,
      },
    ambiguity: typeof source.ambiguity === "string" ? source.ambiguity : undefined,
    durationMs: source.durationMs,
  };
}

function sanitizeStatus(value: unknown): RunStatus {
  if (
    value === "idle" ||
    value === "running" ||
    value === "success" ||
    value === "blocked" ||
    value === "error"
  ) {
    return value;
  }
  return "idle";
}

function sanitizeMessage(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeConfig(config: unknown): NormalizedClarityMapConfig {
  if (!config || typeof config !== "object") {
    return {
      obstacleCount: DEFAULT_OBSTACLE_COUNT,
      initialTarget: null,
      promptStepId: "",
      allowInstructionInput: false,
      instructionLabel: "Commande transmise",
      instructionPlaceholder: "La consigne reçue s'affichera ici…",
    };
  }

  const raw = config as ClarityMapStepConfig;
  const rawCount = typeof raw.obstacleCount === "number" ? raw.obstacleCount : DEFAULT_OBSTACLE_COUNT;
  const obstacleCount = Math.max(
    MIN_OBSTACLE_COUNT,
    Math.min(MAX_OBSTACLE_COUNT, Math.round(Number.isFinite(rawCount) ? rawCount : DEFAULT_OBSTACLE_COUNT))
  );
  const initialTarget = sanitizeGridCoord(raw.initialTarget ?? null);
  const promptStepId = typeof raw.promptStepId === "string" ? raw.promptStepId.trim() : "";
  const allowInstructionInput = raw.allowInstructionInput === true;
  const instructionLabel =
    typeof raw.instructionLabel === "string" && raw.instructionLabel.trim()
      ? raw.instructionLabel.trim()
      : "Commande transmise";
  const instructionPlaceholder =
    typeof raw.instructionPlaceholder === "string" && raw.instructionPlaceholder.trim()
      ? raw.instructionPlaceholder.trim()
      : "La consigne reçue s'affichera ici…";

  return {
    obstacleCount,
    initialTarget,
    promptStepId,
    allowInstructionInput,
    instructionLabel,
    instructionPlaceholder,
    onChange: raw.onChange,
  };
}

function sanitizePayload(payload: unknown): ClarityMapStepPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const source = payload as Partial<ClarityMapStepPayload>;
  const runId = typeof source.runId === "string" && source.runId.trim() ? source.runId : null;
  const target = sanitizeGridCoord(source.target);
  if (!runId || !target) {
    return null;
  }

  const blocked = sanitizeBlocked(source.blocked, target);
  const instruction =
    typeof source.instruction === "string" && source.instruction.trim() ? source.instruction.trim() : undefined;
  const plan = sanitizePlanActions(source.plan);
  const notes =
    typeof source.notes === "string" && source.notes.trim() ? source.notes.trim() : undefined;
  const stats = sanitizeStatsPayload(source.stats);
  const trail = sanitizeTrail(source.trail);
  const status = sanitizeStatus(source.status);
  const message = sanitizeMessage(source.message);

  return {
    runId,
    target,
    blocked,
    instruction,
    plan: plan.length > 0 ? plan : undefined,
    notes,
    stats,
    trail,
    status,
    message,
  };
}

function sanitizePromptPayload(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Partial<ClarityPromptStepPayload>;
  if (typeof source.instruction !== "string") {
    return null;
  }

  return source.instruction;
}

export function ClarityMapStep({
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
  const sequencePayloads = sequenceContext?.payloads ?? null;
  const compositeModules = sequenceContext?.compositeModules ?? null;

  const detectedPromptStepId = useMemo(() => {
    if (!compositeModules) {
      return "";
    }

    const moduleId = definition.id;
    if (typeof moduleId !== "string" || !moduleId) {
      return "";
    }

    for (const modules of Object.values(compositeModules)) {
      if (!Array.isArray(modules)) {
        continue;
      }
      const isSameComposite = modules.some((module) => module.id === moduleId);
      if (!isSameComposite) {
        continue;
      }

      const promptModule = modules.find(
        (module: CompositeStepModuleDefinition) =>
          module.component === "clarity-prompt" && module.id !== moduleId
      );
      if (promptModule && typeof promptModule.id === "string") {
        return promptModule.id;
      }
    }

    return "";
  }, [compositeModules, definition.id]);

  const normalizedConfig = useMemo(() => sanitizeConfig(config), [config]);
  const mapPayload = useMemo(() => sanitizePayload(payload), [payload]);
  const effectivePromptStepId = normalizedConfig.promptStepId || detectedPromptStepId;
  const promptInstruction = useMemo(() => {
    if (!effectivePromptStepId || !sequencePayloads) {
      return null;
    }
    return sanitizePromptPayload(sequencePayloads[effectivePromptStepId]);
  }, [effectivePromptStepId, sequencePayloads]);
  const defaultTarget = mapPayload?.target ?? normalizedConfig.initialTarget ?? createRandomTarget();
  const [target, setTarget] = useState<GridCoord>(defaultTarget);
  const [blocked, setBlocked] = useState<GridCoord[]>(() => {
    if (mapPayload) {
      return mapPayload.blocked;
    }
    return createRandomObstacles(defaultTarget, normalizedConfig.obstacleCount);
  });
  const [instruction, setInstruction] = useState<string>(mapPayload?.instruction ?? "");
  const [runId, setRunId] = useState<string>(mapPayload?.runId ?? createRunId());
  const lastPublishedRef = useRef<string | null>(null);

  const {
    status: executionStatus,
    isLoading: isExecuting,
    message: executionMessage,
    plan: executionPlan,
    notes: executionNotes,
    stats: executionStats,
    trail: executionTrail,
    execute,
    abort,
  } = useClarityPlanExecution();

  useEffect(() => {
    if (!mapPayload) {
      return;
    }

    setTarget(mapPayload.target);
    setBlocked(mapPayload.blocked);
    setInstruction(mapPayload.instruction ?? "");
    setRunId(mapPayload.runId);
  }, [mapPayload]);

  useEffect(() => {
    if (promptInstruction === null) {
      return;
    }

    setInstruction(promptInstruction);
  }, [promptInstruction]);

  const targetFromConfig = normalizedConfig.initialTarget;
  const obstacleCount = normalizedConfig.obstacleCount;

  useEffect(() => {
    if (mapPayload || !targetFromConfig) {
      return;
    }

    setTarget(targetFromConfig);
    setBlocked(createRandomObstacles(targetFromConfig, obstacleCount));
    setRunId(createRunId());
  }, [mapPayload, targetFromConfig, obstacleCount]);

  useEffect(() => {
    if (mapPayload) {
      return;
    }

    setBlocked((previous) => {
      if (previous.length === obstacleCount) {
        return previous;
      }
      return createRandomObstacles(target, obstacleCount);
    });
  }, [mapPayload, obstacleCount, target]);

  const fallbackPlan = mapPayload?.plan ?? [];
  const fallbackNotes = mapPayload?.notes ?? "";
  const fallbackStats = mapPayload?.stats ?? null;
  const fallbackTrail = mapPayload?.trail ?? [START_POSITION];
  const fallbackStatus = mapPayload?.status ?? "idle";
  const fallbackMessage = mapPayload?.message ?? "";

  const hasLiveOutcome =
    executionStatus !== "idle" ||
    Boolean(executionMessage) ||
    executionPlan.length > 0 ||
    executionTrail.length > 0;

  const effectivePlan = executionPlan.length > 0 ? executionPlan : fallbackPlan;
  const effectiveNotes = executionNotes || fallbackNotes;
  const effectiveStats = executionStats ?? fallbackStats;
  const effectiveTrail = executionTrail.length > 0 ? executionTrail : fallbackTrail;
  const effectiveStatus = hasLiveOutcome ? executionStatus : fallbackStatus;
  const effectiveMessage = hasLiveOutcome && executionMessage ? executionMessage : fallbackMessage;
  const trimmedInstruction = instruction.trim();
  const playerPosition =
    effectiveTrail.length > 0 ? effectiveTrail[effectiveTrail.length - 1] : START_POSITION;
  const visited = useMemo(() => {
    const cells = new Set<string>();
    effectiveTrail.forEach((cell) => cells.add(gridKey(cell)));
    return cells;
  }, [effectiveTrail]);
  const messageToneClass = useMemo(() => {
    switch (effectiveStatus) {
      case "success":
        return "text-emerald-600";
      case "blocked":
      case "error":
        return "text-[color:var(--brand-red)]";
      default:
        return "text-[color:var(--brand-charcoal)]";
    }
  }, [effectiveStatus]);

  const blockedSignature = useMemo(
    () => blocked.map((cell) => gridKey(cell)).sort().join("|"),
    [blocked]
  );

  useEffect(() => {
    abort();
  }, [abort, blockedSignature, target.x, target.y]);

  const applyConfigPatch = useCallback(
    (patch: Partial<ClarityMapStepConfig>) => {
      const nextConfig: ClarityMapStepConfig = {
        obstacleCount: patch.obstacleCount ?? normalizedConfig.obstacleCount,
        initialTarget: patch.initialTarget ?? normalizedConfig.initialTarget,
        promptStepId: patch.promptStepId ?? normalizedConfig.promptStepId,
        allowInstructionInput:
          typeof patch.allowInstructionInput === "boolean"
            ? patch.allowInstructionInput
            : normalizedConfig.allowInstructionInput,
        instructionLabel: patch.instructionLabel ?? normalizedConfig.instructionLabel,
        instructionPlaceholder: patch.instructionPlaceholder ?? normalizedConfig.instructionPlaceholder,
      };

      normalizedConfig.onChange?.(nextConfig);
      onUpdateConfig(nextConfig);
    },
    [normalizedConfig, onUpdateConfig]
  );

  const handleObstacleCountChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextCount = Math.max(
        MIN_OBSTACLE_COUNT,
        Math.min(MAX_OBSTACLE_COUNT, Math.round(Number.parseInt(event.target.value, 10) || 0))
      );

      applyConfigPatch({ obstacleCount: nextCount });
    },
    [applyConfigPatch]
  );

  const handleTargetFieldChange = useCallback(
    (axis: "x" | "y") =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const value = clampToGrid(Number.parseInt(event.target.value, 10) || 0);
        const nextTarget = { ...(normalizedConfig.initialTarget ?? START_POSITION), [axis]: value };
        applyConfigPatch({ initialTarget: nextTarget });
      },
    [applyConfigPatch, normalizedConfig]
  );

  const handlePromptIdChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      applyConfigPatch({ promptStepId: event.target.value });
    },
    [applyConfigPatch]
  );

  const handleAllowInputToggle = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      applyConfigPatch({ allowInstructionInput: event.target.checked });
    },
    [applyConfigPatch]
  );

  const handleShuffleTarget = useCallback(() => {
    setTarget((previous) => {
      const next = createRandomTarget(previous);
      setBlocked(createRandomObstacles(next, obstacleCount));
      setRunId(createRunId());
      return next;
    });
  }, [obstacleCount]);

  const handleShuffleObstacles = useCallback(() => {
    setBlocked(createRandomObstacles(target, obstacleCount));
    setRunId(createRunId());
  }, [obstacleCount, target]);

  const handleExecute = useCallback(async () => {
    try {
      await execute({
        instruction: trimmedInstruction,
        goal: target,
        blocked,
        runId,
        start: START_POSITION,
      });
    } catch {
      // The hook exposes validation feedback via its own message state.
    }
  }, [blocked, execute, runId, target, trimmedInstruction]);

  const handleAbort = useCallback(() => {
    abort();
  }, [abort]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (shouldAutoPublish) {
        return;
      }

      const payloadToSend: ClarityMapStepPayload = {
        runId,
        target,
        blocked,
        instruction: trimmedInstruction ? trimmedInstruction : undefined,
        plan: effectivePlan.length > 0 ? effectivePlan : undefined,
        notes: effectiveNotes ? effectiveNotes : undefined,
        stats: effectiveStats ?? undefined,
        trail: effectiveTrail,
        status: effectiveStatus,
        message: effectiveMessage ? effectiveMessage : undefined,
      };

      onAdvance(payloadToSend);
    },
    [
      blocked,
      effectiveMessage,
      effectiveNotes,
      effectivePlan,
      effectiveStatus,
      effectiveStats,
      effectiveTrail,
      onAdvance,
      runId,
      shouldAutoPublish,
      target,
      trimmedInstruction,
    ]
  );

  useEffect(() => {
    if (!shouldAutoPublish) {
      lastPublishedRef.current = null;
      return;
    }

    const payloadToSend: ClarityMapStepPayload = {
      runId,
      target,
      blocked,
      instruction: trimmedInstruction ? trimmedInstruction : undefined,
      plan: effectivePlan.length > 0 ? effectivePlan : undefined,
      notes: effectiveNotes ? effectiveNotes : undefined,
      stats: effectiveStats ?? undefined,
      trail: effectiveTrail,
      status: effectiveStatus,
      message: effectiveMessage ? effectiveMessage : undefined,
    };
    const serialized = JSON.stringify(payloadToSend);
    if (lastPublishedRef.current === serialized) {
      return;
    }

    lastPublishedRef.current = serialized;
    onAdvance(payloadToSend);
  }, [
    blocked,
    effectiveMessage,
    effectiveNotes,
    effectivePlan,
    effectiveStatus,
    effectiveStats,
    effectiveTrail,
    onAdvance,
    runId,
    shouldAutoPublish,
    target,
    trimmedInstruction,
  ]);

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
                Obstacles
              </span>
              <input
                type="number"
                min={MIN_OBSTACLE_COUNT}
                max={MAX_OBSTACLE_COUNT}
                value={obstacleCount}
                onChange={handleObstacleCountChange}
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Étape prompt liée
              </span>
              <input
                type="text"
                value={normalizedConfig.promptStepId}
                onChange={handlePromptIdChange}
                placeholder="ID du module prompt"
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              />
              <span className="text-xs text-[color:var(--brand-charcoal)]/70">
                Laisse vide pour relier automatiquement le module prompt du composite.
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                  Cible X
                </span>
                <input
                  type="number"
                  min={0}
                  max={GRID_SIZE - 1}
                  value={targetFromConfig ? targetFromConfig.x : ""}
                  onChange={handleTargetFieldChange("x")}
                  placeholder="auto"
                  className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                  Cible Y
                </span>
                <input
                  type="number"
                  min={0}
                  max={GRID_SIZE - 1}
                  value={targetFromConfig ? targetFromConfig.y : ""}
                  onChange={handleTargetFieldChange("y")}
                  placeholder="auto"
                  className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                />
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={normalizedConfig.allowInstructionInput}
                onChange={handleAllowInputToggle}
                className="h-4 w-4 rounded border-white/60 text-[color:var(--brand-red)] focus:ring-[color:var(--brand-red)]"
              />
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Autoriser la saisie manuelle
              </span>
            </label>
          </div>
        </fieldset>
      )}

      <div className="grid gap-6 lg:grid-cols-[3fr,2fr]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/40 bg-white/30 p-4 shadow-inner backdrop-blur">
            <ClarityGrid player={playerPosition} target={target} blocked={blocked} visited={visited} />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleShuffleTarget}
              className="inline-flex items-center justify-center rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-[color:var(--brand-red)] shadow-sm transition hover:bg-white"
            >
              Nouvelle cible
            </button>
            <button
              type="button"
              onClick={handleShuffleObstacles}
              className="inline-flex items-center justify-center rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-[color:var(--brand-red)] shadow-sm transition hover:bg-white"
            >
              Mélanger les obstacles
            </button>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-[color:var(--brand-black)]">
                {normalizedConfig.instructionLabel}
              </span>
              <textarea
                rows={6}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder={normalizedConfig.instructionPlaceholder}
                readOnly={!normalizedConfig.allowInstructionInput && promptInstruction !== null}
                className={`min-h-[160px] rounded-2xl border border-white/60 px-4 py-3 text-base text-[color:var(--brand-charcoal)] shadow-sm placeholder:text-[color:var(--brand-charcoal)]/50 focus:border-[color:var(--brand-red)] focus:outline-none ${
                  !normalizedConfig.allowInstructionInput && promptInstruction !== null
                    ? "bg-white/70 text-[color:var(--brand-charcoal)]/80"
                    : "bg-white"
                }`}
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleExecute}
                disabled={isExecuting || !trimmedInstruction}
                className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-[color:var(--brand-red)]/30 transition hover:bg-[color:var(--brand-red-dark)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isExecuting ? "Exécution en cours…" : "Lancer la consigne"}
              </button>
              {isExecuting && (
                <button
                  type="button"
                  onClick={handleAbort}
                  className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-charcoal)]/30 px-4 py-2 text-sm font-semibold text-[color:var(--brand-charcoal)] transition hover:bg-white/60"
                >
                  Interrompre
                </button>
              )}
            </div>
          </div>
          {(isExecuting || effectiveMessage) && (
            <p className={`text-sm ${messageToneClass}`}>
              {effectiveMessage || "L’IA calcule le trajet…"}
            </p>
          )}
          <PlanPreview plan={effectivePlan} notes={effectiveNotes} />
        </div>
      </div>

      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-white/70">
          {shouldAutoPublish
            ? "Le module carte met à jour son payload automatiquement dans le composite."
            : "Valide cette configuration pour continuer et transmettre la commande."}
        </p>
        {!shouldAutoPublish && (
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-[color:var(--brand-red)]/30 transition hover:bg-[color:var(--brand-red-dark)]"
          >
            Continuer
          </button>
        )}
      </div>
    </form>
  );
}
