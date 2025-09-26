import {
  MODEL_OPTIONS,
  THINKING_OPTIONS,
  VERBOSITY_OPTIONS,
  type ModelConfig,
  type ThinkingChoice,
  type VerbosityChoice,
} from "../../config";
import type {
  ActivityCardDefinition,
  ActivityConfigEntry,
  ActivityConfigOverrides,
  ActivityHeaderConfig,
  ActivityLayoutOptions,
} from "../../config/activities";
import type {
  CompositeStepConfig,
  CompositeStepModuleDefinition,
  StepDefinition,
} from "./types";
import type {
  ClarityMapStepConfig,
  ClarityPromptStepConfig,
  DualModelComparisonConfig,
  DualModelComparisonCopyConfig,
  DualModelComparisonInfoCardConfig,
  DualModelComparisonRequestConfig,
  DualModelComparisonVariant,
  DualModelComparisonVariantConfig,
  ExplorateurWorldConfig,
  InfoCardTone,
  InfoCardsStepCardConfig,
  InfoCardsStepConfig,
  PromptEvaluationStepConfig,
  RichContentMediaItem,
  RichContentSidebar,
  RichContentStepConfig,
  SimulationChatConfig,
  SimulationChatStageConfig,
} from "./modules";
import {
  createDefaultExplorateurWorldConfig,
  sanitizeExplorateurWorldConfig,
  validateFieldSpec,
} from "./modules";
import type { FormStepConfig } from "./modules";
import type { VideoCaption, VideoSource, VideoStepConfig } from "./modules";
import type { FieldSpec } from "../../api";

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

const nullableConfigSchema = (): JsonSchema => ({
  anyOf: [configSchema(), { type: "null" }],
});

const nullableSchema = (schema: JsonSchema): JsonSchema => ({
  anyOf: [JSON.parse(JSON.stringify(schema)), { type: "null" }],
});

const MODEL_CHOICES = new Set<string>(MODEL_OPTIONS.map((option) => option.value));
const VERBOSITY_CHOICES = new Set<VerbosityChoice>(
  VERBOSITY_OPTIONS.map((option) => option.value)
);
const THINKING_CHOICES = new Set<ThinkingChoice>(
  THINKING_OPTIONS.map((option) => option.value)
);

const DEFAULT_MODEL = MODEL_OPTIONS[0]?.value ?? "gpt-5-nano";
const DEFAULT_VERBOSITY = VERBOSITY_OPTIONS[0]?.value ?? "low";
const DEFAULT_THINKING = THINKING_OPTIONS[0]?.value ?? "minimal";

const INFO_CARD_TONES: InfoCardTone[] = ["red", "black", "sand", "white"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeString(
  value: unknown,
  fallback = "",
  { trim = true, allowEmpty = false }: { trim?: boolean; allowEmpty?: boolean } = {}
): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = trim ? value.trim() : value;
  if (!allowEmpty && normalized.length === 0) {
    return fallback;
  }
  return normalized;
}

function sanitizeStringArray(values: unknown, { min = 0, max }: { min?: number; max?: number } = {}): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const sanitized = values
    .map((item) => sanitizeString(item, "", { allowEmpty: false }))
    .filter((item) => item.length > 0);
  if (typeof max === "number" && max >= 0) {
    sanitized.length = Math.min(sanitized.length, max);
  }
  if (min > 0 && sanitized.length < min) {
    return [];
  }
  return sanitized;
}

function cloneFieldSpec(spec: FieldSpec): FieldSpec {
  return JSON.parse(JSON.stringify(spec)) as FieldSpec;
}

function sanitizeInteger(
  value: unknown,
  { fallback, min, max }: { fallback: number; min?: number; max?: number }
): number {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : Math.trunc(fallback);
  let result = numeric;
  if (typeof min === "number" && result < min) {
    result = min;
  }
  if (typeof max === "number" && result > max) {
    result = max;
  }
  return result;
}

function sanitizeBoolean(value: unknown, fallback = false): boolean {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  return fallback;
}

function sanitizeInfoCardTone(value: unknown): InfoCardTone {
  if (typeof value === "string") {
    const normalized = value.trim() as InfoCardTone;
    if ((INFO_CARD_TONES as string[]).includes(normalized)) {
      return normalized;
    }
  }
  return "sand";
}

function sanitizeComparisonInfoCards(
  value: unknown
): DualModelComparisonInfoCardConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const source = item as Partial<DualModelComparisonInfoCardConfig>;
      const title = sanitizeString(source.title, "", { allowEmpty: false });
      const description = sanitizeString(source.description, "", { allowEmpty: false });
      if (!title || !description) {
        return null;
      }
      return {
        title,
        description,
        tone: sanitizeInfoCardTone(source.tone),
      } satisfies DualModelComparisonInfoCardConfig;
    })
    .filter((card): card is DualModelComparisonInfoCardConfig => Boolean(card));
}

function sanitizePresetRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  return { ...value };
}

