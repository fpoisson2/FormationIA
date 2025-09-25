import type { StageAnswer } from "../../api";

import type { CreationSpec } from "./modules/CreationBuilderModule";
import type { DecisionPathResult } from "./modules/DecisionPathModule";
import type { EthicsDilemmasResult } from "./modules/EthicsDilemmasModule";
import type { QuarterId } from "./types";

export type ClarteQuizResult = {
  score: number;
  selectedOptionId?: string;
  explanation?: string;
};

export interface QuarterProgressBase {
  done: boolean;
  payloads: Record<string, unknown>;
}

export interface ClarteProgress extends QuarterProgressBase {
  score: number;
  selectedOptionId?: string;
  explanation?: string;
}

export interface CreationProgress extends QuarterProgressBase {
  spec?: CreationSpec;
  reflection?: StageAnswer;
}

export interface DecisionProgress extends QuarterProgressBase {
  path?: DecisionPathResult["selectedOptions"];
  visitedSteps?: DecisionPathResult["visitedSteps"];
}

export type EthicsAnswer = EthicsDilemmasResult["answers"][number];

export interface EthicsProgress extends QuarterProgressBase {
  averageScore: number;
  answers: EthicsAnswer[];
  commitment?: StageAnswer;
}

export interface MairieProgress extends QuarterProgressBase {
  reflection?: StageAnswer;
}

export interface ExplorateurProgress {
  clarte: ClarteProgress;
  creation: CreationProgress;
  decision: DecisionProgress;
  ethique: EthicsProgress;
  mairie: MairieProgress;
  extras: Record<QuarterId, QuarterProgressBase>;
  visited: QuarterId[];
}

export function createInitialProgress(): ExplorateurProgress {
  return {
    clarte: { done: false, score: 0, payloads: {} },
    creation: { done: false, payloads: {} },
    decision: { done: false, payloads: {} },
    ethique: { done: false, averageScore: 0, answers: [], payloads: {} },
    mairie: { done: false, payloads: {} },
    extras: {},
    visited: [],
  };
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (error) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn("Explorateur IA: structuredClone failed", error);
      }
    }
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (error) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("Explorateur IA: unable to clone value", error);
    }
    return value;
  }
}

function sanitizePayloadMap(
  payloads: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!payloads || typeof payloads !== "object") {
    return {};
  }
  const clone = cloneValue(payloads);
  if (!clone || typeof clone !== "object") {
    return {};
  }
  return { ...(clone as Record<string, unknown>) };
}

function isStageAnswer(value: unknown): value is StageAnswer {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isClarteQuizResult(value: unknown): value is ClarteQuizResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as ClarteQuizResult;
  return (
    typeof candidate.score === "number" &&
    (candidate.selectedOptionId === undefined ||
      typeof candidate.selectedOptionId === "string") &&
    (candidate.explanation === undefined ||
      typeof candidate.explanation === "string")
  );
}

function isCreationSpec(value: unknown): value is CreationSpec {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as CreationSpec;
  return (
    (candidate.action === null || typeof candidate.action === "string") &&
    (candidate.media === null || typeof candidate.media === "string") &&
    (candidate.style === null || typeof candidate.style === "string") &&
    (candidate.theme === null || typeof candidate.theme === "string")
  );
}

function isDecisionPathResult(value: unknown): value is DecisionPathResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as DecisionPathResult;
  return (
    Array.isArray(candidate.selectedOptions) &&
    Array.isArray(candidate.visitedSteps)
  );
}

function isEthicsDilemmasResult(value: unknown): value is EthicsDilemmasResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as EthicsDilemmasResult;
  return (
    Array.isArray(candidate.answers) &&
    typeof candidate.averageScore === "number"
  );
}

export type QuarterPayloadMap = Record<string, unknown>;

export function updateClarteProgress(
  previous: ClarteProgress,
  payloads: QuarterPayloadMap | undefined
): ClarteProgress {
  const sanitized = sanitizePayloadMap(payloads);
  const quizPayload = sanitized["clarte:quiz"];
  const quizResult = isClarteQuizResult(quizPayload)
    ? quizPayload
    : undefined;
  return {
    done: true,
    payloads: sanitized,
    score: quizResult?.score ?? previous.score ?? 0,
    selectedOptionId: quizResult?.selectedOptionId ?? previous.selectedOptionId,
    explanation: quizResult?.explanation ?? previous.explanation,
  };
}

