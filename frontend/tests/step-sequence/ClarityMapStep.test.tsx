import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STEP_COMPONENT_REGISTRY, type StepComponentProps } from "../../src/modules/step-sequence";
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
});