function sanitizeVariantConfigInput(
  value: unknown,
  fallbackTitle: string,
  fallbackConfig: ModelConfig
): DualModelComparisonVariantConfig {
  if (!value || typeof value !== "object") {
    return {
      title: fallbackTitle,
      defaultConfig: fallbackConfig,
    } satisfies DualModelComparisonVariantConfig;
  }
  const source = value as Partial<DualModelComparisonVariantConfig>;
  const title = sanitizeString(source.title, fallbackTitle, { allowEmpty: false });
  const defaultConfig = source.defaultConfig
    ? sanitizeModelConfig(source.defaultConfig)
    : fallbackConfig;
  const requestPreset = sanitizePresetRecord(source.requestPreset);
  return {
    title,
    defaultConfig,
    ...(requestPreset ? { requestPreset } : {}),
  } satisfies DualModelComparisonVariantConfig;
}

type GridCoord = { x: number; y: number };

function sanitizeClarityCoord(value: unknown): GridCoord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as { x?: unknown; y?: unknown };
  if (typeof source.x !== "number" || typeof source.y !== "number") {
    return null;
  }
  return {
    x: sanitizeInteger(source.x, {
      fallback: CLARITY_START_POSITION.x,
      min: 0,
      max: CLARITY_GRID_SIZE - 1,
    }),
    y: sanitizeInteger(source.y, {
      fallback: CLARITY_START_POSITION.y,
      min: 0,
      max: CLARITY_GRID_SIZE - 1,
    }),
  };
}


function sanitizeModelConfig(value: unknown): ModelConfig {
  if (!value || typeof value !== "object") {
    return {
      model: DEFAULT_MODEL,
      verbosity: DEFAULT_VERBOSITY as VerbosityChoice,
      thinking: DEFAULT_THINKING as ThinkingChoice,
    } satisfies ModelConfig;
  }
  const source = value as Partial<ModelConfig>;
  const model =
    typeof source.model === "string" && MODEL_CHOICES.has(source.model)
      ? source.model
      : DEFAULT_MODEL;
  const verbosity =
    typeof source.verbosity === "string" && VERBOSITY_CHOICES.has(source.verbosity as VerbosityChoice)
      ? (source.verbosity as VerbosityChoice)
      : (DEFAULT_VERBOSITY as VerbosityChoice);
  const thinking =
    typeof source.thinking === "string" && THINKING_CHOICES.has(source.thinking as ThinkingChoice)
      ? (source.thinking as ThinkingChoice)
      : (DEFAULT_THINKING as ThinkingChoice);
  return { model, verbosity, thinking } satisfies ModelConfig;
}

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
      composite: null,
    } satisfies StepDefinition;
  },
};

interface CreateFormStepInput extends ToolBaseInput {
  fields: FormStepConfig["fields"];
  submitLabel?: string;
  allowEmpty?: boolean;
  initialValues?: FormStepConfig["initialValues"];
  failureMessage?: string;
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

const guidedFieldSchema: JsonSchema = {
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
          items: guidedFieldSchema,
        },
        submitLabel: { type: "string" },
        allowEmpty: { type: "boolean" },
        failureMessage: { type: "string" },
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
      failureMessage: input.failureMessage,
    };

    return {
      id,
      component: "form",
      config,
      composite: null,
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
      composite: null,
    } satisfies StepDefinition;
  },
};

interface SimulationChatStageInput
  extends Partial<Omit<SimulationChatStageConfig, "fields" | "prompt" | "id">> {
  id?: string;
  prompt?: string;
  fields?: unknown[];
}

interface CreateSimulationChatStepInput extends ToolBaseInput {
  title: string;
  help?: string;
  missionId?: string;
  roles?: { ai?: string; user?: string };
  stages: SimulationChatStageInput[];
}

const DEFAULT_SIMULATION_TITLE = "Simulation conversation";
const DEFAULT_SIMULATION_HELP =
  "Réponds aux consignes et observe comment la demande évolue.";
const DEFAULT_SIMULATION_ROLE_AI = "IA";
const DEFAULT_SIMULATION_ROLE_USER = "Participant";

const simulationChatStageSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["prompt", "fields"],
  properties: {
    id: { type: "string" },
    prompt: { type: "string" },
    fields: {
      type: "array",
      minItems: 1,
      items: guidedFieldSchema,
    },
    allowEmpty: { type: "boolean" },
    submitLabel: { type: "string" },
  },
};

const createSimulationChatStep: StepSequenceFunctionTool<
  CreateSimulationChatStepInput
