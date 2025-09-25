import { createContext } from "react";
import type { ComponentType } from "react";

export interface CompositeStepModuleDefinition {
  id: string;
  component: string;
  slot?: string;
  config?: unknown;
}

export interface CompositeStepConfig {
  modules: CompositeStepModuleDefinition[];
  autoAdvance?: boolean;
  continueLabel?: string;
}

export interface ComponentStepDefinition {
  id: string;
  component: string;
  config?: unknown;
  composite?: never;
}

export interface CompositeStepDefinition {
  id: string;
  component?: string;
  config?: unknown;
  composite: CompositeStepConfig;
}

export type StepDefinition =
  | ComponentStepDefinition
  | CompositeStepDefinition;

export function isCompositeStepDefinition(
  step: StepDefinition
): step is CompositeStepDefinition {
  return (
    typeof step === "object" &&
    step !== null &&
    "composite" in step &&
    typeof step.composite !== "undefined"
  );
}

export function resolveStepComponentKey(
  step: StepDefinition
): string | undefined {
  if (isCompositeStepDefinition(step)) {
    return step.component ?? "composite";
  }
  return step.component;
}

export interface StepComponentProps {
  definition: StepDefinition;
  config: unknown;
  payload: unknown;
  isActive: boolean;
  isEditMode: boolean;
  onAdvance: (payload?: unknown) => void;
  onUpdateConfig: (config: unknown) => void;
}

export type StepRegistry = Record<string, ComponentType<StepComponentProps>>;

export interface StepSequenceContextValue {
  stepIndex: number;
  stepCount: number;
  steps: StepDefinition[];
  payloads: Record<string, unknown>;
  isEditMode: boolean;
  onAdvance: (payload?: unknown) => void;
  onUpdateConfig: (config: unknown) => void;
  goToStep: (target: number | string) => void;
  activityContext?: Record<string, unknown> | null;
  compositeModules?: Record<string, CompositeStepModuleDefinition[]>;
}

export const StepSequenceContext = createContext<StepSequenceContextValue | undefined>(
  undefined
);
