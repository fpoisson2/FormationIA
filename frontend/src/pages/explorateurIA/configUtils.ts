import { isCompositeStepDefinition } from "../../modules/step-sequence/types";
import type { StepDefinition } from "../../modules/step-sequence";

import type { QuarterId } from "./types";
import type { QuarterSteps } from "./worlds/world1/steps";

export function cloneStepConfig<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (error) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[ExplorateurIA] Unable to clone step configuration", error);
    }
    return value;
  }
}

export function cloneStepDefinition(step: StepDefinition): StepDefinition {
  if (isCompositeStepDefinition(step)) {
    return {
      id: step.id,
      component: step.component,
      config:
        step.config === undefined ? undefined : cloneStepConfig(step.config),
      composite: cloneStepConfig(step.composite),
    } satisfies StepDefinition;
  }
  return {
    id: step.id,
    component: step.component,
    config:
      step.config === undefined ? undefined : cloneStepConfig(step.config),
  } satisfies StepDefinition;
}

export function cloneQuarterStepMap(map: QuarterSteps): QuarterSteps {
  const result: Partial<QuarterSteps> = {};
  for (const [quarterId, steps] of Object.entries(map) as Array<[
    QuarterId,
    StepDefinition[]
  ]>) {
    result[quarterId] = steps.map(cloneStepDefinition);
  }
  return result as QuarterSteps;
}

export function ensureStepHasQuarterPrefix(
  stepId: string,
  quarterId: QuarterId
): string {
  if (!stepId) {
    return `${quarterId}:step-1`;
  }
  const trimmed = stepId.trim();
  if (trimmed.startsWith(`${quarterId}:`)) {
    return trimmed;
  }
  const sanitized = trimmed.replace(/\s+/g, "-");
  return `${quarterId}:${sanitized}`;
}

export function sanitizeSteps(
  value: unknown,
  fallback?: StepDefinition[]
): StepDefinition[] {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(fallback)
    ? fallback
    : [];
  const steps: StepDefinition[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as Partial<StepDefinition> & {
      id?: unknown;
      component?: unknown;
      config?: unknown;
    };
    if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
      continue;
    }
    if (
      typeof candidate.component !== "string" ||
      candidate.component.trim().length === 0
    ) {
      continue;
    }
    steps.push({
      id: candidate.id,
      component: candidate.component,
      config:
        candidate.config === undefined
          ? undefined
          : cloneStepConfig(candidate.config),
    });
  }
  return steps;
}