> = {
  definition: {
    type: "function",
    name: "create_simulation_chat_step",
    description:
      "Construit une simulation conversationnelle en plusieurs étapes guidées.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "stages"],
      properties: {
        id: { type: "string" },
        idHint: { type: "string" },
        existingStepIds: {
          type: "array",
          items: { type: "string" },
        },
        title: { type: "string" },
        help: { type: "string" },
        missionId: { type: "string" },
        roles: {
          type: "object",
          additionalProperties: false,
          properties: {
            ai: { type: "string" },
            user: { type: "string" },
          },
        },
        stages: {
          type: "array",
          minItems: 1,
          items: simulationChatStageSchema,
        },
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, input.title);
    const title = sanitizeString(input.title, DEFAULT_SIMULATION_TITLE, {
      allowEmpty: false,
    });
    const help = sanitizeString(input.help, DEFAULT_SIMULATION_HELP, {
      allowEmpty: false,
    });
    const missionId = sanitizeString(input.missionId, "", { allowEmpty: false });
    const roles = {
      ai: sanitizeString(input.roles?.ai, DEFAULT_SIMULATION_ROLE_AI, {
        allowEmpty: false,
      }),
      user: sanitizeString(input.roles?.user, DEFAULT_SIMULATION_ROLE_USER, {
        allowEmpty: false,
      }),
    } satisfies SimulationChatConfig["roles"];

    const stages: SimulationChatStageConfig[] = (input.stages ?? [])
      .map((stage, index) => {
        if (!stage || typeof stage !== "object") {
          return null;
        }
        const fallbackStageId = `${id}-stage-${index + 1}`;
        const stageId = sanitizeString(stage.id, fallbackStageId, {
          allowEmpty: false,
        });
        const prompt = sanitizeString(stage.prompt, "", {
          allowEmpty: true,
        });
        const submitLabel = sanitizeString(stage.submitLabel, "", {
          allowEmpty: false,
        });
        const fields: FieldSpec[] = Array.isArray(stage.fields)
          ? stage.fields
              .filter((candidate): candidate is FieldSpec =>
                validateFieldSpec(candidate)
              )
              .map((field) => cloneFieldSpec(field))
          : [];

        return {
          id: stageId,
          prompt,
          fields,
          allowEmpty: Boolean(stage.allowEmpty),
          ...(submitLabel ? { submitLabel } : {}),
        } satisfies SimulationChatStageConfig;
      })
      .filter((stage): stage is SimulationChatStageConfig => Boolean(stage));

    const config: SimulationChatConfig = {
      title,
      help,
      roles,
      stages,
      ...(missionId ? { missionId } : {}),
    };

    return {
      id,
      component: "simulation-chat",
      config,
      composite: null,
    } satisfies StepDefinition;
  },
};

interface InfoCardInput extends Partial<InfoCardsStepCardConfig> {
  title: string;
  description: string;
  items?: unknown[];
}

interface CreateInfoCardsStepInput extends ToolBaseInput {
  eyebrow?: string;
  title?: string;
  description?: string;
  columns?: number;
  cards: InfoCardInput[];
}

const infoCardSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    tone: { type: "string", enum: INFO_CARD_TONES },
    items: {
      type: "array",
      items: { type: "string" },
    },
  },
};

const modelConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["model", "verbosity", "thinking"],
  properties: {
    model: { type: "string" },
    verbosity: { type: "string", enum: Array.from(VERBOSITY_CHOICES) },
    thinking: { type: "string", enum: Array.from(THINKING_CHOICES) },
  },
};

const comparisonInfoCardSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    tone: { type: "string", enum: INFO_CARD_TONES },
  },
};

const comparisonVariantSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    defaultConfig: modelConfigSchema,
    requestPreset: {
      type: "object",
      additionalProperties: true,
    },
  },
};

const createInfoCardsStep: StepSequenceFunctionTool<
  CreateInfoCardsStepInput
> = {
  definition: {
    type: "function",
    name: "create_info_cards_step",
    description:
      "Affiche des cartes d'information synthétiques pour mettre en avant des points clés.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["cards"],
      properties: {
        id: { type: "string" },
        idHint: { type: "string" },
        existingStepIds: {
          type: "array",
          items: { type: "string" },
        },
        eyebrow: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        columns: { type: "number" },
        cards: {
          type: "array",
          minItems: 1,
          items: infoCardSchema,
        },
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, input.title ?? "info-cards");
    const cards: InfoCardsStepCardConfig[] = (input.cards ?? [])
      .map((card) => {
        if (!card) {
          return null;
        }
        const items = sanitizeStringArray(card.items, { max: 8 });
        return {
          title: sanitizeString(card.title, "", { allowEmpty: false }),
          description: sanitizeString(card.description, "", { allowEmpty: false }),
          tone: sanitizeInfoCardTone(card.tone),
          ...(items.length > 0 ? { items } : {}),
        } satisfies InfoCardsStepCardConfig;
      })
      .filter((card): card is InfoCardsStepCardConfig => Boolean(card?.title));

    const fallbackColumns = cards.length > 0 ? Math.min(Math.max(cards.length, 1), 3) : 1;
    const columns = sanitizeInteger(input.columns, {
      fallback: fallbackColumns,
      min: 1,
      max: 4,
    });

    const config: InfoCardsStepConfig = {
      eyebrow: sanitizeString(input.eyebrow, "", { allowEmpty: true }),
      title: sanitizeString(input.title, "", { allowEmpty: true }),
      description: sanitizeString(input.description, "", { allowEmpty: true }),
      columns,
      cards,
    };

    return {
      id,
      component: "info-cards",
      config,
      composite: null,
    } satisfies StepDefinition;
  },
};

