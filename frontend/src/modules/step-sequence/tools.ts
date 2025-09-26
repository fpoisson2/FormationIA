import type {
  ActivityCardDefinition,
  ActivityConfigEntry,
  ActivityConfigOverrides,
  ActivityHeaderConfig,
  ActivityLayoutOptions,
} from "../../config/activities";
import type { ModelConfig } from "../../config";
import type {
  CompositeStepConfig,
  CompositeStepModuleDefinition,
  StepDefinition,
} from "./types";
import type {
  RichContentMediaItem,
  RichContentSidebar,
  RichContentStepConfig,
} from "./modules";
import type { FormStepConfig } from "./modules";
import type { VideoCaption, VideoSource, VideoStepConfig } from "./modules";
import type {
  WorkshopComparisonStepConfig,
  WorkshopContextStepConfig,
  WorkshopSynthesisStepConfig,
} from "./modules";

export type JsonSchema = Record<string, unknown>;

export interface StepSequenceToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchema;
  strict: true;
}

export interface StepSequenceFunctionTool<
  TArgs,
  TResult = StepDefinition
> {
  definition: StepSequenceToolDefinition;
  handler: (args: TArgs) => TResult | Promise<TResult>;
}

type StepIdSource = Iterable<string> | undefined;

const GENERIC_CONFIG_SCHEMA: JsonSchema = {
  $defs: {
    configValue: {
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "integer" },
        { type: "boolean" },
        { type: "null" },
        {
          type: "array",
          items: { $ref: "#/$defs/configValue" },
        },
        {
          type: "object",
          additionalProperties: false,
          patternProperties: {
            ".+": { $ref: "#/$defs/configValue" },
          },
        },
      ],
    },
  },
  type: "object",
  additionalProperties: false,
  patternProperties: {
    ".+": { $ref: "#/$defs/configValue" },
  },
};

const configSchema = (): JsonSchema =>
  JSON.parse(JSON.stringify(GENERIC_CONFIG_SCHEMA));

