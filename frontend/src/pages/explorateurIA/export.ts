import { cloneProgress, type ExplorateurProgress } from "./progress";
import { QUARTER_ORDER, type QuarterId } from "./types";

export interface QuarterExportEntry {
  id: QuarterId;
  done: boolean;
  payloads: Record<string, unknown>;
  details: Record<string, unknown>;
}

export interface ExplorateurExportData {
  activity: string;
  generatedAt: string;
  completionRate: number;
  visited: QuarterId[];
  quarters: Record<QuarterId, QuarterExportEntry>;
}

function toNullable<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

function sanitizePayloads(value: Record<string, unknown>): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return { ...value };
}

function computeCompletionRate(progress: ExplorateurProgress): number {
  const completedCount = QUARTER_ORDER.reduce((total, quarter) => {
    const isDone = progress[quarter]?.done ?? false;
    return total + (isDone ? 1 : 0);
  }, 0);
  return Math.round((completedCount / QUARTER_ORDER.length) * 100);
}

export function createExplorateurExport(
  progress: ExplorateurProgress
): ExplorateurExportData {
  const cloned = cloneProgress(progress);

  const quarters: Record<QuarterId, QuarterExportEntry> = {
    clarte: {
      id: "clarte",
      done: cloned.clarte.done,
      payloads: sanitizePayloads(cloned.clarte.payloads),
      details: {
        score: cloned.clarte.score,
        selectedOptionId: toNullable(cloned.clarte.selectedOptionId),
        explanation: toNullable(cloned.clarte.explanation),
      },
    },
    creation: {
      id: "creation",
      done: cloned.creation.done,
      payloads: sanitizePayloads(cloned.creation.payloads),
      details: {
        spec: cloned.creation.spec ?? null,
        reflection: cloned.creation.reflection ?? null,
      },
    },
    decision: {
      id: "decision",
      done: cloned.decision.done,
      payloads: sanitizePayloads(cloned.decision.payloads),
      details: {
        path: cloned.decision.path ?? null,
        visitedSteps: cloned.decision.visitedSteps ?? null,
      },
    },
    ethique: {
      id: "ethique",
      done: cloned.ethique.done,
      payloads: sanitizePayloads(cloned.ethique.payloads),
      details: {
        averageScore: cloned.ethique.averageScore,
        answers: cloned.ethique.answers,
        commitment: cloned.ethique.commitment ?? null,
      },
    },
    mairie: {
      id: "mairie",
      done: cloned.mairie.done,
      payloads: sanitizePayloads(cloned.mairie.payloads),
      details: {
        reflection: cloned.mairie.reflection ?? null,
      },
    },
  };

  return {
    activity: "Explorateur IA",
    generatedAt: new Date().toISOString(),
    completionRate: computeCompletionRate(cloned),
    visited: [...cloned.visited],
    quarters,
  };
}
