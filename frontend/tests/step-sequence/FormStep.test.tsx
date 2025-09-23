import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  STEP_COMPONENT_REGISTRY,
  StepSequenceContext,
  type StepComponentProps,
} from "../../src/modules/step-sequence";
import type { StageAnswer } from "../../src/api";
import {
  FormStep,
  type FormStepConfig,
  createDefaultFieldSpec,
  validateFieldSpec,
} from "../../src/modules/step-sequence/modules";

function renderFormStep(options: {
  config?: FormStepConfig;
  payload?: StageAnswer;
  isEditMode?: boolean;
} = {}) {
  const onAdvance = vi.fn();
  const onUpdateConfig = vi.fn();

  const baseConfig: FormStepConfig =
    options.config ?? {
      fields: [
        {
          id: "description",
          label: "Description",
          type: "textarea_with_counter",
          minWords: 1,
          maxWords: 60,
        },
      ],
      submitLabel: "Continuer",
    };

  const props: StepComponentProps = {
    definition: { id: "form-step", component: "form", config: baseConfig },
    config: baseConfig,
    payload: options.payload,
    isActive: true,
    isEditMode: Boolean(options.isEditMode),
    onAdvance,
    onUpdateConfig,
  };

  const view = render(
    <StepSequenceContext.Provider
      value={{
        stepIndex: 0,
        isEditMode: Boolean(options.isEditMode),
        onAdvance,
        onUpdateConfig,
      }}
    >
      <FormStep {...props} />
    </StepSequenceContext.Provider>
  );

  return { ...view, onAdvance, onUpdateConfig };
}

describe("FormStep", () => {
  it("registers itself under the form key", () => {
    expect(STEP_COMPONENT_REGISTRY["form"]).toBe(FormStep);
  });

  it("supports initial values and submits sanitized payloads", () => {
    const config: FormStepConfig = {
      fields: [
        {
          id: "desc",
          label: "Description",
          type: "textarea_with_counter",
          minWords: 1,
          maxWords: 60,
        },
      ],
      submitLabel: "Envoyer",
      initialValues: { desc: "  Bonjour monde  " },
    };

    const { onAdvance } = renderFormStep({ config });

    const textarea = screen.getByPlaceholderText("Rédige ta réponse ici") as HTMLTextAreaElement;
    expect(textarea.value).toBe("  Bonjour monde  ");

    const submitButton = screen.getByRole("button", { name: "Envoyer" });
    fireEvent.click(submitButton);

    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledWith({ desc: "Bonjour monde" });
  });

  it("blocks submission with default validation when required fields are empty", () => {
    const { onAdvance } = renderFormStep();

    const submitButton = screen.getByRole("button", { name: "Continuer" });
    fireEvent.click(submitButton);

    expect(onAdvance).not.toHaveBeenCalled();
    expect(screen.queryByText("Complète ce champ.")).not.toBeNull();
  });

  it("merges custom validation errors", () => {
    const validate = vi.fn().mockReturnValue({ desc: "Réponse insuffisante" });
    const config: FormStepConfig = {
      fields: [
        {
          id: "desc",
          label: "Description",
          type: "textarea_with_counter",
          minWords: 1,
          maxWords: 60,
        },
      ],
      submitLabel: "Valider",
      initialValues: { desc: "Un essai" },
      validate,
    };

    const { onAdvance } = renderFormStep({ config });

    const submitButton = screen.getByRole("button", { name: "Valider" });
    fireEvent.click(submitButton);

    expect(validate).toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
    expect(screen.queryByText("Réponse insuffisante")).not.toBeNull();
  });

  it("allows designers to create and remove fields", () => {
    const onChange = vi.fn();
    const config: FormStepConfig = {
      fields: [],
      submitLabel: "Configurer",
      onChange,
    };

    const { onUpdateConfig } = renderFormStep({ config, isEditMode: true });

    const addButton = screen.getByRole("button", { name: "Ajouter un champ" });
    fireEvent.click(addButton);

    expect(onChange).toHaveBeenCalled();
    expect(onUpdateConfig).toHaveBeenCalled();
    const lastConfig = onChange.mock.calls.at(-1)?.[0] as FormStepConfig;
    expect(lastConfig.fields.length).toBe(1);

    const removeButton = screen.getByRole("button", { name: "Retirer" });
    fireEvent.click(removeButton);

    const afterRemoval = onChange.mock.calls.at(-1)?.[0] as FormStepConfig;
    expect(afterRemoval.fields.length).toBe(0);
    expect(screen.queryByText("Aucun champ configuré.")).not.toBeNull();
  });
});

describe("validateFieldSpec", () => {
  it("accepts generated default specs", () => {
    const spec = createDefaultFieldSpec("textarea_with_counter");
    expect(validateFieldSpec(spec)).toBe(true);
  });

  it("rejects malformed specs", () => {
    const invalid = { id: "", label: "", type: "unknown" } as unknown;
    expect(validateFieldSpec(invalid)).toBe(false);
  });
});
