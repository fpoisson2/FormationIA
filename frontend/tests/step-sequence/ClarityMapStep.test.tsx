import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STEP_COMPONENT_REGISTRY,
  StepSequenceContext,
  type StepComponentProps,
} from "../../src/modules/step-sequence";
import {
  ClarityMapStep,
  type ClarityMapStepConfig,
  type ClarityMapStepPayload,
} from "../../src/modules/step-sequence/modules";
import { START_POSITION } from "../../src/modules/clarity";
import type { GridCoord } from "../../src/modules/clarity";

afterEach(() => {
  cleanup();
});

describe("ClarityMapStep", () => {
  it("registers itself under the clarity-map key", () => {
    expect(STEP_COMPONENT_REGISTRY["clarity-map"]).toBe(ClarityMapStep);
  });

  it("renders configuration controls in edit mode", () => {
    const config: ClarityMapStepConfig = {
      obstacleCount: 3,
      initialTarget: { x: 4, y: 5 },
    };

    const props: StepComponentProps = {
      definition: { id: "clarity-map", component: "clarity-map", config },
      config,
      payload: undefined,
      isActive: true,
      isEditMode: true,
      onAdvance: vi.fn(),
      onUpdateConfig: vi.fn(),
    };

    render(<ClarityMapStep {...props} />);

    expect(screen.getByLabelText(/obstacles/i)).toBeTruthy();
    expect(screen.getByLabelText(/cible x/i)).toBeTruthy();
    expect(screen.getByLabelText(/cible y/i)).toBeTruthy();
  });

  it("submits the current target, obstacles and optional instruction", () => {
    const config: ClarityMapStepConfig = {
      obstacleCount: 0,
      initialTarget: { x: 2, y: 3 },
    };

    const onAdvance = vi.fn();
    const props: StepComponentProps = {
      definition: { id: "clarity-map", component: "clarity-map", config },
      config,
      payload: undefined,
      isActive: true,
      isEditMode: false,
      onAdvance,
      onUpdateConfig: vi.fn(),
    };

    render(<ClarityMapStep {...props} />);

    const textarea = screen.getAllByLabelText(/consigne initiale/i)[0];
    fireEvent.change(textarea, { target: { value: "Avance de 2 cases." } });

    const submitButton = screen.getAllByRole("button", { name: /continuer/i })[0];
    fireEvent.click(submitButton);

    expect(onAdvance).toHaveBeenCalledTimes(1);
    const payload = onAdvance.mock.calls[0][0] as ClarityMapStepPayload;
    expect(typeof payload.runId).toBe("string");
    expect(payload.runId).not.toHaveLength(0);
    expect(payload.target).toEqual({ x: 2, y: 3 });
    expect(payload.blocked).toEqual([]);
    expect(payload.instruction).toBe("Avance de 2 cases.");
  });

  it("falls back to the start position when no target is configured", () => {
    const onAdvance = vi.fn();
    const props: StepComponentProps = {
      definition: { id: "clarity-map", component: "clarity-map" },
      config: undefined,
      payload: undefined,
      isActive: true,
      isEditMode: false,
      onAdvance,
      onUpdateConfig: vi.fn(),
    };

    render(<ClarityMapStep {...props} />);

    const submitButton = screen.getAllByRole("button", { name: /continuer/i })[0];
    fireEvent.click(submitButton);

    const payload = onAdvance.mock.calls[0][0] as {
      target: GridCoord;
      blocked: GridCoord[];
      instruction?: string;
      runId: string;
    };

    expect(payload.target).not.toEqual(START_POSITION);
    expect(payload.blocked.every((coord) => coord.x !== payload.target.x || coord.y !== payload.target.y)).toBe(true);
  });

  it("publishes updates automatically when rendered inside a composite module", async () => {
    const onAdvance = vi.fn();
    const props: StepComponentProps = {
      definition: { id: "map-module", component: "clarity-map" },
      config: { obstacleCount: 0 },
      payload: undefined,
      isActive: true,
      isEditMode: false,
      onAdvance,
      onUpdateConfig: vi.fn(),
    };

    const compositeContext = {
      stepIndex: 0,
      stepCount: 1,
      steps: [{ id: "composite-step", component: "composite", composite: { modules: [] } }],
      payloads: {},
      isEditMode: false,
      onAdvance: vi.fn(),
      onUpdateConfig: vi.fn(),
      goToStep: vi.fn(),
    };

    render(
      <StepSequenceContext.Provider value={compositeContext}>
        <ClarityMapStep {...props} />
      </StepSequenceContext.Provider>
    );

    await waitFor(() => {
      expect(onAdvance).toHaveBeenCalled();
    });

    const initialCall = onAdvance.mock.calls[0][0] as ClarityMapStepPayload;
    expect(initialCall.runId).toBeTruthy();

    const textarea = screen.getByPlaceholderText(/décris le trajet/i);
    fireEvent.change(textarea, { target: { value: "Nouvelle consigne" } });

    await waitFor(() => {
      const lastCall = onAdvance.mock.calls[onAdvance.mock.calls.length - 1][0] as ClarityMapStepPayload;
      expect(lastCall.instruction).toBe("Nouvelle consigne");
    });
  });

  it("affiche la trajectoire issue de l’étape de contrôle lorsque les runs correspondent", () => {
    const mapPayload: ClarityMapStepPayload = {
      runId: "run-shared",
      target: { x: 4, y: 5 },
      blocked: [],
      instruction: "",
    };

    const props: StepComponentProps = {
      definition: { id: "map-step", component: "clarity-map", config: { controlStepId: "control-step" } },
      config: { controlStepId: "control-step" },
      payload: mapPayload,
      isActive: true,
      isEditMode: false,
      onAdvance: vi.fn(),
      onUpdateConfig: vi.fn(),
    };

    const context = {
      stepIndex: 1,
      stepCount: 2,
      steps: [],
      payloads: {
        "control-step": {
          runId: "run-shared",
          trail: [START_POSITION, { x: 2, y: 3 }],
        },
      },
      isEditMode: false,
      onAdvance: vi.fn(),
      onUpdateConfig: vi.fn(),
      goToStep: vi.fn(),
    };

    render(
      <StepSequenceContext.Provider value={context}>
        <ClarityMapStep {...props} />
      </StepSequenceContext.Provider>
    );

    expect(screen.queryByText(/Trajectoire reçue depuis l’étape de contrôle/i)).not.toBeNull();
    const playerIcon = screen.getByLabelText("Bonhomme");
    const style = playerIcon.getAttribute("style") ?? "";
    expect(style).toContain("left: 25%");
    expect(style).toContain("top: 35%");
  });
});
