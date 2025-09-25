import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STEP_COMPONENT_REGISTRY,
  StepSequenceContext,
  type StepComponentProps,
} from "../../src/modules/step-sequence";
import {
  ClarityPromptStep,
  type ClarityPromptStepConfig,
  type ClarityPromptStepPayload,
} from "../../src/modules/step-sequence/modules";

afterEach(() => {
  cleanup();
});

describe("ClarityPromptStep", () => {
  it("registers itself under the clarity-prompt key", () => {
    expect(STEP_COMPONENT_REGISTRY["clarity-prompt"]).toBe(ClarityPromptStep);
  });

  it("renders configuration controls in edit mode", () => {
    const config: ClarityPromptStepConfig = {
      promptLabel: "Nouvelle consigne",
      promptPlaceholder: "Décris le trajet",
    };

    const props: StepComponentProps = {
      definition: { id: "prompt", component: "clarity-prompt", config },
      config,
      payload: undefined,
      isActive: true,
      isEditMode: true,
      onAdvance: vi.fn(),
      onUpdateConfig: vi.fn(),
    };

    render(
      <StepSequenceContext.Provider
        value={{
          stepIndex: 0,
          stepCount: 1,
          steps: [props.definition],
          payloads: {},
          isEditMode: true,
          onAdvance: vi.fn(),
          onUpdateConfig: vi.fn(),
          goToStep: vi.fn(),
        }}
      >
        <ClarityPromptStep {...props} />
      </StepSequenceContext.Provider>
    );

    expect(screen.getByLabelText(/libellé/i)).toBeTruthy();
    expect(screen.getByLabelText(/placeholder/i)).toBeTruthy();
  });

  it("submits the instruction when continuing", () => {
    const onAdvance = vi.fn();
    const props: StepComponentProps = {
      definition: { id: "prompt", component: "clarity-prompt" },
      config: undefined,
      payload: undefined,
      isActive: true,
      isEditMode: false,
      onAdvance,
      onUpdateConfig: vi.fn(),
    };

    render(<ClarityPromptStep {...props} />);

    const textarea = screen.getByPlaceholderText(/décris l'action/i);
    fireEvent.change(textarea, { target: { value: "Avance vers la droite" } });

    const button = screen.getByRole("button", { name: /continuer/i });
    fireEvent.click(button);

    expect(onAdvance).toHaveBeenCalledTimes(1);
    const payload = onAdvance.mock.calls[0][0] as ClarityPromptStepPayload;
    expect(payload).toEqual({ instruction: "Avance vers la droite" });
  });

  it("publishes updates automatically when rendered inside a composite module", async () => {
    const onAdvance = vi.fn();
    const props: StepComponentProps = {
      definition: { id: "prompt-module", component: "clarity-prompt" },
      config: undefined,
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
        <ClarityPromptStep {...props} />
      </StepSequenceContext.Provider>
    );

    await waitFor(() => {
      expect(onAdvance).toHaveBeenCalled();
    });

    const textarea = screen.getByPlaceholderText(/décris l'action/i);
    fireEvent.change(textarea, { target: { value: "Nouvelle consigne" } });

    await waitFor(() => {
      const lastCall = onAdvance.mock.calls[onAdvance.mock.calls.length - 1][0] as ClarityPromptStepPayload;
      expect(lastCall.instruction).toBe("Nouvelle consigne");
    });
  });
});
