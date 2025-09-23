import { useCallback, useMemo } from "react";

import type { ActivityProps } from "../../config/activities";
import { StepSequenceRenderer } from "./StepSequenceRenderer";
import type { StepDefinition } from "./types";

export type StepSequenceActivityConfig = {
  steps: StepDefinition[];
};

export type StepSequenceActivityProps = ActivityProps & {
  steps?: StepDefinition[];
  stepSequence?: StepDefinition[];
  metadata?: StepSequenceActivityConfig | null;
  onComplete?: (payloads: Record<string, unknown>) => void;
};

const isStepDefinitionArray = (
  value: StepDefinition[] | undefined
): value is StepDefinition[] =>
  Array.isArray(value) &&
  value.every(
    (step) =>
      step !== null &&
      typeof step === "object" &&
      typeof step.id === "string" &&
      typeof step.component === "string"
  );

export function StepSequenceActivity({
  steps,
  stepSequence,
  metadata,
  isEditMode = false,
  onComplete,
  activityId,
  completionId,
  navigateToActivities,
  setLayoutOverrides,
  resetLayoutOverrides,
  header,
  card,
  layout,
}: StepSequenceActivityProps): JSX.Element {
  const metadataSteps = metadata?.steps;
  const resolvedSteps = useMemo(() => {
    if (isStepDefinitionArray(steps)) {
      return steps;
    }
    if (isStepDefinitionArray(stepSequence)) {
      return stepSequence;
    }
    if (isStepDefinitionArray(metadataSteps)) {
      return metadataSteps;
    }
    return [] as StepDefinition[];
  }, [metadataSteps, stepSequence, steps]);

  const handleComplete = useCallback(
    (payloads: Record<string, unknown>) => {
      onComplete?.(payloads);
    },
    [onComplete]
  );

  const activityContext = useMemo(
    () => ({
      activityId,
      completionId,
      navigateToActivities,
      setLayoutOverrides,
      resetLayoutOverrides,
      header,
      card,
      layout,
    }),
    [
      activityId,
      card,
      completionId,
      header,
      layout,
      navigateToActivities,
      resetLayoutOverrides,
      setLayoutOverrides,
    ]
  );

  return (
    <StepSequenceRenderer
      steps={resolvedSteps}
      isEditMode={isEditMode}
      onComplete={handleComplete}
      activityContext={activityContext}
    />
  );
}
