import type { ComponentType } from "react";

import type { StepComponentProps, StepRegistry } from "./types";

export const STEP_COMPONENT_REGISTRY: StepRegistry = {};

export function registerStepComponent(
  name: string,
  component: ComponentType<StepComponentProps>
): void {
  STEP_COMPONENT_REGISTRY[name] = component;
}

export function getStepComponent(
  name: string
): ComponentType<StepComponentProps> | undefined {
  return STEP_COMPONENT_REGISTRY[name];
}
