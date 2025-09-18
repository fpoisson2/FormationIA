import type { Mission, StageRecord, TableMenuDayValue, TableMenuFullValue } from "../api";

interface HistoryPanelProps {
  mission: Mission;
  entries: StageRecord[];
}

function HistoryPanel({ mission, entries }: HistoryPanelProps): JSX.Element {
  if (entries.length === 0) {
    return (
      <aside className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-[color:var(--brand-black)]">Historique</h3>
        <p className="mt-2 text-sm text-[color:var(--brand-charcoal)]/80">
          Tes réponses précédentes apparaîtront ici après chaque manche.
        </p>
      </aside>
    );
  }

  return (
    <aside className="space-y-4 rounded-3xl border border-white/60 bg-white/90 p-6 shadow-sm">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]">
        Historique des manches
      </h3>
      <div className="space-y-4">
        {entries.map((entry) => {
          const stage = mission.stages[entry.stageIndex];
          if (!stage) {
            return null;
          }
          return (
            <div key={entry.stageIndex} className="space-y-3 rounded-2xl bg-[color:var(--brand-sand)]/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-red)]">
                  Manche {entry.stageIndex + 1}
                </span>
                <span className="text-xs text-[color:var(--brand-charcoal)]/70">
                  {stage.fields.length} champ(s)
                </span>
              </div>
              <p className="text-sm font-medium text-[color:var(--brand-black)]">{stage.prompt}</p>
              <div className="space-y-3 text-sm text-[color:var(--brand-charcoal)]">
                {stage.fields.map((field) => {
                  const value = entry.values[field.id];
                  switch (field.type) {
                    case "bulleted_list": {
                      const bullets = Array.isArray(value) ? (value as string[]) : [];
                      return (
                        <div key={field.id}>
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
                            {field.label}
                          </h4>
                          <ul className="mt-1 list-disc space-y-1 pl-5">
                            {bullets.map((bullet, index) => (
                              <li key={`${field.id}-${index}`}>{bullet}</li>
                            ))}
                          </ul>
                        </div>
                      );
                    }
                    case "table_menu_day": {
                      const table = (value as TableMenuDayValue) || {};
                      return (
                        <div key={field.id} className="space-y-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
                            {field.label}
                          </h4>
                          <table className="min-w-full divide-y divide-slate-200 text-xs">
                            <tbody>
                              {field.meals.map((meal) => (
                                <tr key={meal} className="divide-x divide-slate-200">
                                  <th className="bg-slate-50 px-3 py-2 text-left font-semibold text-[color:var(--brand-charcoal)]">
                                    {meal}
                                  </th>
                                  <td className="px-3 py-2">{table[meal] ?? "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    }
                    case "table_menu_full": {
                      const table = (value as TableMenuFullValue) || {};
                      return (
                        <div key={field.id} className="space-y-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
                            {field.label}
                          </h4>
                          <table className="min-w-full divide-y divide-slate-200 text-xs">
                            <thead className="bg-slate-50 text-[color:var(--brand-charcoal)]">
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
                                  <tr key={meal} className="divide-x divide-slate-200">
                                    <th className="bg-slate-50 px-3 py-2 text-left font-semibold text-[color:var(--brand-charcoal)]">
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
                        </div>
                      );
                    }
                    case "textarea_with_counter":
                    case "reference_line": {
                      const text = typeof value === "string" ? (value as string) : "";
                      return (
                        <div key={field.id} className="space-y-1">
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
                            {field.label}
                          </h4>
                          <p className="rounded-2xl bg-white/70 p-3 text-sm leading-relaxed">
                            {text || "—"}
                          </p>
                        </div>
                      );
                    }
                    case "two_bullets": {
                      const bullets = Array.isArray(value) ? (value as string[]) : [];
                      return (
                        <div key={field.id}>
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
                            {field.label}
                          </h4>
                          <ul className="mt-1 list-disc space-y-1 pl-5">
                            {bullets.map((bullet, index) => (
                              <li key={`${field.id}-${index}`}>{bullet}</li>
                            ))}
                          </ul>
                        </div>
                      );
                    }
                    default:
                      return null;
                  }
                })}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default HistoryPanel;
