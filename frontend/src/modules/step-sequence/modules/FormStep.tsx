import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { KeyboardEvent } from "react";

import type {
  BulletedListFieldSpec,
  FieldSpec,
  FieldType,
  FieldValue,
  MultipleChoiceFieldSpec,
  SingleChoiceFieldSpec,
  StageAnswer,
  TableMenuDayValue,
  TableMenuFullValue,
  TextareaWithCounterFieldSpec,
  TwoBulletsFieldSpec,
} from "../../../api";
import GuidedFields from "../../../components/GuidedFields";
import { StepSequenceContext } from "../types";
import type { StepComponentProps } from "../types";

const DEFAULT_SUBMIT_LABEL = "Continuer";

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  bulleted_list: "Liste à puces",
  table_menu_day: "Table · journée",
  table_menu_full: "Table · complète",
  textarea_with_counter: "Zone de texte",
  two_bullets: "Deux puces",
  reference_line: "Référence",
  single_choice: "Choix unique",
  multiple_choice: "Choix multiples",
};

const FIELD_TYPES: FieldType[] = [
  "bulleted_list",
  "table_menu_day",
  "table_menu_full",
  "textarea_with_counter",
  "two_bullets",
  "reference_line",
  "single_choice",
  "multiple_choice",
];

type NormalizeOptions = {
  fillDefaults: boolean;
  trim: boolean;
};

type ChoiceFieldSpec = SingleChoiceFieldSpec | MultipleChoiceFieldSpec;

export type FormStepValidationResult = Record<string, string>;

export type FormStepValidationFn = (
  values: StageAnswer,
  fields: FieldSpec[]
) => FormStepValidationResult | void | undefined | null;