const DEFAULT_PROMPT_EVALUATION_TEXT = `Rôle: Tu es un tuteur pair qui anime un atelier dynamique.
Tâche: Proposer un plan d’atelier de 60 minutes pour revoir les structures de données avant l’intra.
Public: Étudiantes et étudiants de première année au cégep.
Contraintes: Prévoir trois segments (accroche, pratique guidée, conclusion). Mentionner un outil collaboratif utilisé.
Format attendu: Liste numérotée avec durées estimées.
Réponds uniquement avec le plan.`;

const DEFAULT_PROMPT_EVALUATION_DEVELOPER =
  "Tu es un évaluateur pédagogique spécialisé dans la rédaction de prompts. Analyse le prompt suivant et attribue un score global ainsi que quatre sous-scores (0-100). Réponds uniquement avec un JSON strict, sans commentaire supplémentaire.\n\nFormat attendu (JSON strict): {\\\"total\\\":int,\\\"clarity\\\":int,\\\"specificity\\\":int,\\\"structure\\\":int,\\\"length\\\":int,\\\"comments\\\":\\\"string\\\",\\\"advice\\\":[\\\"string\\\",...]}.\n- \\\"comments\\\" : synthèse en 2 phrases max.\n- \\\"advice\\\" : pistes concrètes (3 max).\n- Utilise des entiers pour les scores.\n- Pas d’autre texte hors du JSON.";

const DEFAULT_COMPARISON_VARIANT_TITLES: Record<DualModelComparisonVariant, string> = {
  A: "Profil A",
  B: "Profil B",
};

const DEFAULT_COMPARISON_LAUNCH_CTA: Required<DualModelComparisonCopyConfig["launchCta"]> = {
  idle: "Lancer les deux requêtes",
  loading: "Réponses en cours…",
  missingContext: "Ajoutez un prompt avant de lancer la génération.",
};

const DEFAULT_COMPARISON_STATUS: Required<DualModelComparisonCopyConfig["variantStatus"]> = {
  idle: "En attente",
  loading: "Réponse en cours…",
  success: "Réponse générée",
};

const DEFAULT_COMPARISON_SELECT_LABELS: Required<DualModelComparisonCopyConfig["selectLabels"]> = {
  model: "Profil IA",
  verbosity: "Verbosité attendue",
  thinking: "Effort de raisonnement",
};

const DEFAULT_COMPARISON_SUMMARY: Required<DualModelComparisonCopyConfig["summary"]> = {
  empty: "Résultat en attente.",
  loading: "Initialisation du flux…",
  resetLabel: "Réinitialiser l’aperçu",
};

const DEFAULT_COMPARISON_TITLE = "Comparez deux configurations IA";
const DEFAULT_COMPARISON_PROMPT_LABEL = "Décrivez la consigne à soumettre";
const DEFAULT_COMPARISON_PROMPT_PLACEHOLDER =
  "Décrivez le besoin ou la tâche attendue pour vos deux variantes.";
const DEFAULT_COMPARISON_PROCEED_CTA = "Passer à l’étape suivante";

const CLARITY_GRID_SIZE = 10;
const CLARITY_START_POSITION = { x: 0, y: 0 } as const;

interface CreatePromptEvaluationStepInput extends ToolBaseInput {
  defaultText?: string;
  developerMessage?: string;
  model?: string;
  verbosity?: VerbosityChoice;
  thinking?: ThinkingChoice;
}

const createPromptEvaluationStep: StepSequenceFunctionTool<
  CreatePromptEvaluationStepInput
> = {
  definition: {
    type: "function",
    name: "create_prompt_evaluation_step",
    description:
      "Ajoute un atelier d’évaluation de prompt avec notation automatique et recommandations.",
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
        defaultText: { type: "string" },
        developerMessage: { type: "string" },
        model: { type: "string" },
        verbosity: { type: "string", enum: Array.from(VERBOSITY_CHOICES) },
        thinking: { type: "string", enum: Array.from(THINKING_CHOICES) },
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, input.idHint ?? "prompt-evaluation");
    const defaultText = sanitizeString(input.defaultText, DEFAULT_PROMPT_EVALUATION_TEXT, {
      allowEmpty: false,
    });
    const developerMessage = sanitizeString(
      input.developerMessage,
      DEFAULT_PROMPT_EVALUATION_DEVELOPER,
      { allowEmpty: false }
    );
    const model = sanitizeString(input.model, DEFAULT_MODEL, { allowEmpty: false });
    const verbosity =
      typeof input.verbosity === "string" && VERBOSITY_CHOICES.has(input.verbosity)
        ? (input.verbosity as VerbosityChoice)
        : (DEFAULT_VERBOSITY as VerbosityChoice);
    const thinking =
      typeof input.thinking === "string" && THINKING_CHOICES.has(input.thinking)
        ? (input.thinking as ThinkingChoice)
        : (DEFAULT_THINKING as ThinkingChoice);

    const config: PromptEvaluationStepConfig = {
      defaultText,
      developerMessage,
      model,
      verbosity,
      thinking,
    };

    return {
      id,
      component: "prompt-evaluation",
      config,
      composite: null,
    } satisfies StepDefinition;
  },
};

