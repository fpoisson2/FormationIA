import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

import {
  STEP_COMPONENT_REGISTRY,
  StepSequenceContainer,
  registerStepComponent,
  useStepSequence,
} from "../../src/modules/step-sequence";
import type { StepComponentProps } from "../../src/modules/step-sequence";

describe("StepSequenceRenderer", () => {
  beforeEach(() => {
    for (const key of Object.keys(STEP_COMPONENT_REGISTRY)) {
      delete STEP_COMPONENT_REGISTRY[key];
    }
  });

  it("navigates between steps and calls onComplete on the last advance", () => {
    function FirstStep({ onAdvance }: StepComponentProps) {
      const { isEditMode } = useStepSequence();
      return (
        <div>
          <span data-testid="mode-indicator">{isEditMode ? "edit" : "view"}</span>
          <button onClick={() => onAdvance({ from: "first" })}>Suivant</button>
        </div>
      );
    }

    function SecondStep({ onAdvance, definition }: StepComponentProps) {
      return (
        <div>
          <span>{definition.id}</span>
          <button onClick={() => onAdvance({ from: "second" })}>Terminer</button>
        </div>
      );
    }

    registerStepComponent("first", FirstStep);
    registerStepComponent("second", SecondStep);

    const onComplete = vi.fn();

    render(
      <StepSequenceContainer
        isEditMode
        onComplete={onComplete}
        steps={[
          { id: "first-step", component: "first" },
          { id: "second-step", component: "second" },
        ]}
      />
    );

    expect(screen.getByTestId("mode-indicator").textContent).toBe("edit");

    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mode-indicator")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({
      "first-step": { from: "first" },
      "second-step": { from: "second" },
    });
  });
});
