import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ACTIVITY_CATALOG,
  resolveActivityDefinition,
  serializeActivityDefinition,
  type ActivityConfigEntry,
  type ActivityDefinition,
} from "../../src/config/activities";
import type { StepDefinition } from "../../src/modules/step-sequence";

const TEST_ACTIVITY_ID = "step-sequence-spec";

const defaultSteps: StepDefinition[] = [
  { id: "intro", component: "introduction", config: { order: 0 } },
  { id: "practice", component: "practice", config: { order: 1 } },
];

beforeEach(() => {
  ACTIVITY_CATALOG[TEST_ACTIVITY_ID] = {
    componentKey: "step-sequence",
    path: "/activities/spec",
    defaults: {
      enabled: true,
      header: { eyebrow: "", title: "Spec" },
      layout: { contentClassName: "" },
      card: {
        title: "Spec",
        description: "",
        highlights: [],
        cta: { label: "", to: "#" },
      },
      stepSequence: defaultSteps,
    },
  };
});

afterEach(() => {
  delete ACTIVITY_CATALOG[TEST_ACTIVITY_ID];
});

describe("Step sequence activities", () => {
  it("merges saved steps with catalog defaults", () => {
    const entry: ActivityConfigEntry = {
      id: TEST_ACTIVITY_ID,
      overrides: {
        stepSequence: [
          { id: "practice", component: "practice", config: { order: 1, score: 5 } },
          { id: "bonus", component: "bonus" },
        ],
      },
    };

    const definition = resolveActivityDefinition(entry);

    expect(definition.stepSequence).toEqual([
      { id: "intro", component: "introduction", type: "introduction", config: { order: 0 } },
      {
        id: "practice",
        component: "practice",
        type: "practice",
        config: { order: 1, score: 5 },
      },
      { id: "bonus", component: "bonus", type: "bonus" },
    ]);
  });

  it("removes catalog defaults when override requests replacement", () => {
    const entry: ActivityConfigEntry = {
      id: TEST_ACTIVITY_ID,
      overrides: {
        stepSequence: [
          { id: "practice", component: "practice", __replaceSequence: true },
        ],
      },
    };

    const definition = resolveActivityDefinition(entry);

    expect(definition.stepSequence).toEqual([
      { id: "practice", component: "practice", type: "practice", config: { order: 1 } },
    ]);
  });

  it("serializes changes to the step sequence", () => {
    const baseDefinition = resolveActivityDefinition({ id: TEST_ACTIVITY_ID });
    const updatedSteps: StepDefinition[] = [
      { ...baseDefinition.stepSequence![0] },
      { id: "practice", component: "practice", config: { order: 1, mode: "advanced" } },
      { id: "summary", component: "summary" },
    ];

    const updatedDefinition: ActivityDefinition = {
      ...baseDefinition,
      stepSequence: updatedSteps,
    };

    const serialized = serializeActivityDefinition(updatedDefinition);

    const expectedSteps = updatedSteps.map((step) => ({
      ...step,
      type: step.component ?? step.id,
      __replaceSequence: true,
    }));

    expect(serialized.overrides?.stepSequence).toEqual(expectedSteps);
  });

  it("persists clarity module visibility toggles", () => {
    const clarityDefinition = resolveActivityDefinition({ id: "clarity" });

    expect(clarityDefinition.stepSequence?.length).toBeGreaterThan(0);

    const updatedSteps = clarityDefinition.stepSequence!.map((step) => {
      if (step.id === "clarity:map") {
        const config = {
          ...((step as { config?: Record<string, unknown> }).config ?? {}),
          showPlanPlaceholder: false,
        };
        return { ...step, config } satisfies StepDefinition;
      }

      if (step.id === "clarity:instruction") {
        const config = {
          ...((step as { config?: Record<string, unknown> }).config ?? {}),
          helperTextEnabled: false,
        };
        return { ...step, config } satisfies StepDefinition;
      }

      return step;
    });

    const updatedDefinition: ActivityDefinition = {
      ...clarityDefinition,
      stepSequence: updatedSteps,
    };

    const serialized = serializeActivityDefinition(updatedDefinition);
    expect(serialized.overrides?.stepSequence).toBeDefined();

    const rehydrated = resolveActivityDefinition(serialized);
    const mapStep = rehydrated.stepSequence?.find((step) => step.id === "clarity:map") as
      | { config?: Record<string, unknown> }
      | undefined;
    const promptStep = rehydrated.stepSequence?.find((step) => step.id === "clarity:instruction") as
      | { config?: Record<string, unknown> }
      | undefined;

    expect(mapStep?.config).toBeDefined();
    expect(promptStep?.config).toBeDefined();
    expect((mapStep?.config as { showPlanPlaceholder?: boolean })?.showPlanPlaceholder).toBe(false);
    expect((promptStep?.config as { helperTextEnabled?: boolean })?.helperTextEnabled).toBe(false);
  });
});
