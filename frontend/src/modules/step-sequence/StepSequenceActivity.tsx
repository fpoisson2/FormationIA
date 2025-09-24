import { useCallback, useMemo } from "react";

import type { ActivityProps } from "../../config/activities";
import {
  StepSequenceRenderer,
  type StepSequenceRenderWrapperProps,
} from "./StepSequenceRenderer";
import type { StepDefinition } from "./types";
import { isCompositeStepDefinition, resolveStepComponentKey } from "./types";
import { useActivityCompletion } from "../../hooks/useActivityCompletion";

export type StepSequenceActivityConfig = {
  steps: StepDefinition[];
};

export type StepSequenceActivityProps = ActivityProps & {
  steps?: StepDefinition[];
  stepSequence?: StepDefinition[];
  metadata?: StepSequenceActivityConfig | null;
  onComplete?: (payloads: Record<string, unknown>) => void;
};

const MANUAL_ADVANCE_COMPONENTS = new Set(["rich-content", "video"]);

const isStepDefinitionArray = (
  value: StepDefinition[] | undefined
): value is StepDefinition[] =>
  Array.isArray(value) &&
  value.every(
    (step) => {
      if (!step || typeof step !== "object") {
        return false;
      }
      const typed = step as StepDefinition;
      if (typeof typed.id !== "string") {
        return false;
      }
      if (isCompositeStepDefinition(typed)) {
        return Array.isArray(typed.composite?.modules);
      }
      return typeof typed.component === "string";
    }
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

  const completionTargetId = completionId || activityId;

  const handleNavigateAfterCompletion = useCallback(() => {
    if (typeof navigateToActivities === "function") {
      navigateToActivities();
    }
  }, [navigateToActivities]);

  const { markCompleted } = useActivityCompletion({
    activityId: completionTargetId,
    onCompleted: handleNavigateAfterCompletion,
    resetOn: [completionTargetId],
  });

  const finalizeSequence = useCallback(async () => {
    if (isEditMode) {
      return;
    }

    const success = await markCompleted({ triggerCompletionCallback: true });
    if (!success) {
      handleNavigateAfterCompletion();
    }
  }, [handleNavigateAfterCompletion, isEditMode, markCompleted]);

  const handleComplete = useCallback(
    (payloads: Record<string, unknown>) => {
      onComplete?.(payloads);
      void finalizeSequence();
    },
    [finalizeSequence, onComplete]
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

  const renderDefaultWrapper = useCallback(
    ({
      step,
      stepIndex,
      stepCount,
      StepComponent,
      componentProps,
      context,
      advance,
    }: StepSequenceRenderWrapperProps) => {
      const canGoBack = stepIndex > 0;
      const isLastStep = stepIndex === stepCount - 1;
      const resolvedComponentKey = resolveStepComponentKey(step);
      const showContinueButton =
        context.isEditMode ||
        (resolvedComponentKey
          ? MANUAL_ADVANCE_COMPONENTS.has(resolvedComponentKey)
          : false);
      const indicatorLabel = `Étape ${stepIndex + 1} sur ${stepCount}`;
      const progressPercent =
        stepCount > 0 ? Math.round(((stepIndex + 1) / stepCount) * 100) : 0;

      let stepTitle: string | null = null;
      const rawConfig = componentProps.config;
      if (rawConfig && typeof rawConfig === "object") {
        const maybeTitle = (rawConfig as { title?: unknown }).title;
        if (typeof maybeTitle === "string" && maybeTitle.trim().length > 0) {
          stepTitle = maybeTitle;
        }
      }

      return (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          <header className="space-y-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {indicatorLabel}
            </p>
            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-orange-500 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {stepTitle ? (
              <h2 className="text-2xl font-semibold text-slate-900">
                {stepTitle}
              </h2>
            ) : null}
            {context.isEditMode ? (
              <nav className="flex flex-wrap justify-center gap-2 text-xs">
                {context.steps.map((definition, index) => (
                  <button
                    key={definition.id}
                    type="button"
                    onClick={() => context.goToStep(index)}
                    className={`rounded-full px-3 py-1 font-medium transition ${
                      index === stepIndex
                        ? "bg-orange-500 text-white shadow-sm"
                        : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                    }`}
                  >
                    Étape {index + 1}
                  </button>
                ))}
              </nav>
            ) : null}
          </header>
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm md:p-10">
            <StepComponent {...componentProps} />
          </div>
          {(canGoBack || showContinueButton) && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {canGoBack ? (
                <button
                  type="button"
                  onClick={() => context.goToStep(stepIndex - 1)}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800"
                >
                  ← Étape précédente
                </button>
              ) : (
                <span className="hidden sm:block" />
              )}
              {showContinueButton ? (
                <button
                  type="button"
                  onClick={advance}
                  className="inline-flex items-center justify-center rounded-full border border-orange-500 bg-orange-500 px-5 py-2 text-sm font-semibold text-white transition hover:border-orange-600 hover:bg-orange-600"
                >
                  {isLastStep ? "Terminer" : "Continuer"}
                </button>
              ) : null}
            </div>
          )}
        </div>
      );
    },
    []
  );

  return (
    <StepSequenceRenderer
      steps={resolvedSteps}
      isEditMode={isEditMode}
      onComplete={handleComplete}
      activityContext={activityContext}
      renderStepWrapper={renderDefaultWrapper}
    />
  );
}
