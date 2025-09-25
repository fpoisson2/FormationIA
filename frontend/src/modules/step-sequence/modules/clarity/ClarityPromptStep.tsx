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
import {
  GRID_SIZE,
  PlanPreview,
  START_POSITION,
  createRandomObstacles,
  createRandomTarget,
  createRunId,
  useClarityPlanExecution,
  type ClientStats,
  type GridCoord,
} from "../../../clarity";
import type { CompositeStepModuleDefinition, StepComponentProps } from "../../types";
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

interface MapModuleSnapshot {
  runId: string | null;
  target: GridCoord | null;
  blocked: GridCoord[];
}

interface MapModuleConfigSnapshot {
  initialTarget: GridCoord | null;
  obstacleCount: number;
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

function sanitizeBlockedList(value: unknown, target: GridCoord): GridCoord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const blocked: GridCoord[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const coord = sanitizeGridCoord(item);
    if (!coord) {
      continue;
    }

    const key = `${coord.x}-${coord.y}`;
    if (
      seen.has(key) ||
      (coord.x === START_POSITION.x && coord.y === START_POSITION.y) ||
      (coord.x === target.x && coord.y === target.y)
    ) {
      continue;
    }

    seen.add(key);
    blocked.push(coord);
  }

  return blocked;
}

function sanitizeMapModulePayload(value: unknown): MapModuleSnapshot {
  if (!value || typeof value !== "object") {
    return { runId: null, target: null, blocked: [] };
  }

  const source = value as Partial<MapModuleSnapshot> & Record<string, unknown>;
  const target = sanitizeGridCoord(source.target);
  const blocked = target ? sanitizeBlockedList(source.blocked, target) : [];
  const runId =
    typeof source.runId === "string" && source.runId.trim().length > 0
      ? source.runId
      : null;

  return { runId, target, blocked };
}

function sanitizeObstacleCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_OBSTACLE_COUNT;
  }
  return Math.max(
    MIN_OBSTACLE_COUNT,
    Math.min(MAX_OBSTACLE_COUNT, Math.round(value))
  );
}

