import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  admin,
  type ActivityConfig,
  type ActivityConfigResponse,
  type ActivityGenerationAdminConfig,
} from "../../api";
import {
  DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE,
  DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE,
} from "../../config/activityGeneration";
import { useAdminAuth } from "../../providers/AdminAuthProvider";

interface FormState {
  systemMessage: string;
  developerMessage: string;
}

function sanitizeMessage(input: string): string {
  return input.replace(/\r\n/g, "\n");
}

function resolveInitialForm(
  config: ActivityGenerationAdminConfig | null | undefined
): FormState {
  const systemMessage =
    typeof config?.systemMessage === "string" && config.systemMessage.trim().length > 0
      ? config.systemMessage
      : DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE;
  const developerMessage =
    typeof config?.developerMessage === "string" &&
    config.developerMessage.trim().length > 0
      ? config.developerMessage
      : DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE;
  return {
    systemMessage,
    developerMessage,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const trimmed = error.message?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  return "Une erreur inattendue est survenue. Veuillez réessayer.";
}

export function AdminActivityGenerationPage(): JSX.Element {
  const { token } = useAdminAuth();
  const configRef = useRef<ActivityConfigResponse | null>(null);
  const [formState, setFormState] = useState<FormState>(() =>
    resolveInitialForm(null)
  );
  const [initialState, setInitialState] = useState<FormState>(() =>
    resolveInitialForm(null)
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hasChanges = useMemo(() => {
    return (
      formState.systemMessage !== initialState.systemMessage ||
      formState.developerMessage !== initialState.developerMessage
    );
  }, [formState, initialState]);

  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await admin.activities.get(token);
        if (cancelled) {
          return;
        }
        configRef.current = response;
        const nextForm = resolveInitialForm(response.activityGeneration);
        setFormState(nextForm);
        setInitialState(nextForm);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            getErrorMessage(loadError) ||
              "Impossible de charger la configuration actuelle."
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!success) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setSuccess(null);
    }, 5000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [success]);

  const handleChange = useCallback(
    (field: keyof FormState, value: string) => {
      setFormState((previous) => ({
        ...previous,
        [field]: value,
      }));
    },
    []
  );

  const handleResetForm = useCallback(() => {
    setFormState(initialState);
    setError(null);
    setSuccess(null);
  }, [initialState]);

  const handleRestoreDefaults = useCallback(() => {
    const defaults = resolveInitialForm({});
    setFormState(defaults);
    setError(null);
    setSuccess(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving) {
      return;
    }
    const baseConfig = configRef.current;
    if (!baseConfig) {
      setError(
        "La configuration initiale est introuvable. Rechargez la page puis réessayez."
      );
      return;
    }

    const trimmedSystem = sanitizeMessage(formState.systemMessage).trim();
    const trimmedDeveloper = sanitizeMessage(
      formState.developerMessage
    ).trim();

    if (trimmedSystem.length < 3 || trimmedDeveloper.length < 3) {
      setError(
        "Les messages système et développeur doivent contenir au moins trois caractères."
      );
      return;
    }

    setIsSaving(true);
    setError(null);

    const payload: ActivityConfig = {
      activities: Array.isArray(baseConfig.activities)
        ? baseConfig.activities
        : [],
      activitySelectorHeader: baseConfig.activitySelectorHeader,
      activityGeneration: {
        systemMessage: trimmedSystem,
        developerMessage: trimmedDeveloper,
      },
    };
    if (Array.isArray(baseConfig.stepSequenceModules)) {
      payload.stepSequenceModules = baseConfig.stepSequenceModules;
    } else {
      payload.stepSequenceModules = [];
    }

    try {
      await admin.activities.save(payload, token);
      const updatedForm: FormState = {
        systemMessage: trimmedSystem,
        developerMessage: trimmedDeveloper,
      };
      configRef.current = {
        ...baseConfig,
        activityGeneration: {
          systemMessage: trimmedSystem,
          developerMessage: trimmedDeveloper,
        },
        stepSequenceModules: payload.stepSequenceModules,
      };
      setFormState(updatedForm);
      setInitialState(updatedForm);
      setSuccess("Configuration sauvegardée avec succès.");
    } catch (saveError) {
      setError(
        getErrorMessage(saveError) ||
          "Impossible d'enregistrer les modifications."
      );
    } finally {
      setIsSaving(false);
    }
  }, [formState, isSaving, token]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <header className="space-y-2">
          <h2 className="text-2xl font-semibold text-[color:var(--brand-black)]">
            Conception d'activités assistée par IA
          </h2>
          <p className="text-sm text-[color:var(--brand-charcoal)]/80">
            Chargement de la configuration...
          </p>
        </header>
        <div className="rounded-3xl border border-white/60 bg-white/70 p-6 text-sm text-[color:var(--brand-charcoal)]/70 shadow-sm backdrop-blur">
          Initialisation en cours...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--brand-charcoal)]/60">
            Génération d'activités
          </p>
          <h2 className="text-2xl font-semibold text-[color:var(--brand-black)]">
            Conception d'activités assistée par IA
          </h2>
        </div>
        <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]/80">
          Ajustez les messages envoyés au modèle pour orienter la conception automatique des activités.
          Le message système fixe le rôle général de l'assistant tandis que le message développeur précise la méthodologie et les contraintes pédagogiques.
        </p>
      </header>

      {error ? (
        <div className="rounded-3xl border border-red-200 bg-red-50/90 p-4 text-sm text-red-800 shadow-sm">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-3xl border border-green-200 bg-green-50/90 p-4 text-sm text-green-800 shadow-sm">
          {success}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3 rounded-3xl border border-white/60 bg-white/95 p-6 shadow-sm backdrop-blur">
          <header className="space-y-2">
            <h3 className="text-base font-semibold text-[color:var(--brand-black)]">
              Message système
            </h3>
            <p className="text-sm text-[color:var(--brand-charcoal)]/70">
              Définit le positionnement général de l'assistant IA (ton, expertise, public cible).
            </p>
          </header>
          <textarea
            value={formState.systemMessage}
            onChange={(event) => handleChange("systemMessage", event.target.value)}
            rows={10}
            maxLength={4000}
            className="min-h-[14rem] w-full resize-y rounded-2xl border border-[color:var(--brand-sand)]/70 bg-white/90 p-4 text-sm leading-relaxed text-[color:var(--brand-charcoal)] shadow-inner focus:border-[color:var(--brand-red)]/60 focus:outline-none focus:ring-0"
          />
          <p className="text-xs text-[color:var(--brand-charcoal)]/60">
            {formState.systemMessage.length} caractères / 4000
          </p>
        </section>

        <section className="space-y-3 rounded-3xl border border-white/60 bg-white/95 p-6 shadow-sm backdrop-blur">
          <header className="space-y-2">
            <h3 className="text-base font-semibold text-[color:var(--brand-black)]">
              Message développeur
            </h3>
            <p className="text-sm text-[color:var(--brand-charcoal)]/70">
              Détaille les étapes attendues, les outils autorisés et les exigences de restitution pour chaque activité générée.
            </p>
          </header>
          <textarea
            value={formState.developerMessage}
            onChange={(event) => handleChange("developerMessage", event.target.value)}
            rows={12}
            maxLength={6000}
            className="min-h-[18rem] w-full resize-y rounded-2xl border border-[color:var(--brand-sand)]/70 bg-white/90 p-4 text-sm leading-relaxed text-[color:var(--brand-charcoal)] shadow-inner focus:border-[color:var(--brand-red)]/60 focus:outline-none focus:ring-0"
          />
          <p className="text-xs text-[color:var(--brand-charcoal)]/60">
            {formState.developerMessage.length} caractères / 6000
          </p>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-charcoal)]/30 px-4 py-2 text-sm font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)]"
          onClick={handleResetForm}
          disabled={isSaving || !hasChanges}
        >
          Annuler les modifications
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-sand)]/60 bg-[color:var(--brand-sand)]/30 px-4 py-2 text-sm font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-sand)]/80 hover:bg-[color:var(--brand-sand)]/50"
          onClick={handleRestoreDefaults}
          disabled={isSaving}
        >
          Restaurer les valeurs par défaut
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-300"
          onClick={() => {
            void handleSave();
          }}
          disabled={isSaving || !hasChanges}
        >
          {isSaving ? "Enregistrement..." : "Enregistrer les modifications"}
        </button>
      </div>
    </div>
  );
}