function sanitizeId(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function generateStepId(
  preferred: string,
  existingIds?: StepIdSource
): string {
  const taken = new Set<string>();
  if (existingIds) {
    for (const value of existingIds) {
      if (typeof value === "string" && value.trim()) {
        taken.add(value.trim());
      }
    }
  }

  const baseCandidate = sanitizeId(preferred) || "step";
  if (!taken.has(baseCandidate)) {
    return baseCandidate;
  }

  let attempt = 2;
  while (taken.has(`${baseCandidate}-${attempt}`)) {
    attempt += 1;
  }

  return `${baseCandidate}-${attempt}`;
}

interface ToolBaseInput {
  id?: string;
  idHint?: string;
  existingStepIds?: string[];
}

function resolveId(input: ToolBaseInput, fallback: string): string {
  if (input.id && input.id.trim()) {
    return input.id.trim();
  }
  const hint = input.idHint && input.idHint.trim() ? input.idHint : fallback;
  return generateStepId(hint, input.existingStepIds);
}

interface CreateRichContentStepInput extends ToolBaseInput {
  title: string;
  body?: string;
  media?: Array<
    Pick<RichContentMediaItem, "url" | "alt" | "caption"> & { id?: string }
  >;
  sidebar?: RichContentSidebar;
}

const createRichContentStep: StepSequenceFunctionTool<
  CreateRichContentStepInput
> = {
  definition: {
    type: "function",
    name: "create_rich_content_step",
    description:
      "Crée une étape riche en contenu (texte et médias) destinée aux présentations ou briefings.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: {
        id: {
          type: "string",
          description: "Identifiant explicite de l'étape (sinon généré).",
        },
        idHint: {
          type: "string",
          description: "Texte utilisé pour dériver l'identifiant si `id` est absent.",
        },
        existingStepIds: {
          type: "array",
          items: { type: "string" },
          description: "Liste d'identifiants déjà utilisés pour éviter les collisions.",
        },
        title: {
          type: "string",
          description: "Titre principal affiché pour l'étape.",
        },
        body: {
          type: "string",
          description: "Corps de texte au format Markdown simplifié.",
        },
        media: {
          type: "array",
          description: "Illustrations ou ressources à afficher sous forme de grille.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["url"],
            properties: {
              id: { type: "string" },
              url: { type: "string" },
              alt: { type: "string" },
              caption: { type: "string" },
            },
          },
        },
        sidebar: {
          description: "Bloc d'accompagnement affiché dans la colonne latérale.",
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "tips"],
              properties: {
                type: { const: "tips" },
                title: { type: "string" },
                tips: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "items"],
              properties: {
                type: { const: "checklist" },
                title: { type: "string" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["label"],
                    properties: {
                      id: { type: "string" },
                      label: { type: "string" },
                      checked: { type: "boolean" },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, input.title);

    const media: RichContentMediaItem[] = (input.media ?? [])
      .filter((item): item is NonNullable<typeof item> => Boolean(item?.url))
      .map((item, index) => ({
        id: item.id && item.id.trim() ? item.id.trim() : `${id}-media-${index + 1}`,
        url: item.url,
        alt: item.alt,
        caption: item.caption,
      }));

    let sidebar: RichContentSidebar | undefined;
    if (input.sidebar && typeof input.sidebar === "object") {
      if (input.sidebar.type === "tips") {
        sidebar = {
          type: "tips",
          title: input.sidebar.title,
          tips: [...input.sidebar.tips],
        };
      } else if (input.sidebar.type === "checklist") {
        sidebar = {
          type: "checklist",
          title: input.sidebar.title,
          items: (input.sidebar.items ?? []).map((item, index) => ({
            id:
              item.id && item.id.trim()
                ? item.id.trim()
                : `${id}-item-${index + 1}`,
            label: item.label,
            checked: item.checked ?? false,
          })),
        };
      }
    }

    const config: RichContentStepConfig = {
      title: input.title,
      body: input.body ?? "",
      media,
      sidebar,
    };

    return {
      id,
      component: "rich-content",
      config,
    } satisfies StepDefinition;
  },
};

interface CreateFormStepInput extends ToolBaseInput {
  fields: FormStepConfig["fields"];
  submitLabel?: string;
  allowEmpty?: boolean;
  initialValues?: FormStepConfig["initialValues"];
}

const fieldOptionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "label"],
  properties: {
    value: { type: "string" },
    label: { type: "string" },
    description: { type: "string" },
  },
};

