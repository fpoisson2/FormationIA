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
  StepSequenceLayoutOverrides,
} from "../../types";

export function ExplorateurWorldStep(
  props: StepComponentProps
): JSX.Element {
  return <ExplorateurIA {...props} />;
}

const EXPLORATEUR_WORLD_LAYOUT_OVERRIDES: StepSequenceLayoutOverrides = Object.freeze({
  outerClassName:
    "flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden px-0 pt-0 pb-0",
  innerClassName:
    "flex h-full min-h-0 flex-1 w-full max-w-none gap-0",
  headerClassName: "hidden",
  contentClassName:
    "flex h-full min-h-0 flex-1 flex-col space-y-0",
  withLandingGradient: false,
  useDynamicViewportHeight: true,
  withBasePadding: false,
  withBaseContentSpacing: false,
  withBaseInnerGap: false,
});

const stepWithMetadata = ExplorateurWorldStep as StepComponentWithMetadata;
stepWithMetadata.stepSequenceWrapper = "bare";
stepWithMetadata.stepSequenceLayoutOverrides = EXPLORATEUR_WORLD_LAYOUT_OVERRIDES;

registerStepComponent("explorateur-world", ExplorateurWorldStep);

export type {
  ExplorateurIAConfig as ExplorateurWorldConfig,
  ExplorateurIATerrainConfig as ExplorateurWorldTerrainConfig,
} from "../../../../pages/ExplorateurIA";

export const createDefaultExplorateurWorldConfig =
  createDefaultExplorateurIAConfig;
export const sanitizeExplorateurWorldConfig = sanitizeExplorateurIAConfig;
