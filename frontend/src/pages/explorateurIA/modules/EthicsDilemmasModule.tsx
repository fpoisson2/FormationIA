import { useCallback, useMemo, useState, type ChangeEvent } from "react";

import type { ExplorateurIAModuleConfig, ExplorateurIAModuleProps } from "./registry";
import { registerExplorateurIAModule } from "./registry";

export interface EthicsDilemmaOptionConfig {
  id: string;
  label: string;
  feedback: string;
  score: number;
}

export interface EthicsDilemmaConfig {
  id: string;
  scenario: string;
  options: EthicsDilemmaOptionConfig[];
}

export interface EthicsDilemmasModuleConfig extends ExplorateurIAModuleConfig {
  type: "ethics-dilemmas";
  title?: string;
  introduction?: string;
  dilemmas: EthicsDilemmaConfig[];
  concludeLabel?: string;
}

export interface EthicsDilemmasResult {
  averageScore: number;
  answers: Array<{ dilemmaId: string; optionId: string; score: number }>;
}

const DEFAULT_DILEMMAS: EthicsDilemmaConfig[] = [
  {
    id: "bias",
    scenario: "Un outil génère un résumé contenant des stéréotypes.",
    options: [
      {
        id: "ignore",
        label: "Ignorer",
        feedback: "Risque d'amplifier le biais et de diffuser une erreur.",
        score: 0,
      },
      {
        id: "correct",
        label: "Corriger et justifier",
        feedback: "Bonne pratique: signalez et corrigez les biais.",
        score: 100,
      },
      {
        id: "question",
        label: "Demander des explications",
        feedback: "Utile, mais sans correction le risque demeure.",
        score: 60,
      },
    ],
  },
  {
    id: "sensitive",
    scenario: "Un modèle révèle des données sensibles dans un exemple.",
    options: [
      {
        id: "ignore",
        label: "Ignorer",
        feedback: "Non conforme à la protection des données.",
        score: 0,
      },
      {
        id: "remove",
        label: "Supprimer et anonymiser",
        feedback: "Conforme aux bonnes pratiques.",
        score: 100,
      },
      {
        id: "ask",
        label: "Demander justification",
        feedback: "Insuffisant sans retrait immédiat.",
        score: 40,
      },
    ],
  },
];

export const DEFAULT_ETHICS_DILEMMAS_CONFIG: EthicsDilemmasModuleConfig = {
  type: "ethics-dilemmas",
  title: "Réagissez à des dilemmes éthiques",
  introduction:
    "Choisissez la meilleure réponse pour limiter les dérives et renforcer la responsabilité.",
  dilemmas: DEFAULT_DILEMMAS,
  concludeLabel: "Voir mon score",
};

function sanitizeDilemmas(
  dilemmas: EthicsDilemmaConfig[] | undefined
): EthicsDilemmaConfig[] {
  if (!Array.isArray(dilemmas) || dilemmas.length === 0) {
    return DEFAULT_DILEMMAS.map((dilemma) => ({
      ...dilemma,
      options: dilemma.options.map((option) => ({ ...option })),
    }));
  }
  return dilemmas.map((dilemma, index) => ({
    id: typeof dilemma.id === "string" ? dilemma.id : `dilemma-${index + 1}`,
    scenario:
      typeof dilemma.scenario === "string"
        ? dilemma.scenario
        : DEFAULT_DILEMMAS[index % DEFAULT_DILEMMAS.length].scenario,
    options:
      Array.isArray(dilemma.options) && dilemma.options.length
        ? dilemma.options.map((option, optionIndex) => ({
            id:
              typeof option?.id === "string" && option.id.trim()
                ? option.id.trim()
                : `${index + 1}-${optionIndex + 1}`,
            label:
              typeof option?.label === "string"
                ? option.label
                : DEFAULT_DILEMMAS[index % DEFAULT_DILEMMAS.length].options[
                    optionIndex % DEFAULT_DILEMMAS[index % DEFAULT_DILEMMAS.length].options.length
                  ].label,
            feedback:
              typeof option?.feedback === "string"
                ? option.feedback
                : DEFAULT_DILEMMAS[index % DEFAULT_DILEMMAS.length].options[
                    optionIndex % DEFAULT_DILEMMAS[index % DEFAULT_DILEMMAS.length].options.length
                  ].feedback,
            score:
              typeof option?.score === "number"
                ? option.score
                : DEFAULT_DILEMMAS[index % DEFAULT_DILEMMAS.length].options[
                    optionIndex % DEFAULT_DILEMMAS[index % DEFAULT_DILEMMAS.length].options.length
                  ].score,
          }))
        : DEFAULT_DILEMMAS[index % DEFAULT_DILEMMAS.length].options.map((option) => ({
            ...option,
          })),
  }));
}

