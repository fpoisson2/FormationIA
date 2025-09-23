import { useCallback, useState } from "react";

import type { ActivityProps } from "../../config/activities";
import { useActivityCompletion } from "../../hooks/useActivityCompletion";

/**
 * Composant d'activité minimal servant de point de départ.
 * Dupliquez ce fichier puis adaptez le contenu pour créer une nouvelle activité.
 */
function ActivityBlankTemplate({
  completionId,
  navigateToActivities,
  isEditMode = false,
}: ActivityProps): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { markCompleted, activityProgressMarked } = useActivityCompletion({
    activityId: completionId,
    onCompleted: () => navigateToActivities(),
  });

  const handleValidate = useCallback(async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const success = await markCompleted({ triggerCompletionCallback: true });
      if (!success) {
        setError("Impossible d'enregistrer la complétion. Réessayez.");
      }
    } catch (err) {
      console.error("ActivityBlankTemplate", err);
      setError("Une erreur imprévue est survenue.");
    } finally {
      setIsSubmitting(false);
    }
  }, [markCompleted]);

  return (
    <section className="space-y-8 rounded-3xl border border-dashed border-[color:var(--brand-charcoal)]/30 bg-white/90 p-8 text-[color:var(--brand-charcoal)] shadow-sm">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Prototype d'activité</h2>
        <p className="text-sm leading-relaxed">
          Remplacez cette section par le contenu spécifique à votre activité. Le
          gabarit conserve la mise en page FormationIA et expose l'API de suivi
          de progression.
        </p>
      </div>

      {isEditMode ? (
        <div className="rounded-xl border border-dashed border-orange-300 bg-orange-50/70 p-4 text-xs font-medium text-orange-800">
          Mode édition actif : adaptez ce composant, puis sauvegardez via le
          bouton « Sauvegarder » dans l'en-tête pour conserver vos ajustements
          (titres, mise en page, etc.).
        </div>
      ) : null}

      <div className="space-y-4 rounded-2xl border border-[color:var(--brand-charcoal)]/10 bg-white p-6">
        <p className="text-sm leading-relaxed">
          Le bouton ci-dessous illustre l'utilisation de
          <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 text-xs">useActivityCompletion</code>
          pour signaler une réussite au backend et retourner automatiquement vers
          la liste des activités.
        </p>
        <button
          type="button"
          onClick={() => {
            void handleValidate();
          }}
          disabled={isSubmitting || activityProgressMarked}
          className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--brand-red)]/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {activityProgressMarked
            ? "Activité validée"
            : isSubmitting
              ? "Validation…"
              : "Valider l'activité"}
        </button>
        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        {activityProgressMarked ? (
          <p className="text-sm text-emerald-600">
            Succès enregistré : l'apprenant sera redirigé vers l'écran des
            activités.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default ActivityBlankTemplate;