export interface FormStepConfig {
  fields: FieldSpec[];
  submitLabel?: string;
  allowEmpty?: boolean;
  initialValues?: StageAnswer;
  validate?: FormStepValidationFn;
  onChange?: (config: FormStepConfig) => void;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function cloneFieldSpec(field: FieldSpec): FieldSpec {
  switch (field.type) {
    case "bulleted_list": {
      const spec = field as BulletedListFieldSpec;
      return {
        ...spec,
        mustContainAny: spec.mustContainAny ? [...spec.mustContainAny] : undefined,
      };
    }
    case "table_menu_day":
    case "table_menu_full": {
      return {
        ...field,
        meals: [...field.meals],
      };
    }
    case "textarea_with_counter": {
      const spec = field as TextareaWithCounterFieldSpec;
      return {
        ...spec,
        forbidWords: spec.forbidWords ? [...spec.forbidWords] : undefined,
      };
    }
    case "single_choice": {
      const spec = field as SingleChoiceFieldSpec;
      return {
        ...spec,
        options: spec.options.map((option) => ({ ...option })),
      };
    }
    case "multiple_choice": {
      const spec = field as MultipleChoiceFieldSpec;
      return {
        ...spec,
        options: spec.options.map((option) => ({ ...option })),
      };
    }
    default:
      return { ...field };
  }
}

function isChoiceField(field: FieldSpec): field is ChoiceFieldSpec {
  return field.type === "single_choice" || field.type === "multiple_choice";
}

function normalizeFieldValue(
  field: FieldSpec,
  raw: unknown,
  options: NormalizeOptions
): FieldValue {
  switch (field.type) {
    case "bulleted_list": {
      const spec = field as BulletedListFieldSpec;
      const minCount = Math.max(1, spec.minBullets);
      const maxCount = Math.max(minCount, spec.maxBullets);
      let bullets = Array.isArray(raw)
        ? (raw as unknown[]).map((item) => (typeof item === "string" ? item : ""))
        : [];
      bullets = bullets.slice(0, maxCount);
      bullets = bullets.map((item) =>
        options.trim ? item.replace(/\s+/g, " ").trim() : item
      );
      if (bullets.length < minCount) {
        const missing = minCount - bullets.length;
        bullets = bullets.concat(Array.from({ length: missing }, () => ""));
      }
      return bullets;
    }
    case "two_bullets": {
      let bullets = Array.isArray(raw)
        ? (raw as unknown[]).map((item) => (typeof item === "string" ? item : ""))
        : [];
      bullets = bullets.slice(0, 2);
      bullets = bullets.map((item) =>
        options.trim ? item.replace(/\s+/g, " ").trim() : item
      );
      if (bullets.length < 2) {
        const missing = 2 - bullets.length;
        bullets = bullets.concat(Array.from({ length: missing }, () => ""));
      }
      return bullets.slice(0, 2).map((item) => item.slice(0, 240));
    }
    case "table_menu_day": {
      const table: TableMenuDayValue = {};
      const source = (raw as TableMenuDayValue) ?? {};
      field.meals.forEach((meal) => {
        const value = source[meal];
        const text = typeof value === "string" ? value : "";
        table[meal] = options.trim ? text.replace(/\s+/g, " ").trim() : text;
      });
      return table;
    }
    case "table_menu_full": {
      const table: TableMenuFullValue = {};
      const source = (raw as TableMenuFullValue) ?? {};
      field.meals.forEach((meal) => {
        const value = source[meal] ?? { plat: "", boisson: "", dessert: "" };
        const normalizeCell = (text: unknown): string => {
          const typed = typeof text === "string" ? text : "";
          return options.trim ? typed.replace(/\s+/g, " ").trim() : typed;
        };
        table[meal] = {
          plat: normalizeCell(value.plat),
          boisson: normalizeCell(value.boisson),
          dessert: normalizeCell(value.dessert),
        };
      });
      return table;
    }
    case "textarea_with_counter": {
      const text = typeof raw === "string" ? raw : "";
      return options.trim ? text.replace(/\s+/g, " ").trim() : text;
    }
    case "reference_line": {
      const text = typeof raw === "string" ? raw : "";
      return options.trim ? text.replace(/\s+/g, " ").trim() : text;
    }
    case "single_choice": {
      const spec = field as SingleChoiceFieldSpec;
      const value = typeof raw === "string" ? raw : "";
      const normalized = options.trim ? value.replace(/\s+/g, " ").trim() : value;
      const isValid = spec.options.some((option) => option.value === normalized);
      return isValid ? normalized : "";
    }
    case "multiple_choice": {
      const spec = field as MultipleChoiceFieldSpec;
      const source = Array.isArray(raw) ? (raw as unknown[]) : [];
      const cleaned = source
        .filter((item): item is string => typeof item === "string")
        .map((item) => (options.trim ? item.replace(/\s+/g, " ").trim() : item))
        .filter((item) => item.length > 0);
      const unique = Array.from(new Set(cleaned));
      const validSet = new Set(
        unique.filter((item) => spec.options.some((option) => option.value === item))
      );
      return spec.options
        .map((option) => option.value)
        .filter((value) => validSet.has(value));
    }
    default:
      return (raw as FieldValue) ?? null;
  }
}

function isStageAnswerLike(value: unknown): value is StageAnswer {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createDefaultFieldSpec(type: FieldType): FieldSpec {
  const id = `${type}-${generateId()}`;
  switch (type) {
    case "bulleted_list":
      return {
        id,
        type,
        label: "Nouvelle liste",
        minBullets: 2,
        maxBullets: 4,
        maxWordsPerBullet: 12,
      };
    case "table_menu_day":
      return {
        id,
        type,
        label: "Menus du jour",
        meals: ["Matin", "Midi", "Soir"],
      };
    case "table_menu_full":
      return {
        id,
        type,
        label: "Menu complet",
        meals: ["Matin", "Midi", "Soir"],
      };
    case "textarea_with_counter":
      return {
        id,
        type,
        label: "Zone de texte",
        minWords: 10,
        maxWords: 120,
      };
    case "two_bullets":
      return {
        id,
        type,
        label: "Deux idées clés",
        maxWordsPerBullet: 18,
      };
    case "reference_line":
      return {
        id,
        type,
        label: "Référence",
      };
    case "single_choice":
      return {
        id,
        type,
        label: "Question à choix unique",
        options: [
          { value: `${id}-option-a`, label: "Option A" },
          { value: `${id}-option-b`, label: "Option B" },
          { value: `${id}-option-c`, label: "Option C" },
        ],
      } satisfies SingleChoiceFieldSpec;
    case "multiple_choice":
      return {
        id,
        type,
        label: "Question à choix multiples",
        options: [
          { value: `${id}-option-a`, label: "Option A" },
          { value: `${id}-option-b`, label: "Option B" },
          { value: `${id}-option-c`, label: "Option C" },
        ],
        minSelections: 1,
      } satisfies MultipleChoiceFieldSpec;
    default:
      return {
        id,
        type,
        label: "Champ",
      } as FieldSpec;
  }
}

export function validateFieldSpec(spec: unknown): spec is FieldSpec {
  if (!spec || typeof spec !== "object") {
    return false;
  }
  const base = spec as Partial<FieldSpec> & { type?: FieldType };
  if (!base.type || !FIELD_TYPES.includes(base.type)) {
    return false;
  }
  if (typeof base.id !== "string" || base.id.trim().length === 0) {
    return false;
  }
  if (typeof base.label !== "string" || base.label.trim().length === 0) {
    return false;
  }

  switch (base.type) {
    case "bulleted_list": {
      const typed = spec as Partial<BulletedListFieldSpec>;
      if (
        typeof typed.minBullets !== "number" ||
        typeof typed.maxBullets !== "number" ||
        typeof typed.maxWordsPerBullet !== "number"
      ) {
        return false;
      }
      if (typed.minBullets < 1 || typed.maxBullets < typed.minBullets) {
        return false;
      }
      if (typed.maxWordsPerBullet < 1) {
        return false;
      }
      if (
        typed.mustContainAny &&
        (!Array.isArray(typed.mustContainAny) ||
          typed.mustContainAny.some((item) => typeof item !== "string"))
      ) {
        return false;
      }
      return true;
    }
    case "table_menu_day":
    case "table_menu_full": {
      const typed = spec as { meals?: unknown };
      if (!Array.isArray(typed.meals) || typed.meals.length === 0) {
        return false;
      }
      return typed.meals.every((item) => typeof item === "string" && item.length > 0);
    }
    case "textarea_with_counter": {
      const typed = spec as Partial<TextareaWithCounterFieldSpec>;
      if (
        typeof typed.minWords !== "number" ||
        typeof typed.maxWords !== "number" ||
        typed.minWords < 0 ||
        typed.maxWords < typed.minWords
      ) {
        return false;
      }
      if (
        typed.forbidWords &&
        (!Array.isArray(typed.forbidWords) ||
          typed.forbidWords.some((item) => typeof item !== "string"))
      ) {
        return false;
      }
      return true;
    }
    case "two_bullets": {
      const typed = spec as Partial<TwoBulletsFieldSpec>;
      return typeof typed.maxWordsPerBullet === "number" && typed.maxWordsPerBullet > 0;
    }
    case "reference_line":
      return true;
    case "single_choice": {
      const typed = spec as SingleChoiceFieldSpec;
      if (!Array.isArray(typed.options) || typed.options.length === 0) {
        return false;
      }
      return typed.options.every(
        (option) =>
          typeof option.value === "string" &&
          option.value.length > 0 &&
          typeof option.label === "string" &&
          option.label.length > 0 &&
          (option.description === undefined || typeof option.description === "string")
      );
    }
    case "multiple_choice": {
      const typed = spec as MultipleChoiceFieldSpec;
      if (!Array.isArray(typed.options) || typed.options.length === 0) {
        return false;
      }
      const optionsValid = typed.options.every(
        (option) =>
          typeof option.value === "string" &&
          option.value.length > 0 &&
          typeof option.label === "string" &&
          option.label.length > 0 &&
          (option.description === undefined || typeof option.description === "string")
      );
      if (!optionsValid) {
        return false;
      }
      if (
        typed.minSelections !== undefined &&
        (!Number.isInteger(typed.minSelections) || typed.minSelections < 0)
      ) {
        return false;
      }
      if (
        typed.maxSelections !== undefined &&
        (!Number.isInteger(typed.maxSelections) || typed.maxSelections < 1)
      ) {
        return false;
      }
      if (
        typed.minSelections !== undefined &&
        typed.maxSelections !== undefined &&
        (typed.maxSelections as number) < (typed.minSelections as number)
      ) {
        return false;
      }
      if (
        typed.minSelections !== undefined &&
        typed.minSelections > typed.options.length
      ) {
        return false;
      }
      if (
        typed.maxSelections !== undefined &&
        typed.maxSelections > typed.options.length
      ) {
        return false;
      }
      return true;
    }
    default:
      return false;
  }
}

export function createInitialFormValues(
  fields: FieldSpec[],
  source?: StageAnswer
): StageAnswer {
  const values: StageAnswer = {};
  fields.forEach((field) => {
    const raw = source?.[field.id];
    values[field.id] = normalizeFieldValue(field, raw, {
      fillDefaults: true,
      trim: false,
    });
  });
  return values;
}

export function sanitizeFormValues(
  fields: FieldSpec[],
  values: StageAnswer
): StageAnswer {
  const sanitized: StageAnswer = {};
  fields.forEach((field) => {
    sanitized[field.id] = normalizeFieldValue(field, values[field.id], {
      fillDefaults: false,
      trim: true,
    });
  });
  return sanitized;
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function isFormAnswerEmpty(
  fields: FieldSpec[],
  values: StageAnswer
): boolean {
  return fields.every((field) => {
    const value = values[field.id];
    switch (field.type) {
      case "bulleted_list":
      case "two_bullets": {
        const items = Array.isArray(value) ? (value as string[]) : [];
        return items.every((item) => item.trim().length === 0);
      }
      case "table_menu_day": {
        const table = (value as TableMenuDayValue) ?? {};
        return field.meals.every((meal) => {
          const text = table[meal] ?? "";
          return typeof text !== "string" || text.trim().length === 0;
        });
      }
      case "table_menu_full": {
        const table = (value as TableMenuFullValue) ?? {};
        return field.meals.every((meal) => {
          const row = table[meal] ?? { plat: "", boisson: "", dessert: "" };
          return (
            (row.plat ?? "").trim().length === 0 &&
            (row.boisson ?? "").trim().length === 0 &&
            (row.dessert ?? "").trim().length === 0
          );
        });
      }
      case "textarea_with_counter":
      case "reference_line": {
        const text = typeof value === "string" ? value : "";
        return text.trim().length === 0;
      }
      case "single_choice": {
        const selected = typeof value === "string" ? value : "";
        return selected.trim().length === 0;
      }
      case "multiple_choice": {
        const selections = Array.isArray(value)
          ? (value as string[]).filter((item) => typeof item === "string" && item.trim().length > 0)
          : [];
        return selections.length === 0;
      }
      default:
        return true;
    }
  });
}

export function defaultValidateFormValues(
  fields: FieldSpec[],
  values: StageAnswer,
  allowEmpty: boolean
): Record<string, string> {
  if (allowEmpty && isFormAnswerEmpty(fields, values)) {
    return {};
  }
  const errors: Record<string, string> = {};

  fields.forEach((field) => {
    const value = values[field.id];
    switch (field.type) {
      case "bulleted_list": {
        const spec = field as BulletedListFieldSpec;
        const bullets = Array.isArray(value) ? (value as string[]) : [];
        const filtered = bullets.filter((item) => item.length > 0);
        if (filtered.length < spec.minBullets || filtered.length > spec.maxBullets) {
          errors[field.id] = `Ajoute ${spec.minBullets}-${spec.maxBullets} puces complètes.`;
          break;
        }
        if (bullets.some((item) => item.length === 0)) {
          errors[field.id] = "Complète chaque puce.";
          break;
        }
        if (bullets.some((item) => countWords(item) > spec.maxWordsPerBullet)) {
          errors[field.id] = `${spec.maxWordsPerBullet} mots max par puce.`;
        }
        break;
      }
      case "two_bullets": {
        const spec = field as TwoBulletsFieldSpec;
        const bullets = Array.isArray(value) ? (value as string[]) : [];
        if (bullets.some((item) => item.length === 0)) {
          errors[field.id] = "Complète les deux puces.";
          break;
        }
        if (bullets.some((item) => countWords(item) > spec.maxWordsPerBullet)) {
          errors[field.id] = `${spec.maxWordsPerBullet} mots max par puce.`;
        }
        break;
      }
      case "table_menu_day": {
        const table = (value as TableMenuDayValue) ?? {};
        const hasEmpty = field.meals.some((meal) => {
          const text = table[meal] ?? "";
          return typeof text !== "string" || text.length === 0;
        });
        if (hasEmpty) {
          errors[field.id] = "Complète chaque repas.";
        }
        break;
      }
      case "table_menu_full": {
        const table = (value as TableMenuFullValue) ?? {};
        const hasEmpty = field.meals.some((meal) => {
          const row = table[meal] ?? { plat: "", boisson: "", dessert: "" };
          return !row.plat || !row.boisson || !row.dessert;
        });
        if (hasEmpty) {
          errors[field.id] = "Complète chaque repas.";
        }
        break;
      }
      case "textarea_with_counter": {
        const spec = field as TextareaWithCounterFieldSpec;
        const text = typeof value === "string" ? value : "";
        if (text.length === 0) {
          errors[field.id] = "Complète ce champ.";
          break;
        }
        const words = countWords(text);
        if (words < spec.minWords || words > spec.maxWords) {
          errors[field.id] = `${spec.minWords}-${spec.maxWords} mots attendus.`;
        }
        break;
      }
      case "reference_line": {
        const text = typeof value === "string" ? value : "";
        if (text.length === 0) {
          errors[field.id] = "Complète ce champ.";
        }
        break;
      }
      case "single_choice": {
        const spec = field as SingleChoiceFieldSpec;
        const selected = typeof value === "string" ? value : "";
        if (!spec.options.some((option) => option.value === selected)) {
          errors[field.id] = "Sélectionne une réponse.";
        }
        break;
      }
      case "multiple_choice": {
        const spec = field as MultipleChoiceFieldSpec;
        const selections = Array.isArray(value)
          ? (value as string[]).filter((item) => typeof item === "string" && item.length > 0)
          : [];
        const unique = Array.from(new Set(selections));
        const valid = unique.filter((item) => spec.options.some((option) => option.value === item));
        if (valid.length !== unique.length) {
          errors[field.id] = "Sélectionne uniquement les options proposées.";
          break;
        }
        if (valid.length === 0) {
          errors[field.id] = "Sélectionne au moins une réponse.";
          break;
        }
        if (typeof spec.minSelections === "number" && valid.length < spec.minSelections) {
          errors[field.id] =
            spec.minSelections > 1
              ? `Sélectionne au moins ${spec.minSelections} réponses.`
              : "Sélectionne au moins une réponse.";
          break;
        }
        if (typeof spec.maxSelections === "number" && valid.length > spec.maxSelections) {
          errors[field.id] =
            spec.maxSelections > 1
              ? `Sélectionne au plus ${spec.maxSelections} réponses.`
              : "Sélectionne au plus une réponse.";
        }
        break;
      }
      default:
        break;
    }
  });

  return errors;
}

function normalizeConfig(config: unknown): FormStepConfig {
  if (!config || typeof config !== "object") {
    return { fields: [], submitLabel: DEFAULT_SUBMIT_LABEL };
  }
  const base = config as Partial<FormStepConfig>;
  const fields = Array.isArray(base.fields)
    ? base.fields.filter(validateFieldSpec).map(cloneFieldSpec)
    : [];
  const submitLabel =
    typeof base.submitLabel === "string" && base.submitLabel.trim().length > 0
      ? base.submitLabel
      : DEFAULT_SUBMIT_LABEL;

  return {
    fields,
    submitLabel,
    allowEmpty: Boolean(base.allowEmpty),
    initialValues: isStageAnswerLike(base.initialValues)
      ? (base.initialValues as StageAnswer)
      : undefined,
    validate: typeof base.validate === "function" ? base.validate : undefined,
    onChange: typeof base.onChange === "function" ? base.onChange : undefined,
  };
}

interface DesignerFieldProps {
  field: FieldSpec;
  index: number;
  isSelected: boolean;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
}

function DesignerField({
  field,
  index,
  isSelected,
  onSelect,
  onRemove,
}: DesignerFieldProps): JSX.Element {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(index);
      }
    },
    [index, onSelect]
  );

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(index)}
        onKeyDown={handleKeyDown}
        className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-red)] focus-visible:ring-offset-2 ${
          isSelected
            ? "border-[color:var(--brand-red)] bg-[color:var(--brand-red)]/5"
            : "border-slate-200 hover:border-[color:var(--brand-red)]/60"
        }`}
      >
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
            {FIELD_TYPE_LABELS[field.type] ?? field.type}
          </span>
          <span className="text-sm font-semibold text-[color:var(--brand-black)]">
            {field.label}
          </span>
        </div>
        <button
          type="button"
          className="text-xs font-semibold text-red-600 hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(index);
          }}
        >
          Retirer
        </button>
      </div>
    </li>
  );
}

interface ChoiceFieldEditorProps {
  field: ChoiceFieldSpec;
  onOptionLabelChange: (optionIndex: number, value: string) => void;
  onOptionDescriptionChange: (optionIndex: number, value: string | undefined) => void;
  onAddOption: () => void;
  onRemoveOption: (optionIndex: number) => void;
}

function ChoiceFieldEditor({
  field,
  onOptionLabelChange,
  onOptionDescriptionChange,
  onAddOption,
  onRemoveOption,
}: ChoiceFieldEditorProps): JSX.Element {
  const canRemoveOption = field.options.length > 1;

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-[color:var(--brand-black)]">
        Options de réponse
      </h4>
      <ul className="space-y-3">
        {field.options.map((option, index) => (
          <li key={option.value} className="space-y-3 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Option {index + 1}
              </span>
              <button
                type="button"
                className={`text-xs font-semibold ${
                  canRemoveOption
                    ? "text-red-600 hover:underline"
                    : "cursor-not-allowed text-slate-300"
                }`}
                onClick={() => canRemoveOption && onRemoveOption(index)}
                disabled={!canRemoveOption}
              >
                Supprimer
              </button>
            </div>
            <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
              Intitulé
              <input
                type="text"
                value={option.label}
                onChange={(event) => onOptionLabelChange(index, event.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none"
                placeholder="Texte affiché pour ce choix"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
              Description (optionnel)
              <textarea
                value={option.description ?? ""}
                onChange={(event) =>
                  onOptionDescriptionChange(
                    index,
                    event.target.value.length > 0 ? event.target.value : undefined
                  )
                }
                className="min-h-[64px] rounded-lg border border-slate-200 px-3 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none"
                placeholder="Détail complémentaire affiché sous le choix"
              />
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="cta-button cta-button--light w-full"
        onClick={onAddOption}
      >
        Ajouter une option
      </button>
    </div>
  );
}

export function FormStep({
  config,
  payload,
  isEditMode,
  onAdvance,
  onUpdateConfig,
}: StepComponentProps): JSX.Element {
  const context = useContext(StepSequenceContext);
  const effectiveOnAdvance = context?.onAdvance ?? onAdvance;
  const effectiveOnUpdateConfig = context?.onUpdateConfig ?? onUpdateConfig;
  const isDesignerMode = context?.isEditMode ?? isEditMode;

  const typedConfig = useMemo(() => normalizeConfig(config), [config]);
  const [activeConfig, setActiveConfig] = useState<FormStepConfig>(typedConfig);

  useEffect(() => {
    setActiveConfig(typedConfig);
  }, [typedConfig]);

  const payloadAnswer = useMemo(() => {
    return isStageAnswerLike(payload) ? (payload as StageAnswer) : undefined;
  }, [payload]);

  const [values, setValues] = useState<StageAnswer>(() =>
    createInitialFormValues(typedConfig.fields, payloadAnswer ?? typedConfig.initialValues)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedFieldIndex, setSelectedFieldIndex] = useState<number | null>(null);

  useEffect(() => {
    if (selectedFieldIndex === null) {
      return;
    }
    if (selectedFieldIndex >= activeConfig.fields.length) {
      setSelectedFieldIndex(
        activeConfig.fields.length > 0 ? activeConfig.fields.length - 1 : null
      );
    }
  }, [activeConfig.fields, selectedFieldIndex]);

  useEffect(() => {
    setValues((prev) => {
      const source = payloadAnswer ?? activeConfig.initialValues ?? prev;
      return createInitialFormValues(activeConfig.fields, source);
    });
    setErrors({});
  }, [activeConfig.fields, activeConfig.initialValues, payloadAnswer]);

  const handleValueChange = useCallback(
    (fieldId: string, value: FieldValue) => {
      setValues((prev) => ({ ...prev, [fieldId]: value }));
    },
    []
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isDesignerMode) {
        return;
      }
      const sanitized = sanitizeFormValues(activeConfig.fields, values);
      let fieldErrors = defaultValidateFormValues(
        activeConfig.fields,
        sanitized,
        Boolean(activeConfig.allowEmpty)
      );
      if (activeConfig.validate) {
        const custom = activeConfig.validate(sanitized, activeConfig.fields);
        if (custom && typeof custom === "object") {
          fieldErrors = { ...fieldErrors, ...custom };
        }
      }
      const filteredErrors: Record<string, string> = {};
      Object.entries(fieldErrors).forEach(([key, message]) => {
        if (typeof message === "string" && message.length > 0) {
          filteredErrors[key] = message;
        }
      });
      if (Object.keys(filteredErrors).length > 0) {
        setErrors(filteredErrors);
        return;
      }
      setErrors({});
      const finalValues = sanitizeFormValues(activeConfig.fields, values);
      setValues(createInitialFormValues(activeConfig.fields, finalValues));
      effectiveOnAdvance(finalValues);
    },
    [
      activeConfig.allowEmpty,
      activeConfig.fields,
      activeConfig.validate,
      effectiveOnAdvance,
      isDesignerMode,
      values,
    ]
  );

  const pushConfigChange = useCallback(
    (updater: (prev: FormStepConfig) => FormStepConfig) => {
      setActiveConfig((prev) => {
        const base = prev ?? typedConfig;
        const next = updater(base);
        const withCallbacks: FormStepConfig = {
          ...next,
          validate: typedConfig.validate,
          onChange: typedConfig.onChange,
        };
        typedConfig.onChange?.(withCallbacks);
        effectiveOnUpdateConfig(withCallbacks);
        return withCallbacks;
      });
    },
    [effectiveOnUpdateConfig, typedConfig]
  );

  const handleSelectField = useCallback((index: number) => {
    setSelectedFieldIndex(index);
  }, []);

  const updateFieldAtIndex = useCallback(
    (index: number, updater: (field: FieldSpec) => FieldSpec) => {
      pushConfigChange((prev) => {
        const nextFields = prev.fields.map((field, idx) => {
          if (idx !== index) {
            return field;
          }
          const draft = cloneFieldSpec(field);
          const updated = updater(draft);
          return cloneFieldSpec(updated);
        });
        return {
          ...prev,
          fields: nextFields,
        };
      });
    },
    [pushConfigChange]
  );

  const updateChoiceField = useCallback(
    (index: number, updater: (field: ChoiceFieldSpec) => ChoiceFieldSpec) => {
      updateFieldAtIndex(index, (field) => {
        if (!isChoiceField(field)) {
          return field;
        }
        return updater(field);
      });
    },
    [updateFieldAtIndex]
  );

  const handleChoiceOptionLabelChange = useCallback(
    (fieldIndex: number, optionIndex: number, value: string) => {
      updateChoiceField(fieldIndex, (field) => ({
        ...field,
        options: field.options.map((option, idx) =>
          idx === optionIndex ? { ...option, label: value } : option
        ),
      }));
    },
    [updateChoiceField]
  );

  const handleChoiceOptionDescriptionChange = useCallback(
    (fieldIndex: number, optionIndex: number, value: string | undefined) => {
      updateChoiceField(fieldIndex, (field) => ({
        ...field,
        options: field.options.map((option, idx) =>
          idx === optionIndex
            ? { ...option, description: value ?? undefined }
            : option
        ),
      }));
    },
    [updateChoiceField]
  );

  const handleAddChoiceOption = useCallback(
    (fieldIndex: number) => {
      updateChoiceField(fieldIndex, (field) => {
        const existingValues = new Set(field.options.map((option) => option.value));
        let value = `${field.id}-option-${generateId()}`;
        while (existingValues.has(value)) {
          value = `${field.id}-option-${generateId()}`;
        }
        const label = `Option ${field.options.length + 1}`;
        return {
          ...field,
          options: [...field.options, { value, label }],
        };
      });
    },
    [updateChoiceField]
  );

  const handleRemoveChoiceOption = useCallback(
    (fieldIndex: number, optionIndex: number) => {
      updateChoiceField(fieldIndex, (field) => {
        if (field.options.length <= 1) {
          return field;
        }
        const options = field.options.filter((_, idx) => idx !== optionIndex);
        if (field.type === "single_choice") {
          return {
            ...field,
            options,
          };
        }
        const nextLength = options.length;
        let minSelections = field.minSelections;
        if (typeof minSelections === "number" && minSelections > nextLength) {
          minSelections = nextLength > 0 ? nextLength : undefined;
        }
        let maxSelections = field.maxSelections;
        if (typeof maxSelections === "number" && maxSelections > nextLength) {
          maxSelections = nextLength > 0 ? nextLength : undefined;
        }
        return {
          ...field,
          options,
          minSelections,
          maxSelections,
        };
      });
    },
    [updateChoiceField]
  );

  const [selectedType, setSelectedType] = useState<FieldType>("textarea_with_counter");

  const handleAddField = useCallback(() => {
    const baseIdSet = new Set(activeConfig.fields.map((field) => field.id));
    let field = createDefaultFieldSpec(selectedType);
    while (baseIdSet.has(field.id)) {
      field = createDefaultFieldSpec(selectedType);
    }
    pushConfigChange((prev) => ({
      ...prev,
      fields: [...prev.fields, field],
    }));
    setSelectedFieldIndex(activeConfig.fields.length);
  }, [activeConfig.fields, pushConfigChange, selectedType]);

  const handleRemoveField = useCallback(
    (index: number) => {
      pushConfigChange((prev) => ({
        ...prev,
        fields: prev.fields.filter((_, idx) => idx !== index),
      }));
    },
    [pushConfigChange]
  );

  const handleSubmitLabelChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      pushConfigChange((prev) => ({
        ...prev,
        submitLabel: value.length > 0 ? value : DEFAULT_SUBMIT_LABEL,
      }));
    },
    [pushConfigChange]
  );

  const currentSubmitLabel =
    activeConfig.submitLabel && activeConfig.submitLabel.length > 0
      ? activeConfig.submitLabel
      : DEFAULT_SUBMIT_LABEL;

  const selectedField =
    selectedFieldIndex !== null ? activeConfig.fields[selectedFieldIndex] : null;
  const selectedChoiceField =
    selectedField && isChoiceField(selectedField) ? selectedField : null;

  return (
    <div className="flex flex-col gap-8 lg:flex-row">
      <form
        className="flex-1 space-y-6"
        onSubmit={handleSubmit}
        aria-label="Formulaire guidé"
      >
        <GuidedFields
          fields={activeConfig.fields}
          values={values}
          onChange={handleValueChange}
          errors={errors}
        />
        <button
          type="submit"
          className="cta-button"
          disabled={isDesignerMode}
        >
          {currentSubmitLabel}
        </button>
      </form>
      {isDesignerMode && (
        <aside
          aria-label="Designer du formulaire"
          className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 p-4"
        >
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-[color:var(--brand-black)]">
              Paramètres du formulaire
            </h2>
            <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
              Libellé du bouton
              <input
                type="text"
                value={currentSubmitLabel}
                onChange={handleSubmitLabelChange}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Libellé du bouton"
              />
            </label>
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[color:var(--brand-black)]">
              Champs
            </h3>
            <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
              Type de champ
              <select
                value={selectedType}
                onChange={(event) => setSelectedType(event.target.value as FieldType)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {FIELD_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="cta-button cta-button--light w-full"
              onClick={handleAddField}
            >
              Ajouter un champ
            </button>
            <ul className="space-y-2">
              {activeConfig.fields.map((field, index) => (
                <DesignerField
                  key={field.id}
                  field={field}
                  index={index}
                  isSelected={selectedFieldIndex === index}
                  onSelect={handleSelectField}
                  onRemove={handleRemoveField}
                />
              ))}
              {activeConfig.fields.length === 0 && (
                <li className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-[color:var(--brand-charcoal)]/70">
                  Aucun champ configuré.
                </li>
              )}
            </ul>
            {activeConfig.fields.length > 0 && (
              selectedFieldIndex !== null ? (
                selectedChoiceField ? (
                  <ChoiceFieldEditor
                    field={selectedChoiceField}
                    onOptionLabelChange={(optionIndex, value) =>
                      handleChoiceOptionLabelChange(selectedFieldIndex, optionIndex, value)
                    }
                    onOptionDescriptionChange={(optionIndex, value) =>
                      handleChoiceOptionDescriptionChange(selectedFieldIndex, optionIndex, value)
                    }
                    onAddOption={() => handleAddChoiceOption(selectedFieldIndex)}
                    onRemoveOption={(optionIndex) =>
                      handleRemoveChoiceOption(selectedFieldIndex, optionIndex)
                    }
                  />
                ) : (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-[color:var(--brand-charcoal)]/80">
                    Ce type de champ n'a pas d'options configurables.
                  </p>
                )
              ) : (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-[color:var(--brand-charcoal)]/80">
                  Sélectionne un champ pour modifier ses options.
                </p>
              )
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

