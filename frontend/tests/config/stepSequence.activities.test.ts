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
      { id: "intro", component: "introduction", config: { order: 0 } },
      { id: "practice", component: "practice", config: { order: 1, score: 5 } },
      { id: "bonus", component: "bonus" },
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

    expect(serialized.overrides?.stepSequence).toEqual(updatedSteps);
  });
});
