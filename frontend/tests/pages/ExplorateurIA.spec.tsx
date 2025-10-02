import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

vi.mock("../../src/pages/explorateurIA/audio/chiptuneTheme", () => ({
  createChiptuneTheme: () => ({
    isSupported: false,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  }),
}));

vi.mock("../../src/api", () => ({
  updateActivityProgress: vi.fn().mockResolvedValue(undefined),
}));

import { useMemo, useState } from "react";
import {
  StepSequenceActivity,
  StepSequenceContext,
  type StepDefinition,
  type StepSequenceActivityProps,
  createDefaultExplorateurWorldConfig,
} from "../../src/modules/step-sequence";
import ExplorateurIA, {
  createDefaultExplorateurIAConfig,
} from "../../src/pages/ExplorateurIA";

function createExplorateurSteps(): StepDefinition[] {
  return [
    {
      id: "explorateur:introduction",
      component: "rich-content",
      config: {
        title: "Bienvenue",
        body: "Découvre la ville IA pas à pas.",
      },
    },
    {
      id: "explorateur:world",
      component: "explorateur-world",
      config: createDefaultExplorateurWorldConfig(),
    },
    {
      id: "explorateur:debrief",
      component: "rich-content",
      config: {
        title: "Bilan",
        body: "Exportez votre badge pour valider l’activité.",
      },
    },
  ];
}

const defaultActivityProps: StepSequenceActivityProps = {
  activityId: "explorateur-ia",
  completionId: "explorateur-ia",
  header: { eyebrow: "", title: "Explorateur IA" },
  card: {
    title: "Explorateur IA",
    description: "",
    highlights: [],
    cta: { label: "", to: "" },
  },
  layout: { activityId: "explorateur-ia" },
  layoutOverrides: {},
  setLayoutOverrides: vi.fn(),
  resetLayoutOverrides: vi.fn(),
  navigateToActivities: vi.fn(),
  isEditMode: false,
  enabled: true,
  stepSequence: undefined,
  setStepSequence: vi.fn(),
  steps: createExplorateurSteps(),
};

const matchMediaMock = vi.fn().mockImplementation(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock,
    });
  }
  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      value: ResizeObserverStub,
    });
  }
  vi.spyOn(window.URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(window.URL, "createObjectURL").mockImplementation(() => "blob:mock");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderExplorateurIA(props?: Partial<StepSequenceActivityProps>) {
  const mergedProps: StepSequenceActivityProps = {
    ...defaultActivityProps,
    steps: createExplorateurSteps(),
    ...props,
  } as StepSequenceActivityProps;
  if (!mergedProps.steps) {
    mergedProps.steps = createExplorateurSteps();
  }
  return render(<StepSequenceActivity {...mergedProps} />);
}

function ConfigDesignerHarness() {
  const [config, setConfig] = useState(createDefaultExplorateurIAConfig());
  const definition = useMemo(
    () => ({
      id: "explorateur:world",
      component: "explorateur-world",
      config,
    }),
    [config]
  );

  const contextValue = useMemo(
    () => ({
      stepIndex: 0,
      stepCount: 1,
      steps: [definition],
      payloads: {},
      isEditMode: true,
      onAdvance: () => {},
      onUpdateConfig: setConfig,
      goToStep: () => {},
      activityContext: null,
      setManualAdvanceHandler: () => {},
      setManualAdvanceDisabled: () => {},
      getManualAdvanceState: () => ({ handler: null, disabled: false }),
    }),
    [definition]
  );

  return (
    <StepSequenceContext.Provider value={contextValue}>
      <ExplorateurIA
        definition={definition}
        config={config}
        payload={null}
        isActive
        isEditMode
        onAdvance={() => {}}
        onUpdateConfig={setConfig}
      />
    </StepSequenceContext.Provider>
  );
}

describe("Explorateur IA", () => {
  it("permet de compléter le quartier Clarté et d'exporter les données", async () => {
    const storedBlobs: Blob[] = [];
    (window.URL.createObjectURL as unknown as vi.Mock).mockImplementation((blob: Blob) => {
      storedBlobs.push(blob);
      return "blob:mock";
    });

    const setStepSequence = vi.fn();
    renderExplorateurIA({ setStepSequence });

    const introContinueButton = await screen.findByRole("button", {
      name: /Continuer/i,
    });
    fireEvent.click(introContinueButton);

    vi.useFakeTimers();

    const clarteButtons = await screen.findAllByRole("button", {
      name: /Quartier Clarté/i,
    });
    fireEvent.click(clarteButtons[0]);

    let continueButton = await screen.findByRole("button", { name: /Continuer/i });
    fireEvent.click(continueButton);

    continueButton = await screen.findByRole("button", { name: /Continuer/i });
    fireEvent.click(continueButton);

    const bestOption = await screen.findByRole("button", {
      name: /Donne un plan en 5 sections sur l'énergie solaire/i,
    });
    fireEvent.click(bestOption);

    const validateButton = await screen.findByRole("button", { name: /Valider/i });
    fireEvent.click(validateButton);

    vi.runAllTimers();
    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Valider/i })).not.toBeInTheDocument();
    });

    const progressionPanel = screen.getByText("Progression").closest("div");
    expect(progressionPanel).not.toBeNull();
    const progressionItems = within(progressionPanel as HTMLElement).getAllByRole("listitem");
    const clarteItem = progressionItems.find((item) =>
      within(item).queryByText(/Quartier Clarté/i)
    );
    expect(clarteItem).toBeDefined();
    expect(within(clarteItem as HTMLElement).getByText("OK")).toBeInTheDocument();

    const jsonButton = screen.getByRole("button", { name: /^JSON$/i });
    fireEvent.click(jsonButton);

    expect(storedBlobs).toHaveLength(1);
    const exportText = await storedBlobs[0].text();
    const exportData = JSON.parse(exportText);
    expect(exportData.activity).toBe("Explorateur IA");
    expect(exportData.quarters.clarte.details.score).toBe(100);
    expect(exportData.quarters.clarte.details.selectedOptionId).toBe("B");
    expect(exportData.quarters.clarte.payloads["clarte:quiz"]).toBeDefined();
  });
});

describe("Explorateur IA designer", () => {
  it("permet d'ajouter un quartier personnalisé", async () => {
    render(<ConfigDesignerHarness />);

    const addQuarterButton = await screen.findByRole("button", {
      name: /Ajouter un quartier/i,
    });
    fireEvent.click(addQuarterButton);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Supprimer Nouveau quartier/i })
      ).toBeInTheDocument();
    });
  });

  it("permet de supprimer un quartier par défaut", async () => {
    render(<ConfigDesignerHarness />);

    const removeButton = await screen.findByRole("button", {
      name: /Supprimer Quartier Clarté/i,
    });
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Supprimer Quartier Clarté/i })
      ).not.toBeInTheDocument();
    });
  });
});
