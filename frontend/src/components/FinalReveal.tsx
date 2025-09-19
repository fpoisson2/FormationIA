import { useMemo, useState } from "react";
import type { Mission, StageRecord, TableMenuDayValue, TableMenuFullValue } from "../api";
import ChatBubble from "./ChatBubble";

interface FinalRevealProps {
  mission: Mission;
  records: StageRecord[];
  onReplay: () => void;
  onBack: () => void;
  onNextMission?: () => void;
  onFinish?: () => void | Promise<void>;
}
function FinalReveal({ mission, records, onReplay, onBack, onNextMission, onFinish }: FinalRevealProps): JSX.Element {
  const [showDebrief, setShowDebrief] = useState(true);
  const [isFinishing, setIsFinishing] = useState(false);
  const checklistLines = useMemo(() => mission.revelation.split("\\n"), [mission.revelation]);

  return (
    <div className="space-y-8">
      {showDebrief && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-3xl rounded-3xl bg-white p-8 shadow-2xl">
            <ChatBubble
              role="ai"
              title="Mission accomplie !"
              bubbleClassName="bg-white text-[color:var(--brand-black)] border border-[color:var(--brand-red)]/30 shadow-xl"
              containerClassName="w-full"
              chipClassName="bg-[color:var(--brand-red)]/15 text-[color:var(--brand-red)]"
            >
              <h2 className="text-xl font-semibold">Pourquoi tout cadrer dès le départ&nbsp;?</h2>
              <p>
                Quand le brief est incomplet, l’IA doit deviner les attentes message après message. En donnant dès la première requête tous les critères essentiels (format, structure, contraintes), tu limites les itérations inutiles, gagnes du temps et évites les malentendus.
              </p>
              <p className="text-sm text-[color:var(--brand-charcoal)]/80">
                Astuce&nbsp;: reformule la demande en checklist avant de lancer l’IA pour repérer les angles morts (données manquantes, format de sortie, tonalité, validations).
              </p>
              <div className="mt-4 space-y-2 rounded-2xl bg-[color:var(--brand-sand)]/70 p-4">
                <h3 className="text-sm font-semibold text-[color:var(--brand-black)]">Checklist idéale</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-[color:var(--brand-charcoal)]">
                  {checklistLines.map((line, index) => (
                    <li key={`check-${index}`}>{line.replace(/^[-•]\s*/, "")}</li>
                  ))}
                </ul>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  className="cta-button cta-button--primary disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setShowDebrief(false)}
                  disabled={isFinishing}
                >
                  Fermer le débrief
                </button>
                <button
                  type="button"
                  className="cta-button cta-button--light disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    setShowDebrief(false);
                    onReplay();
                  }}
                  disabled={isFinishing}
                >
                  Rejouer cette mission
                </button>
                {onNextMission ? (
                  <button
                    type="button"
                    className="cta-button cta-button--light disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      setShowDebrief(false);
                      onNextMission();
                    }}
                    disabled={isFinishing}
                  >
                    Mission suivante
                  </button>
                ) : null}
                <button
                  type="button"
                  className="cta-button cta-button--light disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={async () => {
                    if (isFinishing) {
                      return;
                    }
                    setIsFinishing(true);
                    try {
                      if (onFinish) {
                        await onFinish();
                      }
                    } catch (error) {
                      console.error("Unable to finalize mission", error);
                    } finally {
                      setShowDebrief(false);
                      onBack();
                      setIsFinishing(false);
                    }
                  }}
                  disabled={isFinishing}
                >
                  Retour à l’accueil
                </button>
              </div>
            </ChatBubble>
          </div>
        </div>
      )}
      <header className="space-y-3 text-center">
        <span className="brand-chip">Révélation finale</span>
        <h2 className="text-3xl font-semibold text-[color:var(--brand-black)]">
          {mission.summary_hint}
        </h2>
        <p className="mx-auto max-w-2xl text-sm text-[color:var(--brand-charcoal)]">
          Voici comment ton brief évolue d’une manche à l’autre. Compare avec la checklist finale
          pour voir ce qui manquait dès le départ.
        </p>
      </header>

      <section className="space-y-6">
        <div className="space-y-4">
          {records.map((entry) => {
            const stage = mission.stages[entry.stageIndex];
            return (
              <article key={entry.stageIndex} className="space-y-3 rounded-3xl border border-white/60 bg-white/90 p-6 shadow-sm">
                <header className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-red)]">
                    Manche {entry.stageIndex + 1}
                  </span>
                </header>
                <p className="text-sm font-semibold text-[color:var(--brand-black)]">{stage.prompt}</p>
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
                          <div key={field.id}>
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
                              {field.label}
                            </h4>
                            <p className="mt-1 rounded-2xl bg-[color:var(--brand-sand)]/70 p-3 leading-relaxed">
                              {text}
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
              </article>
            );
          })}
        </div>
        <aside className="space-y-4 rounded-3xl border border-white/60 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-[color:var(--brand-black)]">Ce que tu as répondu</h3>
          <p className="text-sm text-[color:var(--brand-charcoal)]/80">
            Analyse comment ta réponse finale se compare à la checklist idéale présentée dans la fenêtre de fin. Les éléments manquants sont autant d’indices sur les détails à clarifier dès le départ.
          </p>
        </aside>
      </section>

      <div className="flex flex-wrap items-center justify-center gap-4">
        <button type="button" className="cta-button cta-button--primary" onClick={onReplay}>
          Rejouer la mission
        </button>
        <button type="button" className="cta-button cta-button--light" onClick={onBack}>
          Changer de mission
        </button>
      </div>
    </div>
  );
}

export default FinalReveal;