interface CreateDualModelComparisonStepInput extends ToolBaseInput {
  contextStepId?: string;
  contextField?: string;
  copy?: DualModelComparisonCopyConfig;
  request?: DualModelComparisonRequestConfig;
  variants?: Partial<Record<DualModelComparisonVariant, DualModelComparisonVariantConfig>>;
  defaultConfigA?: ModelConfig;
  defaultConfigB?: ModelConfig;
}

const comparisonCopySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    badge: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    backCtaLabel: { type: "string" },
    promptLabel: { type: "string" },
    promptPlaceholder: { type: "string" },
    promptHelper: { type: "string" },
    launchCta: {
      type: "object",
      additionalProperties: false,
      properties: {
        idle: { type: "string" },
        loading: { type: "string" },
        missingContext: { type: "string" },
      },
    },
    variantTitles: {
      type: "object",
      additionalProperties: false,
      properties: {
        A: { type: "string" },
        B: { type: "string" },
      },
    },
    variantTitlePattern: { type: "string" },
    variantStatus: {
      type: "object",
      additionalProperties: false,
      properties: {
        idle: { type: "string" },
        loading: { type: "string" },
        success: { type: "string" },
      },
    },
    selectLabels: {
      type: "object",
      additionalProperties: false,
      properties: {
        model: { type: "string" },
        verbosity: { type: "string" },
        thinking: { type: "string" },
      },
    },
    summary: {
      type: "object",
      additionalProperties: false,
      properties: {
        empty: { type: "string" },
        loading: { type: "string" },
        resetLabel: { type: "string" },
      },
    },
    proceedCtaLabel: { type: "string" },
    infoCards: {
      type: "array",
      items: comparisonInfoCardSchema,
    },
  },
};

const createDualModelComparisonStep: StepSequenceFunctionTool<
  CreateDualModelComparisonStepInput
