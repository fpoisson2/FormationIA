import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StepSequenceRendererProps } from "../../src/modules/step-sequence/StepSequenceRenderer";
import type { StepDefinition } from "../../src/modules/step-sequence";

const renderSpy = vi.fn();
const markCompletedMock = vi.fn(
  async (_options?: { triggerCompletionCallback?: boolean }) => true
);

vi.mock("../../src/hooks/useActivityCompletion", () => ({
  useActivityCompletion: vi.fn(() => ({
    markCompleted: markCompletedMock,
    submitLtiScore: vi.fn(),
    activityProgressMarked: false,
    ltiScoreSubmitted: false,
  })),
}));

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
    markCompletedMock.mockClear();
    markCompletedMock.mockResolvedValue(true);
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

  it("relays onComplete when the renderer signals completion", async () => {
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

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith({ status: "done" });
      expect(markCompletedMock).toHaveBeenCalledTimes(1);
      expect(markCompletedMock).toHaveBeenCalledWith({
        triggerCompletionCallback: true,
      });
    });
  });

  it("prefers the stepSequence prop when provided", () => {
    const props = createBaseProps();
    const fallbackSteps: StepDefinition[] = [
      { id: "metadata", component: "metadata" },
    ];
    const sequenceSteps: StepDefinition[] = [
      { id: "sequence", component: "sequence" },
    ];

    render(
      <StepSequenceActivity
        {...props}
        stepSequence={sequenceSteps}
        metadata={{ steps: fallbackSteps }}
      />
    );

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const [{ steps: receivedSteps }] = renderSpy.mock.calls[0];
    expect(receivedSteps).toBe(sequenceSteps);
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

  it("does not mark completion while in edit mode", async () => {
    const props = createBaseProps();

    render(
      <StepSequenceActivity
        {...props}
        steps={defaultSteps}
        isEditMode
      />
    );

    fireEvent.click(screen.getByTestId("step-sequence-renderer"));

    await waitFor(() => {
      expect(markCompletedMock).not.toHaveBeenCalled();
    });
  });
});