const createFormStep: StepSequenceFunctionTool<CreateFormStepInput> = {
  definition: {
    type: "function",
    name: "create_form_step",
    description:
      "Construit une étape de formulaire exploitant la bibliothèque interne `GuidedFields`.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["fields"],
      properties: {
        id: { type: "string" },
        idHint: { type: "string" },
        existingStepIds: {
          type: "array",
          items: { type: "string" },
        },
        fields: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "type"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "bulleted_list",
                  "table_menu_day",
                  "table_menu_full",
                  "textarea_with_counter",
                  "two_bullets",
                  "reference_line",
                  "single_choice",
                  "multiple_choice",
                ],
              },
              minBullets: { type: "number" },
              maxBullets: { type: "number" },
              maxWordsPerBullet: { type: "number" },
              mustContainAny: {
                type: "array",
                items: { type: "string" },
              },
              meals: {
                type: "array",
                items: { type: "string" },
              },
              minWords: { type: "number" },
              maxWords: { type: "number" },
              forbidWords: {
                type: "array",
                items: { type: "string" },
              },
              tone: { type: "string" },
              options: {
                type: "array",
                items: fieldOptionSchema,
              },
              minSelections: { type: "number" },
              maxSelections: { type: "number" },
            },
          },
        },
        submitLabel: { type: "string" },
        allowEmpty: { type: "boolean" },
        initialValues: {
          type: "object",
          additionalProperties: {
            anyOf: [
              { type: "string" },
              { type: "null" },
              {
                type: "array",
                items: { type: "string" },
              },
              {
                type: "object",
                additionalProperties: {
                  anyOf: [
                    { type: "string" },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["plat", "boisson", "dessert"],
                      properties: {
                        plat: { type: "string" },
                        boisson: { type: "string" },
                        dessert: { type: "string" },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, "form-step");

    const config: FormStepConfig = {
      fields: input.fields,
      submitLabel: input.submitLabel,
      allowEmpty: input.allowEmpty,
      initialValues: input.initialValues,
    };

    return {
      id,
      component: "form",
      config,
    } satisfies StepDefinition;
  },
};

interface CreateVideoStepInput extends ToolBaseInput {
  sources: VideoSource[];
  poster?: string;
  captions?: VideoCaption[];
  autoAdvanceOnEnd?: boolean;
  expectedDuration?: number;
}

const captionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["src"],
  properties: {
    src: { type: "string" },
    srclang: { type: "string" },
    label: { type: "string" },
    default: { type: "boolean" },
  },
};

const videoSourceSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "url"],
  properties: {
    type: { type: "string", enum: ["mp4", "hls", "youtube"] },
    url: { type: "string" },
  },
};

const createVideoStep: StepSequenceFunctionTool<CreateVideoStepInput> = {
  definition: {
    type: "function",
    name: "create_video_step",
    description: "Configure une étape vidéo avec sources multiples et sous-titres.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["sources"],
      properties: {
        id: { type: "string" },
        idHint: { type: "string" },
        existingStepIds: {
          type: "array",
          items: { type: "string" },
        },
        sources: {
          type: "array",
          minItems: 1,
          items: videoSourceSchema,
        },
        poster: { type: "string" },
        captions: {
          type: "array",
          items: captionSchema,
        },
        autoAdvanceOnEnd: { type: "boolean" },
        expectedDuration: { type: "number" },
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, "video-step");

    const config: VideoStepConfig = {
      sources: input.sources,
      poster: input.poster,
      captions: input.captions,
      autoAdvanceOnEnd: input.autoAdvanceOnEnd,
      expectedDuration: input.expectedDuration,
    };

    return {
      id,
      component: "video",
      config,
    } satisfies StepDefinition;
  },
};

interface CreateWorkshopContextStepInput extends ToolBaseInput {
  defaultText?: string;
}

const createWorkshopContextStep: StepSequenceFunctionTool<
  CreateWorkshopContextStepInput
> = {
  definition: {
    type: "function",
    name: "create_workshop_context_step",
    description:
      "Prépare l'étape d'ouverture de l'atelier comparatif (collecte du texte source).",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        id: { type: "string" },
        idHint: { type: "string" },
        existingStepIds: {
          type: "array",
          items: { type: "string" },
        },
        defaultText: {
          type: "string",
          description: "Texte prérempli suggéré aux utilisateurs.",
        },
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, "workshop-context");
    const config: WorkshopContextStepConfig = {
      defaultText: input.defaultText,
    };

    return {
      id,
      component: "workshop-context",
      config,
    } satisfies StepDefinition;
  },
};

interface CreateWorkshopComparisonStepInput extends ToolBaseInput {
  contextStepId: string;
  defaultConfigA?: ModelConfig;
  defaultConfigB?: ModelConfig;
}

const modelConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["model", "verbosity", "thinking"],
  properties: {
    model: { type: "string" },
    verbosity: { type: "string" },
    thinking: { type: "string" },
  },
};

const createWorkshopComparisonStep: StepSequenceFunctionTool<
  CreateWorkshopComparisonStepInput
