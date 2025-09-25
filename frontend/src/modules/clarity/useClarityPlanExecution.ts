import { useCallback, useEffect, useRef, useState } from "react";

import { API_AUTH_KEY, API_BASE_URL } from "../../config";
import type { ModelChoice, ThinkingChoice, VerbosityChoice } from "../../config";
import { START_POSITION } from "./constants";
import { gridKey } from "./utils";
import type {
  ClientStats,
  GridCoord,
  PlanAction,
  RunStatus,
  ServerStatsPayload,
  StepPayload,
} from "./types";

export interface ClarityPlanExecutionRequest {
  instruction: string;
  goal: GridCoord;
  blocked: GridCoord[];
  runId: string;
  start?: GridCoord;
  model?: ModelChoice;
  verbosity?: VerbosityChoice;
  thinking?: ThinkingChoice;
  developerMessage?: string;
}

export interface ClarityPlanExecutionOutcome {
  status: RunStatus;
  message: string;
  plan: PlanAction[];
  notes: string;
  stats: ClientStats | null;
  trail: GridCoord[];
}

function sanitizePlan(payload: unknown): PlanAction[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const rawPlan = Array.isArray((payload as { plan?: unknown[] }).plan)
    ? ((payload as { plan: unknown[] }).plan ?? [])
    : [];
  return rawPlan
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
}

function sanitizeStep(payload: unknown): StepPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const step = payload as StepPayload;
  if (
    typeof step.x === "number" &&
    typeof step.y === "number" &&
    (step.dir === "left" || step.dir === "right" || step.dir === "up" || step.dir === "down")
  ) {
    return step;
  }
  return null;
}

export function useClarityPlanExecution() {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [plan, setPlan] = useState<PlanAction[]>([]);
  const [notes, setNotes] = useState("");
  const [stats, setStats] = useState<ClientStats | null>(null);
  const [trail, setTrail] = useState<GridCoord[]>([]);

  const planRef = useRef<PlanAction[]>([]);
  const notesRef = useRef("");
  const statsRef = useRef<ClientStats | null>(null);
  const trailRef = useRef<GridCoord[]>([]);
  const statusRef = useRef<RunStatus>("idle");
  const messageRef = useRef("");

  const controllerRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const visitedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (mountedRef.current) {
      setIsLoading(false);
      setStatus("idle");
      setMessage("");
    }
  }, []);

  const buildOutcome = useCallback(
    (): ClarityPlanExecutionOutcome => ({
      status: statusRef.current,
      message: messageRef.current,
      plan: planRef.current,
      notes: notesRef.current,
      stats: statsRef.current,
      trail: trailRef.current,
    }),
    []
  );

  const execute = useCallback(
    async ({
      instruction,
      goal,
      blocked,
      runId,
      start = START_POSITION,
      model,
      verbosity,
      thinking,
      developerMessage,
    }: ClarityPlanExecutionRequest) => {
      if (!instruction.trim()) {
        setMessage("Entre une consigne claire pour lancer l’IA.");
        setStatus("idle");
        return Promise.reject(new Error("Instruction manquante"));
      }

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setIsLoading(true);
      setStatus("running");
      statusRef.current = "running";
      setMessage("");
      messageRef.current = "";
      setPlan([]);
      planRef.current = [];
      setNotes("");
      notesRef.current = "";
      setStats(null);
      statsRef.current = null;
      visitedRef.current = new Set([gridKey(start)]);
      const initialTrail = [start];
      trailRef.current = initialTrail;
      setTrail(initialTrail);
      startTimeRef.current = performance.now();

      return new Promise<ClarityPlanExecutionOutcome>(async (resolve, reject) => {
        let hasError = false;
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          };
          if (API_AUTH_KEY) {
            headers["x-api-key"] = API_AUTH_KEY;
          }

          const payload: Record<string, unknown> = {
            start,
            goal,
            blocked: blocked.map((cell) => [cell.x, cell.y]),
            instruction: instruction.trim(),
            runId,
          };
          if (model) {
            payload.model = model;
          }
          if (verbosity) {
            payload.verbosity = verbosity;
          }
          if (thinking) {
            payload.thinking = thinking;
          }
          const trimmedDeveloperMessage = developerMessage?.trim();
          if (trimmedDeveloperMessage) {
            payload.developerMessage = trimmedDeveloperMessage;
          }

          const response = await fetch(`${API_BASE_URL}/plan`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
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

          const handleEvent = (eventName: string, payload: unknown) => {
            if (hasError) {
              return;
            }
            if (!mountedRef.current) {
              return;
            }
            switch (eventName) {
              case "plan": {
                const cleanedPlan = sanitizePlan(payload);
                planRef.current = cleanedPlan;
                setPlan(cleanedPlan);
                const hint = (payload as { notes?: unknown }).notes;
                const cleanHint = typeof hint === "string" ? hint : "";
                notesRef.current = cleanHint;
                setNotes(cleanHint);
                break;
              }
              case "step": {
                if (!payload) {
                  return;
                }
                const sanitized = sanitizeStep(payload);
                if (sanitized) {
                  const key = gridKey(sanitized);
                  if (!visitedRef.current.has(key)) {
                    visitedRef.current.add(key);
                    const nextTrail = [...trailRef.current, { x: sanitized.x, y: sanitized.y }];
                    trailRef.current = nextTrail;
                    setTrail(nextTrail);
                  }
                }
                break;
              }
              case "done": {
                statusRef.current = "success";
                setStatus("success");
                messageRef.current = "🎉 Bien joué ! Le plan atteint l’objectif.";
                setMessage("🎉 Bien joué ! Le plan atteint l’objectif.");
                break;
              }
              case "blocked": {
                statusRef.current = "blocked";
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
                messageRef.current = feedback;
                setMessage(feedback);
                break;
              }
              case "error": {
                statusRef.current = "error";
                setStatus("error");
                const errorMessage =
                  payload && typeof payload === "object" && "message" in payload
                    ? String((payload as { message: unknown }).message)
                    : "Impossible de générer un plan pour cette consigne.";
                messageRef.current = errorMessage;
                setMessage(errorMessage);
                setIsLoading(false);
                hasError = true;
                reject(new Error(errorMessage));
                break;
              }
              case "stats": {
                if (payload && typeof payload === "object") {
                  const statsPayload = payload as ServerStatsPayload;
                  const duration = startTimeRef.current ? performance.now() - startTimeRef.current : 0;
                  const clientStats: ClientStats = { ...statsPayload, durationMs: Math.max(duration, 0) };
                  statsRef.current = clientStats;
                  setStats(clientStats);
                  setIsLoading(false);
                }
                break;
              }
              default:
                break;
            }
          };

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
            handleEvent(eventName, parsed);
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

          setIsLoading(false);
          if (!hasError) {
            resolve(buildOutcome());
          }
        } catch (error) {
          if ((error as DOMException).name === "AbortError") {
            return;
          }
          const message = (error as Error).message || "Erreur lors de l'exécution du plan.";
          statusRef.current = "error";
          setStatus("error");
          messageRef.current = message;
          setMessage(message);
          setIsLoading(false);
          reject(error);
        } finally {
          controllerRef.current = null;
        }
      });
    },
    [buildOutcome]
  );

  return {
    status,
    isLoading,
    message,
    plan,
    notes,
    stats,
    trail,
    execute,
    abort,
  };
}
