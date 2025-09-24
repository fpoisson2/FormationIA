export type ClarityDirection = "left" | "right" | "up" | "down";

export interface GridCoord {
  x: number;
  y: number;
}

export interface PlanAction {
  dir: ClarityDirection;
  steps: number;
}

export interface StepPayload extends GridCoord {
  dir: ClarityDirection;
  i: number;
}

export interface ServerStatsPayload {
  runId: string;
  attempts: number;
  stepsExecuted: number;
  optimalPathLength: number | null;
  surcout: number | null;
  success: boolean;
  finalPosition: GridCoord;
  ambiguity?: string;
}

export interface ClientStats extends ServerStatsPayload {
  durationMs: number;
}

export type RunStatus = "idle" | "running" | "success" | "blocked" | "error";
