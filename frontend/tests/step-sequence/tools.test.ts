import { describe, expect, it } from "vitest";

import {
  STEP_SEQUENCE_TOOLS,
  generateStepId,
  type StepDefinition,
} from "../../src/modules/step-sequence";
import type { ActivityConfigEntry } from "../../src/config/activities";

function expectStepDefinition(step: StepDefinition): void {
  expect(typeof step.id).toBe("string");
  expect(step.id.length).toBeGreaterThan(0);
}

describe("STEP_SEQUENCE_TOOLS", () => {
  it("expose des schémas stricts", () => {
    Object.values(STEP_SEQUENCE_TOOLS).forEach((tool) => {
      expect(tool.definition.strict).toBe(true);
      const params = tool.definition.parameters as {
        additionalProperties?: unknown;
        required?: unknown;
      };
      expect(params.additionalProperties).toBe(false);
      expect(Array.isArray(params.required)).toBe(true);
    });
  });

  it("crée une étape rich-content valide", () => {
    const tool = STEP_SEQUENCE_TOOLS.create_rich_content_step;
    const step = tool.handler({
      title: "Introduction",
      body: "Bienvenue",
      media: [
        {
          url: "https://example.com/cover.png",
          alt: "Illustration",
        },
      ],
      sidebar: {
        type: "tips",
        tips: ["Astuce"],
      },
    });

    expectStepDefinition(step);
    expect(step.component).toBe("rich-content");
    expect(step.config).toMatchObject({
      title: "Introduction",
      body: "Bienvenue",
    });
    expect((step.config as { media?: unknown[] }).media).toHaveLength(1);
  });

  it("crée une étape formulaire conforme", () => {
    const rich = STEP_SEQUENCE_TOOLS.create_rich_content_step.handler({
      title: "Contexte",
    });
    const tool = STEP_SEQUENCE_TOOLS.create_form_step;
    const step = tool.handler({
      idHint: "questionnaire",
      existingStepIds: [rich.id],
      fields: [
        {
          id: "objectif",
          label: "Objectif",
          type: "textarea_with_counter",
          minWords: 10,
          maxWords: 200,
        },
      ],
      submitLabel: "Envoyer",
      allowEmpty: false,
    });

    expectStepDefinition(step);
    expect(step.id).toContain("questionnaire");
    expect(step.component).toBe("form");
    expect(step.config).toMatchObject({
      submitLabel: "Envoyer",
      allowEmpty: false,
    });
  });

  it("crée une étape vidéo enrichie", () => {
    const tool = STEP_SEQUENCE_TOOLS.create_video_step;
    const step = tool.handler({
      idHint: "video-de-demo",
      sources: [
        { type: "mp4", url: "https://example.com/demo.mp4" },
        { type: "hls", url: "https://example.com/demo.m3u8" },
      ],
      captions: [
        { src: "https://example.com/demo.vtt", srclang: "fr" },
      ],
      autoAdvanceOnEnd: true,
      expectedDuration: 120,
    });

    expectStepDefinition(step);
    expect(step.component).toBe("video");
    expect(step.config).toMatchObject({
      autoAdvanceOnEnd: true,
      expectedDuration: 120,
    });
  });

  it("n'expose pas les outils d'atelier", () => {
    expect(STEP_SEQUENCE_TOOLS).toHaveProperty(
      "create_simulation_chat_step",
    );
    expect(STEP_SEQUENCE_TOOLS).toHaveProperty("create_info_cards_step");
    expect(STEP_SEQUENCE_TOOLS).toHaveProperty(
      "create_prompt_evaluation_step",
    );
    expect(STEP_SEQUENCE_TOOLS).toHaveProperty("create_ai_comparison_step");
    expect(STEP_SEQUENCE_TOOLS).toHaveProperty("create_clarity_map_step");
    expect(STEP_SEQUENCE_TOOLS).toHaveProperty("create_clarity_prompt_step");
    expect(STEP_SEQUENCE_TOOLS).toHaveProperty(
      "create_explorateur_world_step",
    );
    expect(STEP_SEQUENCE_TOOLS).not.toHaveProperty(
      "create_workshop_context_step",
    );
    expect(STEP_SEQUENCE_TOOLS).not.toHaveProperty(
      "create_workshop_comparison_step",
    );
    expect(STEP_SEQUENCE_TOOLS).not.toHaveProperty(
      "create_workshop_synthesis_step",
    );
  });

  it("crée une simulation conversationnelle", () => {
    const tool = STEP_SEQUENCE_TOOLS.create_simulation_chat_step;
    const step = tool.handler({
      title: "Simulation vente",
      help: "Accompagne l'apprenant",
      stages: [
        {
          prompt: "Présente-toi",
          fields: [
            {
              id: "pitch",
              label: "Pitch",
              type: "textarea_with_counter",
              minWords: 20,
              maxWords: 80,
            },
          ],
        },
      ],
      roles: {
        ai: "Coach",
        user: "Vendeur",
      },
    });

    expectStepDefinition(step);
    expect(step.component).toBe("simulation-chat");
    expect((step.config as { stages: unknown[] }).stages).toHaveLength(1);
  });

  it("crée un bloc info-cards", () => {
    const tool = STEP_SEQUENCE_TOOLS.create_info_cards_step;
    const step = tool.handler({
      title: "Indicateurs clés",
      cards: [
        {
          title: "Adoption",
          description: "80 % des équipes utilisent l'outil",
          tone: "sand",
          items: ["Objectif atteint", "Suivi mensuel"],
        },
      ],
    });

    expectStepDefinition(step);
    expect(step.component).toBe("info-cards");
    expect((step.config as { cards: unknown[] }).cards).toHaveLength(1);
  });

  it("configure une évaluation de prompt", () => {
    const tool = STEP_SEQUENCE_TOOLS.create_prompt_evaluation_step;
    const step = tool.handler({
      defaultText: "Décris une activité collaborative en 3 étapes.",
      verbosity: "high",
    });

    expectStepDefinition(step);
    expect(step.component).toBe("prompt-evaluation");
    expect((step.config as { defaultText: string }).defaultText).toContain(
      "activité collaborative",
    );
  });

  it("configure une comparaison de modèles IA", () => {
    const tool = STEP_SEQUENCE_TOOLS.create_ai_comparison_step;
    const step = tool.handler({
      contextField: "summary",
      copy: {
        promptLabel: "Formule ta requête",
        variantTitles: { A: "Agent rapide", B: "Agent expert" },
      },
    });

    expectStepDefinition(step);
    expect(step.component).toBe("ai-comparison");
    expect(
      (step.config as { copy: { variantTitles: Record<string, string> } }).copy
        .variantTitles.A,
    ).toContain("Agent");
  });

  it("crée une étape Clarity map", () => {
    const tool = STEP_SEQUENCE_TOOLS.create_clarity_map_step;
    const step = tool.handler({
      obstacleCount: 8,
      initialTarget: { x: 4, y: 7 },
      instructionLabel: "Consigne reçue",
    });

    expectStepDefinition(step);
    expect(step.component).toBe("clarity-map");
    expect((step.config as { obstacleCount: number }).obstacleCount).toBe(8);
  });

  it("crée une étape Clarity prompt", () => {
    const tool = STEP_SEQUENCE_TOOLS.create_clarity_prompt_step;
    const step = tool.handler({
      promptLabel: "Commande IA",
      verbosity: "high",
      thinking: "high",
      settingsMode: "editable",
    });

    expectStepDefinition(step);
    expect(step.component).toBe("clarity-prompt");
    expect((step.config as { settingsMode: string }).settingsMode).toBe(
      "editable",
    );
  });

  it("charge le monde Explorateur IA", () => {
    const tool = STEP_SEQUENCE_TOOLS.create_explorateur_world_step;
    const step = tool.handler({});

    expectStepDefinition(step);
    expect(step.component).toBe("explorateur-world");
    expect((step.config as { terrain: unknown }).terrain).toBeDefined();
  });

  it("crée une étape composite", () => {
    const tool = STEP_SEQUENCE_TOOLS.create_composite_step;
    const step = tool.handler({
      idHint: "recapitulatif",
      modules: [
        { component: "rich-content", slot: "main", config: null },
        { component: "form", slot: "sidebar", config: null },
      ],
      autoAdvance: true,
      continueLabel: "Continuer",
    });

    expectStepDefinition(step);
    expect("composite" in step).toBe(true);
    if ("composite" in step) {
      expect(step.composite?.modules).toHaveLength(2);
      expect(step.composite?.autoAdvance).toBe(true);
      expect(step.composite?.continueLabel).toBe("Continuer");
    }
  });

  it("assemble une activité StepSequence complète", async () => {
    const richStep = STEP_SEQUENCE_TOOLS.create_rich_content_step.handler({
      title: "Étape 1",
      body: "Déroulé",
    });
    const formStep = STEP_SEQUENCE_TOOLS.create_form_step.handler({
      idHint: "collecte",
      existingStepIds: [richStep.id],
      fields: [
        {
          id: "retour",
          label: "Retour",
          type: "textarea_with_counter",
          minWords: 5,
          maxWords: 100,
        },
      ],
    });

    const entry = await STEP_SEQUENCE_TOOLS.build_step_sequence_activity.handler({
      activityId: "atelier",
      steps: [richStep, formStep],
      metadata: {
        header: { eyebrow: "Test", title: "Atelier test" },
      },
    });

    expect((entry as ActivityConfigEntry).id).toBe("atelier");
    expect(entry.componentKey).toBe("step-sequence");
    expect(entry.path).toBe("/atelier");
    expect(entry.overrides).toBeDefined();
    expect(entry.overrides?.header).toMatchObject({
      eyebrow: "Test",
      title: "Atelier test",
    });
    expect(entry.overrides?.stepSequence).toMatchObject([
      { id: richStep.id, component: "rich-content", config: expect.anything() },
      { id: formStep.id, component: "form", config: expect.anything() },
    ]);
  });

  it("génère des identifiants compatibles", () => {
    const first = generateStepId("Synthèse", ["atelier-intro"]);
    const second = generateStepId("Synthèse", ["atelier-intro", first]);

    expect(first).toBe("synthese");
    expect(second).toBe("synthese-2");
  });
});
