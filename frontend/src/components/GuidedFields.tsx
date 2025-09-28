import { Fragment } from "react";
import type {
  FieldSpec,
  FieldValue,
  StageAnswer,
  TableMenuDayValue,
  TableMenuFullValue,
  TableMenuFullMealValue,
  MultipleChoiceFieldSpec,
  SingleChoiceFieldSpec,
} from "../api";

type FieldCorrection = {
  expectedValues: string[];
  selectedValues: string[];
  isCorrect: boolean;
};

interface GuidedFieldsProps {
  fields: FieldSpec[];
  values: StageAnswer;
  onChange: (fieldId: string, value: FieldValue) => void;
  errors: Record<string, string>;
  corrections?: Record<string, FieldCorrection>;
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function ensureArray(value: FieldValue, minSize = 1): string[] {
  const parsed = Array.isArray(value) ? [...(value as string[])] : [];
  const target = Math.max(minSize, 1);
  while (parsed.length < target) {
    parsed.push("");
  }
  if (parsed.length === 0) {
    parsed.push("");
  }
  return parsed;
}

function formatChoiceLabels(
  values: string[],
  options: SingleChoiceFieldSpec["options"]
): string[] {
  const optionMap = new Map(options.map((option) => [option.value, option.label]));
  const seen = new Set<string>();
  const labels: string[] = [];
  values.forEach((value) => {
    const label = optionMap.get(value) ?? value;
    if (!label || seen.has(label)) {
      return;
    }
    seen.add(label);
    labels.push(label);
  });
  return labels;
}

function GuidedFields({
  fields,
  values,
  onChange,
  errors,
  corrections,
}: GuidedFieldsProps): JSX.Element {
  return (
    <div className="space-y-6">
      {fields.map((field) => {
        const error = errors[field.id];
        const correction = corrections?.[field.id];
        switch (field.type) {
          case "single_choice": {
            const { options } = field as SingleChoiceFieldSpec;
            const selected = typeof values[field.id] === "string" ? (values[field.id] as string) : "";
            const expectedLabels = correction
              ? formatChoiceLabels(correction.expectedValues, options)
              : [];
            const selectedLabels = correction
              ? formatChoiceLabels(correction.selectedValues, options)
              : [];
            return (
              <fieldset key={field.id} className="space-y-3">
                <legend className="text-sm font-semibold text-[color:var(--brand-black)]">
                  {field.label}
                </legend>
                <div className="space-y-2">
                  {options.map((option) => {
                    const isChecked = selected === option.value;
                    return (
                      <label
                        key={option.value}
                        className={`flex w-full cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                          isChecked
                            ? "border-[color:var(--brand-red)] bg-[color:var(--brand-red)]/5"
                            : "border-slate-200 hover:border-[color:var(--brand-red)]/60"
                        }`}
                      >
                        <input
                          type="radio"
                          name={field.id}
                          value={option.value}
                          checked={isChecked}
                          onChange={() => onChange(field.id, option.value)}
                          className="mt-1 h-4 w-4 shrink-0 text-[color:var(--brand-red)] focus:ring-[color:var(--brand-red)]"
                        />
                        <span className="flex-1">
                          <span className="font-medium text-[color:var(--brand-black)]">
                            {option.label}
                          </span>
                          {option.description && (
                            <span className="mt-1 block text-xs text-[color:var(--brand-charcoal)]/80">
                              {option.description}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
                {correction && expectedLabels.length > 0 && (
                  <p
                    className={`text-xs font-semibold ${
                      correction.isCorrect
                        ? "text-emerald-600"
                        : "text-[color:var(--brand-red)]"
                    }`}
                  >
                    {correction.isCorrect
                      ? `Bonne réponse ! ${expectedLabels.join(", ")}`
                      : `Correction : ${expectedLabels.join(", ")} · Ta réponse : ${
                          selectedLabels.length > 0 ? selectedLabels.join(", ") : "aucune"
                        }`}
                  </p>
                )}
              </fieldset>
            );
          }
          case "multiple_choice": {
            const spec = field as MultipleChoiceFieldSpec;
            const options = spec.options;
            const rawSelection = Array.isArray(values[field.id])
              ? ((values[field.id] as string[]).filter((item) => typeof item === "string").slice())
              : [];
            const selected = new Set(rawSelection);
            const expectedLabels = correction
              ? formatChoiceLabels(correction.expectedValues, options)
              : [];
            const selectedLabels = correction
              ? formatChoiceLabels(correction.selectedValues, options)
              : [];
            const toggleValue = (value: string) => {
              const next = new Set(selected);
              if (next.has(value)) {
                next.delete(value);
              } else {
                next.add(value);
              }
              const ordered = options
                .map((option) => option.value)
                .filter((optionValue) => next.has(optionValue));
              onChange(field.id, ordered);
            };
            return (
              <fieldset key={field.id} className="space-y-3">
                <legend className="text-sm font-semibold text-[color:var(--brand-black)]">
                  {field.label}
                </legend>
                <div className="space-y-2">
                  {options.map((option) => {
                    const isChecked = selected.has(option.value);
                    return (
                      <label
                        key={option.value}
                        className={`flex w-full cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                          isChecked
                            ? "border-[color:var(--brand-red)] bg-[color:var(--brand-red)]/5"
                            : "border-slate-200 hover:border-[color:var(--brand-red)]/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          value={option.value}
                          checked={isChecked}
                          onChange={() => toggleValue(option.value)}
                          className="mt-1 h-4 w-4 shrink-0 rounded text-[color:var(--brand-red)] focus:ring-[color:var(--brand-red)]"
                        />
                        <span className="flex-1">
                          <span className="font-medium text-[color:var(--brand-black)]">
                            {option.label}
                          </span>
                          {option.description && (
                            <span className="mt-1 block text-xs text-[color:var(--brand-charcoal)]/80">
                              {option.description}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {(spec.minSelections || spec.maxSelections) && (
                  <p className="text-xs text-[color:var(--brand-charcoal)]/70">
                    {spec.minSelections
                      ? `Sélectionne au moins ${spec.minSelections} option${spec.minSelections > 1 ? "s" : ""}`
                      : null}
                    {spec.minSelections && spec.maxSelections ? " · " : null}
                    {spec.maxSelections
                      ? `Maximum ${spec.maxSelections} option${spec.maxSelections > 1 ? "s" : ""}`
                      : null}
                  </p>
                )}
                {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
                {correction && expectedLabels.length > 0 && (
                  <p
                    className={`text-xs font-semibold ${
                      correction.isCorrect
                        ? "text-emerald-600"
                        : "text-[color:var(--brand-red)]"
                    }`}
                  >
                    {correction.isCorrect
                      ? `Bonnes réponses ! ${expectedLabels.join(", ")}`
                      : `Correction : ${expectedLabels.join(", ")} · Ta réponse : ${
                          selectedLabels.length > 0 ? selectedLabels.join(", ") : "aucune"
                        }`}
                  </p>
                )}
              </fieldset>
            );
          }
          case "bulleted_list": {
            const currentBullets = ensureArray(values[field.id], field.minBullets);
            const canAdd = currentBullets.length < Math.min(field.maxBullets, 5);
            return (
              <div key={field.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-[color:var(--brand-black)]">
                    {field.label}
                  </label>
                  <span className="text-xs text-[color:var(--brand-charcoal)]/80">
                    {field.minBullets} à {field.maxBullets} puces · {field.maxWordsPerBullet} mots max
                  </span>
                </div>
                <div className="space-y-2">
                  {currentBullets.map((bullet, index) => (
                    <div key={`${field.id}-${index}`} className="flex items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-red)]/10 text-xs font-semibold text-[color:var(--brand-red)]">
                        {index + 1}
                      </span>
                      <input
                        type="text"
                        value={bullet}
                        onChange={(event) => {
                          const updated = [...currentBullets];
                          updated[index] = event.target.value;
                          onChange(field.id, updated);
                        }}
                        maxLength={80}
                        className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none"
                        placeholder="Entrer une idée concise"
                      />
                      {currentBullets.length > field.minBullets && (
                        <button
                          type="button"
                          className="rounded-full border border-transparent bg-slate-100 px-3 py-2 text-xs font-semibold text-[color:var(--brand-charcoal)]/80 transition hover:bg-slate-200"
                          onClick={() => {
                            const updated = currentBullets.filter((_, idx) => idx !== index);
                            onChange(field.id, updated);
                          }}
                        >
                          Retirer
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {canAdd && (
                  <button
                    type="button"
                    className="cta-button cta-button--light"
                    onClick={() => onChange(field.id, [...currentBullets, ""])}
                  >
                    Ajouter une puce
                  </button>
                )}
                {field.mustContainAny && field.mustContainAny.length > 0 && (
                  <p className="text-xs text-[color:var(--brand-charcoal)]/70">
                    Glisse un ingrédient de la liste dans chaque puce&nbsp;:
                    {" "}
                    {field.mustContainAny.join(", ")}
                  </p>
                )}
                {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
              </div>
            );
          }
          case "table_menu_day": {
            const current: TableMenuDayValue = (values[field.id] as TableMenuDayValue) ?? {};
            const meals = field.meals;
            return (
              <div key={field.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-[color:var(--brand-black)]">
                    {field.label}
                  </label>
                  <span className="text-xs text-[color:var(--brand-charcoal)]/80">1 à 4 mots par plat</span>
                </div>
                <div className="flex flex-col gap-3 md:hidden">
                  {meals.map((meal) => (
                    <div key={meal} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                      <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                        {meal}
                      </p>
                      <input
                        type="text"
                        value={current[meal] ?? ""}
                        onChange={(event) => {
                          onChange(field.id, { ...current, [meal]: event.target.value });
                        }}
                        maxLength={80}
                        className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                        placeholder="Plat"
                      />
                    </div>
                  ))}
                </div>
                <div className="hidden w-full overflow-hidden rounded-2xl border border-slate-200 md:block">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <tbody>
                      {meals.map((meal) => (
                        <tr key={meal} className="divide-x divide-slate-200">
                          <th className="w-32 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]">
                            {meal}
                          </th>
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={current[meal] ?? ""}
                              onChange={(event) => {
                                onChange(field.id, { ...current, [meal]: event.target.value });
                              }}
                              maxLength={80}
                              className="w-full rounded-full border border-slate-200 px-4 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                              placeholder="Plat"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
              </div>
            );
          }
          case "table_menu_full": {
            const current: TableMenuFullValue = (values[field.id] as TableMenuFullValue) ?? {};
            const meals = field.meals;
            return (
              <div key={field.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-[color:var(--brand-black)]">
                    {field.label}
                  </label>
                  <span className="text-xs text-[color:var(--brand-charcoal)]/80">1 à 4 mots par cellule</span>
                </div>
                <div className="flex flex-col gap-3 md:hidden">
                  {meals.map((meal) => {
                    const value: TableMenuFullMealValue = current[meal] ?? {
                      plat: "",
                      boisson: "",
                      dessert: "",
                    };
                    return (
                      <div key={meal} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                          {meal}
                        </p>
                        <div className="mt-2 space-y-3 text-sm">
                          {(["plat", "boisson", "dessert"] as const).map((column) => (
                            <label
                              key={column}
                              className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70"
                            >
                              {column.charAt(0).toUpperCase() + column.slice(1)}
                              <input
                                type="text"
                                value={value[column]}
                                onChange={(event) => {
                                  onChange(field.id, {
                                    ...current,
                                    [meal]: {
                                      ...value,
                                      [column]: event.target.value,
                                    },
                                  });
                                }}
                                maxLength={80}
                                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                                placeholder={column.charAt(0).toUpperCase() + column.slice(1)}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="hidden w-full overflow-hidden rounded-2xl border border-slate-200 md:block">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]">
                      <tr>
                        <th className="px-4 py-3 text-left">Repas</th>
                        <th className="px-4 py-3 text-left">Plat</th>
                        <th className="px-4 py-3 text-left">Boisson</th>
                        <th className="px-4 py-3 text-left">Dessert</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meals.map((meal) => {
                        const value: TableMenuFullMealValue = current[meal] ?? {
                          plat: "",
                          boisson: "",
                          dessert: "",
                        };
                        return (
                          <tr key={meal} className="divide-x divide-slate-200">
                            <th className="bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]">
                              {meal}
                            </th>
                            {(["plat", "boisson", "dessert"] as const).map((column) => (
                              <td key={column} className="px-4 py-3">
                                <input
                                  type="text"
                                  value={value[column]}
                                  onChange={(event) => {
                                    onChange(field.id, {
                                      ...current,
                                      [meal]: {
                                        ...value,
                                        [column]: event.target.value,
                                      },
                                    });
                                  }}
                                  maxLength={80}
                                  className="w-full rounded-full border border-slate-200 px-4 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                                  placeholder={column.charAt(0).toUpperCase() + column.slice(1)}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
              </div>
            );
          }
          case "textarea_with_counter": {
            const value = typeof values[field.id] === "string" ? (values[field.id] as string) : "";
            const words = countWords(value);
            return (
              <div key={field.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-[color:var(--brand-black)]">
                    {field.label}
                  </label>
                  <span className="text-xs text-[color:var(--brand-charcoal)]/80">
                    {words} mots · cible {field.minWords}-{field.maxWords}
                  </span>
                </div>
                <textarea
                  value={value}
                  onChange={(event) => onChange(field.id, event.target.value)}
                  rows={6}
                  className="w-full rounded-3xl border border-slate-200 px-5 py-4 text-sm leading-relaxed text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none"
                  placeholder="Rédige ta réponse ici"
                />
                {field.forbidWords && field.forbidWords.length > 0 && (
                  <p className="text-xs text-[color:var(--brand-charcoal)]/70">
                    Évite les mots : {field.forbidWords.join(", ")}
                  </p>
                )}
                {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
              </div>
            );
          }
          case "two_bullets": {
            const bullets = ensureArray(values[field.id], 2).slice(0, 2);
            return (
              <div key={field.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-[color:var(--brand-black)]">
                    {field.label}
                  </label>
                  <span className="text-xs text-[color:var(--brand-charcoal)]/80">
                    2 puces · {field.maxWordsPerBullet} mots max
                  </span>
                </div>
                <div className="space-y-2">
                  {bullets.map((bullet, index) => (
                    <div key={`${field.id}-${index}`} className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-charcoal)]/10 text-xs font-semibold text-[color:var(--brand-charcoal)]">
                        {index + 1}
                      </span>
                      <input
                        type="text"
                        value={bullet}
                        onChange={(event) => {
                          const updated = [...bullets];
                          updated[index] = event.target.value;
                          onChange(field.id, updated);
                        }}
                        maxLength={80}
                        className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none"
                        placeholder="Idée clé"
                      />
                    </div>
                  ))}
                </div>
                {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
              </div>
            );
          }
          case "reference_line": {
            const value = typeof values[field.id] === "string" ? (values[field.id] as string) : "";
            return (
              <div key={field.id} className="space-y-2">
                <label className="text-sm font-semibold text-[color:var(--brand-black)]">
                  {field.label}
                </label>
                <input
                  type="text"
                  value={value}
                  onChange={(event) => onChange(field.id, event.target.value)}
                  maxLength={80}
                  className="w-full rounded-full border border-slate-200 px-4 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none"
                  placeholder="Dupont, 2024"
                />
                <p className="text-xs text-[color:var(--brand-charcoal)]/70">
                  Format attendu&nbsp;: Auteur, 20xx
                </p>
                {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
              </div>
            );
          }
          default:
            return <Fragment key={field.id} />;
        }
      })}
    </div>
  );
}

export default GuidedFields;
