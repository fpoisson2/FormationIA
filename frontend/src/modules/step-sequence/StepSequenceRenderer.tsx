import { useCallback, useEffect, useMemo, useState } from "react";

import { getStepComponent } from "./registry";
import { StepSequenceContext } from "./types";
import type {
  StepComponentProps,
  StepDefinition,
  StepSequenceContextValue,
  StepComponentWithMetadata,
} from "./types";

export interface StepSequenceRenderWrapperProps {
  step: StepDefinition;
  stepIndex: number;
  stepCount: number;
  StepComponent: StepComponentWithMetadata;
  componentProps: StepComponentProps;
  context: StepSequenceContextValue;
  advance: (payload?: unknown) => void;
}

export interface StepSequenceRendererProps {
  steps: StepDefinition[];
  initialIndex?: number;
  isEditMode?: boolean;
  onComplete?: (payloads: Record<string, unknown>) => void;
  activityContext?: Record<string, unknown> | null;
  onStepConfigChange?: (stepId: string, config: unknown) => void;
  renderStepWrapper?: (props: StepSequenceRenderWrapperProps) => JSX.Element;
}

export function StepSequenceRenderer({
  steps,
  initialIndex = 0,
  isEditMode = false,
  onComplete,
  activityContext = null,
  onStepConfigChange,
  renderStepWrapper,
}: StepSequenceRendererProps): JSX.Element | null {
  const [currentIndex, setCurrentIndex] = useState(() =>
    Math.min(initialIndex, Math.max(steps.length - 1, 0))
  );
  const [stepPayloads, setStepPayloads] = useState<Record<string, unknown>>({});
  const [stepConfigs, setStepConfigs] = useState<Record<string, unknown>>(() => {
    const nextConfigs: Record<string, unknown> = {};
    for (const step of steps) {
      nextConfigs[step.id] = step.config;
    }
    return nextConfigs;
  });

  const stepIdsKey = useMemo(() => steps.map((step) => step.id).join("|"), [steps]);

  useEffect(() => {
    setCurrentIndex((prevIndex) =>
      steps.length === 0 ? 0 : Math.min(prevIndex, steps.length - 1)
    );
    setStepPayloads({});
  }, [stepIdsKey, steps.length]);

  useEffect(() => {
    const nextConfigs: Record<string, unknown> = {};
    for (const step of steps) {
      nextConfigs[step.id] = step.config;
    }
    setStepConfigs(nextConfigs);
  }, [stepIdsKey, steps]);

  const handleAdvance = useCallback(
    (payload?: unknown) => {
      const activeStep = steps[currentIndex];
      if (!activeStep) return;

      setStepPayloads((prev) => {
        const nextPayloads = { ...prev, [activeStep.id]: payload };
        if (currentIndex >= steps.length - 1) {
          onComplete?.(nextPayloads);
        }
        return nextPayloads;
      });

      if (currentIndex < steps.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    },
    [currentIndex, onComplete, steps]
  );

  const handleConfigUpdate = useCallback(
    (config: unknown) => {
      const activeStep = steps[currentIndex];
      if (!activeStep) return;

      setStepConfigs((prev) => ({ ...prev, [activeStep.id]: config }));
      onStepConfigChange?.(activeStep.id, config);
    },
    [currentIndex, onStepConfigChange, steps]
  );

  const goToStep = useCallback(
    (target: number | string) => {
      if (steps.length === 0) {
        return;
      }

      setCurrentIndex((previousIndex) => {
        if (typeof target === "number") {
          if (Number.isNaN(target)) {
            return previousIndex;
          }
          const nextIndex = Math.min(
            Math.max(Math.trunc(target), 0),
            steps.length - 1
          );
          return nextIndex;
        }

        const resolvedIndex = steps.findIndex((step) => step.id === target);
        return resolvedIndex === -1 ? previousIndex : resolvedIndex;
      });
    },
    [steps]
  );

  const contextValue = useMemo(
    () => ({
      stepIndex: currentIndex,
      stepCount: steps.length,
      steps,
      payloads: stepPayloads,
      isEditMode,
      onAdvance: handleAdvance,
      onUpdateConfig: handleConfigUpdate,
      goToStep,
      activityContext,
    }),
    [
      activityContext,
      currentIndex,
      goToStep,
      handleAdvance,
      handleConfigUpdate,
      isEditMode,
      stepPayloads,
      steps,
    ]
  );

  const activeStep = steps[currentIndex];
  if (!activeStep) {
    return null;
  }

  const StepComponent = getStepComponent(activeStep.component);
  if (!StepComponent) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        `No step component registered for key "${activeStep.component}".`
      );
    }
    return null;
  }

  const componentProps: StepComponentProps = {
    definition: activeStep,
    config: stepConfigs[activeStep.id],
    payload: stepPayloads[activeStep.id],
    isActive: true,
    isEditMode,
    onAdvance: handleAdvance,
    onUpdateConfig: handleConfigUpdate,
  };

  if (renderStepWrapper) {
    const wrapperProps: StepSequenceRenderWrapperProps = {
      step: activeStep,
      stepIndex: currentIndex,
      stepCount: steps.length,
      StepComponent,
      componentProps,
      context: contextValue,
      advance: handleAdvance,
    };

    return (
      <StepSequenceContext.Provider value={contextValue}>
        {renderStepWrapper(wrapperProps)}
      </StepSequenceContext.Provider>
    );
  }

  return (
    <StepSequenceContext.Provider value={contextValue}>
      <StepComponent {...componentProps} />
    </StepSequenceContext.Provider>
  );
}