> = {
  definition: {
    type: "function",
    name: "create_workshop_comparison_step",
    description:
      "Génère l'étape de comparaison de modèles de l'atelier (paramétrage des variantes).",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["contextStepId"],
      properties: {
        id: { type: "string" },
        idHint: { type: "string" },
        existingStepIds: {
          type: "array",
          items: { type: "string" },
        },
        contextStepId: {
          type: "string",
          description: "Identifiant de l'étape de contexte qui fournit le texte source.",
        },
        defaultConfigA: modelConfigSchema,
        defaultConfigB: modelConfigSchema,
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, "workshop-comparison");
    const config: WorkshopComparisonStepConfig = {
      contextStepId: input.contextStepId,
      defaultConfigA: input.defaultConfigA,
      defaultConfigB: input.defaultConfigB,
    };

    return {
      id,
      component: "workshop-comparison",
      config,
    } satisfies StepDefinition;
  },
};

interface CreateWorkshopSynthesisStepInput extends ToolBaseInput {
  contextStepId: string;
  comparisonStepId: string;
}

const createWorkshopSynthesisStep: StepSequenceFunctionTool<
  CreateWorkshopSynthesisStepInput
> = {
  definition: {
    type: "function",
    name: "create_workshop_synthesis_step",
    description:
      "Assemble l'étape finale de l'atelier en s'appuyant sur les réponses générées.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["contextStepId", "comparisonStepId"],
      properties: {
        id: { type: "string" },
        idHint: { type: "string" },
        existingStepIds: {
          type: "array",
          items: { type: "string" },
        },
        contextStepId: {
          type: "string" },
        comparisonStepId: { type: "string" },
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, "workshop-synthesis");
    const config: WorkshopSynthesisStepConfig = {
      contextStepId: input.contextStepId,
      comparisonStepId: input.comparisonStepId,
    };

    return {
      id,
      component: "workshop-synthesis",
      config,
    } satisfies StepDefinition;
  },
};

interface CompositeModuleInput
  extends Partial<Omit<CompositeStepModuleDefinition, "id" | "component">> {
  id?: string;
  component: string;
}

interface CreateCompositeStepInput extends ToolBaseInput {
  modules: CompositeModuleInput[];
  autoAdvance?: boolean;
  continueLabel?: string;
}

const compositeModuleSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["component"],
  properties: {
    id: { type: "string" },
    component: { type: "string" },
    slot: { type: "string" },
    config: configSchema(),
  },
};

const createCompositeStep: StepSequenceFunctionTool<
  CreateCompositeStepInput
> = {
  definition: {
    type: "function",
    name: "create_composite_step",
    description:
      "Construit une étape composite agrégeant plusieurs modules réutilisables.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["modules"],
      properties: {
        id: { type: "string" },
        idHint: { type: "string" },
        existingStepIds: {
          type: "array",
          items: { type: "string" },
        },
        modules: {
          type: "array",
          minItems: 1,
          items: compositeModuleSchema,
        },
        autoAdvance: { type: "boolean" },
        continueLabel: { type: "string" },
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, "composite-step");
    const modules: CompositeStepConfig["modules"] = input.modules.map(
      (module, index) => ({
        id:
          module.id && module.id.trim()
            ? module.id.trim()
            : `${id}-module-${index + 1}`,
        component: module.component,
        slot: module.slot,
        config: module.config,
      })
    );

    const composite: CompositeStepConfig = {
      modules,
      autoAdvance: input.autoAdvance,
      continueLabel: input.continueLabel,
    };

    return {
      id,
      composite,
    } satisfies StepDefinition;
  },
};

interface BuildActivityMetadata
  extends Partial<Omit<ActivityConfigEntry, "id" | "stepSequence">> {
  header?: ActivityHeaderConfig;
  layout?: ActivityLayoutOptions;
  card?: ActivityCardDefinition;
  overrides?: ActivityConfigOverrides | null;
}

interface BuildStepSequenceActivityInput {
  activityId: string;
  steps: StepDefinition[];
  metadata?: BuildActivityMetadata;
}

const headerSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["eyebrow", "title"],
  properties: {
    eyebrow: { type: "string" },
    title: { type: "string" },
    subtitle: { type: "string" },
    badge: { type: "string" },
    titleAlign: { type: "string", enum: ["left", "center"] },
  },
};

const layoutSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {
    activityId: { type: "string" },
    outerClassName: { type: "string" },
    innerClassName: { type: "string" },
    headerClassName: { type: "string" },
    contentClassName: { type: "string" },
    contentAs: { type: "string" },
    withLandingGradient: { type: "boolean" },
    useDynamicViewportHeight: { type: "boolean" },
    withBasePadding: { type: "boolean" },
    withBaseContentSpacing: { type: "boolean" },
    withBaseInnerGap: { type: "boolean" },
    actions: configSchema(),
    headerChildren: configSchema(),
    beforeHeader: configSchema(),
  },
};

const cardSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "highlights", "cta"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    highlights: {
      type: "array",
      items: { type: "string" },
    },
    cta: {
      type: "object",
      additionalProperties: false,
      required: ["label", "to"],
      properties: {
        label: { type: "string" },
        to: { type: "string" },
      },
    },
  },
};

const buildStepSequenceActivity: StepSequenceFunctionTool<
  BuildStepSequenceActivityInput,
  ActivityConfigEntry
> = {
  definition: {
    type: "function",
    name: "build_step_sequence_activity",
    description:
      "Assemble une configuration d'activité basée sur une suite d'étapes générées.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["activityId", "steps"],
      properties: {
        activityId: { type: "string" },
        steps: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id"],
            properties: {
              id: { type: "string" },
              component: { type: "string" },
              config: configSchema(),
              composite: {
                type: "object",
                additionalProperties: false,
                required: ["modules"],
                properties: {
                  modules: {
                    type: "array",
                    items: compositeModuleSchema,
                  },
                  autoAdvance: { type: "boolean" },
                  continueLabel: { type: "string" },
                },
              },
            },
          },
        },
        metadata: {
          type: "object",
          additionalProperties: false,
          required: [],
          properties: {
            componentKey: { type: "string" },
            path: { type: "string" },
            completionId: { type: "string" },
            enabled: { type: "boolean" },
            header: headerSchema,
            layout: layoutSchema,
            card: cardSchema,
            overrides: {
              type: "object",
              additionalProperties: false,
              required: [],
              properties: {
                header: headerSchema,
                layout: layoutSchema,
                card: cardSchema,
                completionId: { type: "string" },
                stepSequence: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id"],
                    properties: {
                      id: { type: "string" },
                      component: { type: "string" },
                      config: configSchema(),
                      composite: {
                        type: "object",
                        additionalProperties: false,
                        required: ["modules"],
                        properties: {
                          modules: {
                            type: "array",
                            items: compositeModuleSchema,
                          },
                          autoAdvance: { type: "boolean" },
                          continueLabel: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  handler: async (input) => {
    const { resolveActivityDefinition, serializeActivityDefinition } =
      await import("../../config/activities");
    const { activityId, steps, metadata } = input;
    const entry: ActivityConfigEntry = {
      id: activityId,
      componentKey: metadata?.componentKey ?? "step-sequence",
      path: metadata?.path,
      completionId: metadata?.completionId,
      enabled: metadata?.enabled,
      header: metadata?.header,
      layout: metadata?.layout,
      card: metadata?.card,
      stepSequence: steps,
      overrides: metadata?.overrides ?? null,
    };

    const resolvedDefinition = resolveActivityDefinition(entry);
    const definitionWithSteps = {
      ...resolvedDefinition,
      stepSequence: steps,
    };
    const serialized = serializeActivityDefinition(definitionWithSteps);
    return serialized;
  },
};

export const STEP_SEQUENCE_TOOLS = {
  create_rich_content_step: createRichContentStep,
  create_form_step: createFormStep,
  create_video_step: createVideoStep,
  create_workshop_context_step: createWorkshopContextStep,
  create_workshop_comparison_step: createWorkshopComparisonStep,
  create_workshop_synthesis_step: createWorkshopSynthesisStep,
  create_composite_step: createCompositeStep,
  build_step_sequence_activity: buildStepSequenceActivity,
} as const;

export type StepSequenceToolName = keyof typeof STEP_SEQUENCE_TOOLS;
