import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { admin, type ActivityGenerationJob } from "../../api";
import {
  StepSequenceRenderer,
  getStepComponent,
  resolveStepComponentKey,
  type StepDefinition,
} from "../../modules/step-sequence";
import "../../modules/step-sequence/modules";
import { useAdminAuth } from "../../providers/AdminAuthProvider";

interface RouteParams {
  jobId?: string;
  stepId?: string;
}

function extractStepHighlight(step: StepDefinition | null): string | null {
  if (!step) {
    return null;
  }

  const directKeys: Array<keyof StepDefinition | string> = [
    "title",
    "label",
    "name",
    "heading",
  ];

  for (const key of directKeys) {
    const value = (step as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const config = (step as { config?: unknown }).config;
  if (config && typeof config === "object") {
    const configMap = config as Record<string, unknown>;
    for (const key of directKeys) {
      const value = configMap[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    const fields = configMap.fields;
    if (Array.isArray(fields)) {
      for (const field of fields) {
        if (!field || typeof field !== "object") {
          continue;
        }
        const label = (field as Record<string, unknown>).label;
        if (typeof label === "string" && label.trim()) {
          return label.trim();
        }
      }
    }
  }

  return null;
}

export function ActivityGenerationStepPreviewPage(): JSX.Element {
  const { jobId, stepId } = useParams<RouteParams>();
  const navigate = useNavigate();
  const { token } = useAdminAuth();
  const [job, setJob] = useState<ActivityGenerationJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const controller = new AbortController();

    void admin.activities
      .getGenerationJob(jobId, token, { signal: controller.signal })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setJob(result);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        const detail =
          err instanceof Error
            ? err.message
            : "Impossible de charger la tâche de génération.";
        setError(detail);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [jobId, token]);

  const steps = useMemo<StepDefinition[]>(() => {
    if (!job?.cachedSteps) {
      return [];
    }
    return Object.values(job.cachedSteps) as StepDefinition[];
  }, [job?.cachedSteps]);

  const { availableSteps, unsupportedCount } = useMemo(
    () => {
      const nextSteps: StepDefinition[] = [];
      let skipped = 0;

      for (const step of steps) {
        if (!step || typeof step !== "object") {
          continue;
        }

        const componentKey = resolveStepComponentKey(step) ?? step.component ?? "";
        if (!componentKey) {
          skipped += 1;
          continue;
        }

        if (!getStepComponent(componentKey)) {
          skipped += 1;
          continue;
        }

        nextSteps.push(step);
      }

      return { availableSteps: nextSteps, unsupportedCount: skipped };
    },
    [steps]
  );

  const initialIndex = useMemo(() => {
    if (!stepId || availableSteps.length === 0) {
      return 0;
    }
    const index = availableSteps.findIndex((step) => step.id === stepId);
    return index >= 0 ? index : 0;
  }, [availableSteps, stepId]);

  const activeStep = availableSteps[initialIndex] ?? null;
  const highlight = extractStepHighlight(activeStep);
  const stepMissing = stepId
    ? !availableSteps.some((step) => step.id === stepId)
    : false;

  if (!jobId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[color:var(--brand-sand)]/40 px-4">
        <div className="max-w-md rounded-3xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-red-700">
            Identifiant de tâche manquant.
          </p>
          <button
            type="button"
            onClick={() => navigate("/assistant-ia")}
            className="mt-4 inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600"
          >
            Revenir à l’assistant
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[color:var(--brand-sand)]/40 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-[color:var(--brand-black)]">
              Aperçu de l’étape générée
            </h1>
            <p className="text-sm text-[color:var(--brand-charcoal)]/80">
              Job {jobId}
              {stepId ? ` · Étape ${stepId}` : ""}
            </p>
            {highlight ? (
              <p className="text-xs text-[color:var(--brand-charcoal)]">
                {highlight}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/assistant-ia?jobId=${encodeURIComponent(jobId)}`}
              className="inline-flex items-center justify-center rounded-full border border-sky-300 px-4 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-50"
            >
              Retour à la conversation
            </Link>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center justify-center rounded-full border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Précédent
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-3xl border border-gray-200 bg-white/80 p-8 text-center text-sm text-gray-600 shadow-sm">
            Chargement de l’étape en cours…
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">
            {error}
          </div>
        ) : availableSteps.length === 0 ? (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 shadow-sm">
            {unsupportedCount > 0
              ? "Aucune étape compatible n’a été trouvée dans cette tâche pour le moment."
              : "Aucune étape générée pour cette tâche pour le moment."}
          </div>
        ) : (
          <div className="rounded-3xl border border-white/70 bg-white/95 p-6 shadow-sm">
            {stepMissing ? (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
                L’identifiant demandé n’est pas disponible dans les étapes compatibles. Affichage de la
                première étape rendue disponible.
              </div>
            ) : null}
            {unsupportedCount > 0 ? (
              <div className="mb-4 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-xs text-sky-800">
                {unsupportedCount === 1
                  ? "1 étape générée utilise un composant non pris en charge par l’aperçu et a été masquée."
                  : `${unsupportedCount} étapes générées utilisent des composants non pris en charge par l’aperçu et ont été masquées.`}
              </div>
            ) : null}
            <StepSequenceRenderer
              steps={availableSteps}
              initialIndex={initialIndex}
              isEditMode={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
