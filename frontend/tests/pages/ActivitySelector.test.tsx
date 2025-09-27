import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProgressMock, getConfigMock, saveMock, setEditModeMock } =
  vi.hoisted(() => ({
    getProgressMock: vi.fn(),
    getConfigMock: vi.fn(),
    saveMock: vi.fn(),
    setEditModeMock: vi.fn(),
  }));

vi.mock("../../src/api", () => ({
  getProgress: getProgressMock,
  activities: {
    getConfig: getConfigMock,
  },
  admin: {
    activities: {
      save: saveMock,
    },
  },
}));

vi.mock("../../src/providers/AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    status: "authenticated",
    user: { roles: ["admin"] },
    isEditMode: true,
    setEditMode: setEditModeMock,
    token: "test-token",
  }),
}));

vi.mock("../../src/hooks/useLTI", () => ({
  useLTI: () => ({ context: null, isLTISession: false, loading: false }),
}));

import ActivitySelector from "../../src/pages/ActivitySelector";
import { getDefaultActivityDefinitions } from "../../src/config/activities";
import { StepSequenceActivity } from "../../src/modules/step-sequence";
import "../../src/modules/step-sequence/modules";

describe("ActivitySelector StepSequence designer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProgressMock.mockResolvedValue({ activities: {} });
    getConfigMock.mockResolvedValue({ activities: [], activitySelectorHeader: null });
    saveMock.mockResolvedValue(undefined);
  });

  it("exposes the StepSequence editor for default activities using the StepSequence component", async () => {
    render(
      <MemoryRouter>
        <ActivitySelector />
      </MemoryRouter>
    );

    await waitFor(() => expect(getConfigMock).toHaveBeenCalled());

    const defaultStepSequenceCount = getDefaultActivityDefinitions().filter(
      (definition) => definition.component === StepSequenceActivity
    ).length;

    expect(defaultStepSequenceCount).toBeGreaterThan(0);

    await waitFor(() => {
      expect(
        screen.queryAllByRole("region", { name: /Séquence d'étapes pour/i })
      ).toHaveLength(defaultStepSequenceCount);
    });
  });

  it("allows creating a StepSequence activity and editing its steps", async () => {
    render(
      <MemoryRouter>
        <ActivitySelector />
      </MemoryRouter>
    );

    await waitFor(() => expect(getConfigMock).toHaveBeenCalled());

    const [shortcutButton] = await screen.findAllByRole("button", {
      name: /Ajouter une activité StepSequence/i,
    });
    fireEvent.click(shortcutButton);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const sequenceRegion = await screen.findByRole("region", {
      name: /Séquence d'étapes pour Nouvelle séquence StepSequence/i,
    });

    const initialHeadings = within(sequenceRegion).getAllByRole("heading", { name: /Étape/ });
    expect(initialHeadings).toHaveLength(2);

    const introTitleInput = within(sequenceRegion).getByPlaceholderText("Titre de l'étape");
    fireEvent.change(introTitleInput, {
      target: { value: "Bienvenue dans la séquence" },
    });

    await waitFor(() =>
      expect(
        within(sequenceRegion).getByDisplayValue("Bienvenue dans la séquence")
      ).toBeInTheDocument()
    );

    const addStepButton = within(sequenceRegion).getByRole("button", {
      name: /Ajouter une étape/i,
    });
    fireEvent.click(addStepButton);

    await waitFor(() => {
      const headings = within(sequenceRegion).getAllByRole("heading", { name: /Étape/ });
      expect(headings).toHaveLength(3);
    });
  });
});
