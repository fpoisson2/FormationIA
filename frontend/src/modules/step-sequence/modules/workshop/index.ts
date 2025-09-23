import { registerStepComponent } from "../../registry";

import { WorkshopComparisonStep } from "./WorkshopComparisonStep";
import { WorkshopContextStep } from "./WorkshopContextStep";
import { WorkshopSynthesisStep } from "./WorkshopSynthesisStep";

registerStepComponent("workshop-context", WorkshopContextStep);
registerStepComponent("workshop-comparison", WorkshopComparisonStep);
registerStepComponent("workshop-synthesis", WorkshopSynthesisStep);

export type { WorkshopContextStepState } from "./WorkshopContextStep";
export type { WorkshopComparisonStepState } from "./WorkshopComparisonStep";
export type { WorkshopSynthesisStepState } from "./WorkshopSynthesisStep";

