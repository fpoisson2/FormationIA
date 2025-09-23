import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  STEP_COMPONENT_REGISTRY,
  StepSequenceContext,
  type StepComponentProps,
} from "../../src/modules/step-sequence";
import {
  RichContentStep,
  type RichContentStepConfig,
} from "../../src/modules/step-sequence/modules";

function renderRichContentStep(
  isEditMode: boolean,
  config: RichContentStepConfig
) {
  const onAdvance = vi.fn();
  const onUpdateConfig = vi.fn();

  const props: StepComponentProps = {
    definition: { id: "rich", component: "rich-content", config },
    config,
    payload: undefined,
    isActive: true,
    isEditMode,
    onAdvance,
    onUpdateConfig,
  };

  const view = render(
    <StepSequenceContext.Provider
      value={{
        stepIndex: 0,
        isEditMode,
        onAdvance,
        onUpdateConfig,
      }}
    >
      <RichContentStep {...props} />
    </StepSequenceContext.Provider>
  );

  return { container: view.container, onUpdateConfig };
}

describe("RichContentStep", () => {
  it("registers itself under the rich-content key", () => {
    expect(STEP_COMPONENT_REGISTRY["rich-content"]).toBe(RichContentStep);
  });

  it("matches the read-only snapshot", () => {
    const { container } = renderRichContentStep(false, {
      title: "Introduction",
      body: "Bienvenue sur la plateforme !\nProfitez de votre parcours.",
      media: [
        {
          id: "m1",
          url: "https://cdn.example.com/hero.png",
          alt: "Capture d'écran",
          caption: "Interface principale",
        },
      ],
      sidebar: {
        type: "tips",
        title: "Astuces",
        tips: ["Prenez des notes", "Planifiez vos séances"],
      },
    });

    expect(container).toMatchSnapshot();
  });

  it("matches the editable snapshot", () => {
    const { container } = renderRichContentStep(true, {
      title: "Atelier",
      body: "Complétez les informations demandées ci-dessous.",
      media: [
        {
          id: "m1",
          url: "https://cdn.example.com/form.png",
          alt: "Formulaire",
        },
      ],
      sidebar: {
        type: "checklist",
        title: "Checklist",
        items: [
          { id: "i1", label: "Ajouter un média", checked: true },
          { id: "i2", label: "Renseigner la description" },
        ],
      },
      onChange: vi.fn(),
    });

    expect(container).toMatchSnapshot();
  });
});