export function updateCreationProgress(
  previous: CreationProgress,
  payloads: QuarterPayloadMap | undefined
): CreationProgress {
  const sanitized = sanitizePayloadMap(payloads);
  const specPayload = sanitized["creation:builder"];
  const reflectionPayload = sanitized["creation:reflection"];
  return {
    done: true,
    payloads: sanitized,
    spec: isCreationSpec(specPayload) ? specPayload : previous.spec,
    reflection: isStageAnswer(reflectionPayload)
      ? (reflectionPayload as StageAnswer)
      : previous.reflection,
  };
}

export function updateDecisionProgress(
  previous: DecisionProgress,
  payloads: QuarterPayloadMap | undefined
): DecisionProgress {
  const sanitized = sanitizePayloadMap(payloads);
  const pathPayload = sanitized["decision:path"];
  const result = isDecisionPathResult(pathPayload) ? pathPayload : undefined;
  return {
    done: true,
    payloads: sanitized,
    path: result?.selectedOptions ?? previous.path,
    visitedSteps: result?.visitedSteps ?? previous.visitedSteps,
  };
}

export function updateEthicsProgress(
  previous: EthicsProgress,
  payloads: QuarterPayloadMap | undefined
): EthicsProgress {
  const sanitized = sanitizePayloadMap(payloads);
  const dilemmasPayload = sanitized["ethique:dilemmas"];
  const result = isEthicsDilemmasResult(dilemmasPayload)
    ? dilemmasPayload
    : undefined;
  const commitmentPayload = sanitized["ethique:commitment"];
  return {
    done: true,
    payloads: sanitized,
    averageScore: result?.averageScore ?? previous.averageScore ?? 0,
    answers: result?.answers ?? previous.answers ?? [],
    commitment: isStageAnswer(commitmentPayload)
      ? (commitmentPayload as StageAnswer)
      : previous.commitment,
  };
}

export function updateMairieProgress(
  previous: MairieProgress,
  payloads: QuarterPayloadMap | undefined
): MairieProgress {
  const sanitized = sanitizePayloadMap(payloads);
  const feedbackPayload = sanitized["mairie:feedback"];
  return {
    done: true,
    payloads: sanitized,
    reflection: isStageAnswer(feedbackPayload)
      ? (feedbackPayload as StageAnswer)
      : previous.reflection,
  };
}

export function updateGenericQuarterProgress(
  previous: QuarterProgressBase | undefined,
  payloads: QuarterPayloadMap | undefined
): QuarterProgressBase {
  const sanitized = sanitizePayloadMap(payloads);
  return {
    done: true,
    payloads: previous ? { ...previous.payloads, ...sanitized } : sanitized,
  } satisfies QuarterProgressBase;
}

export function cloneProgress(progress: ExplorateurProgress): ExplorateurProgress {
  return {
    clarte: { ...progress.clarte, payloads: cloneValue(progress.clarte.payloads) },
    creation: {
      ...progress.creation,
      payloads: cloneValue(progress.creation.payloads),
      spec: progress.creation.spec
        ? cloneValue(progress.creation.spec)
        : progress.creation.spec,
      reflection: progress.creation.reflection
        ? cloneValue(progress.creation.reflection)
        : progress.creation.reflection,
    },
    decision: {
      ...progress.decision,
      payloads: cloneValue(progress.decision.payloads),
      path: progress.decision.path ? [...progress.decision.path] : undefined,
      visitedSteps: progress.decision.visitedSteps
        ? [...progress.decision.visitedSteps]
        : undefined,
    },
    ethique: {
      ...progress.ethique,
      payloads: cloneValue(progress.ethique.payloads),
      answers: progress.ethique.answers.map((answer) => ({ ...answer })),
      commitment: progress.ethique.commitment
        ? cloneValue(progress.ethique.commitment)
        : progress.ethique.commitment,
    },
    mairie: {
      ...progress.mairie,
      payloads: cloneValue(progress.mairie.payloads),
      reflection: progress.mairie.reflection
        ? cloneValue(progress.mairie.reflection)
        : progress.mairie.reflection,
    },
    extras: Object.entries(progress.extras).reduce(
      (acc, [id, extra]) => {
        acc[id as QuarterId] = {
          done: extra.done,
          payloads: cloneValue(extra.payloads),
        } satisfies QuarterProgressBase;
        return acc;
      },
      {} as Record<QuarterId, QuarterProgressBase>
    ),
    visited: [...progress.visited],
  };
}
