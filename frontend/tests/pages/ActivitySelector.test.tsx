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
import { createDefaultExplorateurWorldConfig } from "../../src/modules/step-sequence/modules/explorateur-world";

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

    fireEvent.click(within(modal).getByRole("button", { name: /^Fermer$/i }));
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

    const [openModalButton] = await screen.findAllByRole("button", {
      name: /Configurer la séquence Nouvelle séquence StepSequence/i,
    });
    fireEvent.click(openModalButton);

    const sequenceModal = await screen.findByRole("dialog", {
      name: /Configurer « Nouvelle séquence StepSequence »/i,
    });

    const sequenceRegion = await within(sequenceModal).findByRole("region", {
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

  it("persists the default Explorateur world config when adding the module", async () => {
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

    const [openModalButton] = await screen.findAllByRole("button", {
      name: /Configurer la séquence Nouvelle séquence StepSequence/i,
    });
    fireEvent.click(openModalButton);

    const sequenceModal = await screen.findByRole("dialog", {
      name: /Configurer « Nouvelle séquence StepSequence »/i,
    });

    const sequenceRegion = await within(sequenceModal).findByRole("region", {
      name: /Séquence d'étapes pour Nouvelle séquence StepSequence/i,
    });

    const typeSelect = within(sequenceRegion).getByLabelText(
      "Type d'étape à ajouter"
    );
    fireEvent.change(typeSelect, { target: { value: "explorateur-world" } });

    const addStepButton = within(sequenceRegion).getByRole("button", {
      name: /Ajouter une étape/i,
    });
    fireEvent.click(addStepButton);

    await waitFor(() => {
      const accordions = within(sequenceRegion).getAllByRole("button", {
        name: (name) => /^Étape \d+/i.test(name),
      });
      expect(accordions.length).toBeGreaterThanOrEqual(3);
    });

    fireEvent.click(
      within(sequenceModal).getByRole("button", { name: /^Fermer$/i })
    );

    const [saveButton] = await screen.findAllByRole("button", {
      name: /Sauvegarder/i,
    });
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveMock).toHaveBeenCalled());

    const payload = saveMock.mock.calls[0][0];
    expect(Array.isArray(payload.activities)).toBe(true);

    const createdActivity = payload.activities.find(
      (activity: any) =>
        activity &&
        typeof activity.id === "string" &&
        activity.id.startsWith("sequence-")
    );
    expect(createdActivity).toBeTruthy();

    const worldStep = createdActivity?.overrides?.stepSequence?.find(
      (step: any) => step?.component === "explorateur-world"
    );

    expect(worldStep).toBeTruthy();
    expect(worldStep.config).toEqual(createDefaultExplorateurWorldConfig());
  });
});
