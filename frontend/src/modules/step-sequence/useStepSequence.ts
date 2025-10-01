import { useContext } from "react";

import { StepSequenceContext } from "./types";
import type { StepSequenceContextValue } from "./types";

export function useStepSequence(): StepSequenceContextValue {
  const context = useContext(StepSequenceContext);
  if (!context) {
    throw new Error("useStepSequence must be used within a StepSequenceRenderer");
  }
  return context;
}

