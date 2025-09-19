import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { updateActivityProgress } from "../api";
import type { LTIScorePayload } from "./useLTI";

interface ActivityCompletionAutoOptions {
  condition: boolean;
  triggerCompletionCallback?: boolean;
}

interface ActivityCompletionLtiOptions {
  isSession: boolean;
  submitScore: (payload: LTIScorePayload) => Promise<boolean>;
  canSubmit: boolean;
  buildPayload: () => LTIScorePayload | null;
}

interface UseActivityCompletionOptions {
  activityId: string;
  onCompleted?: (activityId: string) => void;
  autoComplete?: ActivityCompletionAutoOptions;
  lti?: ActivityCompletionLtiOptions;
  resetOn?: DependencyList;
}

interface MarkCompletedOptions {
  triggerCompletionCallback?: boolean;
}

export function useActivityCompletion({
  activityId,
  onCompleted,
  autoComplete,
  lti,
  resetOn,
}: UseActivityCompletionOptions) {
  const [activityProgressMarked, setActivityProgressMarked] = useState(false);
  const [ltiScoreSubmitted, setLtiScoreSubmitted] = useState(false);

  const latestOnCompleted = useRef(onCompleted);
  latestOnCompleted.current = onCompleted;

  const isMarkingRef = useRef(false);
  const isSubmittingLtiRef = useRef(false);

  const markCompleted = useCallback(
    async ({ triggerCompletionCallback = false }: MarkCompletedOptions = {}) => {
      if (activityProgressMarked) {
        if (triggerCompletionCallback) {
          latestOnCompleted.current?.(activityId);
        }
        return true;
      }

      if (isMarkingRef.current) {
        if (triggerCompletionCallback) {
          latestOnCompleted.current?.(activityId);
        }
        return true;
      }

      isMarkingRef.current = true;
      try {
        await updateActivityProgress({ activityId, completed: true });
        setActivityProgressMarked(true);
        if (triggerCompletionCallback) {
          latestOnCompleted.current?.(activityId);
        }
        return true;
      } catch (error) {
        console.error(`Unable to persist ${activityId} progress`, error);
        return false;
      } finally {
        isMarkingRef.current = false;
      }
    },
    [activityId, activityProgressMarked]
  );

  const ltiOptionsRef = useRef(lti);
  ltiOptionsRef.current = lti;

  const submitLtiScore = useCallback(
    async (payloadOverride?: LTIScorePayload) => {
      const options = ltiOptionsRef.current;
      if (!options || !options.isSession) {
        return false;
      }

      if (ltiScoreSubmitted) {
        return true;
      }

      if (isSubmittingLtiRef.current) {
        return true;
      }

      const payload = payloadOverride ?? options.buildPayload();
      if (!payload) {
        return false;
      }

      isSubmittingLtiRef.current = true;
      try {
        const success = await options.submitScore(payload);
        if (success) {
          setLtiScoreSubmitted(true);
        }
        return success;
      } catch (error) {
        console.error(`Failed to submit LTI score for ${activityId}`, error);
        return false;
      } finally {
        isSubmittingLtiRef.current = false;
      }
    },
    [activityId, ltiScoreSubmitted]
  );

  const autoCompleteCondition = autoComplete?.condition ?? false;
  const autoCompleteWithNavigation = autoComplete?.triggerCompletionCallback ?? false;

  useEffect(() => {
    if (!autoCompleteCondition || activityProgressMarked) {
      return;
    }
    void markCompleted({ triggerCompletionCallback: autoCompleteWithNavigation });
  }, [activityProgressMarked, autoCompleteCondition, autoCompleteWithNavigation, markCompleted]);

  const ltiCanSubmit = lti?.canSubmit ?? false;
  const ltiHasSession = lti?.isSession ?? false;

  useEffect(() => {
    if (!ltiHasSession || !ltiCanSubmit || ltiScoreSubmitted) {
      return;
    }
    void submitLtiScore();
  }, [ltiHasSession, ltiCanSubmit, ltiScoreSubmitted, submitLtiScore]);

  const resetDeps = resetOn ?? [];
  const resetGuardRef = useRef(true);

  useEffect(() => {
    if (resetGuardRef.current) {
      resetGuardRef.current = false;
      return;
    }
    setActivityProgressMarked(false);
    setLtiScoreSubmitted(false);
    isMarkingRef.current = false;
    isSubmittingLtiRef.current = false;
  }, resetDeps);

  return {
    markCompleted,
    submitLtiScore,
    activityProgressMarked,
    ltiScoreSubmitted,
  };
}
