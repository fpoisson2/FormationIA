import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/modules/clarity/useClarityPlanExecution", () => ({
  useClarityPlanExecution: vi.fn(),
}));

import {
  STEP_COMPONENT_REGISTRY,
  StepSequenceContext,
  type StepComponentProps,
} from "../../src/modules/step-sequence";
import {
  ClarityControlStep,
  type ClarityControlStepConfig,
  type ClarityControlStepPayload,
  type ClarityMapStepPayload,
} from "../../src/modules/step-sequence/modules";
import { START_POSITION, useClarityPlanExecution } from "../../src/modules/clarity";

const DEFAULT_CONTEXT = {
  stepIndex: 0,
  stepCount: 2,
  steps: [],
  payloads: {},
  isEditMode: false,
  onAdvance: () => {},
  onUpdateConfig: () => {},
  goToStep: () => {},
};

describe("ClarityControlStep", () => {
  beforeEach(() => {
    vi.mocked(useClarityPlanExecution).mockReturnValue({
      status: "idle",
      isLoading: false,
      message: "",
      plan: [],
      notes: "",
      stats: null,
      trail: [START_POSITION],
      execute: vi.fn(),
      abort: vi.fn(),
    });
  });

  it("registers itself under the clarity-control key", () => {
    expect(STEP_COMPONENT_REGISTRY["clarity-control"]).toBe(ClarityControlStep);
  });

  it("renders configuration controls in edit mode", () => {
    const config: ClarityControlStepConfig = {
      mapStepId: "map-step",
      prompt: "Test prompt",
    };
    const props: StepComponentProps = {
      definition: { id: "control", component: "clarity-control", config },
      config,
      payload: undefined,
      isActive: true,
      isEditMode: true,
      onAdvance: vi.fn(),
      onUpdateConfig: vi.fn(),
    };

    render(
      <StepSequenceContext.Provider value={{ ...DEFAULT_CONTEXT, isEditMode: true }}>
        <ClarityControlStep {...props} />
      </StepSequenceContext.Provider>
    );

    expect(screen.getByLabelText(/étape carte/i)).toBeTruthy();
    expect(screen.getByLabelText(/prompt affiché/i)).toBeTruthy();
  });

  it("executes the plan using the shared hook and forwards the outcome", async () => {
    const mapPayload: ClarityMapStepPayload = {
      runId: "run-test",
      target: { x: 4, y: 5 },
      blocked: [{ x: 1, y: 1 }],
      instruction: "Initial",
    };

    const outcome: ClarityControlStepPayload = {
      runId: mapPayload.runId,
      instruction: "Nouvelle instruction",
      plan: [
        { dir: "right", steps: 2 },
        { dir: "down", steps: 3 },
      ],
      notes: "Hypothèse",
      stats: {
        runId: mapPayload.runId,
        attempts: 1,
        stepsExecuted: 5,
        optimalPathLength: 5,
        surcout: 0,
        success: true,
        finalPosition: { x: 4, y: 5 },
        ambiguity: undefined,
        durationMs: 1200,
      },
      trail: [START_POSITION, { x: 1, y: 0 }, { x: 2, y: 0 }],
    };

    const execute = vi.fn().mockResolvedValue(outcome);
    vi.mocked(useClarityPlanExecution).mockReturnValue({
      status: "idle",
      isLoading: false,
      message: "",
      plan: outcome.plan,
      notes: outcome.notes,
      stats: outcome.stats,
      trail: outcome.trail,
      execute,
      abort: vi.fn(),
    });

    const config: ClarityControlStepConfig = {
      mapStepId: "map-step",
      prompt: "Décris la trajectoire",
    };
    const onAdvance = vi.fn();
    const props: StepComponentProps = {
      definition: { id: "control", component: "clarity-control", config },
      config,
      payload: undefined,
      isActive: true,
      isEditMode: false,
      onAdvance,
      onUpdateConfig: vi.fn(),
    };

    render(
      <StepSequenceContext.Provider
        value={{
          ...DEFAULT_CONTEXT,
          payloads: { "map-step": mapPayload },
        }}
      >
        <ClarityControlStep {...props} />
      </StepSequenceContext.Provider>
    );

    const textarea = screen.getByPlaceholderText(/exemple/i);
    fireEvent.change(textarea, { target: { value: outcome.instruction } });

    const submitButton = screen.getByRole("button", { name: /lancer le plan/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(execute).toHaveBeenCalledWith({
        instruction: outcome.instruction,
        goal: mapPayload.target,
        blocked: mapPayload.blocked,
        runId: mapPayload.runId,
        start: START_POSITION,
      });
    });

    await waitFor(() => {
      expect(onAdvance).toHaveBeenCalledWith(outcome);
    });
  });
});
