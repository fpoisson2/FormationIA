import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getStepComponent } from "./registry";
import { StepSequenceContext } from "./types";
import type {
  StepComponentProps,
  StepDefinition,
  StepSequenceContextValue,
  StepComponentWithMetadata,
  StepSequenceActivityContextBridge,
  StepSequenceLayoutOverrides,
  ManualAdvanceHandler,
  ManualAdvanceState,
} from "./types";
import { isCompositeStepDefinition, resolveStepComponentKey } from "./types";

function buildInitialConfigs(steps: StepDefinition[]): Record<string, unknown> {
  const nextConfigs: Record<string, unknown> = {};
  for (const step of steps) {
    nextConfigs[step.id] = isCompositeStepDefinition(step)
      ? step.composite
      : step.config;
  }
  return nextConfigs;
}

function sanitizeConfigValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeConfigValue(item, seen));
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if (seen.has(objectValue)) {
      return null;
    }

    seen.add(objectValue);
    const sanitizedEntries = Object.entries(objectValue).reduce<
      Record<string, unknown>
    >((accumulator, [key, entry]) => {
      if (typeof entry === "function") {
        return accumulator;
      }

      const sanitized = sanitizeConfigValue(entry, seen);
      if (typeof sanitized !== "undefined") {
        accumulator[key] = sanitized;
      }

      return accumulator;
    }, {});
    seen.delete(objectValue);
    return sanitizedEntries;
  }

  if (typeof value === "function") {
    return undefined;
  }

  return value;
}

