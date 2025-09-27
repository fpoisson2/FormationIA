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

  it("exposes the StepSequence editor via a modal for default StepSequence activities", async () => {
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

    const configureButtons = await screen.findAllByRole("button", {
      name: /Configurer la séquence/i,
    });

    expect(configureButtons).toHaveLength(defaultStepSequenceCount);

    fireEvent.click(configureButtons[0]);

    const modal = await screen.findByRole("dialog", {
      name: /Configurer «/i,
    });

    expect(
      within(modal).getByRole("region", {
        name: /Séquence d'étapes pour/i,
      })
    ).toBeInTheDocument();

    fireEvent.click(within(modal).getByRole("button", { name: /Fermer/i }));
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

    const sequenceModal = await screen.findByRole("dialog", {
      name: /Configurer « Nouvelle séquence StepSequence »/i,
    });

    const sequenceRegion = within(sequenceModal).getByRole("region", {
      name: /Séquence d'étapes pour Nouvelle séquence StepSequence/i,
    });

    const initialAccordions = within(sequenceRegion).getAllByRole("button", {
      name: (name) => /^Étape \d+/i.test(name),
    });
    expect(initialAccordions).toHaveLength(2);

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
      const accordions = within(sequenceRegion).getAllByRole("button", {
        name: (name) => /^Étape \d+/i.test(name),
      });
      expect(accordions).toHaveLength(3);
    });
  });
});
