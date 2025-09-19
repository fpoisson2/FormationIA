import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BulletedListFieldSpec,
  FieldSpec,
  FieldValue,
  Mission,
  StageAnswer,
  StageRecord,
  TableMenuDayValue,
  TableMenuFullValue,
  TextareaWithCounterFieldSpec,
  TwoBulletsFieldSpec,
} from "../api";
import GuidedFields from "./GuidedFields";
import ChatBubble from "./ChatBubble";

interface PromptStageProps {
  mission: Mission;
  stageIndex: number;
  history: StageRecord[];
  initialValues?: StageAnswer;
  onSubmit: (values: StageAnswer) => Promise<void>;
  onBack: () => void;
  isSubmitting: boolean;
  serverError?: string;
}

const REFERENCE_PATTERN = /^[A-ZÉÈÎÂ][a-zéèêîïâä' -]+,\s*20\d{2}$/;

function createInitialValues(stageFields: FieldSpec[]): StageAnswer {
  const values: StageAnswer = {};
  stageFields.forEach((field) => {
    switch (field.type) {
      case "bulleted_list": {
        const spec = field as BulletedListFieldSpec;
        const bullets = Array.from({ length: Math.max(spec.minBullets, 1) }, () => "");
        values[field.id] = bullets;
        break;
      }
      case "table_menu_day": {
        const table: TableMenuDayValue = {};
        field.meals.forEach((meal) => {
          table[meal] = "";
        });
        values[field.id] = table;
        break;
      }
      case "table_menu_full": {
        const table: TableMenuFullValue = {};
        field.meals.forEach((meal) => {
          table[meal] = { plat: "", boisson: "", dessert: "" };
        });
        values[field.id] = table;
        break;
      }
      case "two_bullets": {
        values[field.id] = Array.from({ length: 2 }, () => "");
        break;
      }
      case "textarea_with_counter":
      case "reference_line":
        values[field.id] = "";
        break;
      default:
        values[field.id] = null;
        break;
    }
  });
  return values;
}

function trimWords(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function PromptStage({
  mission,
  stageIndex,
  history,
  initialValues,
  onSubmit,
  onBack,
  isSubmitting,
  serverError,
}: PromptStageProps): JSX.Element {
  const stage = mission.stages[stageIndex];
  const [values, setValues] = useState<StageAnswer>(() => initialValues ?? createInitialValues(stage.fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [displayedPrompt, setDisplayedPrompt] = useState(stage.prompt);
  const [isStreamingPrompt, setIsStreamingPrompt] = useState(false);
  const allowEmpty = stage.allowEmpty ?? false;

  useEffect(() => {
    setValues(initialValues ?? createInitialValues(stage.fields));
    setErrors({});
  }, [initialValues, stage.fields, stageIndex]);

  useEffect(() => {
    const fullPrompt = stage.prompt;
    setDisplayedPrompt("");
    setIsStreamingPrompt(true);

    let index = 0;
    const interval = window.setInterval(() => {
      index += 1;
      setDisplayedPrompt(fullPrompt.slice(0, index));
      if (index >= fullPrompt.length) {
        window.clearInterval(interval);
        setIsStreamingPrompt(false);
      }
    }, 18);

    return () => {
      window.clearInterval(interval);
      setDisplayedPrompt(fullPrompt);
      setIsStreamingPrompt(false);
    };
  }, [stage.prompt, stageIndex]);

  const handleValueChange = useCallback((fieldId: string, value: FieldValue) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const sanitizeValues = useCallback(
    (fields: FieldSpec[], current: StageAnswer): StageAnswer => {
      const sanitized: StageAnswer = {};
      fields.forEach((field) => {
        const value = current[field.id];
        switch (field.type) {
          case "bulleted_list": {
            const bullets = Array.isArray(value) ? (value as string[]) : [];
            sanitized[field.id] = bullets.map((item) => trimWords(item));
            break;
          }
          case "two_bullets": {
            const bullets = Array.isArray(value) ? (value as string[]) : [];
            sanitized[field.id] = bullets.map((item) => trimWords(item));
            break;
          }
          case "table_menu_day": {
            const table = (value as TableMenuDayValue) ?? {};
            const normalized: TableMenuDayValue = {};
            field.meals.forEach((meal) => {
              normalized[meal] = trimWords(table[meal] ?? "");
            });
            sanitized[field.id] = normalized;
            break;
          }
          case "table_menu_full": {
            const table = (value as TableMenuFullValue) ?? {};
            const normalized: TableMenuFullValue = {};
            field.meals.forEach((meal) => {
              const row = table[meal] ?? { plat: "", boisson: "", dessert: "" };
              normalized[meal] = {
                plat: trimWords(row.plat ?? ""),
                boisson: trimWords(row.boisson ?? ""),
                dessert: trimWords(row.dessert ?? ""),
              };
            });
            sanitized[field.id] = normalized;
            break;
          }
          case "textarea_with_counter": {
            const text = typeof value === "string" ? (value as string) : "";
            sanitized[field.id] = text.trim();
            break;
          }
          case "reference_line": {
            const text = typeof value === "string" ? (value as string) : "";
            sanitized[field.id] = trimWords(text);
            break;
          }
          default:
            sanitized[field.id] = value;
        }
      });
      return sanitized;
    },
    []
  );

  const validate = useCallback(
    (fields: FieldSpec[], current: StageAnswer): Record<string, string> => {
      const fieldErrors: Record<string, string> = {};
      fields.forEach((field) => {
        const value = current[field.id];
        switch (field.type) {
          case "bulleted_list": {
            const spec = field as BulletedListFieldSpec;
            const bullets = Array.isArray(value)
              ? (value as string[]).map((item) => (typeof item === "string" ? item : ""))
              : [];
            const filtered = bullets.filter((item) => item.length > 0);
            if (filtered.length < spec.minBullets || filtered.length > spec.maxBullets) {
              fieldErrors[field.id] = `Ajoute ${spec.minBullets}-${spec.maxBullets} puces complètes.`;
              break;
            }
            const invalid = bullets.find((item) => item.length === 0);
            if (invalid !== undefined) {
              fieldErrors[field.id] = "Complète chaque puce.";
              break;
            }
            const wordOverflow = bullets.find((item) => item.split(/\s+/).filter(Boolean).length > spec.maxWordsPerBullet);
            if (wordOverflow) {
              fieldErrors[field.id] = `${spec.maxWordsPerBullet} mots max par puce.`;
              break;
            }
            // Laisser passer même si l'ingrédient est manquant, mais afficher un rappel doux.
            break;
         }
          case "table_menu_day": {
            const table = (value as TableMenuDayValue) ?? {};
            const hasEmpty = field.meals.some((meal) => !(table[meal] && table[meal].length > 0));
            if (hasEmpty) {
              fieldErrors[field.id] = "Complète chaque repas.";
              break;
            }
            const tooLong = field.meals.some((meal) => {
              const text = table[meal] ?? "";
              const wordCount = text.split(/\s+/).filter(Boolean).length;
              return wordCount === 0 || wordCount > 4;
            });
            if (tooLong) {
              fieldErrors[field.id] = "1 à 4 mots par plat.";
            }
            break;
          }
          case "table_menu_full": {
            const table = (value as TableMenuFullValue) ?? {};
            let invalid = false;
            field.meals.forEach((meal) => {
              const row = table[meal] ?? { plat: "", boisson: "", dessert: "" };
              (Object.entries(row) as ["plat" | "boisson" | "dessert", string][]).forEach(([key, text]) => {
                const wordCount = (text ?? "").split(/\s+/).filter(Boolean).length;
                if (wordCount === 0 || wordCount > 4) {
                  invalid = true;
                }
              });
            });
            if (invalid) {
              fieldErrors[field.id] = "Renseigne plat, boisson, dessert (1-4 mots chacun).";
            }
            break;
          }
          case "textarea_with_counter": {
            const spec = field as TextareaWithCounterFieldSpec;
            const text = typeof value === "string" ? (value as string) : "";
            const wordCount = text.split(/\s+/).filter(Boolean).length;
            if (wordCount < spec.minWords || wordCount > spec.maxWords) {
              fieldErrors[field.id] = `Entre ${spec.minWords}-${spec.maxWords} mots.`;
              break;
            }
            if (spec.forbidWords && spec.forbidWords.length > 0) {
              const lowered = text.toLowerCase();
              const banned = spec.forbidWords.find((word) => lowered.includes(word.toLowerCase()));
              if (banned) {
                fieldErrors[field.id] = `Évite le mot « ${banned} ».`;
              }
            }
            break;
          }
          case "two_bullets": {
            const spec = field as TwoBulletsFieldSpec;
            const bullets = Array.isArray(value)
              ? (value as string[]).map((item) => (typeof item === "string" ? item : ""))
              : [];
            if (bullets.length !== 2 || bullets.some((item) => item.length === 0)) {
              fieldErrors[field.id] = "Fournis exactement 2 puces.";
              break;
            }
            const invalid = bullets.find(
              (item) => item.split(/\s+/).filter(Boolean).length === 0 || item.split(/\s+/).filter(Boolean).length > spec.maxWordsPerBullet
            );
            if (invalid) {
              fieldErrors[field.id] = `${spec.maxWordsPerBullet} mots max par puce.`;
            }
            break;
          }
          case "reference_line": {
            const text = typeof value === "string" ? (value as string) : "";
            if (!REFERENCE_PATTERN.test(text)) {
              fieldErrors[field.id] = "Format attendu : Auteur, 20xx.";
            }
            break;
          }
          default:
            break;
        }
      });
      return fieldErrors;
    },
    []
  );

  useEffect(() => {
    if (allowEmpty) {
      setErrors((prev) => (Object.keys(prev).length > 0 ? {} : prev));
      return;
    }
    const sanitized = sanitizeValues(stage.fields, values);
    const fieldErrors = validate(stage.fields, sanitized);
    setErrors((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(fieldErrors);
      if (prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key] === fieldErrors[key])) {
        return prev;
      }
      return fieldErrors;
    });
  }, [allowEmpty, sanitizeValues, stage.fields, validate, values]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const sanitized = sanitizeValues(stage.fields, values);
      const fieldErrors = allowEmpty ? {} : validate(stage.fields, sanitized);
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length > 0) {
        return;
      }
      await onSubmit(sanitized);
    },
    [allowEmpty, onSubmit, sanitizeValues, stage.fields, validate, values]
  );

  const historyEntries = useMemo(
    () => history.filter((entry) => entry.stageIndex < stageIndex),
    [history, stageIndex]
  );

  const renderSummaryValue = useCallback(
    (field: FieldSpec, value: FieldValue) => {
      switch (field.type) {
        case "bulleted_list": {
          const bullets = Array.isArray(value) ? (value as string[]) : [];
          return (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {bullets.map((bullet, index) => (
                <li key={`${field.id}-${index}`}>{bullet}</li>
              ))}
            </ul>
          );
        }
        case "table_menu_day": {
          const table = (value as TableMenuDayValue) || {};
          return (
            <table className="mt-3 min-w-full divide-y divide-white/20 text-xs">
              <tbody>
                {field.meals.map((meal) => (
                  <tr key={meal} className="divide-x divide-white/10">
                    <th className="bg-white/10 px-3 py-2 text-left font-semibold uppercase tracking-wide">
                      {meal}
                    </th>
                    <td className="px-3 py-2">{table[meal] ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        case "table_menu_full": {
          const table = (value as TableMenuFullValue) || {};
          return (
            <table className="mt-3 min-w-full divide-y divide-white/20 text-xs">
              <thead className="bg-white/10">
                <tr>
                  <th className="px-3 py-2 text-left">Repas</th>
                  <th className="px-3 py-2 text-left">Plat</th>
                  <th className="px-3 py-2 text-left">Boisson</th>
                  <th className="px-3 py-2 text-left">Dessert</th>
                </tr>
              </thead>
              <tbody>
                {field.meals.map((meal) => {
                  const row = table[meal] ?? { plat: "—", boisson: "—", dessert: "—" };
                  return (
                    <tr key={meal} className="divide-x divide-white/10">
                      <th className="bg-white/10 px-3 py-2 text-left font-semibold uppercase tracking-wide">
                        {meal}
                      </th>
                      <td className="px-3 py-2">{row.plat || "—"}</td>
                      <td className="px-3 py-2">{row.boisson || "—"}</td>
                      <td className="px-3 py-2">{row.dessert || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        }
        case "textarea_with_counter":
        case "reference_line": {
          const text = typeof value === "string" ? (value as string) : "";
          return <p className="mt-2 rounded-2xl bg-white/10 p-3 text-sm leading-relaxed">{text || "—"}</p>;
        }
        case "two_bullets": {
          const bullets = Array.isArray(value) ? (value as string[]) : [];
          return (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {bullets.map((bullet, index) => (
                <li key={`${field.id}-${index}`}>{bullet}</li>
              ))}
            </ul>
          );
        }
        default:
          return null;
      }
    },
    []
  );

  const promptForDisplay = displayedPrompt.length > 0
    ? displayedPrompt
    : isStreamingPrompt
      ? ""
      : stage.prompt;

  const hasBlockingErrors = !allowEmpty && Object.keys(errors).length > 0;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <span className="brand-chip">Manche {stageIndex + 1} / {mission.stages.length}</span>
            <h2 className="text-2xl font-semibold text-[color:var(--brand-black)]">
              {mission.title}
            </h2>
            <p className="max-w-2xl text-sm text-[color:var(--brand-charcoal)]/80">
              Tu incarnes l’IA Clarté. L’usager affine son brief manche après manche : applique ses nouvelles consignes et observe comment le besoin évolue.
            </p>
          </div>
          <button
            type="button"
            className="cta-button cta-button--light disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onBack}
            disabled={isSubmitting || !allowEmpty}
          >
            Changer de mission
          </button>
        </div>
      </header>

      <section className="space-y-6">
        <div className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-col gap-5 max-h-[60vh] overflow-y-auto pr-2">
            {historyEntries.map((entry) => {
              const pastStage = mission.stages[entry.stageIndex];
              if (!pastStage) {
                return null;
              }
              return (
                <div key={`history-${entry.stageIndex}`} className="space-y-3">
                  <ChatBubble role="ai" title={`Manche ${entry.stageIndex + 1}`}>
                    <p>{pastStage.prompt}</p>
                  </ChatBubble>
                  <ChatBubble role="user">
                    {pastStage.fields.map((field) => (
                      <div key={field.id}>
                        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{field.label}</p>
                        {renderSummaryValue(field, entry.values[field.id])}
                      </div>
                    ))}
                  </ChatBubble>
                </div>
              );
            })}
            <ChatBubble role="ai" title={`Manche ${stageIndex + 1}`} isStreaming={isStreamingPrompt}>
              <p>{promptForDisplay}</p>
            </ChatBubble>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <ChatBubble
            role="user"
            title="À toi de jouer"
            bubbleClassName="bg-white text-[color:var(--brand-black)] border border-[color:var(--brand-red)]/20 shadow-xl md:max-w-none"
            containerClassName="w-full"
            chipClassName="bg-[color:var(--brand-red)]/15 text-[color:var(--brand-red)]"
          >
            <p className="text-xs italic text-[color:var(--brand-charcoal)]/80">{mission.ui_help}</p>
            <GuidedFields fields={stage.fields} values={values} onChange={handleValueChange} errors={errors} />
            {serverError && <p className="text-sm font-semibold text-red-600">{serverError}</p>}
          </ChatBubble>
          <div className="flex items-center justify-end gap-4">
            {isSubmitting && <span className="text-sm text-[color:var(--brand-charcoal)]/80">Envoi…</span>}
            <button
              type="submit"
              className="cta-button cta-button--primary disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSubmitting || hasBlockingErrors}
            >
              {stageIndex === mission.stages.length - 1 ? "Voir la révélation" : "Continuer"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default PromptStage;
