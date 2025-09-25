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
    expect(screen.getByLabelText(/modèle par défaut/i)).toBeTruthy();
    expect(screen.getByLabelText(/verbosité par défaut/i)).toBeTruthy();
    expect(screen.getByLabelText(/raisonnement par défaut/i)).toBeTruthy();
    expect(screen.getByLabelText(/prompt développeur/i)).toBeTruthy();
    expect(screen.getByLabelText(/affichage des paramètres/i)).toBeTruthy();
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

    expect(screen.queryByRole("button", { name: /lancer la consigne/i })).toBeNull();
    expect(screen.queryByText(/paramètres IA/i)).toBeNull();

    const button = screen.getByRole("button", { name: /continuer/i });
    fireEvent.click(button);

    expect(onAdvance).toHaveBeenCalledTimes(1);
    const payload = onAdvance.mock.calls[0][0] as ClarityPromptStepPayload;
    expect(payload).toMatchObject({
      instruction: "Avance vers la droite",
      triggerId: undefined,
      model: "gpt-5-mini",
      verbosity: "medium",
      thinking: "medium",
      developerPrompt: "",
    });
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
      expect(lastCall.model).toBe("gpt-5-mini");
    });
  });

  it("affiche les paramètres en lecture seule lorsqu'ils sont exposés", () => {
    const config: ClarityPromptStepConfig = {
      settingsMode: "read-only",
      model: "gpt-5",
      verbosity: "high",
      thinking: "high",
      developerPrompt: "Toujours valider les contraintes métier.",
    };

    const props: StepComponentProps = {
      definition: { id: "prompt", component: "clarity-prompt", config },
      config,
      payload: undefined,
      isActive: true,
      isEditMode: false,
      onAdvance: vi.fn(),
      onUpdateConfig: vi.fn(),
    };

    render(<ClarityPromptStep {...props} />);

    expect(screen.getByText(/paramètres ia/i)).toBeTruthy();
    expect(screen.getByText(/gpt-5/i)).toBeTruthy();
    expect(screen.getByText(/élevée/i)).toBeTruthy();
    expect(screen.getByText(/approfondi/i)).toBeTruthy();
    expect(screen.getByText(/Toujours valider les contraintes métier\./i)).toBeTruthy();
    expect(screen.queryByDisplayValue("gpt-5")).toBeNull();
  });

  it("permet à l’utilisateur d’ajuster les paramètres quand l’édition est activée", () => {
    const config: ClarityPromptStepConfig = {
      settingsMode: "editable",
      model: "gpt-5-nano",
      verbosity: "low",
      thinking: "minimal",
      developerPrompt: "Initial system message",
    };

    const onAdvance = vi.fn();
    const props: StepComponentProps = {
      definition: { id: "prompt", component: "clarity-prompt", config },
      config,
      payload: undefined,
      isActive: true,
      isEditMode: false,
      onAdvance,
      onUpdateConfig: vi.fn(),
    };

    render(<ClarityPromptStep {...props} />);

    fireEvent.change(screen.getByPlaceholderText(/décris l'action/i), {
      target: { value: "Collecte les pièces" },
    });

    fireEvent.change(screen.getByLabelText(/^Modèle$/i), {
      target: { value: "gpt-5" },
    });
    fireEvent.change(screen.getByLabelText(/^Verbosité$/i), {
      target: { value: "medium" },
    });
    fireEvent.change(screen.getByLabelText(/^Raisonnement$/i), {
      target: { value: "high" },
    });
    fireEvent.change(screen.getByLabelText(/Prompt développeur/i), {
      target: { value: "Respecte le ton pédagogique" },
    });

    const continueButton = screen.getByRole("button", { name: /continuer/i });
    fireEvent.click(continueButton);

    expect(onAdvance).toHaveBeenCalledTimes(1);
    const payload = onAdvance.mock.calls[0][0] as ClarityPromptStepPayload;
    expect(payload).toMatchObject({
      instruction: "Collecte les pièces",
      model: "gpt-5",
      verbosity: "medium",
      thinking: "high",
      developerPrompt: "Respecte le ton pédagogique",
    });
  });

  it("déclenche un identifiant de simulation lorsqu'on lance la consigne en composite", async () => {
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

    const textarea = await screen.findByPlaceholderText(/décris l'action/i);
    fireEvent.change(textarea, { target: { value: "Avance de trois cases vers le haut" } });

    await waitFor(() => {
      expect(onAdvance).toHaveBeenCalled();
    });
    onAdvance.mockClear();

    const launchButton = screen.getByRole("button", { name: /lancer la consigne/i });
    expect(launchButton).toBeEnabled();

    fireEvent.click(launchButton);

    await waitFor(() => {
      expect(onAdvance).toHaveBeenCalledTimes(1);
      const payload = onAdvance.mock.calls[0][0] as ClarityPromptStepPayload;
      expect(payload.instruction).toBe("Avance de trois cases vers le haut");
      expect(typeof payload.triggerId).toBe("string");
      expect(payload.triggerId).toMatch(/trigger|[0-9a-f-]{8}/i);
      expect(payload.model).toBe("gpt-5-mini");
    });
  });
});