function buildStepsSignature(steps: StepDefinition[]): string {
  try {
    const simplified = steps.map((step) => {
      const seen = new WeakSet<object>();
      if (isCompositeStepDefinition(step)) {
        return {
          id: step.id,
          component: step.component ?? null,
          composite: sanitizeConfigValue(step.composite, seen),
        };
      }
      return {
        id: step.id,
        component: step.component,
        config: sanitizeConfigValue(step.config, seen),
      };
    });
    return JSON.stringify(simplified);
  } catch {
    return steps.map((step) => step.id).join("|");
  }
}

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
  activityContext?: StepSequenceActivityContextBridge | null;
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
  const [stepConfigs, setStepConfigs] = useState<Record<string, unknown>>(() =>
    buildInitialConfigs(steps)
  );

  const [manualAdvanceState, setManualAdvanceState] = useState<ManualAdvanceState>({
    handler: null,
    disabled: false,
  });
  const manualAdvanceStateRef = useRef(manualAdvanceState);

  useEffect(() => {
    manualAdvanceStateRef.current = manualAdvanceState;
  }, [manualAdvanceState]);

  const resetManualAdvanceState = useCallback(() => {
    setManualAdvanceState({ handler: null, disabled: false });
  }, []);

  const stepIdsKey = useMemo(() => steps.map((step) => step.id).join("|"), [steps]);
  const stepsSignature = useMemo(() => buildStepsSignature(steps), [steps]);
  const latestStepsRef = useRef(steps);

  useEffect(() => {
    latestStepsRef.current = steps;
  }, [steps]);

  useEffect(() => {
    setCurrentIndex((prevIndex) =>
      steps.length === 0 ? 0 : Math.min(prevIndex, steps.length - 1)
    );
    setStepPayloads({});
  }, [stepIdsKey, steps.length]);

  useEffect(() => {
    setStepConfigs(buildInitialConfigs(latestStepsRef.current));
  }, [stepsSignature]);

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

      resetManualAdvanceState();

      if (currentIndex < steps.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    },
    [currentIndex, onComplete, resetManualAdvanceState, steps]
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentIndex]);

  const goToStep = useCallback(
    (target: number | string) => {
      if (steps.length === 0) {
        return;
      }

      resetManualAdvanceState();

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
    [resetManualAdvanceState, steps]
  );

  const setManualAdvanceHandler = useCallback((handler: ManualAdvanceHandler | null) => {
    setManualAdvanceState((previous) => ({ ...previous, handler }));
  }, []);

  const setManualAdvanceDisabled = useCallback((disabled: boolean) => {
    setManualAdvanceState((previous) => ({ ...previous, disabled }));
  }, []);

  const getManualAdvanceState = useCallback((): ManualAdvanceState => {
    return manualAdvanceStateRef.current;
  }, []);

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
      setManualAdvanceHandler,
      setManualAdvanceDisabled,
      getManualAdvanceState,
    }),
    [
      getManualAdvanceState,
      activityContext,
      currentIndex,
      goToStep,
      handleAdvance,
      handleConfigUpdate,
      isEditMode,
      setManualAdvanceDisabled,
      setManualAdvanceHandler,
      stepPayloads,
      steps,
    ]
  );

  const activeStep = steps[currentIndex];
  const activeStepId = activeStep?.id ?? null;

  useEffect(() => {
    resetManualAdvanceState();
  }, [activeStepId, resetManualAdvanceState]);
  if (!activeStep) {
    return null;
  }

  const stepComponentKey = resolveStepComponentKey(activeStep);
  if (!stepComponentKey) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        `No step component key could be resolved for step "${activeStep.id}".`
      );
    }
    return null;
  }

  const StepComponent = getStepComponent(stepComponentKey);
  if (!StepComponent) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        `No step component registered for key "${stepComponentKey}".`
      );
    }
    return null;
  }

  const resolvedConfig =
    stepConfigs[activeStep.id] ??
    (isCompositeStepDefinition(activeStep)
      ? activeStep.composite
      : activeStep.config);

  const componentProps: StepComponentProps = {
    definition: activeStep,
    config: resolvedConfig,
    payload: stepPayloads[activeStep.id],
    isActive: true,
    isEditMode,
    onAdvance: handleAdvance,
    onUpdateConfig: handleConfigUpdate,
  };

  const layoutBridge = useMemo(() => {
    if (!activityContext || typeof activityContext !== "object") {
      return null;
    }

    const bridge = activityContext as StepSequenceActivityContextBridge;
    if (typeof bridge.setLayoutOverrides !== "function") {
      return null;
    }

    return {
      layoutOverrides: bridge.layoutOverrides,
      setLayoutOverrides:
        bridge.setLayoutOverrides as (overrides: StepSequenceLayoutOverrides) => void,
      resetLayoutOverrides:
        typeof bridge.resetLayoutOverrides === "function"
          ? (bridge.resetLayoutOverrides as () => void)
          : undefined,
    } as const;
  }, [activityContext]);

  const previousLayoutOverridesRef = useRef<{
    stepId: string | null;
    value: StepSequenceLayoutOverrides | undefined;
  }>({ stepId: null, value: undefined });

  const latestLayoutBridgeRef = useRef(layoutBridge);
  useEffect(() => {
    latestLayoutBridgeRef.current = layoutBridge;
  }, [layoutBridge]);

  const restoreLayoutOverrides = useCallback((bridge: typeof layoutBridge) => {
    const state = previousLayoutOverridesRef.current;
    if (state.stepId === null) {
      return;
    }

    previousLayoutOverridesRef.current = { stepId: null, value: undefined };

    if (!bridge) {
      return;
    }

    const previous = state.value;
    if (previous !== undefined) {
      bridge.setLayoutOverrides(previous);
      return;
    }

    if (bridge.resetLayoutOverrides) {
      bridge.resetLayoutOverrides();
      return;
    }

    bridge.setLayoutOverrides({});
  }, []);

  useEffect(() => {
    if (!StepComponent || !layoutBridge) {
      return;
    }

    const desiredOverrides = StepComponent.stepSequenceLayoutOverrides;
    if (!desiredOverrides) {
      restoreLayoutOverrides(layoutBridge);
      return;
    }

    const state = previousLayoutOverridesRef.current;
    if (state.stepId === null) {
      previousLayoutOverridesRef.current = {
        stepId: activeStep.id,
        value: layoutBridge.layoutOverrides,
      };
    } else {
      previousLayoutOverridesRef.current = {
        stepId: activeStep.id,
        value: state.value,
      };
    }

    if (layoutBridge.layoutOverrides !== desiredOverrides) {
      layoutBridge.setLayoutOverrides(desiredOverrides);
    }
  }, [StepComponent, activeStep.id, layoutBridge, restoreLayoutOverrides]);

  useEffect(() => {
    return () => {
      restoreLayoutOverrides(latestLayoutBridgeRef.current);
    };
  }, [restoreLayoutOverrides]);

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