> = {
  definition: {
    type: "function",
    name: "create_ai_comparison_step",
    description:
      "Met en scène deux variantes de modèles IA pour comparer leurs réponses à un même prompt.",
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
        contextStepId: { type: "string" },
        contextField: { type: "string" },
        copy: comparisonCopySchema,
        request: {
          type: "object",
          additionalProperties: false,
          properties: {
            endpoint: { type: "string" },
            systemPrompt: { type: "string" },
          },
        },
        variants: {
          type: "object",
          additionalProperties: false,
          properties: {
            A: comparisonVariantSchema,
            B: comparisonVariantSchema,
          },
        },
        defaultConfigA: modelConfigSchema,
        defaultConfigB: modelConfigSchema,
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, input.idHint ?? "ai-comparison");
    const contextStepId = sanitizeString(input.contextStepId, "", { allowEmpty: true });
    const contextField = sanitizeString(input.contextField, "sourceText", {
      allowEmpty: false,
    });

    const requestEndpoint = sanitizeString(input.request?.endpoint, "/summary", {
      allowEmpty: false,
    });
    const request: DualModelComparisonRequestConfig = {
      endpoint: requestEndpoint,
    };
    const systemPrompt = sanitizeString(input.request?.systemPrompt, "", {
      allowEmpty: false,
    });
    if (systemPrompt) {
      request.systemPrompt = systemPrompt;
    }

    const copySource = isPlainObject(input.copy)
      ? (input.copy as DualModelComparisonCopyConfig)
      : {};
    const badge = sanitizeString(copySource.badge, "", { allowEmpty: false });
    const description = sanitizeString(copySource.description, "", { allowEmpty: false });
    const backCtaLabel = sanitizeString(copySource.backCtaLabel, "", { allowEmpty: false });
    const promptHelper = sanitizeString(copySource.promptHelper, "", { allowEmpty: false });
    const variantTitlePattern = sanitizeString(copySource.variantTitlePattern, "", {
      allowEmpty: false,
    });

    const launchCta = {
      idle: sanitizeString(
        copySource.launchCta?.idle,
        DEFAULT_COMPARISON_LAUNCH_CTA.idle,
        { allowEmpty: false }
      ),
      loading: sanitizeString(
        copySource.launchCta?.loading,
        DEFAULT_COMPARISON_LAUNCH_CTA.loading,
        { allowEmpty: false }
      ),
      missingContext: sanitizeString(
        copySource.launchCta?.missingContext,
        DEFAULT_COMPARISON_LAUNCH_CTA.missingContext,
        { allowEmpty: false }
      ),
    } satisfies Required<DualModelComparisonCopyConfig["launchCta"]>;

    const variantTitles: Record<DualModelComparisonVariant, string> = {
      ...DEFAULT_COMPARISON_VARIANT_TITLES,
    };
    if (isPlainObject(copySource.variantTitles)) {
      const titles = copySource.variantTitles as Partial<
        Record<DualModelComparisonVariant, string>
      >;
      for (const variant of Object.keys(variantTitles) as DualModelComparisonVariant[]) {
        const value = titles?.[variant];
        if (typeof value === "string" && value.trim()) {
          variantTitles[variant] = value.trim();
        }
      }
    }
    if (variantTitlePattern && variantTitlePattern.includes("{variant}")) {
      for (const variant of Object.keys(variantTitles) as DualModelComparisonVariant[]) {
        variantTitles[variant] = variantTitlePattern.replace(/\{variant\}/g, variant);
      }
    }

    const variantStatus = {
      idle: sanitizeString(
        copySource.variantStatus?.idle,
        DEFAULT_COMPARISON_STATUS.idle,
        { allowEmpty: false }
      ),
      loading: sanitizeString(
        copySource.variantStatus?.loading,
        DEFAULT_COMPARISON_STATUS.loading,
        { allowEmpty: false }
      ),
      success: sanitizeString(
        copySource.variantStatus?.success,
        DEFAULT_COMPARISON_STATUS.success,
        { allowEmpty: false }
      ),
    } satisfies Required<DualModelComparisonCopyConfig["variantStatus"]>;

    const selectLabels = {
      model: sanitizeString(
        copySource.selectLabels?.model,
        DEFAULT_COMPARISON_SELECT_LABELS.model,
        { allowEmpty: false }
      ),
      verbosity: sanitizeString(
        copySource.selectLabels?.verbosity,
        DEFAULT_COMPARISON_SELECT_LABELS.verbosity,
        { allowEmpty: false }
      ),
      thinking: sanitizeString(
        copySource.selectLabels?.thinking,
        DEFAULT_COMPARISON_SELECT_LABELS.thinking,
        { allowEmpty: false }
      ),
    } satisfies Required<DualModelComparisonCopyConfig["selectLabels"]>;

    const summary = {
      empty: sanitizeString(
        copySource.summary?.empty,
        DEFAULT_COMPARISON_SUMMARY.empty,
        { allowEmpty: false }
      ),
      loading: sanitizeString(
        copySource.summary?.loading,
        DEFAULT_COMPARISON_SUMMARY.loading,
        { allowEmpty: false }
      ),
      resetLabel: sanitizeString(
        copySource.summary?.resetLabel,
        DEFAULT_COMPARISON_SUMMARY.resetLabel,
        { allowEmpty: false }
      ),
    } satisfies Required<DualModelComparisonCopyConfig["summary"]>;

    const proceedCtaLabel = sanitizeString(
      copySource.proceedCtaLabel,
      DEFAULT_COMPARISON_PROCEED_CTA,
      { allowEmpty: false }
    );

    const infoCards = sanitizeComparisonInfoCards(copySource.infoCards);

    const copy: DualModelComparisonCopyConfig = {
      title: sanitizeString(copySource.title, DEFAULT_COMPARISON_TITLE, {
        allowEmpty: false,
      }),
      promptLabel: sanitizeString(
        copySource.promptLabel,
        DEFAULT_COMPARISON_PROMPT_LABEL,
        { allowEmpty: false }
      ),
      promptPlaceholder: sanitizeString(
        copySource.promptPlaceholder,
        DEFAULT_COMPARISON_PROMPT_PLACEHOLDER,
        { allowEmpty: false }
      ),
      launchCta,
      variantTitles,
      variantStatus,
      selectLabels,
      summary,
      proceedCtaLabel,
      infoCards,
      ...(badge ? { badge } : {}),
      ...(description ? { description } : {}),
      ...(backCtaLabel ? { backCtaLabel } : {}),
      ...(promptHelper ? { promptHelper } : {}),
    };

    const variantsInput = input.variants ?? {};
    const variantAConfig = sanitizeVariantConfigInput(
      variantsInput?.A,
      variantTitles.A,
      sanitizeModelConfig(input.defaultConfigA ?? variantsInput?.A?.defaultConfig)
    );
    const variantBConfig = sanitizeVariantConfigInput(
      variantsInput?.B,
      variantTitles.B,
      sanitizeModelConfig(input.defaultConfigB ?? variantsInput?.B?.defaultConfig)
    );

    const config: DualModelComparisonConfig = {
      contextStepId,
      contextField,
      copy,
      request,
      variants: {
        A: variantAConfig,
        B: variantBConfig,
      },
      defaultConfigA: { ...variantAConfig.defaultConfig },
      defaultConfigB: { ...variantBConfig.defaultConfig },
    };

    return {
      id,
      component: "ai-comparison",
      config,
      composite: null,
    } satisfies StepDefinition;
  },
};

interface CreateClarityMapStepInput extends ToolBaseInput {
  obstacleCount?: number;
  initialTarget?: unknown;
  promptStepId?: string;
  allowInstructionInput?: boolean;
  instructionLabel?: string;
  instructionPlaceholder?: string;
}

const clarityCoordSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: {
    x: { type: "number" },
    y: { type: "number" },
  },
};

