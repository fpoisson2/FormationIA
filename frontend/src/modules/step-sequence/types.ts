import { createContext } from "react";
import type { ComponentType } from "react";

export interface StepDefinition {
  id: string;
  component: string;
  config?: unknown;
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

export type StepSequenceWrapperPreference = "default" | "bare";

export type StepComponentWithMetadata = ComponentType<StepComponentProps> & {
  stepSequenceWrapper?: StepSequenceWrapperPreference;
};

export type StepRegistry = Record<string, StepComponentWithMetadata>;

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
}

export const StepSequenceContext = createContext<StepSequenceContextValue | undefined>(
  undefined
);
