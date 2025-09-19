import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import logoPrincipal from "../assets/logo_principal.svg";
import { getProgress, type ProgressResponse } from "../api";
import {
  ACTIVITY_DEFINITIONS,
  type ActivityDefinition,
} from "../config/activities";
import { useLTI } from "../hooks/useLTI";

function ActivitySelector(): JSX.Element {
  const [completedMap, setCompletedMap] = useState<Record<string, boolean>>({});
  const [completedActivity, setCompletedActivity] = useState<ActivityDefinition | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { context, isLTISession, loading: ltiLoading } = useLTI();
  const displayName =
    context?.user?.name?.trim() ||
    context?.user?.email?.trim() ||
    context?.user?.subject?.trim() ||
    "";
  const shouldShowWelcome = isLTISession && !ltiLoading && displayName.length > 0;
  const completedId = (location.state as { completed?: string } | null)?.completed;

  useEffect(() => {
    if (!completedId) {
      return;
    }

    const foundActivity = ACTIVITY_DEFINITIONS.find(
      (activity: ActivityDefinition) => activity.id === completedId
    );

    if (foundActivity) {
      setCompletedActivity(foundActivity);
    }

    const timeout = window.setTimeout(() => {
      navigate("/activites", { replace: true, state: null });
    }, 150);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [completedId, navigate]);

  useEffect(() => {
    if (!completedActivity) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCompletedActivity(null);
    }, 8000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [completedActivity]);

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
        {completedActivity ? (
          <div className="animate-section flex flex-col gap-4 rounded-3xl border border-green-200/80 bg-green-50/90 p-6 text-green-900 shadow-sm backdrop-blur">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-green-700/80">
                Activité terminée
              </p>
              <p className="text-lg font-semibold md:text-xl">
                Tu as complété l’activité « {completedActivity.title} »
              </p>
            </div>
            <div className="flex flex-col gap-3 text-sm text-green-800 md:flex-row md:items-center md:justify-between">
              <span className="text-sm md:text-base">
                Tu peux rouvrir l’activité pour revoir tes actions ou poursuivre une autre compétence.
              </span>
              <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
                <Link
                  to={completedActivity.cta.to}
                  className="cta-button cta-button--secondary inline-flex items-center justify-center gap-2 border-green-600/40 bg-white/80 px-4 py-2 text-green-800 transition hover:border-green-600/70 hover:bg-white"
                  onClick={() => setCompletedActivity(null)}
                >
                  Ouvrir l’activité
                  <span className="text-lg">↗</span>
                </Link>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-green-600/30 px-4 py-2 text-sm font-medium text-green-700 transition hover:border-green-600/60 hover:text-green-800"
                  onClick={() => setCompletedActivity(null)}
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {shouldShowWelcome ? (
          <div className="animate-section rounded-3xl border border-white/70 bg-white/90 p-6 text-center shadow-sm backdrop-blur">
            <p className="text-lg font-medium text-[color:var(--brand-charcoal)] md:text-xl">
              Bienvenue <span className="font-semibold text-[color:var(--brand-black)]">{displayName}</span>
            </p>
          </div>
        ) : null}
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
          {ACTIVITY_DEFINITIONS.map((activity: ActivityDefinition) => (
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
                  to={activity.cta.to}
                  className="cta-button cta-button--primary inline-flex items-center gap-2"
                >
                  {activity.cta.label}
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
