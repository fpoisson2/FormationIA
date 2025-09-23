import { useContext } from "react";

import { getStepComponent, registerStepComponent, STEP_COMPONENT_REGISTRY } from "./registry";
import { StepSequenceRenderer } from "./StepSequenceRenderer";
import type { StepSequenceRendererProps } from "./StepSequenceRenderer";
import {
  StepSequenceContext,
  type StepComponentProps,
  type StepDefinition,
  type StepRegistry,
  type StepSequenceContextValue,
} from "./types";

export function StepSequenceContainer(
  props: StepSequenceRendererProps
): JSX.Element | null {
  if (!props.steps.length) {
    return null;
  }

  return <StepSequenceRenderer {...props} />;
}

export function useStepSequence(): StepSequenceContextValue {
  const context = useContext(StepSequenceContext);
  if (!context) {
    throw new Error("useStepSequence must be used within a StepSequenceRenderer");
  }
  return context;
}

export {
  StepSequenceRenderer,
  StepSequenceContext,
  STEP_COMPONENT_REGISTRY,
  getStepComponent,
  registerStepComponent,
};

export * from "./modules";

export type {
  StepDefinition,
  StepComponentProps,
  StepRegistry,
  StepSequenceContextValue,
  StepSequenceRendererProps,
};
