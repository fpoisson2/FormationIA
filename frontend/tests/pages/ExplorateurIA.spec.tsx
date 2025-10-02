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

import {
  StepSequenceActivity,
  type StepDefinition,
  type StepSequenceActivityProps,
  createDefaultExplorateurWorldConfig,
} from "../../src/modules/step-sequence";

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

    vi.runAllTimers();
    vi.useRealTimers();

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /Quartier Clarté/i }) ??
          screen.queryByText(/Quartier Clarté/i)
      ).not.toBeInTheDocument();
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
    expect(exportData.quarters.clarte.payloads).toEqual({});
    expect(exportData.quarters.clarte.details.score).toBe(0);
    expect(exportData.quarters.clarte.details.selectedOptionId).toBeNull();
    expect(exportData.quarters.clarte.details.explanation).toBeNull();
  });
});
