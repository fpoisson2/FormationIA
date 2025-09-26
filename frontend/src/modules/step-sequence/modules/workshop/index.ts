import { registerStepComponent } from "../../registry";

import { WorkshopComparisonStep } from "./WorkshopComparisonStep";
import { WorkshopContextStep } from "./WorkshopContextStep";
import { WorkshopSynthesisStep } from "./WorkshopSynthesisStep";

registerStepComponent("workshop-context", WorkshopContextStep);
registerStepComponent("workshop-comparison", WorkshopComparisonStep);
registerStepComponent("workshop-synthesis", WorkshopSynthesisStep);

export type { WorkshopContextStepConfig, WorkshopContextStepState } from "./WorkshopContextStep";
export type {
  WorkshopComparisonStepConfig,
  WorkshopComparisonStepState,
} from "./WorkshopComparisonStep";
export type {
  WorkshopSynthesisStepConfig,
  WorkshopSynthesisStepState,
} from "./WorkshopSynthesisStep";