const createClarityMapStep: StepSequenceFunctionTool<CreateClarityMapStepInput> = {
  definition: {
    type: "function",
    name: "create_clarity_map_step",
    description:
      "Crée une étape de navigation Clarity où l’IA propose un plan d’action sur une grille 10×10.",
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
        obstacleCount: { type: "number" },
        initialTarget: {
          anyOf: [clarityCoordSchema, { type: "null" }],
        },
        promptStepId: { type: "string" },
        allowInstructionInput: { type: "boolean" },
        instructionLabel: { type: "string" },
        instructionPlaceholder: { type: "string" },
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, input.idHint ?? "clarity-map");
    const obstacleCount = sanitizeInteger(input.obstacleCount, {
      fallback: 6,
      min: 0,
      max: 24,
    });
    const target = sanitizeClarityCoord(input.initialTarget);
    const promptStepId = sanitizeString(input.promptStepId, "", { allowEmpty: true });
    const allowInstructionInput = sanitizeBoolean(input.allowInstructionInput, true);
    const instructionLabel = sanitizeString(
      input.instructionLabel,
      "Commande transmise",
      { allowEmpty: false }
    );
    const instructionPlaceholder = sanitizeString(
      input.instructionPlaceholder,
      "La consigne reçue s'affichera ici…",
      { allowEmpty: false }
    );

    const config: ClarityMapStepConfig = {
      obstacleCount,
      initialTarget: target,
      promptStepId,
      allowInstructionInput,
      instructionLabel,
      instructionPlaceholder,
    };

    return {
      id,
      component: "clarity-map",
      config,
      composite: null,
    } satisfies StepDefinition;
  },
};

interface CreateClarityPromptStepInput extends ToolBaseInput {
  promptLabel?: string;
  promptPlaceholder?: string;
  model?: string;
  verbosity?: VerbosityChoice;
  thinking?: ThinkingChoice;
  developerPrompt?: string;
  settingsMode?: "hidden" | "read-only" | "editable";
}

const createClarityPromptStep: StepSequenceFunctionTool<CreateClarityPromptStepInput> = {
  definition: {
    type: "function",
    name: "create_clarity_prompt_step",
    description:
      "Prépare la consigne de pilotage Clarity avec choix du modèle, verbosité et effort de raisonnement.",
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
        promptLabel: { type: "string" },
        promptPlaceholder: { type: "string" },
        model: { type: "string" },
        verbosity: { type: "string", enum: Array.from(VERBOSITY_CHOICES) },
        thinking: { type: "string", enum: Array.from(THINKING_CHOICES) },
        developerPrompt: { type: "string" },
        settingsMode: {
          type: "string",
          enum: ["hidden", "read-only", "editable"],
        },
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, input.idHint ?? "clarity-prompt");
    const promptLabel = sanitizeString(input.promptLabel, "Consigne à transmettre", {
      allowEmpty: false,
    });
    const promptPlaceholder = sanitizeString(
      input.promptPlaceholder,
      "Décris l'action à effectuer…",
      { allowEmpty: false }
    );
    const model = sanitizeString(input.model, "gpt-5-mini", { allowEmpty: false });
    const verbosity =
      typeof input.verbosity === "string" && VERBOSITY_CHOICES.has(input.verbosity)
        ? (input.verbosity as VerbosityChoice)
        : ("medium" as VerbosityChoice);
    const thinking =
      typeof input.thinking === "string" && THINKING_CHOICES.has(input.thinking)
        ? (input.thinking as ThinkingChoice)
        : ("medium" as ThinkingChoice);
    const developerPrompt = sanitizeString(input.developerPrompt, "", {
      allowEmpty: true,
    });
    const settingsMode =
      input.settingsMode === "hidden" ||
      input.settingsMode === "read-only" ||
      input.settingsMode === "editable"
        ? input.settingsMode
        : "hidden";

    const config: ClarityPromptStepConfig = {
      promptLabel,
      promptPlaceholder,
      model,
      verbosity,
      thinking,
      developerPrompt,
      settingsMode,
    };

    return {
      id,
      component: "clarity-prompt",
      config,
      composite: null,
    } satisfies StepDefinition;
  },
};

interface CreateExplorateurWorldStepInput extends ToolBaseInput {
  config?: unknown;
}

const createExplorateurWorldStep: StepSequenceFunctionTool<
  CreateExplorateurWorldStepInput
