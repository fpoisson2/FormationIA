import { useCallback, useMemo, useState, type ChangeEvent } from "react";

import type { ExplorateurIAModuleConfig, ExplorateurIAModuleProps } from "./registry";
import { registerExplorateurIAModule } from "./registry";

const combineClasses = (
  ...values: Array<string | false | null | undefined>
): string => values.filter(Boolean).join(" ");

export interface ClarteQuizOptionConfig {
  id: string;
  label: string;
  explanation: string;
  score: number;
}

export interface ClarteQuizModuleConfig extends ExplorateurIAModuleConfig {
  type: "clarte-quiz";
  title?: string;
  question: string;
  options: ClarteQuizOptionConfig[];
  validateLabel?: string;
}

export interface ClarteQuizResult {
  selectedOptionId: string;
  score: number;
  explanation: string;
}

const DEFAULT_OPTIONS: ClarteQuizOptionConfig[] = [
  {
    id: "A",
    label: "Écris un plan.",
    explanation: "Trop vague : objectifs, sections, longueur… manquent.",
    score: 0,
  },
  {
    id: "B",
    label:
      "Donne un plan en 5 sections sur l'énergie solaire pour débutants, avec titres et 2 sous-points chacun.",
    explanation: "Précis, contraint et adapté au public cible.",
    score: 100,
  },
  {
    id: "C",
    label: "Plan énergie solaire?",
    explanation: "Formulation télégraphique, ambiguë.",
    score: 10,
  },
];

export const DEFAULT_CLARTE_QUIZ_CONFIG: ClarteQuizModuleConfig = {
  type: "clarte-quiz",
  title: "Choisissez la consigne la plus claire",
  question: "Quel est le meilleur énoncé pour obtenir un plan clair?",
  options: DEFAULT_OPTIONS,
  validateLabel: "Valider",
};

function sanitizeQuizConfig(
  config: unknown
): ClarteQuizModuleConfig {
  if (!config || typeof config !== "object") {
    return { ...DEFAULT_CLARTE_QUIZ_CONFIG };
  }
  const base = config as Partial<ClarteQuizModuleConfig>;
  const rawOptions = Array.isArray(base.options) ? base.options : [];
  const options: ClarteQuizOptionConfig[] = rawOptions.length
    ? rawOptions.map((option, index) => ({
        id:
          typeof option?.id === "string" && option.id.trim()
            ? option.id.trim()
            : String.fromCharCode(65 + index),
        label:
          typeof option?.label === "string"
            ? option.label
            : DEFAULT_OPTIONS[index % DEFAULT_OPTIONS.length].label,
        explanation:
          typeof option?.explanation === "string"
            ? option.explanation
            : DEFAULT_OPTIONS[index % DEFAULT_OPTIONS.length].explanation,
        score:
          typeof option?.score === "number"
            ? option.score
            : DEFAULT_OPTIONS[index % DEFAULT_OPTIONS.length].score,
      }))
    : DEFAULT_OPTIONS;

  return {
    type: "clarte-quiz",
    title:
      typeof base.title === "string"
        ? base.title
        : DEFAULT_CLARTE_QUIZ_CONFIG.title,
    question:
      typeof base.question === "string"
        ? base.question
        : DEFAULT_CLARTE_QUIZ_CONFIG.question,
    validateLabel:
      typeof base.validateLabel === "string"
        ? base.validateLabel
        : DEFAULT_CLARTE_QUIZ_CONFIG.validateLabel,
    options,
  };
}

function updateOption(
  options: ClarteQuizOptionConfig[],
  index: number,
  patch: Partial<ClarteQuizOptionConfig>
): ClarteQuizOptionConfig[] {
  return options.map((option, optionIndex) =>
    optionIndex === index ? { ...option, ...patch } : option
  );
}

