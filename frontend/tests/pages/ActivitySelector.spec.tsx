import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getProgressMock = vi.fn();
const getConfigMock = vi.fn();
const saveMock = vi.fn();
const importMock = vi.fn();
const exportMock = vi.fn();
const setEditModeMock = vi.fn();

vi.mock("../../src/api", () => ({
  getProgress: getProgressMock,
  activities: {
    getConfig: getConfigMock,
  },
  admin: {
    activities: {
      save: saveMock,
      import: importMock,
      export: exportMock,
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
import "../../src/modules/step-sequence/modules";

describe("ActivitySelector StepSequence designer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProgressMock.mockResolvedValue({ activities: {} });
    getConfigMock.mockResolvedValue({ activities: [], activitySelectorHeader: null });
    saveMock.mockResolvedValue(undefined);
    importMock.mockResolvedValue({ ok: true, activity: {} });
    exportMock.mockResolvedValue({});
  });

  it("allows creating a StepSequence activity and editing its steps", async () => {
    render(
      <MemoryRouter>
        <ActivitySelector />
      </MemoryRouter>
    );

    await waitFor(() => expect(getConfigMock).toHaveBeenCalled());

    const addButton = await screen.findByRole("button", { name: /Ajouter une activité/i });
    fireEvent.click(addButton);

    const shortcutButton = await screen.findByRole("button", {
      name: /Nouvelle activité StepSequence/i,
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
