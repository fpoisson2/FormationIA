import ExplorateurIA, {
  createDefaultExplorateurIAConfig,
  sanitizeExplorateurIAConfig,
  type ExplorateurIAConfig,
  type ExplorateurIATerrainConfig,
} from "../../../../pages/ExplorateurIA";
import { registerStepComponent } from "../../registry";
import type {
  StepComponentProps,
  StepComponentWithMetadata,
} from "../../types";

export function ExplorateurWorldStep(
  props: StepComponentProps
): JSX.Element {
  return <ExplorateurIA {...props} />;
}

(ExplorateurWorldStep as StepComponentWithMetadata).stepSequenceWrapper = "bare";

registerStepComponent("explorateur-world", ExplorateurWorldStep);

export type {
  ExplorateurIAConfig as ExplorateurWorldConfig,
  ExplorateurIATerrainConfig as ExplorateurWorldTerrainConfig,
} from "../../../../pages/ExplorateurIA";

export const createDefaultExplorateurWorldConfig =
  createDefaultExplorateurIAConfig;
export const sanitizeExplorateurWorldConfig = sanitizeExplorateurIAConfig;
