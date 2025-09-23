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

export type StepRegistry = Record<string, ComponentType<StepComponentProps>>;

export interface StepSequenceContextValue {
  stepIndex: number;
  isEditMode: boolean;
  onAdvance: (payload?: unknown) => void;
  onUpdateConfig: (config: unknown) => void;
}

export const StepSequenceContext = createContext<StepSequenceContextValue | undefined>(
  undefined
);
