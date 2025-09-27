import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  admin,
  type ActivityConfigResponse,
  type ActivityConfig,
} from "../../api";
import { AdminSkeleton } from "../../components/admin/AdminSkeleton";
import { useAdminAuth } from "../../providers/AdminAuthProvider";
import {
  getStepSequenceModuleLabel,
  getStepSequenceModuleLibraryEntry,
  listRegisteredStepSequenceModuleKeys,
  sanitizeStepSequenceModuleConfigList,
  type StepSequenceModuleConfig,
  type StepSequenceModuleLibraryEntry,
} from "../../modules/step-sequence/moduleLibrary";
import "../../modules/step-sequence/modules";

type ModuleFormState = {
  key: string;
  enabled: boolean;
  title: string;
  description: string;
  coverImage: string;
  defaults: {
    title: string;
    description: string;
    coverImage: string;
  };
};

function sanitizeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function normalizeForPayload(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const trimmed = error.message?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "Une erreur inattendue est survenue. Veuillez réessayer.";
}

export function AdminStepSequenceModulesPage(): JSX.Element {
  const { token } = useAdminAuth();
  const configRef = useRef<ActivityConfigResponse | null>(null);
  const moduleKeys = useMemo(
    () => listRegisteredStepSequenceModuleKeys(),
    []
  );
  const [moduleForms, setModuleForms] = useState<ModuleFormState[]>([]);
  const [initialForms, setInitialForms] = useState<ModuleFormState[]>([]);
  const [extraModules, setExtraModules] = useState<StepSequenceModuleConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const buildFormsFromConfigs = useCallback(
    (configs: StepSequenceModuleConfig[]) => {
      const sanitized = sanitizeStepSequenceModuleConfigList(configs);
      const configMap = new Map<string, StepSequenceModuleConfig>();
      sanitized.forEach((entry) => {
        configMap.set(entry.key, entry);
      });

      const forms: ModuleFormState[] = moduleKeys.map((key) => {
        const label = getStepSequenceModuleLabel(key);
        const config = configMap.get(key) ?? null;
        const fallbackEntry = getStepSequenceModuleLibraryEntry(key, label);
        const resolvedEntry: StepSequenceModuleLibraryEntry = config
          ? getStepSequenceModuleLibraryEntry(key, label, config)
          : fallbackEntry;

        return {
          key,
          enabled: resolvedEntry.enabled,
          title: resolvedEntry.metadata.title ?? "",
          description: resolvedEntry.metadata.description ?? "",
          coverImage: resolvedEntry.metadata.coverImage ?? "",
          defaults: {
            title: fallbackEntry.metadata.title ?? "",
            description: fallbackEntry.metadata.description ?? "",
            coverImage: fallbackEntry.metadata.coverImage ?? "",
          },
        };
      });

      const extras = sanitized.filter(
        (entry) => !moduleKeys.includes(entry.key)
      );

      return { forms, extras };
    },
    [moduleKeys]
  );

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
        configRef.current = {
          ...response,
          stepSequenceModules: sanitizeStepSequenceModuleConfigList(
            response.stepSequenceModules
          ),
        };
        const { forms, extras } = buildFormsFromConfigs(
          configRef.current.stepSequenceModules ?? []
        );
        setModuleForms(forms);
        setInitialForms(forms.map((form) => ({ ...form })));
        setExtraModules(extras);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            getErrorMessage(loadError) ||
              "Impossible de charger la configuration des modules."
          );
          setModuleForms([]);
          setInitialForms([]);
          setExtraModules([]);
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
  }, [buildFormsFromConfigs, token]);

  useEffect(() => {
    if (!success) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setSuccess(null);
    }, 4000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [success]);

  const hasChanges = useMemo(() => {
    if (moduleForms.length !== initialForms.length) {
      return true;
    }
    for (let index = 0; index < moduleForms.length; index += 1) {
      const current = moduleForms[index];
      const initial = initialForms[index];
      if (!initial || current.key !== initial.key) {
        return true;
      }
      if (
        current.enabled !== initial.enabled ||
        current.title !== initial.title ||
        current.description !== initial.description ||
        current.coverImage !== initial.coverImage
      ) {
        return true;
      }
    }
    return false;
  }, [initialForms, moduleForms]);

  const handleToggleModule = useCallback((key: string, enabled: boolean) => {
    setModuleForms((previous) =>
      previous.map((module) =>
        module.key === key ? { ...module, enabled } : module
      )
    );
    setError(null);
    setSuccess(null);
  }, []);

  const handleUpdateModuleField = useCallback(
    (key: string, field: "title" | "description" | "coverImage", value: string) => {
      setModuleForms((previous) =>
        previous.map((module) =>
          module.key === key
            ? {
                ...module,
                [field]: sanitizeText(value),
              }
            : module
        )
      );
      setError(null);
      setSuccess(null);
    },
    []
  );

  const handleResetModule = useCallback((key: string) => {
    setModuleForms((previous) =>
      previous.map((module) =>
        module.key === key
          ? {
              ...module,
              title: module.defaults.title,
              description: module.defaults.description,
              coverImage: module.defaults.coverImage,
            }
          : module
      )
    );
    setError(null);
    setSuccess(null);
  }, []);

  const handleRestoreInitial = useCallback(() => {
    setModuleForms(initialForms);
    setError(null);
    setSuccess(null);
  }, [initialForms]);

  const handleSave = useCallback(async () => {
    if (isSaving) {
      return;
    }
    const baseConfig = configRef.current;
    if (!baseConfig) {
      setError(
        "Configuration de référence introuvable. Rechargez la page puis réessayez."
      );
      return;
    }

    setIsSaving(true);
    setError(null);

    const sanitizedForms: StepSequenceModuleConfig[] = moduleForms.map(
      (module) => ({
        key: module.key,
        enabled: module.enabled,
        title: normalizeForPayload(module.title),
        description: normalizeForPayload(module.description),
        coverImage: normalizeForPayload(module.coverImage),
      })
    );
    const payloadModules: StepSequenceModuleConfig[] = [
      ...sanitizedForms,
      ...extraModules,
    ];

    const payload: ActivityConfig = {
      activities: Array.isArray(baseConfig.activities)
        ? baseConfig.activities
        : [],
      activitySelectorHeader: baseConfig.activitySelectorHeader,
      activityGeneration: baseConfig.activityGeneration,
      stepSequenceModules: payloadModules,
    };

    try {
      await admin.activities.save(payload, token);
      configRef.current = {
        ...baseConfig,
        stepSequenceModules: payloadModules,
      };
      const { forms, extras } = buildFormsFromConfigs(payloadModules);
      setModuleForms(forms);
      setInitialForms(forms.map((form) => ({ ...form })));
      setExtraModules(extras);
      setSuccess("Configuration sauvegardée avec succès.");
    } catch (saveError) {
      setError(
        getErrorMessage(saveError) ||
          "Impossible d'enregistrer la configuration des modules."
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    buildFormsFromConfigs,
    extraModules,
    isSaving,
    moduleForms,
    token,
  ]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <header className="space-y-2">
          <h2 className="text-2xl font-semibold text-[color:var(--brand-black)]">
            Modules StepSequence
          </h2>
          <p className="text-sm text-[color:var(--brand-charcoal)]/80">
            Chargement de la bibliothèque des modules...
          </p>
        </header>
        <AdminSkeleton lines={6} />
        <AdminSkeleton lines={6} />
        <AdminSkeleton lines={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold text-[color:var(--brand-black)]">
          Modules StepSequence
        </h2>
        <p className="text-sm text-[color:var(--brand-charcoal)]/80">
          Activez ou désactivez les modules disponibles et personnalisez les
          métadonnées affichées dans la bibliothèque.
        </p>
      </header>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-2xl border border-green-200 bg-green-50/80 p-4 text-sm text-green-700">
          {success}
        </div>
      ) : null}

      {extraModules.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-800">
          <p className="font-semibold">
            Modules non enregistrés dans le frontend
          </p>
          <p className="mt-1">
            Ces modules sont présents dans la configuration mais aucun composant
            correspondant n'est actuellement disponible dans l'interface :
          </p>
          <ul className="mt-2 list-disc pl-5">
            {extraModules.map((module) => (
              <li key={module.key}>{module.key}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-5">
        {moduleForms.map((module) => {
          const fallbackImage = module.defaults.coverImage;
          const previewImage = module.coverImage || fallbackImage;
          return (
            <article
              key={module.key}
              className="space-y-4 rounded-3xl border border-[color:var(--brand-charcoal)]/15 bg-white/95 p-6 shadow-sm"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">
                    Module {module.key}
                  </p>
                  <h3 className="text-lg font-semibold text-[color:var(--brand-black)]">
                    {getStepSequenceModuleLabel(module.key)}
                  </h3>
                </div>
                <label className="inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
                  <input
                    type="checkbox"
                    checked={module.enabled}
                    onChange={(event) =>
                      handleToggleModule(module.key, event.target.checked)
                    }
                    className="h-4 w-4 rounded border-orange-300 text-orange-600 focus:ring-orange-500"
                  />
                  Module disponible
                </label>
              </div>

              <div className="grid gap-5 lg:grid-cols-[220px,1fr]">
                <div className="overflow-hidden rounded-2xl border border-[color:var(--brand-charcoal)]/10 bg-[color:var(--brand-charcoal)]/5">
                  {previewImage ? (
                    <img
                      src={previewImage}
                      onError={(event) => {
                        event.currentTarget.src = fallbackImage;
                      }}
                      alt={`Illustration du module ${getStepSequenceModuleLabel(
                        module.key
                      )}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-6 text-center text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/60">
                      Aucune illustration définie
                    </div>
                  )}
                </div>
                <div className="space-y-4">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                    Titre affiché
                    <input
                      type="text"
                      value={module.title}
                      onChange={(event) =>
                        handleUpdateModuleField(
                          module.key,
                          "title",
                          event.target.value
                        )
                      }
                      className="mt-1 w-full rounded-xl border border-[color:var(--brand-charcoal)]/20 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
                    />
                  </label>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                    Description
                    <textarea
                      value={module.description}
                      onChange={(event) =>
                        handleUpdateModuleField(
                          module.key,
                          "description",
                          event.target.value
                        )
                      }
                      rows={4}
                      className="mt-1 w-full resize-none rounded-xl border border-[color:var(--brand-charcoal)]/20 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
                    />
                  </label>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                    URL de l'image
                    <input
                      type="url"
                      value={module.coverImage}
                      onChange={(event) =>
                        handleUpdateModuleField(
                          module.key,
                          "coverImage",
                          event.target.value
                        )
                      }
                      placeholder="https://..."
                      className="mt-1 w-full rounded-xl border border-[color:var(--brand-charcoal)]/20 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
                    />
                  </label>
                  <div className="flex flex-wrap justify-between gap-3 text-xs text-[color:var(--brand-charcoal)]/70">
                    <button
                      type="button"
                      onClick={() => handleResetModule(module.key)}
                      className="rounded-full border border-[color:var(--brand-charcoal)]/20 px-3 py-1 font-semibold text-[color:var(--brand-charcoal)] transition hover:border-orange-300 hover:text-orange-700"
                    >
                      Réinitialiser ce module
                    </button>
                    <span>
                      Valeur par défaut : {module.defaults.title}
                    </span>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleRestoreInitial}
          disabled={!hasChanges || isSaving}
          className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 text-sm font-semibold text-[color:var(--brand-charcoal)] transition hover:border-orange-300 hover:text-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Réinitialiser les modifications
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="inline-flex items-center justify-center rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-orange-300"
        >
          {isSaving ? "Enregistrement..." : "Enregistrer la configuration"}
        </button>
      </div>
    </div>
  );
}
