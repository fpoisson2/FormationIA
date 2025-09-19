import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { API_AUTH_KEY, API_BASE_URL } from "../config";
import { useLTI } from "../hooks/useLTI";
import { updateActivityProgress } from "../api";
import ActivityLayout from "../components/ActivityLayout";

const GRID_SIZE = 10;

interface GridCoord {
  x: number;
  y: number;
}

interface PlanAction {
  dir: "left" | "right" | "up" | "down";
  steps: number;
}

interface StepPayload extends GridCoord {
  dir: PlanAction["dir"];
  i: number;
}

interface ServerStatsPayload {
  runId: string;
  attempts: number;
  stepsExecuted: number;
  optimalPathLength: number | null;
  surcout: number | null;
  success: boolean;
  finalPosition: GridCoord;
  ambiguity?: string;
}

interface ClientStats extends ServerStatsPayload {
  durationMs: number;
}

type GamePhase = "intro" | "brief" | "animating" | "results";
type RunStatus = "idle" | "running" | "success" | "blocked";

const START_POSITION: GridCoord = { x: 0, y: 0 };

const DIRECTION_LABELS: Record<PlanAction["dir"], string> = {
  up: "Monter",
  down: "Descendre",
  left: "Aller à gauche",
  right: "Aller à droite",
};

const CLARITY_TIPS = [
  "Indique la direction ET la distance quand c’est possible.",
  "Découpe en étapes si nécessaire (“puis…”, “ensuite…”).",
  "Nomme explicitement l’objectif (“jusqu’à l’objet en bas à droite”).",
];

const MICRO_TIPS = [
  "Précise la destination exacte.",
  "Indique un nombre de pas pour chaque direction.",
  "Évite les mots vagues : “un peu”, “par là”.",
];

const createRunId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `run-${Math.random().toString(36).slice(2, 10)}`;
};

const randomInt = (max: number): number => Math.floor(Math.random() * max);

const createRandomTarget = (current?: GridCoord): GridCoord => {
  let next = { x: randomInt(GRID_SIZE), y: randomInt(GRID_SIZE) };
  while (
    (next.x === START_POSITION.x && next.y === START_POSITION.y) ||
    (current && next.x === current.x && next.y === current.y)
  ) {
    next = { x: randomInt(GRID_SIZE), y: randomInt(GRID_SIZE) };
  }
  return next;
};

const createRandomObstacles = (target: GridCoord, count = 6): GridCoord[] => {
  const set = new Set<string>();
  const obstacles: GridCoord[] = [];
  while (obstacles.length < count) {
    const candidate = { x: randomInt(GRID_SIZE), y: randomInt(GRID_SIZE) };
    const key = `${candidate.x}-${candidate.y}`;
    if (
      set.has(key) ||
      (candidate.x === START_POSITION.x && candidate.y === START_POSITION.y) ||
      (candidate.x === target.x && candidate.y === target.y)
    ) {
      continue;
    }
    set.add(key);
    obstacles.push(candidate);
  }
  return obstacles;
};

