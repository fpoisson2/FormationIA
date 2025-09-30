import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SimulationChatConfig } from "../../src/modules/step-sequence/modules";
import { DEFAULT_SIMULATION_SYSTEM_MESSAGE } from "../../src/modules/step-sequence/modules";
import SimulationChatStep from "../../src/modules/step-sequence/modules/SimulationChatStep";
import { StepSequenceContext } from "../../src/modules/step-sequence/types";
import type {
  StepComponentProps,
  StepSequenceContextValue,
} from "../../src/modules/step-sequence/types";

function renderSimulationChatStep(config: SimulationChatConfig) {
  const props: StepComponentProps = {
    definition: { id: "simulation", component: "simulation-chat", config },
    config,
    payload: null,
    isActive: true,
    isEditMode: true,
    onAdvance: vi.fn(),
    onUpdateConfig: vi.fn(),
  };

  return render(<SimulationChatStep {...props} />);
}

describe("SimulationChatStep", () => {
  const baseConfig: Omit<SimulationChatConfig, "stages"> = {
    title: "Simulation",
    help: "Aide",
    roles: { ai: "IA", user: "Participant" },
    mode: "scripted",
    systemMessage: DEFAULT_SIMULATION_SYSTEM_MESSAGE,
    model: "gpt-5-mini",
    verbosity: "medium",
    thinking: "medium",
  };

  it("keeps fields whose labels are temporarily empty during normalization", async () => {
    const config: SimulationChatConfig = {
      ...baseConfig,
      stages: [
        {
          id: "stage-1",
          prompt: "",
          allowEmpty: false,
          fields: [
            {
              id: "field-1",
              label: "",
              type: "textarea_with_counter",
              minWords: 0,
              maxWords: 120,
            },
          ],
        },
      ],
    };

    renderSimulationChatStep(config);

    const [submitLabelInput] = await screen.findAllByLabelText("Libellé du bouton");
    const settingsPanel = submitLabelInput.closest("aside");
    expect(settingsPanel).not.toBeNull();
    const fieldInputs = within(settingsPanel as HTMLElement).getAllByLabelText("Libellé");
    expect(fieldInputs).toHaveLength(1);
    expect(fieldInputs[0]).toHaveValue("");
  });

  it("preserves the field input after clearing its label in edit mode", async () => {
    const config: SimulationChatConfig = {
      ...baseConfig,
      stages: [
        {
          id: "stage-1",
          prompt: "",
          allowEmpty: false,
          fields: [
            {
              id: "field-1",
              label: "Titre du champ",
              type: "textarea_with_counter",
              minWords: 0,
              maxWords: 120,
            },
          ],
        },
      ],
    };

    renderSimulationChatStep(config);

    const [submitLabelInput] = await screen.findAllByLabelText("Libellé du bouton");
    const settingsPanel = submitLabelInput.closest("aside");
    expect(settingsPanel).not.toBeNull();
    const input = within(settingsPanel as HTMLElement).getByLabelText("Libellé");
    fireEvent.change(input, { target: { value: "" } });

    const remainingInputs = within(settingsPanel as HTMLElement).getAllByLabelText("Libellé");
    expect(remainingInputs).toHaveLength(1);
    expect(remainingInputs[0]).toHaveValue("");
  });

  it("preserves the AI role label while editing", async () => {
    const config: SimulationChatConfig = {
      ...baseConfig,
      roles: { ai: "Intelligence", user: "Participant" },
      stages: [],
    };

    renderSimulationChatStep(config);

    const [input] = await screen.findAllByLabelText("Libellé du rôle IA");
    fireEvent.change(input, { target: { value: "" } });

    expect(input).toHaveValue("");
  });

  it("allows clearing the title and help without restoring defaults", async () => {
    const config: SimulationChatConfig = {
      ...baseConfig,
      stages: [],
    };

    renderSimulationChatStep(config);

    const [submitLabelInput] = await screen.findAllByLabelText("Libellé du bouton");
    const settingsPanel = submitLabelInput.closest("aside");
    expect(settingsPanel).not.toBeNull();

    const titleInput = within(settingsPanel as HTMLElement).getByLabelText("Titre");
    fireEvent.change(titleInput, { target: { value: "" } });
    expect(titleInput).toHaveValue("");

    const helpTextarea = within(settingsPanel as HTMLElement).getByLabelText("Aide contextuelle");
    fireEvent.change(helpTextarea, { target: { value: "" } });
    expect(helpTextarea).toHaveValue("");
  });

  it("registers a manual advance handler once the live conversation ends", async () => {
    const setManualAdvanceHandler = vi.fn();
    const setManualAdvanceDisabled = vi.fn();
    const onAdvance = vi.fn();

    const config: SimulationChatConfig = {
      ...baseConfig,
      mode: "live",
      stages: [],
    };

    const props: StepComponentProps = {
      definition: { id: "simulation", component: "simulation-chat", config },
      config,
      payload: {
        history: [],
        runId: "run-42",
        conversation: {
          messages: [
            { id: "msg-user", role: "user", content: "Bonjour" },
            { id: "msg-ai", role: "ai", content: "Salut" },
          ],
          finished: true,
        },
      },
      isActive: true,
      isEditMode: false,
      onAdvance,
      onUpdateConfig: vi.fn(),
    };

    const contextValue: StepSequenceContextValue = {
      stepIndex: 0,
      stepCount: 1,
      steps: [],
      payloads: {},
      isEditMode: false,
      onAdvance: vi.fn(),
      onUpdateConfig: vi.fn(),
      goToStep: vi.fn(),
      setManualAdvanceHandler,
      setManualAdvanceDisabled,
      getManualAdvanceState: () => ({ handler: null, disabled: false }),
    };

    render(
      <StepSequenceContext.Provider value={contextValue}>
        <SimulationChatStep {...props} />
      </StepSequenceContext.Provider>
    );

    await waitFor(() => {
      expect(setManualAdvanceHandler).toHaveBeenCalledWith(expect.any(Function));
    });

    expect(onAdvance).not.toHaveBeenCalled();

    const lastCallIndex = setManualAdvanceHandler.mock.calls.length - 1;
    const handler =
      lastCallIndex >= 0
        ? (setManualAdvanceHandler.mock.calls[lastCallIndex]?.[0] as (() => unknown))
        : undefined;
    expect(typeof handler).toBe("function");
    expect(handler?.()).toEqual({
      history: [],
      runId: "run-42",
      conversation: {
        messages: [
          { id: "msg-user", role: "user", content: "Bonjour" },
          { id: "msg-ai", role: "ai", content: "Salut" },
        ],
        finished: true,
      },
    });

    expect(setManualAdvanceDisabled).toHaveBeenCalledWith(false);
  });

  it("exposes a disabled manual advance handler while the live conversation is running", async () => {
    const setManualAdvanceHandler = vi.fn();
    const setManualAdvanceDisabled = vi.fn();

    const config: SimulationChatConfig = {
      ...baseConfig,
      mode: "live",
      stages: [],
    };

    const props: StepComponentProps = {
      definition: { id: "simulation", component: "simulation-chat", config },
      config,
      payload: {
        history: [],
        runId: "run-42",
        conversation: {
          messages: [
            { id: "msg-user", role: "user", content: "Bonjour" },
            { id: "msg-ai", role: "ai", content: "Salut" },
          ],
          finished: false,
        },
      },
      isActive: true,
      isEditMode: false,
      onAdvance: vi.fn(),
      onUpdateConfig: vi.fn(),
    };

    const contextValue: StepSequenceContextValue = {
      stepIndex: 0,
      stepCount: 1,
      steps: [],
      payloads: {},
      isEditMode: false,
      onAdvance: vi.fn(),
      onUpdateConfig: vi.fn(),
      goToStep: vi.fn(),
      setManualAdvanceHandler,
      setManualAdvanceDisabled,
      getManualAdvanceState: () => ({ handler: null, disabled: false }),
    };

    render(
      <StepSequenceContext.Provider value={contextValue}>
        <SimulationChatStep {...props} />
      </StepSequenceContext.Provider>
    );

    await waitFor(() => {
      expect(setManualAdvanceHandler).toHaveBeenCalledWith(expect.any(Function));
    });

    const lastCallIndex = setManualAdvanceHandler.mock.calls.length - 1;
    const handler =
      lastCallIndex >= 0
        ? (setManualAdvanceHandler.mock.calls[lastCallIndex]?.[0] as (() => unknown))
        : undefined;
    expect(typeof handler).toBe("function");
    expect(handler?.()).toEqual({
      history: [],
      runId: "run-42",
      conversation: {
        messages: [
          { id: "msg-user", role: "user", content: "Bonjour" },
          { id: "msg-ai", role: "ai", content: "Salut" },
        ],
        finished: false,
      },
    });

    expect(setManualAdvanceDisabled).toHaveBeenCalledWith(true);
  });
});
