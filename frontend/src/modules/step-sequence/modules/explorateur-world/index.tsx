import { Suspense, lazy } from "react";

import {
  createDefaultExplorateurIAConfig,
  sanitizeExplorateurIAConfig,
} from "../../../../pages/explorateurIA/worldConfig";
import type {
  ExplorateurExperienceMode,
  ExplorateurIAConfig,
  ExplorateurIATerrainConfig,
} from "../../../../pages/explorateurIA/worldConfig";
import { registerStepComponent } from "../../registry";
import type {
  StepComponentProps,
  StepComponentWithMetadata,
  StepSequenceLayoutOverrides,
} from "../../types";

const ExplorateurIALazy = lazy(() =>
  import("../../../../pages/ExplorateurIA").then((module) => ({
    default: module.default,
  }))
);

function ExplorateurWorldFallback(): JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-50 text-sm text-slate-500">
      Chargement de l’Explorateur IA…
    </div>
  );
}

export function ExplorateurWorldStep(
  props: StepComponentProps
): JSX.Element {
  return (
    <Suspense fallback={<ExplorateurWorldFallback />}>
      <ExplorateurIALazy {...props} />
    </Suspense>
  );
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
  ExplorateurExperienceMode as ExplorateurWorldExperienceMode,
} from "../../../../pages/explorateurIA/worldConfig";

export const createDefaultExplorateurWorldConfig =
  createDefaultExplorateurIAConfig;
export const sanitizeExplorateurWorldConfig = sanitizeExplorateurIAConfig;