const formatDuration = (ms: number): string => {
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)} s`;
  }
  return `${Math.round(seconds)} s`;
};

function FireworksOverlay({ active }: { active: boolean }): JSX.Element | null {
  const pieces = useMemo(() => {
    if (!active) {
      return [] as Array<{ id: number; left: number; delay: number; duration: number; color: string }>;
    }
    const colors = ["#F75567", "#FDBD39", "#3BCBFF", "#8A5CFF"];
    return Array.from({ length: 32 }, (_, index) => ({
      id: index,
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 1.8 + Math.random() * 0.6,
      color: colors[index % colors.length],
    }));
  }, [active]);

  if (!active) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="absolute block h-2 w-2 rounded-full opacity-0"
          style={{
            left: `${piece.left}%`,
            top: "50%",
            backgroundColor: piece.color,
            animation: `clarity-firework ${piece.duration}s ease-out ${piece.delay}s forwards`,
          }}
        />
      ))}
    </div>
  );
}

function ClarityGrid({
  player,
  target,
  blocked,
  visited,
}: {
  player: GridCoord;
  target: GridCoord;
  blocked: GridCoord[];
  visited: Set<string>;
}): JSX.Element {
  const blockedSet = useMemo(() => new Set(blocked.map((cell) => `${cell.x}-${cell.y}`)), [blocked]);
  const axis = useMemo(() => Array.from({ length: GRID_SIZE }, (_, index) => index), []);
  const cellPercent = 100 / GRID_SIZE;
  const playerLeft = (player.x + 0.5) * cellPercent;
  const playerTop = (player.y + 0.5) * cellPercent;
  const targetLeft = (target.x + 0.5) * cellPercent;
  const targetTop = (target.y + 0.5) * cellPercent;

  return (
    <div className="relative mx-auto w-full max-w-[480px]">
      <div className="flex items-end gap-4">
        <div className="flex h-[360px] flex-col justify-between pb-4 text-xs font-semibold text-[color:var(--brand-charcoal)]/70">
          {axis.map((value) => (
            <span key={`row-${value}`} className="text-right">
              {value}
            </span>
          ))}
        </div>
        <div className="relative">
          <div className="relative aspect-square h-[360px] rounded-3xl border border-white/60 bg-white/70 p-2 shadow-inner">
            <div className="grid h-full w-full grid-cols-10 grid-rows-10 overflow-hidden rounded-2xl border border-white/40">
              {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, index) => {
                const x = index % GRID_SIZE;
                const y = Math.floor(index / GRID_SIZE);
                const key = `${x}-${y}`;
                const isVisited = visited.has(key);
                const isStart = x === START_POSITION.x && y === START_POSITION.y;
                const isTarget = x === target.x && y === target.y;
                const isBlocked = blockedSet.has(key);
                return (
                  <div
                    key={key}
                    className={`relative border border-white/40 ${
                      isVisited ? "bg-[color:var(--brand-yellow)]/30" : "bg-white/60"
                    }`}
                  >
                    {isBlocked && (
                      <span className="absolute inset-0 flex items-center justify-center text-xs text-[color:var(--brand-red)]">🧱</span>
                    )}
                    {isStart && (
                      <span className="absolute left-1 top-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]">
                        Start
                      </span>
                    )}
                    {isTarget && (
                      <span className="absolute right-1 top-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--brand-red)]">
                        Goal
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="clarity-grid-overlay" />
          </div>
          <div className="pointer-events-none absolute inset-0">
            <span
              className="absolute flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center text-2xl transition-transform duration-300 ease-out"
              style={{ left: `${playerLeft}%`, top: `${playerTop}%` }}
              role="img"
              aria-label="Bonhomme"
            >
              👤
            </span>
            <span
              className="absolute flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center text-2xl"
              style={{ left: `${targetLeft}%`, top: `${targetTop}%` }}
              role="img"
              aria-label="Objectif"
            >
              🎯
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex justify-center gap-[34px] text-xs font-semibold text-[color:var(--brand-charcoal)]/70">
        {axis.map((value) => (
          <span key={`col-${value}`}>{value}</span>
        ))}
      </div>
    </div>
  );
}

function PlanPreview({ plan, notes }: { plan: PlanAction[]; notes: string }): JSX.Element {
  if (!plan.length && !notes) {
    return (
      <div className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-[color:var(--brand-black)]">Plan</h3>
        <p className="mt-2 text-sm text-[color:var(--brand-charcoal)]/80">
          Le plan validé apparaîtra ici dès que le backend aura converti ta consigne.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/60 bg-white/90 p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-[color:var(--brand-black)]">Plan validé</h3>
      <ol className="mt-4 space-y-2 text-sm text-[color:var(--brand-charcoal)]">
        {plan.map((action, index) => (
          <li key={`${action.dir}-${index}`} className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-red)]/10 text-xs font-semibold text-[color:var(--brand-red)]">
              {index + 1}
            </span>
            <span>
              {DIRECTION_LABELS[action.dir]} · {action.steps} pas
            </span>
          </li>
        ))}
      </ol>
      {notes && (
        <p className="mt-4 rounded-2xl bg-[color:var(--brand-yellow)]/30 p-3 text-xs text-[color:var(--brand-charcoal)]">
          Hypothèse du modèle : {notes}
        </p>
      )}
    </div>
  );
}

function ClarityTipsPanel(): JSX.Element {
  return (
    <div className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-[color:var(--brand-black)]">Conseils de clarté</h3>
      <ul className="mt-4 space-y-3 text-sm text-[color:var(--brand-charcoal)]">
        {CLARITY_TIPS.map((tip) => (
          <li key={tip} className="flex items-start gap-3">
            <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
              ✶
            </span>
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatsModal({
  stats,
  summary,
  onReplay,
  onShuffle,
  onExit,
  onComplete,
  isCompleting,
}: {
  stats: ClientStats;
  summary: string;
  onReplay: () => void;
  onShuffle: () => void;
  onExit: () => void;
  onComplete: () => void;
  isCompleting: boolean;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/60 bg-white/95 p-8 shadow-2xl">
        <div>
          <h3 className="text-2xl font-semibold text-[color:var(--brand-black)]">🎉 Bilan de la manche</h3>
          <p className="mt-2 whitespace-pre-line text-sm text-[color:var(--brand-charcoal)]">{summary}</p>
          {stats.ambiguity && (
            <p className="mt-3 rounded-2xl bg-[color:var(--brand-yellow)]/40 p-3 text-xs text-[color:var(--brand-charcoal)]">
              Hypothèse détectée : {stats.ambiguity}
            </p>
          )}
        </div>
        <ul className="mt-6 grid gap-3 text-sm text-[color:var(--brand-charcoal)] md:grid-cols-2">
          <li className="rounded-2xl bg-white/80 p-3 shadow-sm">
            <strong className="text-[color:var(--brand-black)]">Tentatives :</strong> {stats.attempts}
          </li>
          <li className="rounded-2xl bg-white/80 p-3 shadow-sm">
            <strong className="text-[color:var(--brand-black)]">Pas effectués :</strong> {stats.stepsExecuted}
          </li>
          <li className="rounded-2xl bg-white/80 p-3 shadow-sm">
            <strong className="text-[color:var(--brand-black)]">Chemin optimal :</strong> {stats.optimalPathLength ?? "–"}
          </li>
          <li className="rounded-2xl bg-white/80 p-3 shadow-sm">
            <strong className="text-[color:var(--brand-black)]">Surcoût :</strong> {typeof stats.surcout === "number" ? `${stats.surcout > 0 ? "+" : ""}${stats.surcout}` : "–"}
          </li>
          <li className="rounded-2xl bg-white/80 p-3 shadow-sm">
            <strong className="text-[color:var(--brand-black)]">Temps de résolution :</strong> {formatDuration(stats.durationMs)}
          </li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="cta-button cta-button--primary inline-flex items-center gap-2"
            onClick={onComplete}
            disabled={isCompleting}
          >
            {isCompleting ? "Redirection…" : "Terminer l’activité"}
          </button>
          <button
            type="button"
            className="cta-button inline-flex items-center gap-2 border border-white/60 bg-white/80 text-[color:var(--brand-charcoal)] hover:bg-white"
            onClick={onReplay}
            disabled={isCompleting}
          >
            Rejouer (nouvel objet)
          </button>
          <button
            type="button"
            className="cta-button inline-flex items-center gap-2 border border-[color:var(--brand-red)]/30 bg-white/80 text-[color:var(--brand-red)] hover:bg-white"
            onClick={onShuffle}
            disabled={isCompleting}
          >
            Changer les obstacles
          </button>
          <button
            type="button"
            className="cta-button inline-flex items-center gap-2 border border-white/60 bg-white/80 text-[color:var(--brand-charcoal)] hover:bg-white"
            onClick={onExit}
            disabled={isCompleting}
          >
            Retour à l’intro
          </button>
        </div>
      </div>
    </div>
  );
}

function ClarityPath(): JSX.Element {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<GamePhase>("intro");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [instruction, setInstruction] = useState("");
  const [plan, setPlan] = useState<PlanAction[]>([]);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<ClientStats | null>(null);
  const [target, setTarget] = useState<GridCoord>(() => createRandomTarget());
  const [blocked, setBlocked] = useState<GridCoord[]>([]);
  const [player, setPlayer] = useState<GridCoord>(START_POSITION);
  const [trail, setTrail] = useState<GridCoord[]>([START_POSITION]);
  const [isLoading, setIsLoading] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [ltiScoreSubmitted, setLtiScoreSubmitted] = useState(false);
  const [activityProgressMarked, setActivityProgressMarked] = useState(false);
  const [isCompletingActivity, setIsCompletingActivity] = useState(false);

  const { isLTISession, submitScore, context, error: ltiError } = useLTI();

  const isResultsPhase = phase === "results";
  const isBriefPhase = phase === "brief";
  const isInstructionDisabled = isLoading || !isBriefPhase;
  const areObstacleActionsDisabled = isLoading || !isBriefPhase;

  const runIdRef = useRef<string>(createRunId());
  const controllerRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const celebrationTimeoutRef = useRef<number | null>(null);
  const stepQueueRef = useRef<StepPayload[]>([]);
  const stepTimerRef = useRef<number | null>(null);
  const openModalTimeoutRef = useRef<number | null>(null);
  const showModalWhenReadyRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      if (celebrationTimeoutRef.current) {
        window.clearTimeout(celebrationTimeoutRef.current);
      }
      if (stepTimerRef.current) {
        window.clearTimeout(stepTimerRef.current);
      }
      if (openModalTimeoutRef.current) {
        window.clearTimeout(openModalTimeoutRef.current);
      }
      stepQueueRef.current = [];
      showModalWhenReadyRef.current = false;
    };
  }, []);

  // Submit score to LTI when activity is successfully completed
  useEffect(() => {
    const synchronizeProgress = async () => {
      if (
        isResultsPhase &&
        isLTISession &&
        status === "success" &&
        stats &&
        stats.success &&
        !ltiScoreSubmitted
      ) {
        const efficiency = stats.optimalPathLength
          ? Math.max(0, 1 - (stats.surcout || 0) / stats.optimalPathLength)
          : 1;

        const success = await submitScore({
          missionId: "clarity-path",
          success: true,
          scoreGiven: 1.0,
          scoreMaximum: 1.0,
          activityProgress: "Completed",
          gradingProgress: "FullyGraded",
          metadata: {
            attempts: stats.attempts,
            stepsExecuted: stats.stepsExecuted,
            optimalPathLength: stats.optimalPathLength,
            surcout: stats.surcout,
            efficiency: efficiency,
            durationMs: stats.durationMs,
            runId: stats.runId,
          },
        });

        if (success) {
          setLtiScoreSubmitted(true);
        }
      }

      if (isResultsPhase && stats?.success && !activityProgressMarked) {
        try {
          await updateActivityProgress({ activityId: "clarity", completed: true });
          setActivityProgressMarked(true);
        } catch (error) {
          console.error("Unable to persist clarity path progress", error);
        }
      }
    };

    synchronizeProgress();
  }, [status, stats, isLTISession, submitScore, ltiScoreSubmitted, activityProgressMarked, isResultsPhase]);

  const triggerCelebration = useCallback(() => {
    setCelebrating(true);
    if (celebrationTimeoutRef.current) {
      window.clearTimeout(celebrationTimeoutRef.current);
    }
    celebrationTimeoutRef.current = window.setTimeout(() => {
      if (mountedRef.current) {
        setCelebrating(false);
      }
    }, 2600);
  }, []);

  const scheduleModalOpen = useCallback(() => {
    showModalWhenReadyRef.current = false;
    if (openModalTimeoutRef.current) {
      window.clearTimeout(openModalTimeoutRef.current);
    }
    openModalTimeoutRef.current = window.setTimeout(() => {
      openModalTimeoutRef.current = null;
      if (mountedRef.current) {
        setPhase("results");
        setIsStatsModalOpen(true);
      }
    }, 400);
  }, []);

  const processNextStep = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }
    const queue = stepQueueRef.current;
    if (!queue.length) {
      stepTimerRef.current = null;
      if (showModalWhenReadyRef.current) {
        scheduleModalOpen();
      }
      return;
    }
    const step = queue.shift()!;
    const next = { x: step.x, y: step.y };
    setPlayer(next);
    setTrail((prev) => [...prev, next]);
    stepTimerRef.current = window.setTimeout(processNextStep, 260);
  }, []);

  const visitedCells = useMemo(() => {
    const set = new Set<string>();
    trail.forEach((cell) => set.add(`${cell.x}-${cell.y}`));
    return set;
  }, [trail]);

  const resetRoundState = useCallback(
    (options?: { nextTarget?: GridCoord; nextObstacles?: GridCoord[]; newRunId?: boolean }) => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setPlan([]);
      setNotes("");
      setMessage("");
      setStats(null);
      setIsStatsModalOpen(false);
      setStatus("idle");
      setIsLoading(false);
      setPlayer(START_POSITION);
      setTrail([START_POSITION]);
      setCelebrating(false);
      if (stepTimerRef.current) {
        window.clearTimeout(stepTimerRef.current);
        stepTimerRef.current = null;
      }
      stepQueueRef.current = [];
      showModalWhenReadyRef.current = false;
      if (openModalTimeoutRef.current) {
        window.clearTimeout(openModalTimeoutRef.current);
        openModalTimeoutRef.current = null;
      }
      startTimeRef.current = 0;
      if (options?.nextTarget) {
        setTarget(options.nextTarget);
      }
      if (options?.nextObstacles) {
        setBlocked(options.nextObstacles);
      } else if (options?.nextTarget) {
        setBlocked((prev) => prev.filter((cell) => cell.x !== options.nextTarget!.x || cell.y !== options.nextTarget!.y));
      }
      if (options?.newRunId !== false) {
        runIdRef.current = createRunId();
      }
    },
    []
  );

  const handleServerEvent = useCallback(
    (eventName: string, payload: unknown) => {
      if (!mountedRef.current) {
        return;
      }
      switch (eventName) {
        case "plan": {
          const rawPlan =
            payload && typeof payload === "object" && Array.isArray((payload as { plan?: unknown[] }).plan)
              ? ((payload as { plan: unknown[] }).plan ?? [])
              : [];
          const cleanedPlan = rawPlan
            .map((item) => {
              if (!item || typeof item !== "object") {
                return null;
              }
              const dir = (item as { dir?: string }).dir;
              const stepsValue = (item as { steps?: number }).steps;
              if (dir !== "left" && dir !== "right" && dir !== "up" && dir !== "down") {
                return null;
              }
              if (typeof stepsValue !== "number" || !Number.isFinite(stepsValue)) {
                return null;
              }
              const normalizedSteps = Math.max(1, Math.min(20, Math.round(stepsValue)));
              return { dir, steps: normalizedSteps } as PlanAction;
            })
            .filter((item): item is PlanAction => item !== null);
          setPlan(cleanedPlan);
          const hint = (payload as { notes?: unknown }).notes;
          setNotes(typeof hint === "string" ? hint : "");
          break;
        }
        case "step": {
          const step = payload as StepPayload;
          if (
            step &&
            typeof step.x === "number" &&
            typeof step.y === "number" &&
            typeof step.dir === "string"
          ) {
            stepQueueRef.current.push(step);
            if (stepTimerRef.current === null) {
              stepTimerRef.current = window.setTimeout(processNextStep, 220);
            }
          }
          break;
        }
        case "done": {
          setStatus("success");
          setMessage("🎉 Bien joué ! Le plan atteint l’objectif.");
          break;
        }
        case "blocked": {
          setStatus("blocked");
          let feedback = "Le plan n'a pas atteint l'objectif.";
          if (payload && typeof payload === "object") {
            const reason = (payload as { reason?: string }).reason;
            if (reason === "obstacle") {
              feedback = "Le bonhomme a heurté un obstacle. Reformule ta consigne pour l'éviter.";
            } else if (reason === "goal_not_reached") {
              feedback = "Le chemin ne mène pas jusqu'à l'objet. Précise chaque direction et le nombre de pas.";
            }
          }
          setMessage(feedback);
          break;
        }
        case "error": {
          setStatus("idle");
          const errorMessage =
            payload && typeof payload === "object" && "message" in payload
              ? String((payload as { message: unknown }).message)
              : "Impossible de générer un plan pour cette consigne.";
          setMessage(errorMessage);
          setIsLoading(false);
          setPhase("brief");
          break;
        }
        case "stats": {
          const statsPayload = payload as ServerStatsPayload;
          if (statsPayload && typeof statsPayload === "object") {
            const duration = startTimeRef.current ? performance.now() - startTimeRef.current : 0;
            setStats({ ...statsPayload, durationMs: Math.max(duration, 0) });
            setIsLoading(false);
            if (statsPayload.success) {
              triggerCelebration();
            } else {
              setCelebrating(false);
            }
            showModalWhenReadyRef.current = true;
            if (!stepQueueRef.current.length && stepTimerRef.current === null) {
              scheduleModalOpen();
            }
          }
          break;
        }
        default:
          break;
      }
    },
    [processNextStep, triggerCelebration]
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const content = instruction.trim();
      if (!content) {
        setMessage("Entre une consigne claire pour lancer l’IA.");
        return;
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setPhase("animating");
      setIsLoading(true);
      setStatus("running");
      setMessage("");
      setPlan([]);
      setNotes("");
      setStats(null);
      setIsStatsModalOpen(false);
      setPlayer(START_POSITION);
      setTrail([START_POSITION]);
      setCelebrating(false);
      if (stepTimerRef.current) {
        window.clearTimeout(stepTimerRef.current);
        stepTimerRef.current = null;
      }
      stepQueueRef.current = [];
      showModalWhenReadyRef.current = false;
      if (openModalTimeoutRef.current) {
        window.clearTimeout(openModalTimeoutRef.current);
        openModalTimeoutRef.current = null;
      }
      startTimeRef.current = performance.now();

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        };
        if (API_AUTH_KEY) {
          headers["x-api-key"] = API_AUTH_KEY;
        }

        const response = await fetch(`${API_BASE_URL}/plan`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            start: START_POSITION,
            goal: target,
            blocked: blocked.map((cell) => [cell.x, cell.y]),
            instruction: content,
            runId: runIdRef.current,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "Le serveur n'a pas pu générer de plan.");
        }

        if (!response.body) {
          throw new Error("Flux de réponse indisponible.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const feedChunk = (chunk: string) => {
          const lines = chunk.split("\n");
          let eventName = "message";
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.replace("event:", "").trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.replace("data:", "").trim());
            }
          }
          const dataStr = dataLines.join("");
          let parsed: unknown = null;
          if (dataStr && dataStr !== "null") {
            try {
              parsed = JSON.parse(dataStr);
            } catch {
              parsed = dataStr;
            }
          }
          handleServerEvent(eventName, parsed);
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              feedChunk(buffer);
            }
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (chunk.trim()) {
              feedChunk(chunk);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (error) {
        if ((error as DOMException).name === "AbortError") {
          return;
        }
        if (mountedRef.current) {
          setStatus("idle");
          setMessage((error as Error).message || "Erreur lors de l'exécution du plan.");
          setPhase("brief");
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [blocked, handleServerEvent, instruction, target]
  );

  const handleStart = useCallback(() => {
    setPhase("brief");
    resetRoundState({ nextTarget: createRandomTarget(), nextObstacles: [], newRunId: true });
  }, [resetRoundState]);

  const handleBackToIntro = useCallback(() => {
    setPhase("intro");
    resetRoundState({ nextTarget: createRandomTarget(), nextObstacles: [], newRunId: true });
    setInstruction("");
  }, [resetRoundState]);

  const handleReplay = useCallback(() => {
    setPhase("brief");
    const nextTarget = createRandomTarget(target);
    const sanitizedObstacles = blocked.filter((cell) => cell.x !== nextTarget.x || cell.y !== nextTarget.y);
    resetRoundState({ nextTarget, nextObstacles: sanitizedObstacles, newRunId: true });
    setInstruction("");
  }, [blocked, resetRoundState, target]);

  const handleShuffleObstacles = useCallback(() => {
    setPhase("brief");
    const next = createRandomObstacles(target);
    resetRoundState({ nextObstacles: next, newRunId: true });
    setInstruction("");
  }, [resetRoundState, target]);

  const handleCompleteActivity = useCallback(async () => {
    if (isCompletingActivity) {
      return;
    }
    setIsCompletingActivity(true);
    try {
      await updateActivityProgress({ activityId: "clarity", completed: true });
      setActivityProgressMarked(true);
    } catch (error) {
      console.error("Unable to persist clarity path progress", error);
    } finally {
      if (mountedRef.current) {
        setIsCompletingActivity(false);
      }
      navigate("/activites", { state: { completed: "clarity" } });
    }
  }, [isCompletingActivity, navigate]);

  const statsSummary = useMemo(() => {
    if (!stats) {
      return "";
    }
    const optimalPart =
      stats.optimalPathLength !== null
        ? `optimal ${stats.optimalPathLength}`
        : "optimal inconnu";
    const surcout = typeof stats.surcout === "number" ? stats.surcout : null;
    const surcoutLabel = surcout !== null ? `${surcout > 0 ? "+" : ""}${surcout}` : "–";
    if (stats.success) {
      return `Tu as atteint l’objectif en ${stats.stepsExecuted} pas (${optimalPart}, surcoût ${surcoutLabel}).\nTa consigne finale précisait direction, distance et objectif : résultat immédiat !`;
    }
    return `Échec : le plan s’est arrêté après ${stats.stepsExecuted} pas (${optimalPart}).\nAjoute des directions explicites et indique le nombre de cases pour guider le modèle.`;
  }, [stats]);


  if (phase === "intro") {
    return (
      <ActivityLayout
        activityId="clarity-intro"
        eyebrow="Parcours de la clarté"
        title="Donner une bonne consigne, c’est gagner du temps."
        subtitle="Avant de jouer, découvre comment la précision de tes instructions influence directement le trajet de notre bonhomme. Formule une consigne claire pour atteindre la cible rapidement."
        titleAlign="center"
        contentAs="div"
        contentClassName="gap-0"
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-10 text-center">
          <div className="grid gap-4 text-left text-sm text-[color:var(--brand-charcoal)] md:grid-cols-3">
            <div className="rounded-3xl border border-white/60 bg-white/90 p-6 shadow-sm">
              Une consigne vague = essais, détours, blocages.
            </div>
            <div className="rounded-3xl border border-white/60 bg-white/90 p-6 shadow-sm">
              Une consigne précise = trajectoire directe et résultat fiable.
            </div>
            <div className="rounded-3xl border border-white/60 bg-white/90 p-6 shadow-sm">
              Ici, ta formulation influe sur le chemin du bonhomme.
            </div>
          </div>
          <button
            type="button"
            onClick={handleStart}
            className="cta-button cta-button--primary mx-auto inline-flex items-center gap-2"
          >
            Jouer
            <span className="text-lg">→</span>
          </button>
        </div>
      </ActivityLayout>
    );
  }

  return (
    <ActivityLayout
      activityId="clarity"
      eyebrow="Parcours de la clarté"
      title="Guide le bonhomme avec une consigne limpide"
      subtitle="Écris une instruction en langue naturelle. Le backend demande au modèle gpt-5-nano un plan complet, valide la trajectoire puis te montre l’exécution pas à pas."
      badge="Mode jeu"
      beforeHeader={<FireworksOverlay active={celebrating} />}
      innerClassName="relative"
      contentAs="div"
      contentClassName="gap-10"
    >
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <section className="rounded-3xl border border-white/60 bg-white/85 p-8 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-8">
            <div className="space-y-4 text-sm text-[color:var(--brand-charcoal)]">
              <p>
                Objectif actuel : <strong>🎯 ({target.x}, {target.y})</strong>. Bonhomme au départ : <strong>(0,0)</strong>.
              </p>
              <p>
                Mouvements autorisés : left, right, up, down. Le backend génère d’abord un plan complet, le valide puis diffuse l’animation.
              </p>
            </div>

            <ClarityGrid player={player} target={target} blocked={blocked} visited={visitedCells} />

            {message && (
              <div
                className={`rounded-2xl p-4 text-sm ${
                  status === "success"
                    ? "bg-[color:var(--brand-green,#66CDAA)]/20 text-[color:var(--brand-black)]"
                    : status === "blocked"
                    ? "bg-[color:var(--brand-red)]/15 text-[color:var(--brand-charcoal)]"
                    : "bg-white/70 text-[color:var(--brand-charcoal)]"
                }`}
              >
                {message}
              </div>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-6">
          <section className="rounded-3xl border border-white/60 bg-white/90 p-6 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-[color:var(--brand-black)]">Ta consigne</h3>
                <button
                  type="button"
                  className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-charcoal)] hover:text-[color:var(--brand-black)]"
                  onClick={() => setInstruction("Descends 9 cases puis va à droite 9 cases jusqu’à l’objet en bas à droite.")}
                  disabled={isInstructionDisabled}
                >
                  Exemple clair
                </button>
              </div>
              <textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Exemple : Descends 9 cases puis va à droite 9 cases jusqu'à l’objet en bas à droite."
                rows={4}
                className="w-full rounded-2xl border border-white/60 bg-white/95 p-4 text-sm text-[color:var(--brand-charcoal)] shadow-sm outline-none transition focus:border-[color:var(--brand-red)]/40 focus:ring-2 focus:ring-[color:var(--brand-red)]/30"
                disabled={isInstructionDisabled}
              />
              <div className="flex flex-wrap gap-2 text-xs text-[color:var(--brand-charcoal)]/90">
                {MICRO_TIPS.map((tip) => (
                  <span key={tip} className="rounded-full bg-[color:var(--brand-yellow)]/40 px-3 py-1">
                    {tip}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="cta-button cta-button--primary inline-flex items-center gap-2"
                  disabled={isInstructionDisabled}
                >
                  {isLoading ? "Calcul en cours…" : "Envoyer"}
                  <span className="text-lg">→</span>
                </button>
                <button
                  type="button"
                  className="cta-button inline-flex items-center gap-2 border border-[color:var(--brand-red)]/25 bg-white/80 text-[color:var(--brand-red)] hover:bg-white"
                  onClick={handleShuffleObstacles}
                  disabled={areObstacleActionsDisabled}
                >
                  Changer les obstacles
                </button>
              </div>
            </form>
          </section>

          <PlanPreview plan={plan} notes={notes} />
          <ClarityTipsPanel />
        </aside>
      </div>

      {stats && isStatsModalOpen && (
        <StatsModal
          stats={stats}
          summary={statsSummary}
          onComplete={handleCompleteActivity}
          isCompleting={isCompletingActivity}
          onReplay={() => {
            setIsStatsModalOpen(false);
            handleReplay();
          }}
          onShuffle={() => {
            setIsStatsModalOpen(false);
            handleShuffleObstacles();
          }}
          onExit={() => {
            setIsStatsModalOpen(false);
            handleBackToIntro();
          }}
        />
      )}
    </ActivityLayout>
  );

}

export default ClarityPath;
