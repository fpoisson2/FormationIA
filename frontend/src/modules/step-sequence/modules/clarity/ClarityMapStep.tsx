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
  ClarityGrid,
  GRID_SIZE,
  START_POSITION,
  createRandomObstacles,
  createRandomTarget,
  createRunId,
  gridKey,
} from "../../../clarity";
import type { GridCoord } from "../../../clarity";
import type { StepComponentProps } from "../../types";
import { StepSequenceContext } from "../../types";

export interface ClarityMapStepPayload {
  runId: string;
  target: GridCoord;
  blocked: GridCoord[];
  instruction?: string;
}

export interface ClarityMapStepConfig {
  obstacleCount?: number;
  initialTarget?: GridCoord | null;
  allowInstructionInput?: boolean;
  instructionLabel?: string;
  instructionPlaceholder?: string;
  controlStepId?: string;
  onChange?: (config: ClarityMapStepConfig) => void;
}

interface NormalizedClarityMapConfig {
  obstacleCount: number;
  initialTarget: GridCoord | null;
  allowInstructionInput: boolean;
  instructionLabel: string;
  instructionPlaceholder: string;
  controlStepId: string;
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

function sanitizeConfig(config: unknown): NormalizedClarityMapConfig {
  if (!config || typeof config !== "object") {
    return {
      obstacleCount: DEFAULT_OBSTACLE_COUNT,
      initialTarget: null,
      allowInstructionInput: true,
      instructionLabel: "Consigne initiale (optionnelle)",
      instructionPlaceholder: "Décris le trajet attendu…",
      controlStepId: "",
    };
  }
  const raw = config as ClarityMapStepConfig;
  const rawCount = typeof raw.obstacleCount === "number" ? raw.obstacleCount : DEFAULT_OBSTACLE_COUNT;
  const obstacleCount = Math.max(
    MIN_OBSTACLE_COUNT,
    Math.min(MAX_OBSTACLE_COUNT, Math.round(Number.isFinite(rawCount) ? rawCount : DEFAULT_OBSTACLE_COUNT))
  );
  const initialTarget = sanitizeGridCoord(raw.initialTarget ?? null);
  const allowInstructionInput = raw.allowInstructionInput !== false;
  const instructionLabel =
    typeof raw.instructionLabel === "string" && raw.instructionLabel.trim()
      ? raw.instructionLabel.trim()
      : "Consigne initiale (optionnelle)";
  const instructionPlaceholder =
    typeof raw.instructionPlaceholder === "string" && raw.instructionPlaceholder.trim()
      ? raw.instructionPlaceholder.trim()
      : "Décris le trajet attendu…";
  const controlStepId = typeof raw.controlStepId === "string" ? raw.controlStepId.trim() : "";

  return {
    obstacleCount,
    initialTarget,
    allowInstructionInput,
    instructionLabel,
    instructionPlaceholder,
    controlStepId,
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
    typeof source.instruction === "string" && source.instruction.trim()
      ? source.instruction.trim()
      : undefined;
  return { runId, target, blocked, instruction };
}

interface LinkedControlState {
  runId: string;
  trail: GridCoord[];
}

function sanitizeControlPayload(payload: unknown): LinkedControlState | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const source = payload as { runId?: unknown; trail?: unknown };
  const runId = typeof source.runId === "string" && source.runId.trim() ? source.runId.trim() : null;
  if (!runId || !Array.isArray(source.trail)) {
    return null;
  }
  const trail = source.trail
    .map(sanitizeGridCoord)
    .filter((coord): coord is GridCoord => Boolean(coord));
  if (!trail.length) {
    return { runId, trail: [] };
  }
  const deduped: GridCoord[] = [];
  const seen = new Set<string>();
  for (const coord of trail) {
    const key = gridKey(coord);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(coord);
  }
  return { runId, trail: deduped };
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

  const normalizedConfig = useMemo(() => sanitizeConfig(config), [config]);
  const mapPayload = useMemo(() => sanitizePayload(payload), [payload]);

  const defaultTarget = mapPayload?.target ?? normalizedConfig.initialTarget ?? createRandomTarget();
  const [target, setTarget] = useState<GridCoord>(defaultTarget);
  const [blocked, setBlocked] = useState<GridCoord[]>(() => {
    if (mapPayload) {
      return mapPayload.blocked;
    }
    return createRandomObstacles(defaultTarget, normalizedConfig.obstacleCount);
  });
  const [instruction, setInstruction] = useState(mapPayload?.instruction ?? "");
  const [runId, setRunId] = useState(mapPayload?.runId ?? createRunId());
  const lastPublishedRef = useRef<string | null>(null);
  const controlState = useMemo(() => {
    if (!normalizedConfig.controlStepId || !sequencePayloads) {
      return null;
    }
    return sanitizeControlPayload(sequencePayloads[normalizedConfig.controlStepId]);
  }, [normalizedConfig.controlStepId, sequencePayloads]);

  const targetFromConfig = normalizedConfig.initialTarget;
  const obstacleCount = normalizedConfig.obstacleCount;

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

  const handleConfigChange = useCallback(
    (next: ClarityMapStepConfig) => {
      normalizedConfig.onChange?.(next);
      onUpdateConfig(next);
    },
    [normalizedConfig, onUpdateConfig]
  );

  const handleObstacleCountChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextCount = Math.max(
        MIN_OBSTACLE_COUNT,
        Math.min(MAX_OBSTACLE_COUNT, Math.round(Number.parseInt(event.target.value, 10) || 0))
      );
      handleConfigChange({
        ...normalizedConfig,
        obstacleCount: nextCount,
      });
    },
    [handleConfigChange, normalizedConfig]
  );

  const handleTargetFieldChange = useCallback(
    (axis: "x" | "y") =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = clampToGrid(Number.parseInt(event.target.value, 10) || 0);
        const nextTarget = { ...(normalizedConfig.initialTarget ?? START_POSITION), [axis]: value };
        handleConfigChange({
          ...normalizedConfig,
          initialTarget: nextTarget,
        });
      },
    [handleConfigChange, normalizedConfig]
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
        instruction: instruction.trim() ? instruction.trim() : undefined,
      };
      onAdvance(payloadToSend);
    },
    [blocked, instruction, onAdvance, runId, shouldAutoPublish, target]
  );

  useEffect(() => {
    if (!shouldAutoPublish) {
      lastPublishedRef.current = null;
      return;
    }
    const trimmed = instruction.trim();
    const payloadToSend: ClarityMapStepPayload = {
      runId,
      target,
      blocked,
      instruction: trimmed ? trimmed : undefined,
    };
    const serialized = JSON.stringify(payloadToSend);
    if (lastPublishedRef.current === serialized) {
      return;
    }
    lastPublishedRef.current = serialized;
    onAdvance(payloadToSend);
  }, [blocked, instruction, onAdvance, runId, shouldAutoPublish, target]);

  const controlRunMatches = controlState && controlState.runId === runId;

  const visited = useMemo(() => {
    if (!controlRunMatches || !controlState?.trail.length) {
      return new Set<string>();
    }
    const set = new Set<string>();
    controlState.trail.forEach((coord) => set.add(gridKey(coord)));
    return set;
  }, [controlRunMatches, controlState]);

  const playerPosition = useMemo(() => {
    if (controlRunMatches && controlState?.trail.length) {
      return controlState.trail[controlState.trail.length - 1];
    }
    return START_POSITION;
  }, [controlRunMatches, controlState]);

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
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Étape contrôle liée
              </span>
              <input
                type="text"
                value={normalizedConfig.controlStepId}
                onChange={(event) =>
                  handleConfigChange({ ...normalizedConfig, controlStepId: event.target.value.trim() })
                }
                className="rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
              />
              <span className="text-xs text-[color:var(--brand-charcoal)]/70">
                Optionnel · Permet d’afficher la trajectoire renvoyée par l’étape de contrôle.
              </span>
            </label>
          </div>
        </fieldset>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-[color:var(--brand-charcoal)]">
            Cible actuelle · ({target.x}, {target.y})
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="cta-button inline-flex items-center gap-2 border border-white/60 bg-white/80 text-[color:var(--brand-charcoal)] hover:bg-white"
              onClick={handleShuffleTarget}
            >
              Nouvel objectif
            </button>
            <button
              type="button"
              className="cta-button inline-flex items-center gap-2 border border-white/60 bg-white/80 text-[color:var(--brand-charcoal)] hover:bg-white"
              onClick={handleShuffleObstacles}
            >
              Mélanger les obstacles
            </button>
          </div>
        </div>
        <ClarityGrid player={playerPosition} target={target} blocked={blocked} visited={visited} />
        {controlRunMatches && controlState?.trail.length ? (
          <p className="text-xs text-[color:var(--brand-charcoal)]/70">
            Trajectoire reçue depuis l’étape de contrôle.
          </p>
        ) : null}
      </div>

      {normalizedConfig.allowInstructionInput && (
        <label className="flex flex-col gap-2 text-sm text-[color:var(--brand-charcoal)]">
          <span className="font-semibold text-[color:var(--brand-black)]">
            {normalizedConfig.instructionLabel}
          </span>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={normalizedConfig.instructionPlaceholder}
            rows={4}
            className="rounded-2xl border border-white/60 bg-white/80 px-4 py-3 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
          />
          <span className="text-xs text-[color:var(--brand-charcoal)]/70">
            Optionnel · Ce texte sera proposé par défaut dans l’étape de contrôle.
          </span>
        </label>
      )}

      {!shouldAutoPublish && (
        <div className="flex justify-end">
          <button type="submit" className="cta-button cta-button--primary">
            Continuer
          </button>
        </div>
      )}
    </form>
  );
}
