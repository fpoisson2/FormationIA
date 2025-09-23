import { useCallback, useEffect, useMemo, useState } from "react";

import { getStepComponent } from "./registry";
import { StepSequenceContext } from "./types";
import type { StepComponentProps, StepDefinition } from "./types";

export interface StepSequenceRendererProps {
  steps: StepDefinition[];
  initialIndex?: number;
  isEditMode?: boolean;
  onComplete?: (payloads: Record<string, unknown>) => void;
}

export function StepSequenceRenderer({
  steps,
  initialIndex = 0,
  isEditMode = false,
  onComplete,
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
    },
    [currentIndex, steps]
  );

  const contextValue = useMemo(
    () => ({
      stepIndex: currentIndex,
      isEditMode,
      onAdvance: handleAdvance,
      onUpdateConfig: handleConfigUpdate,
    }),
    [currentIndex, handleAdvance, handleConfigUpdate, isEditMode]
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

  return (
    <StepSequenceContext.Provider value={contextValue}>
      <StepComponent {...componentProps} />
    </StepSequenceContext.Provider>
  );
}
