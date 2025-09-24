import { describe, expect, beforeEach, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { StepSequenceRenderer } from "../../src/modules/step-sequence/StepSequenceRenderer";
import {
  STEP_COMPONENT_REGISTRY,
  registerStepComponent,
} from "../../src/modules/step-sequence/registry";
import { CompositeStep } from "../../src/modules/step-sequence/modules/CompositeStep";
import type { StepComponentProps } from "../../src/modules/step-sequence/types";

describe("CompositeStep", () => {
  beforeEach(() => {
    Object.keys(STEP_COMPONENT_REGISTRY).forEach((key) => {
      delete STEP_COMPONENT_REGISTRY[key];
    });
    registerStepComponent("composite", CompositeStep);
  });

  function createTestModule(
    label: string,
    payload: unknown
  ): (props: StepComponentProps) => JSX.Element {
    return function TestModule({ onAdvance }: StepComponentProps) {
      return (
        <button type="button" onClick={() => onAdvance(payload)}>
          {label}
        </button>
      );
    };
  }

  it("renders child modules and aggregates their payloads", () => {
    registerStepComponent("module-a", createTestModule("Module A", { ready: true }));
    registerStepComponent("module-b", createTestModule("Module B", { done: true }));

    const handleComplete = vi.fn();

    render(
      <StepSequenceRenderer
        steps={[
          {
            id: "composite-step",
            composite: {
              modules: [
                { id: "module-a", component: "module-a" },
                { id: "module-b", component: "module-b" },
              ],
            },
          },
        ]}
        onComplete={handleComplete}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Module A" }));
    fireEvent.click(screen.getByRole("button", { name: "Module B" }));

    const continueButton = screen.getByRole("button", { name: "Continuer" });
    expect(continueButton).toHaveProperty("disabled", false);

    fireEvent.click(continueButton);

    expect(handleComplete).toHaveBeenCalledTimes(1);
    expect(handleComplete).toHaveBeenCalledWith({
      "composite-step": {
        "module-a": { ready: true },
        "module-b": { done: true },
      },
    });
  });
});
