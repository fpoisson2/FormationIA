import { useContext } from "react";

import { getStepComponent, registerStepComponent, STEP_COMPONENT_REGISTRY } from "./registry";
import { StepSequenceRenderer } from "./StepSequenceRenderer";
import type {
  StepSequenceRenderWrapperProps,
  StepSequenceRendererProps,
} from "./StepSequenceRenderer";
import { StepSequenceActivity } from "./StepSequenceActivity";
import type {
  StepSequenceActivityConfig,
  StepSequenceActivityProps,
} from "./StepSequenceActivity";
import {
  StepSequenceContext,
  type StepComponentProps,
  type StepComponentWithMetadata,
  type StepDefinition,
  type StepRegistry,
  type StepSequenceActivityContextBridge,
  type StepSequenceContextValue,
  type StepSequenceWrapperPreference,
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
  StepSequenceActivity,
  StepSequenceRenderer,
  StepSequenceContext,
  STEP_COMPONENT_REGISTRY,
  getStepComponent,
  registerStepComponent,
};

export * from "./modules";
export * from "./tools";

export { isCompositeStepDefinition, resolveStepComponentKey } from "./types";
export type { CompositeStepConfig, CompositeStepModuleDefinition } from "./types";

export type {
  StepSequenceActivityConfig,
  StepSequenceActivityProps,
  StepDefinition,
  StepComponentProps,
  StepRegistry,
  StepSequenceContextValue,
  StepSequenceRendererProps,
  StepSequenceRenderWrapperProps,
  StepComponentWithMetadata,
  StepSequenceWrapperPreference,
  StepSequenceActivityContextBridge,
};