function sanitizeMapModuleConfig(value: unknown): MapModuleConfigSnapshot {
  if (!value || typeof value !== "object") {
    return { initialTarget: null, obstacleCount: DEFAULT_OBSTACLE_COUNT };
  }

  const source = value as { initialTarget?: unknown; obstacleCount?: unknown };
  return {
    initialTarget: sanitizeGridCoord(source.initialTarget),
    obstacleCount: sanitizeObstacleCount(source.obstacleCount),
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
  const allowManualSubmit = isEditMode || !shouldAutoPublish;
  const sequencePayloads = sequenceContext?.payloads ?? null;
  const compositeModules = sequenceContext?.compositeModules ?? null;

  const normalizedConfig = useMemo(() => sanitizeConfig(config), [config]);
  const sanitizedPayload = useMemo(
    () => sanitizePayload(payload, normalizedConfig),
    [payload, normalizedConfig]
  );

  const detectedMapModule = useMemo<CompositeStepModuleDefinition | null>(() => {
    if (!compositeModules) {
      return null;
    }

    const moduleId = definition.id;
    if (typeof moduleId !== "string" || !moduleId) {
      return null;
    }

    for (const modules of Object.values(compositeModules)) {
      if (!Array.isArray(modules)) {
        continue;
      }
      const belongsToComposite = modules.some((module) => module.id === moduleId);
      if (!belongsToComposite) {
        continue;
      }

      const targetModule = modules.find(
        (module) => module.component === "clarity-map" && module.id !== moduleId
      );
      if (targetModule) {
        return targetModule;
      }
    }

    return null;
  }, [compositeModules, definition.id]);

  const detectedMapStepId = detectedMapModule?.id ?? "";
  const mapConfigSnapshot = useMemo(
    () => sanitizeMapModuleConfig(detectedMapModule?.config),
    [detectedMapModule]
  );
  const mapPayloadSnapshot = useMemo(
    () =>
      detectedMapStepId && sequencePayloads
        ? sanitizeMapModulePayload(sequencePayloads[detectedMapStepId])
        : { runId: null, target: null, blocked: [] },
    [detectedMapStepId, sequencePayloads]
  );
  const mapSourceLabel = detectedMapModule?.id ?? "";

  const initialTestTarget =
    mapPayloadSnapshot.target ??
    mapConfigSnapshot.initialTarget ??
    createRandomTarget();
  const initialTestBlocked =
    mapPayloadSnapshot.target !== null
      ? mapPayloadSnapshot.blocked
      : createRandomObstacles(initialTestTarget, mapConfigSnapshot.obstacleCount);
  const initialTestRunId = mapPayloadSnapshot.runId ?? createRunId();

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
  const [testTarget, setTestTarget] = useState<GridCoord>(initialTestTarget);
  const [testBlocked, setTestBlocked] = useState<GridCoord[]>(initialTestBlocked);
  const [testRunId, setTestRunId] = useState<string>(initialTestRunId);
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

  useEffect(() => {
    if (!mapPayloadSnapshot.target) {
      return;
    }

    setTestTarget(mapPayloadSnapshot.target);
    setTestBlocked(mapPayloadSnapshot.blocked);
    if (mapPayloadSnapshot.runId) {
      setTestRunId(mapPayloadSnapshot.runId);
    }
  }, [mapPayloadSnapshot.blocked, mapPayloadSnapshot.runId, mapPayloadSnapshot.target]);

  useEffect(() => {
    if (mapPayloadSnapshot.target || !mapConfigSnapshot.initialTarget) {
      return;
    }

    setTestTarget(mapConfigSnapshot.initialTarget);
    setTestBlocked(
      createRandomObstacles(
        mapConfigSnapshot.initialTarget,
        mapConfigSnapshot.obstacleCount
      )
    );
  }, [
    mapConfigSnapshot.initialTarget,
    mapConfigSnapshot.obstacleCount,
    mapPayloadSnapshot.target,
  ]);

  useEffect(() => {
    if (!mapPayloadSnapshot.runId) {
      return;
    }
    setTestRunId(mapPayloadSnapshot.runId);
  }, [mapPayloadSnapshot.runId]);

  const trimmedInstructionValue = instruction.trim();
  const trimmedDeveloperMessageValue = developerMessage.trim();
  const defaultDeveloperMessage = normalizedConfig.developerMessage;
  const fallbackDeveloperMessage =
    defaultDeveloperMessage.trim() || defaultDeveloperMessage;
  const developerMessageForRequest =
    trimmedDeveloperMessageValue || fallbackDeveloperMessage;

  const {
    execute,
    isLoading,
    message: executionMessage,
    plan: executionPlan,
    notes: executionNotes,
    stats: executionStats,
    status: executionStatus,
  } = useClarityPlanExecution();

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
      if (!allowManualSubmit) {
        return;
      }

      onAdvance(buildPayload());
    },
    [allowManualSubmit, buildPayload, onAdvance]
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

  const handleTestExecution = useCallback(() => {
    if (!trimmedInstructionValue) {
      return;
    }

    void execute({
      instruction: trimmedInstructionValue,
      goal: testTarget,
      blocked: testBlocked,
      runId: testRunId,
      model,
      verbosity,
      thinking,
      developerMessage: developerMessageForRequest,
    }).catch(() => {});
  }, [
    developerMessageForRequest,
    execute,
    model,
    testBlocked,
    testRunId,
    testTarget,
    thinking,
    trimmedInstructionValue,
    verbosity,
  ]);

  const testContextDescription = useMemo(() => {
    const baseLabel = `(${testTarget.x}, ${testTarget.y})`;
    const obstacleCount = testBlocked.length;
    const obstacleLabel = `${obstacleCount} obstacle${obstacleCount > 1 ? "s" : ""}`;
    if (mapSourceLabel) {
      return `Carte liée « ${mapSourceLabel} » · Cible ${baseLabel} · ${obstacleLabel}`;
    }
    return `Carte par défaut · Cible ${baseLabel} · ${obstacleLabel}`;
  }, [mapSourceLabel, testBlocked.length, testTarget.x, testTarget.y]);

  const resolvedExecutionPlan = executionPlan;
  const resolvedExecutionNotes = executionNotes;
  const resolvedExecutionMessage = executionMessage;
  const resolvedExecutionStats = executionStats;

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
        <fieldset className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-[color:var(--brand-charcoal)]">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
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
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-[color:var(--brand-charcoal)] placeholder:text-gray-500 focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/20"
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
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-[color:var(--brand-charcoal)] placeholder:text-gray-500 focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/20"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Modèle par défaut
              </span>
              <select
                value={normalizedConfig.model}
                onChange={(event) =>
                  handleConfigChange({ defaultModel: event.target.value as ModelChoice })
                }
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/20"
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="text-[color:var(--brand-charcoal)]">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Verbosité par défaut
              </span>
              <select
                value={normalizedConfig.verbosity}
                onChange={(event) =>
                  handleConfigChange({
                    defaultVerbosity: event.target.value as VerbosityChoice,
                  })
                }
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/20"
              >
                {VERBOSITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="text-[color:var(--brand-charcoal)]">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Raisonnement par défaut
              </span>
              <select
                value={normalizedConfig.thinking}
                onChange={(event) =>
                  handleConfigChange({ defaultThinking: event.target.value as ThinkingChoice })
                }
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/20"
              >
                {THINKING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="text-[color:var(--brand-charcoal)]">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Message développeur par défaut
              </span>
              <textarea
                rows={4}
                value={normalizedConfig.developerMessage}
                onChange={(event) =>
                  handleConfigChange({ defaultDeveloperMessage: event.target.value })
                }
                className="min-h-[120px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-[color:var(--brand-charcoal)] placeholder:text-gray-500 focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/20"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={normalizedConfig.exposeSettings}
                onChange={(event) => handleConfigChange({ exposeSettings: event.target.checked })}
                className="h-4 w-4 rounded border-gray-400 text-[color:var(--brand-red)] focus:ring-[color:var(--brand-red)]"
              />
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
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
                className="h-4 w-4 rounded border-gray-400 text-[color:var(--brand-red)] focus:ring-[color:var(--brand-red)]"
              />
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Montrer le message développeur
              </span>
            </label>
          </div>
          <div className="mt-4 rounded-xl border border-gray-300 bg-gray-50 p-4 text-xs">
            <div className="flex items-center justify-between gap-3 text-[color:var(--brand-charcoal)]/80">
              <span className="font-semibold uppercase tracking-wide">Payload partagé</span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--brand-charcoal)]/60">
                Lecture seule
              </span>
            </div>
            <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-[11px] leading-relaxed text-[color:var(--brand-charcoal)]">
              {structuredPreview}
            </pre>
          </div>
        </fieldset>
      )}

      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-[color:var(--brand-charcoal)]">{normalizedConfig.promptLabel}</span>
        <textarea
          required
          rows={4}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={normalizedConfig.promptPlaceholder}
          className="min-h-[120px] rounded-2xl border border-gray-300 bg-white px-4 py-3 text-base text-[color:var(--brand-charcoal)] shadow-sm placeholder:text-gray-500 focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/20"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
            Modèle
          </span>
          <select
            value={model}
            onChange={(event) => setModel(event.target.value as ModelChoice)}
            className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/20"
          >
            {MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="text-[color:var(--brand-charcoal)]">
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
            Verbosité
          </span>
          <select
            value={verbosity}
            onChange={(event) => setVerbosity(event.target.value as VerbosityChoice)}
            className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/20"
          >
            {VERBOSITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="text-[color:var(--brand-charcoal)]">
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
            Raisonnement
          </span>
          <select
            value={thinking}
            onChange={(event) => setThinking(event.target.value as ThinkingChoice)}
            className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/20"
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
        <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
          Message développeur transmis au modèle
        </span>
        <textarea
          rows={4}
          value={developerMessage}
          onChange={(event) => setDeveloperMessage(event.target.value)}
          className="min-h-[120px] rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-[color:var(--brand-charcoal)] shadow-sm placeholder:text-gray-500 focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/20"
        />
      </label>

      {(exposeSettings || exposeDeveloperMessage) && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-[color:var(--brand-charcoal)] shadow-inner">
          <div className="flex flex-col gap-3">
            {exposeSettings && (
              <dl className="grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">Modèle</dt>
                  <dd className="mt-1 font-medium text-[color:var(--brand-charcoal)]">
                    {activeModelOption?.label ?? model}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">Verbosité</dt>
                  <dd className="mt-1 font-medium text-[color:var(--brand-charcoal)]">
                    {activeVerbosityOption?.label ?? verbosity}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">Raisonnement</dt>
                  <dd className="mt-1 font-medium text-[color:var(--brand-charcoal)]">
                    {activeThinkingOption?.label ?? thinking}
                  </dd>
                </div>
              </dl>
            )}
            {exposeDeveloperMessage && (
              <div>
                <p className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                  Brief développeur visible pour l’apprenant·e
                </p>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-[color:var(--brand-charcoal)]">
                  {developerMessage.trim() || normalizedConfig.developerMessage}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-300 bg-gray-100 p-4 text-[color:var(--brand-charcoal)] shadow-inner">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[color:var(--brand-charcoal)]">
              Tester la consigne avec l’IA
            </p>
            <p className="text-xs text-[color:var(--brand-charcoal)]/70">{testContextDescription}</p>
          </div>
          <button
            type="button"
            onClick={handleTestExecution}
            disabled={isLoading || !trimmedInstructionValue}
            className={`inline-flex items-center justify-center rounded-full px-4 py-1.5 text-xs font-semibold transition ${
              isLoading || !trimmedInstructionValue
                ? "cursor-not-allowed border border-gray-200 bg-gray-100 text-[color:var(--brand-charcoal)]/60"
                : "border border-transparent bg-[color:var(--brand-red)] text-white hover:bg-[color:var(--brand-red-dark)]"
            }`}
          >
            {isLoading
              ? "Analyse en cours…"
              : shouldAutoPublish
                ? "Relancer l’IA"
                : "Tester la consigne"}
          </button>
        </div>
        {executionStatus !== "idle" && (
          <span className="mt-3 inline-flex items-center rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
            {executionStatus === "running"
              ? "Analyse en cours"
              : executionStatus === "success"
                ? "Plan validé"
                : executionStatus === "blocked"
                  ? "Plan incomplet"
                  : executionStatus === "error"
                    ? "Erreur"
                    : "Prêt"}
          </span>
        )}
        {resolvedExecutionMessage && (
          <p className="mt-3 text-sm text-[color:var(--brand-charcoal)]">{resolvedExecutionMessage}</p>
        )}
        <div className="mt-3">
          <PlanPreview plan={resolvedExecutionPlan} notes={resolvedExecutionNotes} tone="light" />
        </div>
        {resolvedExecutionStats && (
          <dl className="mt-3 grid gap-3 text-xs text-[color:var(--brand-charcoal)]/70 sm:grid-cols-2">
            <div>
              <dt className="font-semibold uppercase tracking-wide text-[10px]">Tentatives</dt>
              <dd className="mt-1 text-[color:var(--brand-charcoal)]">
                {resolvedExecutionStats.attempts}
              </dd>
            </div>
            <div>
              <dt className="font-semibold uppercase tracking-wide text-[10px]">Pas exécutés</dt>
              <dd className="mt-1 text-[color:var(--brand-charcoal)]">
                {resolvedExecutionStats.stepsExecuted}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[color:var(--brand-charcoal)]/80">
          {allowManualSubmit
            ? "Clique sur “Envoyer la requête” pour transmettre la consigne au module suivant."
            : "Les modifications sont partagées automatiquement dans le module composite."}
        </p>
        {allowManualSubmit && (
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
