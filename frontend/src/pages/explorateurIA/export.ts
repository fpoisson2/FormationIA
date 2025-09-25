import { cloneProgress, type ExplorateurProgress } from "./progress";
import { isQuarterId, type QuarterId } from "./types";
import { DEFAULT_DERIVED_QUARTERS } from "./config";

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

const DEFAULT_QUARTER_ORDER: QuarterId[] = [
  ...DEFAULT_DERIVED_QUARTERS.quarterOrder,
];

function normalizeQuarterOrder(
  order: QuarterId[] | undefined,
  extras: Record<QuarterId, unknown>
): QuarterId[] {
  const seen = new Set<QuarterId>();
  const result: QuarterId[] = [];

  if (Array.isArray(order)) {
    for (const candidate of order) {
      if (!isQuarterId(candidate) || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      result.push(candidate);
    }
  }

  for (const key of Object.keys(extras) as QuarterId[]) {
    if (!isQuarterId(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(key);
  }

  for (const id of DEFAULT_QUARTER_ORDER) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  return result;
}

function isQuarterDone(progress: ExplorateurProgress, id: QuarterId): boolean {
  switch (id) {
    case "clarte":
      return progress.clarte.done;
    case "creation":
      return progress.creation.done;
    case "decision":
      return progress.decision.done;
    case "ethique":
      return progress.ethique.done;
    case "mairie":
      return progress.mairie.done;
    default:
      return Boolean(progress.extras[id]?.done);
  }
}

function computeCompletionRate(
  progress: ExplorateurProgress,
  order: QuarterId[]
): number {
  if (order.length === 0) {
    return 0;
  }
  const completedCount = order.reduce(
    (total, quarter) => total + (isQuarterDone(progress, quarter) ? 1 : 0),
    0
  );
  return Math.round((completedCount / order.length) * 100);
}

export interface CreateExplorateurExportOptions {
  quarterOrder?: QuarterId[];
}

export function createExplorateurExport(
  progress: ExplorateurProgress,
  options?: CreateExplorateurExportOptions
): ExplorateurExportData {
  const cloned = cloneProgress(progress);
  const quarterOrder = normalizeQuarterOrder(options?.quarterOrder, cloned.extras);

  const entries: Array<[QuarterId, QuarterExportEntry]> = [
    [
      "clarte",
      {
        id: "clarte",
        done: cloned.clarte.done,
        payloads: sanitizePayloads(cloned.clarte.payloads),
        details: {
          score: cloned.clarte.score,
          selectedOptionId: toNullable(cloned.clarte.selectedOptionId),
          explanation: toNullable(cloned.clarte.explanation),
        },
      },
    ],
    [
      "creation",
      {
        id: "creation",
        done: cloned.creation.done,
        payloads: sanitizePayloads(cloned.creation.payloads),
        details: {
          spec: cloned.creation.spec ?? null,
          reflection: cloned.creation.reflection ?? null,
        },
      },
    ],
    [
      "decision",
      {
        id: "decision",
        done: cloned.decision.done,
        payloads: sanitizePayloads(cloned.decision.payloads),
        details: {
          path: cloned.decision.path ?? null,
          visitedSteps: cloned.decision.visitedSteps ?? null,
        },
      },
    ],
    [
      "ethique",
      {
        id: "ethique",
        done: cloned.ethique.done,
        payloads: sanitizePayloads(cloned.ethique.payloads),
        details: {
          averageScore: cloned.ethique.averageScore,
          answers: cloned.ethique.answers,
          commitment: cloned.ethique.commitment ?? null,
        },
      },
    ],
    [
      "mairie",
      {
        id: "mairie",
        done: cloned.mairie.done,
        payloads: sanitizePayloads(cloned.mairie.payloads),
        details: {
          reflection: cloned.mairie.reflection ?? null,
        },
      },
    ],
  ];

  for (const [id, extra] of Object.entries(cloned.extras)) {
    if (!isQuarterId(id)) {
      continue;
    }
    entries.push([
      id as QuarterId,
      {
        id: id as QuarterId,
        done: Boolean(extra?.done),
        payloads: sanitizePayloads(extra?.payloads ?? {}),
        details: {},
      },
    ]);
  }

  const quarters = entries.reduce(
    (acc, [id, entry]) => {
      acc[id] = entry;
      return acc;
    },
    {} as Record<QuarterId, QuarterExportEntry>
  );

  return {
    activity: "Explorateur IA",
    generatedAt: new Date().toISOString(),
    completionRate: computeCompletionRate(cloned, quarterOrder),
    visited: [...cloned.visited],
    quarters,
  };
}
