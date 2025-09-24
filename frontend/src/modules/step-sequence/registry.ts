import type {
  StepComponentWithMetadata,
  StepRegistry,
} from "./types";

export const STEP_COMPONENT_REGISTRY: StepRegistry = {};

export function registerStepComponent(
  name: string,
  component: StepComponentWithMetadata
): void {
  STEP_COMPONENT_REGISTRY[name] = component;
}

export function getStepComponent(
  name: string
): StepComponentWithMetadata | undefined {
  return STEP_COMPONENT_REGISTRY[name];
}
