import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import logoPrincipal from "../assets/logo_principal.svg";
import { getProgress, type ProgressResponse } from "../api";

const ACTIVITIES = [
  {
    id: "atelier",
    title: "Atelier comparatif IA",
    description:
      "Objectif : cadrer ta demande, comparer deux configurations IA et capitaliser sur les essais.",
    highlights: [
      "Définir le contexte et les attentes",
      "Tester modèle, verbosité et raisonnement",
      "Assembler une synthèse réutilisable",
    ],
    cta: "Lancer l’atelier",
    to: "/atelier/etape-1",
  },
  {
    id: "prompt-dojo",
    title: "Prompt Dojo — Mission débutant",
    description:
      "Objectif : t’entraîner à affiner une consigne en suivant des défis progressifs.",
    highlights: [
      "Défis à difficulté graduelle",
      "Retour immédiat sur la qualité du prompt",
      "Construction d’une version finale personnalisée",
    ],
    cta: "Entrer dans le dojo",
    to: "/prompt-dojo",
  },
  {
    id: "clarity",
    title: "Parcours de la clarté",
    description:
      "Objectif : expérimenter la précision des consignes sur un parcours 10×10.",
    highlights: [
      "Plan d’action IA généré avant l’animation",
      "Visualisation pas à pas avec obstacles",
      "Analyse des tentatives et du surcoût",
    ],
    cta: "Tester la clarté",
    to: "/parcours-clarte",
  },
  {
    id: "clarte-dabord",
    title: "Clarté d’abord !",
    description:
      "Objectif : mesurer l’impact d’un brief incomplet et révéler la checklist idéale.",
    highlights: [
      "Deux missions thématiques en trois manches",
      "Champs guidés avec validations pédagogiques",
      "Révélation finale et export JSON du menu",
    ],
    cta: "Lancer Clarté d’abord !",
    to: "/clarte-dabord",
  },
];

function ActivitySelector(): JSX.Element {
  const [completedMap, setCompletedMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const loadProgress = async () => {
      try {
        const progress = await getProgress();
        if (!cancelled) {
          const activities = Object.entries(progress.activities ?? {}).reduce<Record<string, boolean>>(
            (acc, [activityId, record]) => {
              acc[activityId] = Boolean(record?.completed);
              return acc;
            },
            {}
          );
          setCompletedMap(activities);
        }
      } catch (error) {
        console.warn("Progress unavailable", error);
      }
    };

    void loadProgress();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="landing-gradient min-h-screen px-6 py-16 text-[color:var(--brand-black)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-12">
        <header className="space-y-6 rounded-3xl border border-white/70 bg-white/90 p-8 shadow-sm backdrop-blur animate-section">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <Link to="/" className="flex items-center gap-3">
              <img src={logoPrincipal} alt="Cégep Limoilou" className="h-12 w-auto md:h-14" />
              <span className="text-xs uppercase tracking-[0.3em] text-[color:var(--brand-charcoal)]/70">
                Choisis ton activité
              </span>
            </Link>
            <span className="brand-chip bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
              Objectifs pédagogiques
            </span>
          </div>
          <div className="space-y-3 text-center md:text-left">
            <h1 className="text-3xl font-semibold md:text-4xl">
              Quelle compétence veux-tu travailler avec l’IA ?
            </h1>
            <p className="mx-auto max-w-3xl text-sm text-[color:var(--brand-charcoal)] md:text-base">
              Chaque activité se concentre sur une intention distincte : cadrer une demande, affiner un prompt, tester une consigne ou vérifier l’exhaustivité d’un brief.
            </p>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2 animate-section-delayed">
          {ACTIVITIES.map((activity) => (
            <article
              key={activity.id}
              className="group relative flex h-full flex-col gap-6 rounded-3xl border border-white/60 bg-white/90 p-8 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:shadow-lg"
            >
              {completedMap[activity.id] ? (
                <span className="absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-full bg-green-100 text-green-700 shadow-sm">
                  ✓
                </span>
              ) : null}
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold text-[color:var(--brand-black)]">
                  {activity.title}
                </h2>
                <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]/90">
                  {activity.description}
                </p>
              </div>
              <ul className="flex flex-col gap-2 text-sm text-[color:var(--brand-charcoal)]">
                {activity.highlights.map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
                      +
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                <Link
                  to={activity.to}
                  className="cta-button cta-button--primary inline-flex items-center gap-2"
                >
                  {activity.cta}
                  <span className="inline-block text-lg transition group-hover:translate-x-1">→</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ActivitySelector;
