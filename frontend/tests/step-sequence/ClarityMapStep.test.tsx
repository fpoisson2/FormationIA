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
      promptStepId: "prompt-step",
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
    expect(screen.getByLabelText(/étape prompt/i)).toBeTruthy();
    expect(screen.getByLabelText(/cible x/i)).toBeTruthy();
    expect(screen.getByLabelText(/cible y/i)).toBeTruthy();
    expect(screen.getByLabelText(/autoriser la saisie/i)).toBeTruthy();
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

    const textarea = screen.getByPlaceholderText(/consigne reçue/i);
    fireEvent.change(textarea, { target: { value: "Avance de 2 cases." } });

    const submitButton = screen.getByRole("button", { name: /continuer/i });
    fireEvent.click(submitButton);

    expect(onAdvance).toHaveBeenCalledTimes(1);
    const payload = onAdvance.mock.calls[0][0] as ClarityMapStepPayload;
    expect(typeof payload.runId).toBe("string");
    expect(payload.runId).not.toHaveLength(0);
    expect(payload.target).toEqual({ x: 2, y: 3 });
    expect(payload.blocked).toEqual([]);
    expect(payload.instruction).toBe("Avance de 2 cases.");
    expect(payload.plan).toBeUndefined();
    expect(payload.notes).toBeUndefined();
    expect(payload.stats).toBeUndefined();
    expect(payload.trail).toEqual([START_POSITION]);
    expect(payload.status).toBe("idle");
    expect(payload.message).toBeUndefined();
  });

  it("falls back to a random target when none is configured", () => {
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

    const submitButton = screen.getByRole("button", { name: /continuer/i });
    fireEvent.click(submitButton);

    const payload = onAdvance.mock.calls[0][0] as ClarityMapStepPayload;

    expect(payload.target).not.toEqual(START_POSITION);
    expect(payload.blocked.every((coord) => coord.x !== payload.target.x || coord.y !== payload.target.y)).toBe(true);
    expect(payload.trail).toEqual([START_POSITION]);
    expect(payload.status).toBe("idle");
  });

  it("publishes updates automatically when rendered inside a composite module", async () => {
    const onAdvance = vi.fn();
    const props: StepComponentProps = {
      definition: { id: "map-module", component: "clarity-map" },
      config: { obstacleCount: 0, allowInstructionInput: true },
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

    const textarea = screen.getByPlaceholderText(/consigne reçue/i);
    fireEvent.change(textarea, { target: { value: "Nouvelle consigne" } });

    await waitFor(() => {
      const lastCall = onAdvance.mock.calls[onAdvance.mock.calls.length - 1][0] as ClarityMapStepPayload;
      expect(lastCall.instruction).toBe("Nouvelle consigne");
    });
  });

  it("affiche la commande reçue depuis le module prompt configuré", () => {
    const mapPayload: ClarityMapStepPayload = {
      runId: "run-shared",
      target: { x: 4, y: 5 },
      blocked: [],
      instruction: "",
    };

    const onAdvance = vi.fn();
    const props: StepComponentProps = {
      definition: { id: "map-step", component: "clarity-map", config: { promptStepId: "prompt-step" } },
      config: { promptStepId: "prompt-step" },
      payload: mapPayload,
      isActive: true,
      isEditMode: false,
      onAdvance,
      onUpdateConfig: vi.fn(),
    };

    const context = {
      stepIndex: 1,
      stepCount: 2,
      steps: [],
      payloads: {
        "prompt-step": { instruction: "Tourne à droite" },
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

    expect(screen.queryByPlaceholderText(/consigne reçue/i)).toBeNull();

    return waitFor(() => {
      expect(onAdvance).toHaveBeenCalled();
      const payload = onAdvance.mock.calls[onAdvance.mock.calls.length - 1][0] as ClarityMapStepPayload;
      expect(payload.instruction).toBe("Tourne à droite");
    });
  });

  it("détecte automatiquement le module prompt lorsqu'il est présent dans le composite", () => {
    const onAdvance = vi.fn();
    const props: StepComponentProps = {
      definition: { id: "map-module", component: "clarity-map" },
      config: undefined,
      payload: undefined,
      isActive: true,
      isEditMode: false,
      onAdvance,
      onUpdateConfig: vi.fn(),
    };

    const context = {
      stepIndex: 0,
      stepCount: 1,
      steps: [],
      payloads: {
        "prompt-module": { instruction: "Dirige-toi vers le nord" },
      },
      isEditMode: false,
      onAdvance: vi.fn(),
      onUpdateConfig: vi.fn(),
      goToStep: vi.fn(),
      compositeModules: {
        "composite-step": [
          { id: "prompt-module", component: "clarity-prompt" },
          { id: "map-module", component: "clarity-map" },
        ],
      },
    };

    render(
      <StepSequenceContext.Provider value={context}>
        <ClarityMapStep {...props} />
      </StepSequenceContext.Provider>
    );

    expect(screen.queryByPlaceholderText(/consigne reçue/i)).toBeNull();

    return waitFor(() => {
      expect(onAdvance).toHaveBeenCalled();
      const payload = onAdvance.mock.calls[onAdvance.mock.calls.length - 1][0] as ClarityMapStepPayload;
      expect(payload.instruction).toBe("Dirige-toi vers le nord");
    });
  });
});
