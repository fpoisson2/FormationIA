import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StepSequenceRendererProps } from "../../src/modules/step-sequence/StepSequenceRenderer";
import type { StepDefinition } from "../../src/modules/step-sequence";

const renderSpy = vi.fn();

vi.mock("../../src/modules/step-sequence/StepSequenceRenderer", () => ({
  StepSequenceRenderer: (props: StepSequenceRendererProps) => {
    renderSpy(props);
    return (
      <div
        data-testid="step-sequence-renderer"
        data-edit-mode={props.isEditMode ? "true" : "false"}
        onClick={() => props.onComplete?.({ status: "done" })}
      />
    );
  },
}));

// The mock must be declared before importing the component under test.
import { StepSequenceActivity } from "../../src/modules/step-sequence/StepSequenceActivity";

const createBaseProps = () => ({
  activityId: "activity-1",
  completionId: "activity-1",
  header: { eyebrow: "", title: "" },
  card: { title: "", description: "", highlights: [], cta: { label: "", to: "#" } },
  layout: { eyebrow: "", title: "" },
  layoutOverrides: {},
  setLayoutOverrides: vi.fn(),
  resetLayoutOverrides: vi.fn(),
  navigateToActivities: vi.fn(),
});

const defaultSteps: StepDefinition[] = [
  { id: "first-step", component: "first" },
];

describe("StepSequenceActivity", () => {
  beforeEach(() => {
    renderSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("propagates isEditMode to the renderer", () => {
    const props = createBaseProps();

    render(
      <StepSequenceActivity
        {...props}
        isEditMode
        steps={defaultSteps}
      />
    );

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const [{ isEditMode: receivedEditMode }] = renderSpy.mock.calls[0];
    expect(receivedEditMode).toBe(true);
    expect(
      screen.getByTestId("step-sequence-renderer").getAttribute("data-edit-mode")
    ).toBe("true");
  });

  it("relays onComplete when the renderer signals completion", () => {
    const props = createBaseProps();
    const onComplete = vi.fn();

    render(
      <StepSequenceActivity
        {...props}
        steps={defaultSteps}
        onComplete={onComplete}
      />
    );

    fireEvent.click(screen.getByTestId("step-sequence-renderer"));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({ status: "done" });
  });

  it("falls back to metadata steps when none are provided in props", () => {
    const props = createBaseProps();
    const metadataSteps: StepDefinition[] = [
      { id: "meta", component: "meta-step" },
    ];

    render(
      <StepSequenceActivity
        {...props}
        metadata={{ steps: metadataSteps }}
      />
    );

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const [{ steps }] = renderSpy.mock.calls[0];
    expect(steps).toBe(metadataSteps);
  });
});