function sanitizeEthicsConfig(config: unknown): EthicsDilemmasModuleConfig {
  if (!config || typeof config !== "object") {
    return { ...DEFAULT_ETHICS_DILEMMAS_CONFIG };
  }
  const base = config as Partial<EthicsDilemmasModuleConfig>;
  return {
    type: "ethics-dilemmas",
    title:
      typeof base.title === "string"
        ? base.title
        : DEFAULT_ETHICS_DILEMMAS_CONFIG.title,
    introduction:
      typeof base.introduction === "string"
        ? base.introduction
        : DEFAULT_ETHICS_DILEMMAS_CONFIG.introduction,
    concludeLabel:
      typeof base.concludeLabel === "string"
        ? base.concludeLabel
        : DEFAULT_ETHICS_DILEMMAS_CONFIG.concludeLabel,
    dilemmas: sanitizeDilemmas(base.dilemmas),
  };
}

function EthicsDilemmasModule({
  config,
  payload,
  onAdvance,
  isEditMode,
  onUpdateConfig,
}: ExplorateurIAModuleProps) {
  const typedConfig = useMemo(() => sanitizeEthicsConfig(config), [config]);
  const dilemmas = typedConfig.dilemmas;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<EthicsDilemmasResult["answers"]>(() => {
    if (payload && typeof payload === "object") {
      const result = payload as EthicsDilemmasResult;
      if (Array.isArray(result.answers)) {
        return [...result.answers];
      }
    }
    return [];
  });

  const current = dilemmas[index] ?? dilemmas[dilemmas.length - 1];

  const handleSelect = useCallback(
    (option: EthicsDilemmaOptionConfig) => {
      const nextAnswers = [...answers, {
        dilemmaId: current.id,
        optionId: option.id,
        score: option.score,
      }];
      if (index + 1 >= dilemmas.length) {
        const average =
          nextAnswers.reduce((total, entry) => total + entry.score, 0) /
          nextAnswers.length;
        onAdvance({
          answers: nextAnswers,
          averageScore: Math.round(average),
        });
        setAnswers(nextAnswers);
        return;
      }
      setAnswers(nextAnswers);
      setIndex(index + 1);
    },
    [answers, current.id, dilemmas.length, index, onAdvance]
  );

  const handleReset = useCallback(() => {
    setIndex(0);
    setAnswers([]);
  }, []);

  const handleUpdateDilemma = useCallback(
    (dilemmaIndex: number, patch: Partial<EthicsDilemmaConfig>) => {
      const nextDilemmas = dilemmas.map((dilemma, index) =>
        index === dilemmaIndex ? { ...dilemma, ...patch } : dilemma
      );
      onUpdateConfig({ ...typedConfig, dilemmas: nextDilemmas });
    },
    [dilemmas, onUpdateConfig, typedConfig]
  );

  const handleOptionChange = useCallback(
    (
      dilemmaIndex: number,
      optionIndex: number,
      field: keyof EthicsDilemmaOptionConfig,
      value: string
    ) => {
      const nextDilemmas = dilemmas.map((dilemma, index) => {
        if (index !== dilemmaIndex) return dilemma;
        const nextOptions = dilemma.options.map((option, optIndex) => {
          if (optIndex !== optionIndex) return option;
          if (field === "score") {
            const parsed = Number.parseInt(value, 10);
            return {
              ...option,
              score: Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(100, parsed)),
            };
          }
          return { ...option, [field]: value };
        });
        return { ...dilemma, options: nextOptions };
      });
      onUpdateConfig({ ...typedConfig, dilemmas: nextDilemmas });
    },
    [dilemmas, onUpdateConfig, typedConfig]
  );

  if (isEditMode) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Titre</span>
            <input
              className="w-full rounded-md border border-slate-300 p-2"
              value={typedConfig.title ?? ""}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                onUpdateConfig({ ...typedConfig, title: event.target.value })
              }
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Introduction</span>
            <textarea
              className="h-24 w-full rounded-md border border-slate-300 p-2"
              value={typedConfig.introduction ?? ""}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                onUpdateConfig({
                  ...typedConfig,
                  introduction: event.target.value,
                })
              }
            />
          </label>
        </div>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Texte du bouton final</span>
          <input
            className="w-full rounded-md border border-slate-300 p-2"
            value={typedConfig.concludeLabel ?? ""}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onUpdateConfig({ ...typedConfig, concludeLabel: event.target.value })
            }
          />
        </label>
        <div className="space-y-4">
          {dilemmas.map((dilemma, dilemmaIndex) => (
            <div
              key={dilemma.id}
              className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">
                  Dilemme {dilemmaIndex + 1} — {dilemma.id}
                </h3>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">Identifiant</span>
                <input
                  className="w-full rounded-md border border-slate-300 p-2"
                  value={dilemma.id}
                  onChange={(event) =>
                    handleUpdateDilemma(dilemmaIndex, { id: event.target.value })
                  }
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">Scénario</span>
                <textarea
                  className="h-24 w-full rounded-md border border-slate-300 p-2"
                  value={dilemma.scenario}
                  onChange={(event) =>
                    handleUpdateDilemma(dilemmaIndex, {
                      scenario: event.target.value,
                    })
                  }
                />
              </label>
              <div className="space-y-3">
                {dilemma.options.map((option, optionIndex) => (
                  <div
                    key={option.id}
                    className="rounded-xl border border-slate-200 p-3"
                  >
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="block space-y-1 text-sm">
                        <span className="font-medium text-slate-600">Identifiant</span>
                        <input
                          className="w-full rounded-md border border-slate-300 p-2"
                          value={option.id}
                          onChange={(event) =>
                            handleOptionChange(
                              dilemmaIndex,
                              optionIndex,
                              "id",
                              event.target.value
                            )
                          }
                        />
                      </label>
                      <label className="block space-y-1 text-sm">
                        <span className="font-medium text-slate-600">Libellé</span>
                        <input
                          className="w-full rounded-md border border-slate-300 p-2"
                          value={option.label}
                          onChange={(event) =>
                            handleOptionChange(
                              dilemmaIndex,
                              optionIndex,
                              "label",
                              event.target.value
                            )
                          }
                        />
                      </label>
                      <label className="block space-y-1 text-sm">
                        <span className="font-medium text-slate-600">Score</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          className="w-full rounded-md border border-slate-300 p-2"
                          value={option.score}
                          onChange={(event) =>
                            handleOptionChange(
                              dilemmaIndex,
                              optionIndex,
                              "score",
                              event.target.value
                            )
                          }
                        />
                      </label>
                    </div>
                    <label className="mt-3 block space-y-1 text-sm">
                      <span className="font-medium text-slate-600">Feedback</span>
                      <textarea
                        className="h-20 w-full rounded-md border border-slate-300 p-2"
                        value={option.feedback}
                        onChange={(event) =>
                          handleOptionChange(
                            dilemmaIndex,
                            optionIndex,
                            "feedback",
                            event.target.value
                          )
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!current) {
    return null;
  }

  const score = answers.reduce((total, entry) => total + entry.score, 0);
  const average = answers.length ? Math.round(score / answers.length) : 0;

  return (
    <div className="space-y-4">
      {typedConfig.title ? (
        <h2 className="text-lg font-semibold text-slate-900">{typedConfig.title}</h2>
      ) : null}
      {typedConfig.introduction ? (
        <p className="text-sm text-slate-600">{typedConfig.introduction}</p>
      ) : null}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between text-xs text-slate-500">
          <span>
            Situation {index + 1} / {dilemmas.length}
          </span>
          <span className="font-semibold text-emerald-600">
            Score moyen : {average}
          </span>
        </div>
        <p className="mt-2 text-base text-slate-700">{current.scenario}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {current.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => handleSelect(option)}
            className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50"
          >
            <div className="text-sm font-semibold text-slate-800">{option.label}</div>
            <p className="mt-2 text-xs text-slate-600">{option.feedback}</p>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <div>
          Réponses données :
          <span className="ml-2 font-semibold text-slate-700">
            {answers.length} / {dilemmas.length}
          </span>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-full border border-slate-300 px-3 py-1 font-semibold text-slate-600 hover:bg-slate-100"
        >
          Recommencer
        </button>
      </div>
    </div>
  );
}

registerExplorateurIAModule("ethics-dilemmas", EthicsDilemmasModule);