> = {
  definition: {
    type: "function",
    name: "create_explorateur_world_step",
    description:
      "Instancie le mini-monde Explorateur IA complet avec sa configuration (terrains, quartiers, missions).",
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
        config: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
  },
  handler: (input) => {
    const id = resolveId(input, input.idHint ?? "explorateur-world");
    const config: ExplorateurWorldConfig = input.config
      ? sanitizeExplorateurWorldConfig(input.config)
      : createDefaultExplorateurWorldConfig();

    return {
      id,
      component: "explorateur-world",
      config,
      composite: null,
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
  required: ["id", "component", "slot", "config"],
  properties: {
    id: { type: "string" },
    component: { type: "string" },
    slot: { type: "string" },
    config: nullableConfigSchema(),
  },
};

const compositeStepConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["modules", "autoAdvance", "continueLabel"],
  properties: {
    modules: {
      type: "array",
      items: compositeModuleSchema,
    },
    autoAdvance: { type: ["boolean", "null"] },
    continueLabel: { type: ["string", "null"] },
  },
};

const nullableCompositeStepConfigSchema = (): JsonSchema => ({
  anyOf: [
    JSON.parse(JSON.stringify(compositeStepConfigSchema)),
    { type: "null" },
  ],
});

const stepSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "component", "config", "composite"],
  properties: {
    id: { type: "string" },
    component: { type: ["string", "null"] },
    config: nullableConfigSchema(),
    composite: nullableCompositeStepConfigSchema(),
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
        autoAdvance: { type: ["boolean", "null"] },
        continueLabel: { type: ["string", "null"] },
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
        slot: module.slot ?? "main",
        config: module.config ?? null,
      })
    );

    const composite: CompositeStepConfig = {
      modules,
      autoAdvance: input.autoAdvance ?? null,
      continueLabel: input.continueLabel ?? null,
    };

    return {
      id,
      component: "composite",
      config: null,
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
  required: ["eyebrow", "title", "subtitle", "badge", "titleAlign"],
  properties: {
    eyebrow: { type: ["string", "null"] },
    title: { type: ["string", "null"] },
    subtitle: { type: ["string", "null"] },
    badge: { type: ["string", "null"] },
    titleAlign: {
      anyOf: [
        { type: "string", enum: ["left", "center"] },
        { type: "null" },
      ],
    },
  },
};

const layoutSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "activityId",
    "outerClassName",
    "innerClassName",
    "headerClassName",
    "contentClassName",
    "contentAs",
    "withLandingGradient",
    "useDynamicViewportHeight",
    "withBasePadding",
    "withBaseContentSpacing",
    "withBaseInnerGap",
    "actions",
    "headerChildren",
    "beforeHeader",
  ],
  properties: {
    activityId: { type: ["string", "null"] },
    outerClassName: { type: ["string", "null"] },
    innerClassName: { type: ["string", "null"] },
    headerClassName: { type: ["string", "null"] },
    contentClassName: { type: ["string", "null"] },
    contentAs: { type: ["string", "null"] },
    withLandingGradient: { type: ["boolean", "null"] },
    useDynamicViewportHeight: { type: ["boolean", "null"] },
    withBasePadding: { type: ["boolean", "null"] },
    withBaseContentSpacing: { type: ["boolean", "null"] },
    withBaseInnerGap: { type: ["boolean", "null"] },
    actions: nullableConfigSchema(),
    headerChildren: nullableConfigSchema(),
    beforeHeader: nullableConfigSchema(),
  },
};

const ctaSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "to"],
  properties: {
    label: { type: ["string", "null"] },
    to: { type: ["string", "null"] },
  },
};

const cardSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "highlights", "cta"],
  properties: {
    title: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    highlights: {
      anyOf: [
        { type: "array", items: { type: "string" } },
        { type: "null" },
      ],
    },
    cta: nullableSchema(ctaSchema),
  },
};

const overridesSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["header", "layout", "card", "completionId", "stepSequence"],
  properties: {
    header: nullableSchema(headerSchema),
    layout: nullableSchema(layoutSchema),
    card: nullableSchema(cardSchema),
    completionId: { type: ["string", "null"] },
    stepSequence: nullableSchema({
      type: "array",
      items: stepSchema,
    }),
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
      required: ["activityId", "steps", "metadata"],
      properties: {
        activityId: { type: "string" },
        steps: {
          type: "array",
          minItems: 1,
          items: stepSchema,
        },
        metadata: nullableSchema({
          type: "object",
          additionalProperties: false,
          required: [
            "componentKey",
            "path",
            "completionId",
            "enabled",
            "header",
            "layout",
            "card",
            "overrides",
          ],
          properties: {
            componentKey: { type: ["string", "null"] },
            path: { type: ["string", "null"] },
            completionId: { type: ["string", "null"] },
            enabled: { type: ["boolean", "null"] },
            header: nullableSchema(headerSchema),
            layout: nullableSchema(layoutSchema),
            card: nullableSchema(cardSchema),
            overrides: nullableSchema(overridesSchema),
          },
        }),
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
  create_simulation_chat_step: createSimulationChatStep,
  create_info_cards_step: createInfoCardsStep,
  create_prompt_evaluation_step: createPromptEvaluationStep,
  create_ai_comparison_step: createDualModelComparisonStep,
  create_clarity_map_step: createClarityMapStep,
  create_clarity_prompt_step: createClarityPromptStep,
  create_explorateur_world_step: createExplorateurWorldStep,
  create_composite_step: createCompositeStep,
  build_step_sequence_activity: buildStepSequenceActivity,
} as const;

export type StepSequenceToolName = keyof typeof STEP_SEQUENCE_TOOLS;