function ClarteQuizModule({
  config,
  onUpdateConfig,
  onAdvance,
  payload,
  isEditMode,
}: ExplorateurIAModuleProps) {
  const typedConfig = useMemo(() => sanitizeQuizConfig(config), [config]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const previous = payload as ClarteQuizResult | undefined;
    return previous?.selectedOptionId ?? null;
  });

  const selectedOption = useMemo(
    () => typedConfig.options.find((option) => option.id === selectedId) ?? null,
    [typedConfig.options, selectedId]
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleValidate = useCallback(() => {
    if (!selectedOption) {
      return;
    }
    const result: ClarteQuizResult = {
      selectedOptionId: selectedOption.id,
      score: selectedOption.score,
      explanation: selectedOption.explanation,
    };
    onAdvance(result);
  }, [onAdvance, selectedOption]);

  const handleConfigChange = useCallback(
    (patch: Partial<ClarteQuizModuleConfig>) => {
      const nextConfig = sanitizeQuizConfig({ ...typedConfig, ...patch });
      onUpdateConfig(nextConfig);
    },
    [onUpdateConfig, typedConfig]
  );

  const handleOptionChange = useCallback(
    (index: number, field: keyof ClarteQuizOptionConfig, value: string | number) => {
      if (field === "score" && typeof value === "string") {
        const numeric = Number.parseInt(value, 10);
        handleConfigChange({
          options: updateOption(typedConfig.options, index, {
            score: Number.isNaN(numeric) ? 0 : Math.max(0, Math.min(100, numeric)),
          }),
        });
        return;
      }
      handleConfigChange({
        options: updateOption(typedConfig.options, index, {
          [field]: value,
        } as Partial<ClarteQuizOptionConfig>),
      });
    },
    [handleConfigChange, typedConfig.options]
  );

  const handleAddOption = useCallback(() => {
    const index = typedConfig.options.length;
    handleConfigChange({
      options: [
        ...typedConfig.options,
        {
          id: String.fromCharCode(65 + index),
          label: "Nouvelle option",
          explanation: "Décrivez l'impact pédagogique de cette option.",
          score: 50,
        },
      ],
    });
  }, [handleConfigChange, typedConfig.options]);

  const handleRemoveOption = useCallback(
    (index: number) => {
      if (typedConfig.options.length <= 1) {
        return;
      }
      const next = typedConfig.options.filter((_, optionIndex) => optionIndex !== index);
      handleConfigChange({ options: next });
    },
    [handleConfigChange, typedConfig.options]
  );

  if (isEditMode) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Titre</span>
            <input
              className="w-full rounded-md border border-slate-300 p-2"
              value={typedConfig.title ?? ""}
              onChange={(event) =>
                handleConfigChange({ title: event.target.value })
              }
              placeholder="Titre pédagogique"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Question</span>
            <textarea
              className="h-24 w-full rounded-md border border-slate-300 p-2"
              value={typedConfig.question}
              onChange={(event) =>
                handleConfigChange({ question: event.target.value })
              }
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Texte du bouton</span>
            <input
              className="w-full rounded-md border border-slate-300 p-2"
              value={typedConfig.validateLabel ?? ""}
              onChange={(event) =>
                handleConfigChange({ validateLabel: event.target.value })
              }
              placeholder="Valider"
            />
          </label>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Options</h3>
            <button
              type="button"
              onClick={handleAddOption}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Ajouter une option
            </button>
          </div>
          <div className="space-y-3">
            {typedConfig.options.map((option, index) => (
              <div
                key={option.id || index}
                className="rounded-2xl border border-slate-200 p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <span>ID</span>
                      <input
                        className="w-16 rounded-md border border-slate-300 p-1 text-center"
                        value={option.id}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          handleOptionChange(index, "id", event.target.value)
                        }
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <span>Score</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="w-20 rounded-md border border-slate-300 p-1 text-center"
                        value={option.score}
                        onChange={(event) =>
                          handleOptionChange(index, "score", event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveOption(index)}
                    className="text-xs font-semibold text-red-600 hover:text-red-700"
                    aria-label={`Supprimer l'option ${option.id}`}
                  >
                    Supprimer
                  </button>
                </div>
                <label className="mt-3 block space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Intitulé</span>
                  <input
                    className="w-full rounded-md border border-slate-300 p-2"
                    value={option.label}
                    onChange={(event) =>
                      handleOptionChange(index, "label", event.target.value)
                    }
                  />
                </label>
                <label className="mt-3 block space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Feedback</span>
                  <textarea
                    className="h-20 w-full rounded-md border border-slate-300 p-2"
                    value={option.explanation}
                    onChange={(event) =>
                      handleOptionChange(
                        index,
                        "explanation",
                        event.target.value
                      )
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="space-y-4">
        <header className="space-y-1">
          {typedConfig.title ? (
            <h2 className="text-lg font-semibold text-slate-900">
              {typedConfig.title}
            </h2>
          ) : null}
          <p className="text-sm text-slate-600">{typedConfig.question}</p>
        </header>
        <div className="space-y-2">
          {typedConfig.options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelect(option.id)}
              className={combineClasses(
                "w-full rounded-xl border p-3 text-left text-sm shadow-sm transition",
                selectedId === option.id
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {option.id}
                </span>
                <span className="text-slate-700">{option.label}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700">Impact pédagogique</h3>
        {selectedOption ? (
          <>
            <p className="text-sm text-slate-600">{selectedOption.explanation}</p>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-slate-700">Score</span>
              <div className="flex-1 rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${selectedOption.score}%` }}
                />
              </div>
              <span className="w-12 text-right text-sm font-semibold tabular-nums text-emerald-600">
                {selectedOption.score}
              </span>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">
            Sélectionnez une option pour afficher le retour.
          </p>
        )}
        <button
          type="button"
          onClick={handleValidate}
          disabled={!selectedOption}
          className={combineClasses(
            "rounded-xl px-4 py-2 text-sm font-semibold text-white transition",
            selectedOption
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "bg-emerald-400/60 cursor-not-allowed"
          )}
        >
          {typedConfig.validateLabel ?? "Valider"}
        </button>
      </section>
    </div>
  );
}

registerExplorateurIAModule("clarte-quiz", ClarteQuizModule);
