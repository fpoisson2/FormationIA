import { describe, expect, beforeEach, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { StepSequenceRenderer } from "../../src/modules/step-sequence/StepSequenceRenderer";
import {
  STEP_COMPONENT_REGISTRY,
  registerStepComponent,
} from "../../src/modules/step-sequence/registry";
import { CompositeStep } from "../../src/modules/step-sequence/modules/CompositeStep";
import { useStepSequence } from "../../src/modules/step-sequence";
import type {
  CompositeStepConfig,
  StepComponentProps,
} from "../../src/modules/step-sequence/types";

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

  it("makes each module payload available through the step sequence context", async () => {
    registerStepComponent(
      "module-publisher",
      function ModulePublisher({ onAdvance }: StepComponentProps) {
        return (
          <button type="button" onClick={() => onAdvance({ status: "ready" })}>
            Publish payload
          </button>
        );
      }
    );

    registerStepComponent(
      "module-consumer",
      function ModuleConsumer() {
        const { payloads } = useStepSequence();
        const status = (payloads["module-publisher"] as { status?: string } | undefined)?.status ?? "pending";
        return <div data-testid="consumer-status">{status}</div>;
      }
    );

    render(
      <StepSequenceRenderer
        steps={[
          {
            id: "composite-step",
            composite: {
              modules: [
                { id: "module-publisher", component: "module-publisher" },
                { id: "module-consumer", component: "module-consumer" },
              ],
            },
          },
        ]}
      />
    );

    expect(screen.getByTestId("consumer-status").textContent).toBe("pending");

    fireEvent.click(screen.getByRole("button", { name: /publish payload/i }));

    await waitFor(() => {
      expect(screen.getByTestId("consumer-status").textContent).toBe("ready");
    });
  });

  it("permet de gérer les blocs en mode édition", () => {
    registerStepComponent(
      "module-a",
      createTestModule("Module A", { status: "ok" })
    );

    const handleUpdateConfig = vi.fn();

    render(
      <CompositeStep
        definition={{
          id: "composite-step",
          component: "composite",
          composite: { modules: [] },
        }}
        config={{ modules: [] }}
        payload={undefined}
        isActive
        isEditMode
        onAdvance={vi.fn()}
        onUpdateConfig={handleUpdateConfig}
      />
    );

    expect(
      screen.getByText(/aucun bloc n’est configuré pour le moment/i)
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /ajouter ce bloc/i }));

    expect(handleUpdateConfig).toHaveBeenCalledTimes(1);
    const nextConfig = handleUpdateConfig.mock.calls[0][0] as CompositeStepConfig;
    expect(nextConfig.modules).toHaveLength(1);
    expect(nextConfig.modules[0]?.component).toBe("module-a");
  });
});
