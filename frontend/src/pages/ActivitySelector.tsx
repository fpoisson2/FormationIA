import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import ActivityLayout from "../components/ActivityLayout";
import {
  getProgress,
  admin,
  activities as activitiesClient,
  type ActivitySelectorHeaderConfig,
  type ProgressResponse,
} from "../api";
import {
  getDefaultActivityDefinitions,
  resolveActivityDefinition,
  serializeActivityDefinition,
  type ActivityConfigEntry,
  type ActivityDefinition,
} from "../config/activities";
import {
  getStepComponent,
  STEP_COMPONENT_REGISTRY,
  StepSequenceContext,
  type StepDefinition,
} from "../modules/step-sequence";
import "../modules/step-sequence/modules";
import { useLTI } from "../hooks/useLTI";
import { useAdminAuth } from "../providers/AdminAuthProvider";

const ADMIN_ROLES = ["admin", "superadmin", "administrator"];

const STEP_SEQUENCE_COMPONENT_KEY = "step-sequence";

const STEP_TYPE_LABELS: Record<string, string> = {
  form: "Formulaire",
  "rich-content": "Contenu riche",
  video: "Vidéo",
  "workshop-context": "Atelier · Contexte",
  "workshop-comparison": "Atelier · Comparaison",
  "workshop-synthesis": "Atelier · Synthèse",
};

const NOOP = () => {};

function generateUniqueId(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch (error) {
    // Ignore errors when crypto is not available (e.g. server-side rendering)
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function getStepTypeLabel(key: string): string {
  return STEP_TYPE_LABELS[key] ?? key;
}

function createDefaultStepSequenceTemplate(): StepDefinition[] {
  const introStepId = generateUniqueId("step");
  const formStepId = generateUniqueId("step");
  const formFieldId = generateUniqueId("field");

  return [
    {
      id: introStepId,
      component: "rich-content",
      config: {
        title: "Introduction à la séquence",
        body: "Présentez le contexte de l'activité et détaillez les consignes clés pour l'apprenant.",
        sidebar: {
          type: "tips",
          title: "Pour bien démarrer",
          tips: [
            "Rappelle les objectifs pédagogiques.",
            "Partage une ressource ou un exemple inspirant.",
          ],
        },
      },
    },
    {
      id: formStepId,
      component: "form",
      config: {
        submitLabel: "Envoyer ma réponse",
        allowEmpty: false,
        fields: [
          {
            id: formFieldId,
            type: "textarea_with_counter",
            label: "Décrivez votre besoin ou votre situation",
            minWords: 20,
            maxWords: 150,
          },
        ],
      },
    },
  ];
}

interface StepSequenceEditorProps {
  activityTitle: string;
  steps: StepDefinition[];
  stepTypeOptions: string[];
  onAddStep: (component: string) => void;
  onRemoveStep: (stepId: string) => void;
  onMoveStep: (fromIndex: number, toIndex: number) => void;
  onChangeStepType: (stepId: string, component: string) => void;
  onUpdateStepConfig: (stepId: string, config: unknown) => void;
}

interface StepSequenceStepCardProps {
  step: StepDefinition;
  index: number;
  stepTypeOptions: string[];
  onRemove: (stepId: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChangeType: (stepId: string, component: string) => void;
  onUpdateConfig: (stepId: string, config: unknown) => void;
}

function StepSequenceStepCard({
  step,
  index,
  stepTypeOptions,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onChangeType,
  onUpdateConfig,
}: StepSequenceStepCardProps): JSX.Element {
  const StepComponent = useMemo(() => getStepComponent(step.component), [step.component]);

  const handleTypeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onChangeType(step.id, event.target.value);
    },
    [onChangeType, step.id]
  );

  const handleConfigUpdate = useCallback(
    (config: unknown) => {
      onUpdateConfig(step.id, config);
    },
    [onUpdateConfig, step.id]
  );

  const contextValue = useMemo(
    () => ({
      stepIndex: 0,
      isEditMode: true,
      onAdvance: NOOP,
      onUpdateConfig: handleConfigUpdate,
    }),
    [handleConfigUpdate]
  );

  return (
    <div className="rounded-2xl border border-orange-200/70 bg-orange-50/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-orange-700">
          Étape {index + 1}
        </h4>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="rounded-full border border-orange-200 px-2 py-1 text-xs text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Monter l'étape ${index + 1}`}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="rounded-full border border-orange-200 px-2 py-1 text-xs text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Descendre l'étape ${index + 1}`}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => onRemove(step.id)}
            className="rounded-full border border-red-200 px-2 py-1 text-xs text-red-600 transition hover:border-red-300 hover:bg-red-100"
          >
            Supprimer l'étape
          </button>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-orange-700">
          Type d'étape
          <select
            value={step.component}
            onChange={handleTypeChange}
            className="rounded-lg border border-orange-200 px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-orange-400 focus:outline-none"
          >
            {stepTypeOptions.map((type) => (
              <option key={type} value={type}>
                {getStepTypeLabel(type)}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-3 rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm">
          {StepComponent ? (
            <StepSequenceContext.Provider value={contextValue}>
              <StepComponent
                definition={step}
                config={step.config}
                payload={undefined}
                isActive
                isEditMode
                onAdvance={NOOP}
                onUpdateConfig={handleConfigUpdate}
              />
            </StepSequenceContext.Provider>
          ) : (
            <p className="text-sm text-orange-700">
              Aucun composant enregistré pour « {step.component} ».
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StepSequenceEditor({
  activityTitle,
  steps,
  stepTypeOptions,
  onAddStep,
  onRemoveStep,
  onMoveStep,
  onChangeStepType,
  onUpdateStepConfig,
}: StepSequenceEditorProps): JSX.Element {
  const [nextStepType, setNextStepType] = useState<string>("");

  useEffect(() => {
    if (stepTypeOptions.length === 0) {
      setNextStepType("");
      return;
    }
    setNextStepType((prev) =>
      prev && stepTypeOptions.includes(prev) ? prev : stepTypeOptions[0]
    );
  }, [stepTypeOptions]);

  const handleAddStep = useCallback(() => {
    if (!nextStepType) return;
    onAddStep(nextStepType);
  }, [nextStepType, onAddStep]);

  return (
    <section
      role="region"
      aria-label={`Séquence d'étapes pour ${activityTitle}`}
      className="space-y-5 rounded-3xl border border-orange-200 bg-orange-50/60 p-5"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-orange-700">
          Séquence d'étapes
        </h3>
        <p className="text-xs text-orange-800">
          Ajoutez, organisez et configurez les étapes qui composent cette activité.
        </p>
      </div>
      <div className="space-y-4">
        {steps.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-orange-200 bg-white/70 p-4 text-sm text-orange-700">
            Aucune étape configurée pour le moment. Ajoutez une première étape pour
            démarrer la séquence.
          </p>
        ) : (
          steps.map((step, index) => (
            <StepSequenceStepCard
              key={step.id}
              step={step}
              index={index}
              stepTypeOptions={stepTypeOptions}
              onRemove={onRemoveStep}
              onMoveUp={() => onMoveStep(index, Math.max(0, index - 1))}
              onMoveDown={() =>
                onMoveStep(index, Math.min(steps.length - 1, index + 1))
              }
              canMoveUp={index > 0}
              canMoveDown={index < steps.length - 1}
              onChangeType={onChangeStepType}
              onUpdateConfig={onUpdateStepConfig}
            />
          ))
        )}
      </div>
      <div className="space-y-2 rounded-2xl border border-dashed border-orange-200 bg-white/70 p-4">
        <label className="flex flex-col gap-1 text-xs font-semibold text-orange-700">
          Type d'étape à ajouter
          <select
            value={nextStepType}
            onChange={(event) => setNextStepType(event.target.value)}
            className="rounded-lg border border-orange-200 px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-orange-400 focus:outline-none"
            disabled={stepTypeOptions.length === 0}
          >
            {stepTypeOptions.length === 0 ? (
              <option value="">Aucun module disponible</option>
            ) : (
              stepTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {getStepTypeLabel(type)}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          type="button"
          onClick={handleAddStep}
          disabled={stepTypeOptions.length === 0 || !nextStepType}
          className="inline-flex items-center justify-center rounded-full border border-orange-300 bg-white px-4 py-2 text-xs font-semibold text-orange-700 transition hover:border-orange-400 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Ajouter une étape
        </button>
      </div>
    </section>
  );
}

const DEFAULT_ACTIVITY_SELECTOR_HEADER: ActivitySelectorHeaderConfig = {
  eyebrow: "Choisis ton activité",
  title: "Quelle compétence veux-tu travailler avec l'IA ?",
  subtitle:
    "Chaque activité se concentre sur une intention distincte : cadrer une demande, affiner un prompt, tester une consigne ou vérifier l'exhaustivité d'un brief.",
  badge: "Objectifs pédagogiques",
};

const sanitizeHeaderConfig = (
  value: unknown
): ActivitySelectorHeaderConfig | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const headerValue = value as Record<string, unknown>;
  const sanitized: ActivitySelectorHeaderConfig = {};

  if (typeof headerValue.eyebrow === "string") {
    sanitized.eyebrow = headerValue.eyebrow;
  }
  if (typeof headerValue.title === "string") {
    sanitized.title = headerValue.title;
  }
  if (typeof headerValue.subtitle === "string") {
    sanitized.subtitle = headerValue.subtitle;
  }
  if (typeof headerValue.badge === "string") {
    sanitized.badge = headerValue.badge;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
};

const normaliseRoles = (roles: string[] | undefined | null): string[] =>
  (roles ?? []).map((role) => role.toLowerCase().trim());

const canAccessAdmin = (roles: string[]): boolean =>
  roles.some((role) => ADMIN_ROLES.includes(role));

function ActivitySelector(): JSX.Element {
  const defaultActivities = useMemo(
    () => getDefaultActivityDefinitions(),
    []
  );
  const definitionMap = useMemo(
    () => new Map(defaultActivities.map((activity) => [activity.id, activity])),
    [defaultActivities]
  );
  const stepComponentKeys = useMemo(
    () => Object.keys(STEP_COMPONENT_REGISTRY).sort((a, b) => a.localeCompare(b)),
    []
  );

  const buildEditableActivities = useCallback(
    (storedActivities?: ActivityConfigEntry[] | null) => {
      if (!storedActivities || storedActivities.length === 0) {
        return defaultActivities.map((activity) =>
          resolveActivityDefinition({ id: activity.id })
        );
      }

      const seen = new Set<string>();
      const merged: ActivityDefinition[] = [];

      for (const item of storedActivities) {
        if (!item || typeof item !== "object" || !("id" in item) || !item.id) {
          continue;
        }

        try {
          const resolved = resolveActivityDefinition(item as ActivityConfigEntry);
          merged.push(resolved);
          seen.add(resolved.id);
        } catch (error) {
          console.warn("Entrée d'activité invalide ignorée", error);
        }
      }

      for (const activity of defaultActivities) {
        if (!seen.has(activity.id)) {
          merged.push(resolveActivityDefinition({ id: activity.id }));
        }
      }

      return merged;
    },
    [defaultActivities]
  );

  const [completedMap, setCompletedMap] = useState<Record<string, boolean>>({});
  const [completedActivity, setCompletedActivity] = useState<ActivityDefinition | null>(null);
  const [disabledActivity, setDisabledActivity] = useState<ActivityDefinition | null>(null);
  const [editableActivities, setEditableActivities] = useState<ActivityDefinition[]>(
    () => buildEditableActivities()
  );
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [headerOverrides, setHeaderOverrides] = useState<ActivitySelectorHeaderConfig>({});
  const location = useLocation();
  const navigate = useNavigate();
  const { context, isLTISession, loading: ltiLoading } = useLTI();
  const { status: adminStatus, user: adminUser, isEditMode, setEditMode, token } = useAdminAuth();
  const displayName =
    context?.user?.name?.trim() ||
    context?.user?.email?.trim() ||
    context?.user?.subject?.trim() ||
    "";
  const shouldShowWelcome = isLTISession && !ltiLoading && displayName.length > 0;
  const locationState =
    (location.state as { completed?: string; disabled?: string } | null) ?? null;
  const completedId = locationState?.completed;
  const disabledId = locationState?.disabled;
  const isAdminAuthenticated = adminStatus === "authenticated";
  const userRoles = normaliseRoles(adminUser?.roles);
  const canShowAdminButton = isAdminAuthenticated && canAccessAdmin(userRoles);

  const canUseStepSequenceShortcut = stepComponentKeys.length > 0;
  const newSequenceButtonClasses = `group flex min-h-[18rem] w-full flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed p-8 text-center transition ${
    canUseStepSequenceShortcut
      ? "border-orange-300 bg-white/70 text-orange-600 hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700"
      : "cursor-not-allowed border-gray-200 bg-gray-50/80 text-gray-400"
  }`;
  const newSequenceLabel = canUseStepSequenceShortcut
    ? "Ajouter une activité StepSequence"
    : "Modules StepSequence indisponibles";
  const newSequenceDescription = canUseStepSequenceShortcut
    ? "Crée une nouvelle séquence multi-étapes."
    : "Ajoutez un module d’étape pour pouvoir créer une séquence.";
  const newSequenceDescriptionClasses = `text-xs ${
    canUseStepSequenceShortcut
      ? "text-orange-600 opacity-80"
      : "text-gray-400"
  }`;

  useEffect(() => {
    if (!completedId && !disabledId) {
      return;
    }

    const findActivityById = (id: string | undefined | null) => {
      if (!id) return undefined;
      return (
        editableActivities.find((activity) => activity.id === id) ||
        definitionMap.get(id)
      );
    };

    if (completedId) {
      const foundActivity = findActivityById(completedId);
      if (foundActivity) {
        setCompletedActivity(foundActivity);
      }
    }

    if (disabledId) {
      const foundDisabled = findActivityById(disabledId);
      if (foundDisabled) {
        setDisabledActivity(foundDisabled);
      }
    }

    const timeout = window.setTimeout(() => {
      navigate("/activites", { replace: true, state: null });
    }, 150);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [completedId, disabledId, editableActivities, navigate]);

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
    if (!disabledActivity) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setDisabledActivity(null);
    }, 8000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [disabledActivity]);

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

  useEffect(() => {
    void loadSavedConfig();
  }, []);

  const handleMoveActivity = (fromIndex: number, toIndex: number) => {
    if (!isEditMode) return;

    const newActivities = [...editableActivities];
    const [movedActivity] = newActivities.splice(fromIndex, 1);
    newActivities.splice(toIndex, 0, movedActivity);
    setEditableActivities(newActivities);
  };

  const handleToggleActivityEnabled = (activityId: string, value: boolean) => {
    if (!isEditMode) return;

    setEditableActivities((prev) =>
      prev.map((activity) =>
        activity.id === activityId
          ? {
              ...activity,
              enabled: value,
            }
          : activity
      )
    );
  };

  const handleUpdateActivityText = (activityId: string, field: 'title' | 'description' | 'cta.label', value: string) => {
    if (!isEditMode) return;

    setEditableActivities(prev =>
      prev.map(activity =>
        activity.id === activityId
          ? {
              ...activity,
              card: {
                ...activity.card,
                ...(field === 'cta.label'
                  ? { cta: { ...activity.card.cta, label: value } }
                  : { [field]: value }
                )
              }
            }
          : activity
      )
    );
  };

  const handleUpdateHighlight = (activityId: string, highlightIndex: number, value: string) => {
    if (!isEditMode) return;

    setEditableActivities(prev =>
      prev.map(activity =>
        activity.id === activityId
          ? {
              ...activity,
              card: {
                ...activity.card,
                highlights: activity.card.highlights.map((highlight, index) =>
                  index === highlightIndex ? value : highlight
                )
              }
            }
          : activity
      )
    );
  };

  const handleAddHighlight = (activityId: string) => {
    if (!isEditMode) return;

    setEditableActivities(prev =>
      prev.map(activity =>
        activity.id === activityId
          ? {
              ...activity,
              card: {
                ...activity.card,
                highlights: [...activity.card.highlights, 'Nouveau point']
              }
            }
          : activity
      )
    );
  };

  const handleRemoveHighlight = (activityId: string, highlightIndex: number) => {
    if (!isEditMode) return;

    setEditableActivities(prev =>
      prev.map(activity =>
        activity.id === activityId
          ? {
              ...activity,
              card: {
                ...activity.card,
                highlights: activity.card.highlights.filter((_, index) => index !== highlightIndex)
              }
            }
          : activity
      )
    );
  };

  const handleAddStepToActivity = useCallback(
    (activityId: string, component: string) => {
      if (!isEditMode) return;

      setEditableActivities((prev) =>
        prev.map((activity) => {
          if (activity.id !== activityId) {
            return activity;
          }
          const baseSteps = activity.stepSequence ?? [];
          const existingIds = new Set(baseSteps.map((step) => step.id));
          let stepId = generateUniqueId("step");
          while (existingIds.has(stepId)) {
            stepId = generateUniqueId("step");
          }
          const nextSteps: StepDefinition[] = [
            ...baseSteps.map((step) => ({ ...step })),
            {
              id: stepId,
              component,
            },
          ];
          return {
            ...activity,
            stepSequence: nextSteps,
          };
        })
      );
    },
    [isEditMode]
  );

  const handleRemoveStepFromActivity = useCallback(
    (activityId: string, stepId: string) => {
      if (!isEditMode) return;

      setEditableActivities((prev) =>
        prev.map((activity) => {
          if (activity.id !== activityId) {
            return activity;
          }
          const steps = activity.stepSequence ?? [];
          if (!steps.some((step) => step.id === stepId)) {
            return activity;
          }
          const nextSteps = steps
            .filter((step) => step.id !== stepId)
            .map((step) => ({ ...step }));
          return {
            ...activity,
            stepSequence: nextSteps,
          };
        })
      );
    },
    [isEditMode]
  );

  const handleMoveStepWithinActivity = useCallback(
    (activityId: string, fromIndex: number, toIndex: number) => {
      if (!isEditMode) return;

      setEditableActivities((prev) =>
        prev.map((activity) => {
          if (activity.id !== activityId) {
            return activity;
          }
          const steps = activity.stepSequence ?? [];
          if (
            fromIndex === toIndex ||
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= steps.length ||
            toIndex >= steps.length
          ) {
            return activity;
          }
          const nextSteps = steps.map((step) => ({ ...step }));
          const [moved] = nextSteps.splice(fromIndex, 1);
          nextSteps.splice(toIndex, 0, moved);
          return {
            ...activity,
            stepSequence: nextSteps,
          };
        })
      );
    },
    [isEditMode]
  );

  const handleChangeStepComponent = useCallback(
    (activityId: string, stepId: string, component: string) => {
      if (!isEditMode) return;

      setEditableActivities((prev) =>
        prev.map((activity) => {
          if (activity.id !== activityId) {
            return activity;
          }
          const steps = activity.stepSequence ?? [];
          let updated = false;
          const nextSteps = steps.map((step) => {
            if (step.id !== stepId) {
              return { ...step };
            }
            updated = true;
            return {
              ...step,
              component,
              config: undefined,
            };
          });
          if (!updated) {
            return activity;
          }
          return {
            ...activity,
            stepSequence: nextSteps,
          };
        })
      );
    },
    [isEditMode]
  );

  const handleUpdateStepConfig = useCallback(
    (activityId: string, stepId: string, config: unknown) => {
      if (!isEditMode) return;

      setEditableActivities((prev) =>
        prev.map((activity) => {
          if (activity.id !== activityId) {
            return activity;
          }
          const steps = activity.stepSequence ?? [];
          let updated = false;
          const nextSteps = steps.map((step) => {
            if (step.id !== stepId) {
              return { ...step };
            }
            updated = true;
            return {
              ...step,
              config,
            };
          });
          if (!updated) {
            return activity;
          }
          return {
            ...activity,
            stepSequence: nextSteps,
          };
        })
      );
    },
    [isEditMode]
  );

  const handleDragStart = (index: number) => {
    if (!isEditMode) return;
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (!isEditMode || draggedIndex === null) return;
    setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    if (!isEditMode || draggedIndex === null || dragOverIndex === null) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    if (draggedIndex !== dragOverIndex) {
      handleMoveActivity(draggedIndex, dragOverIndex);
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleCreateStepSequenceActivity = useCallback(() => {
    if (!isEditMode || !canUseStepSequenceShortcut) return;

    setEditableActivities((prev) => {
      const existingIds = new Set(prev.map((activity) => activity.id));
      let candidateId = generateUniqueId("sequence");
      while (existingIds.has(candidateId)) {
        candidateId = generateUniqueId("sequence");
      }

      const templateSteps = createDefaultStepSequenceTemplate();

      const baseEntry: ActivityConfigEntry = {
        id: candidateId,
        componentKey: STEP_SEQUENCE_COMPONENT_KEY,
        enabled: true,
        card: {
          title: "Nouvelle séquence StepSequence",
          description:
            "Créez un parcours sur mesure en combinant plusieurs étapes guidées.",
          highlights: [
            "Introduction contextualisée",
            "Collecte d'informations structurée",
            "Étapes modulaires",
          ],
          cta: {
            label: "Configurer",
            to: `/activites/${candidateId}`,
          },
        },
        stepSequence: templateSteps,
      };

      const resolved = resolveActivityDefinition(baseEntry);

      return [...prev, resolved];
    });

  }, [canUseStepSequenceShortcut, isEditMode]);

  const handleSaveChanges = async () => {
    if (isSaving) return;

    setIsSaving(true);
    try {
      const serializedActivities = editableActivities.map((activity) =>
        serializeActivityDefinition(activity)
      );

      const headerConfig: ActivitySelectorHeaderConfig = {
        ...DEFAULT_ACTIVITY_SELECTOR_HEADER,
        ...headerOverrides,
      };

      await admin.activities.save(
        {
          activities: serializedActivities,
          activitySelectorHeader: headerConfig,
        },
        token
      );
      setEditMode(false);
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error);
      alert('Erreur lors de la sauvegarde. Veuillez réessayer.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelChanges = async () => {
    await loadSavedConfig();
    setEditMode(false);
  };

  const handleHeaderEdit = (field: 'eyebrow' | 'title' | 'subtitle' | 'badge', value: string) => {
    if (!isEditMode) return;
    setHeaderOverrides(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const loadSavedConfig = async () => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      const response = await activitiesClient.getConfig();
      if (response.activities && response.activities.length > 0) {
        setEditableActivities(
          buildEditableActivities(response.activities as ActivityConfigEntry[])
        );
      } else {
        setEditableActivities(buildEditableActivities());
      }
      const savedHeader = sanitizeHeaderConfig(response.activitySelectorHeader);
      setHeaderOverrides(savedHeader ?? {});
    } catch (error) {
      console.warn('Aucune configuration sauvegardée trouvée, utilisation de la configuration par défaut');
      setEditableActivities(buildEditableActivities());
      setHeaderOverrides({});
    } finally {
      setIsLoading(false);
    }
  };

  const activitiesToDisplay = isEditMode
    ? editableActivities
    : editableActivities.filter((activity) => activity.enabled !== false);

  const currentHeader = {
    ...DEFAULT_ACTIVITY_SELECTOR_HEADER,
    ...headerOverrides
  };

  return (
    <>
      <ActivityLayout
      activityId="activity-selector"
      eyebrow={currentHeader.eyebrow}
      title={currentHeader.title}
      subtitle={currentHeader.subtitle}
      badge={currentHeader.badge}
      onHeaderEdit={isEditMode ? handleHeaderEdit : undefined}
      actions={
        canShowAdminButton ? (
          <div className="flex items-center gap-2">
            {isEditMode ? (
              <>
                <button
                  onClick={handleSaveChanges}
                  disabled={isSaving}
                  className="inline-flex items-center justify-center rounded-full border border-green-600/20 bg-green-50 px-4 py-2 text-xs font-medium text-green-700 transition hover:border-green-600/40 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? 'Sauvegarde...' : 'Sauvegarder'}
                </button>
                <button
                  onClick={handleCancelChanges}
                  disabled={isSaving}
                  className="inline-flex items-center justify-center rounded-full border border-red-600/20 bg-red-50 px-4 py-2 text-xs font-medium text-red-700 transition hover:border-red-600/40 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Annuler
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditMode(true)}
                disabled={isLoading}
                className="inline-flex items-center justify-center rounded-full border border-orange-600/20 bg-orange-50 px-4 py-2 text-xs font-medium text-orange-700 transition hover:border-orange-600/40 hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Chargement...' : 'Mode édition'}
              </button>
            )}
            <Link
              to="/admin"
              className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 text-xs font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)]"
            >
              Administration
            </Link>
          </div>
        ) : null
      }
      beforeHeader={
        <>
          {isEditMode && (
            <div className="animate-section rounded-3xl border border-orange-200/80 bg-orange-50/90 p-6 text-orange-900 shadow-sm backdrop-blur">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-orange-700/80">
                    Mode édition activé
                  </span>
                  {isLoading && <span className="text-xs text-orange-600">Chargement de la configuration...</span>}
                  {!isLoading && <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse"></span>}
                </div>
                <p className="text-sm leading-relaxed text-orange-800">
                  Vous pouvez maintenant modifier les textes, réorganiser les activités par glisser-déposer ou avec les flèches, et ajouter ou supprimer des points clés.
                </p>
              </div>
            </div>
          )}
          {completedActivity ? (
            <div className="animate-section flex flex-col gap-4 rounded-3xl border border-green-200/80 bg-green-50/90 p-6 text-green-900 shadow-sm backdrop-blur">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-green-700/80">
                  Activité terminée
                </p>
                <p className="text-lg font-semibold md:text-xl">
                  Tu as complété l’activité « {completedActivity.card.title} »
                </p>
              </div>
              <div className="flex flex-col gap-3 text-sm text-green-800 md:flex-row md:items-center md:justify-between">
                <span className="text-sm md:text-base">
                  Tu peux rouvrir l’activité pour revoir tes actions ou poursuivre une autre compétence.
                </span>
                <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
                  <Link
                    to={completedActivity.card.cta.to}
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
          {disabledActivity ? (
            <div className="animate-section flex flex-col gap-4 rounded-3xl border border-red-200/80 bg-red-50/90 p-6 text-red-900 shadow-sm backdrop-blur">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-700/80">
                  Activité désactivée
                </p>
                <p className="text-lg font-semibold md:text-xl">
                  L’activité « {disabledActivity.card.title} » est actuellement masquée pour les apprenants.
                </p>
              </div>
              <p className="text-sm text-red-800">
                Activez-la de nouveau depuis le mode édition pour la rendre visible dans la sélection.
              </p>
            </div>
          ) : null}
          {shouldShowWelcome ? (
            <div className="animate-section rounded-3xl border border-white/70 bg-white/90 p-6 text-center shadow-sm backdrop-blur">
              <p className="text-lg font-medium text-[color:var(--brand-charcoal)] md:text-xl">
                Bienvenue <span className="font-semibold text-[color:var(--brand-black)]">{displayName}</span>
              </p>
            </div>
          ) : null}
        </>
      }
      headerClassName="space-y-6 animate-section"
      contentClassName="animate-section-delayed"
      contentAs="div"
    >
      <div className="grid gap-6 md:grid-cols-2">
        {activitiesToDisplay.map((activity: ActivityDefinition, index: number) => {
          const isDisabled = activity.enabled === false;
          const isCompleted = completedMap[activity.id];
          const hoverClasses = isDisabled
            ? "hover:translate-y-0 hover:shadow-sm"
            : "hover:-translate-y-1 hover:shadow-lg";
          const statusClasses = isDisabled
            ? "border-gray-200 bg-gray-100/80 text-gray-500/90 ring-0 saturate-75"
            : isCompleted
              ? "border-green-200 bg-green-50/90 ring-2 ring-green-100"
              : "border-white/60 bg-white/90";
          const editClasses = isEditMode
            ? isDisabled
              ? "cursor-move border-orange-200/70 ring-1 ring-orange-100/60"
              : "cursor-move border-orange-200 ring-2 ring-orange-100"
            : "";
          const dragClasses = [
            draggedIndex === index ? "opacity-50" : "",
            dragOverIndex === index && draggedIndex !== index
              ? "scale-105 ring-4 ring-blue-200"
              : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <article
              key={activity.id}
              draggable={isEditMode}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`group relative flex h-full flex-col gap-6 rounded-3xl border p-8 shadow-sm backdrop-blur transition ${hoverClasses} ${statusClasses} ${editClasses} ${dragClasses}`.trim()}
            >
              {isEditMode && (
                <div className="absolute left-4 top-4 flex flex-col gap-1">
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-orange-100 text-xs text-orange-600 shadow-sm">
                    ⋮⋮
                  </div>
                <button
                  onClick={() => handleMoveActivity(index, Math.max(0, index - 1))}
                  disabled={index === 0}
                  className="flex h-6 w-6 items-center justify-center rounded bg-white text-xs text-gray-600 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
                >
                  ↑
                </button>
                <button
                  onClick={() => handleMoveActivity(index, Math.min(activitiesToDisplay.length - 1, index + 1))}
                  disabled={index === activitiesToDisplay.length - 1}
                  className="flex h-6 w-6 items-center justify-center rounded bg-white text-xs text-gray-600 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
                >
                  ↓
                  </button>
                </div>
              )}
            {!isEditMode && isCompleted ? (
              <div className="absolute right-6 top-6 flex flex-col items-center gap-1">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100 text-green-700 shadow-sm">
                  ✓
                </span>
                <span className="text-xs font-medium text-green-700 uppercase tracking-wide">
                  Complété
                </span>
              </div>
            ) : null}
            {isEditMode && (
              <label className="absolute right-6 top-6 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-gray-600 shadow-sm">
                <input
                  type="checkbox"
                  checked={activity.enabled !== false}
                  onChange={(event) =>
                    handleToggleActivityEnabled(activity.id, event.target.checked)
                  }
                  className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                />
                Visible
              </label>
            )}
            {isDisabled && (
              <span className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-red-100/90 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700 shadow-sm">
                Désactivée
              </span>
            )}
              <div className="space-y-3">
                {isEditMode ? (
                  <>
                    <input
                      type="text"
                    value={activity.card.title}
                    onChange={(e) => handleUpdateActivityText(activity.id, 'title', e.target.value)}
                    className="w-full border-b border-gray-200 bg-transparent text-2xl font-semibold text-[color:var(--brand-black)] focus:border-orange-400 focus:outline-none"
                  />
                  <textarea
                    value={activity.card.description}
                    onChange={(e) => handleUpdateActivityText(activity.id, 'description', e.target.value)}
                    rows={3}
                    className="w-full resize-none border border-gray-200 rounded-lg p-2 text-sm leading-relaxed text-[color:var(--brand-charcoal)]/90 focus:border-orange-400 focus:outline-none"
                  />
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-semibold text-[color:var(--brand-black)]">
                    {activity.card.title}
                  </h2>
                  <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]/90">
                    {activity.card.description}
                  </p>
                </>
              )}
            </div>
            <ul className="flex flex-col gap-2 text-sm text-[color:var(--brand-charcoal)]">
              {activity.card.highlights.map((item, highlightIndex) => (
                <li key={`${activity.id}-highlight-${highlightIndex}`} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
                    +
                  </span>
                  {isEditMode ? (
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => handleUpdateHighlight(activity.id, highlightIndex, e.target.value)}
                        className="flex-1 border-b border-gray-200 bg-transparent text-sm focus:border-orange-400 focus:outline-none"
                      />
                      <button
                        onClick={() => handleRemoveHighlight(activity.id, highlightIndex)}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-xs text-red-600 hover:bg-red-200"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <span>{item}</span>
                  )}
                </li>
              ))}
              {isEditMode && (
                <li className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                    +
                  </span>
                  <button
                    onClick={() => handleAddHighlight(activity.id)}
                    className="text-sm text-gray-500 hover:text-orange-600"
                  >
                    Ajouter un point
                  </button>
                </li>
              )}
            </ul>
            {isEditMode && activity.componentKey === STEP_SEQUENCE_COMPONENT_KEY ? (
              <StepSequenceEditor
                activityTitle={activity.card.title}
                steps={activity.stepSequence ?? []}
                stepTypeOptions={stepComponentKeys}
                onAddStep={(component) =>
                  handleAddStepToActivity(activity.id, component)
                }
                onRemoveStep={(stepId) =>
                  handleRemoveStepFromActivity(activity.id, stepId)
                }
                onMoveStep={(fromIndex, toIndex) =>
                  handleMoveStepWithinActivity(activity.id, fromIndex, toIndex)
                }
                onChangeStepType={(stepId, component) =>
                  handleChangeStepComponent(activity.id, stepId, component)
                }
                onUpdateStepConfig={(stepId, config) =>
                  handleUpdateStepConfig(activity.id, stepId, config)
                }
              />
            ) : null}
            <div className="mt-auto">
              {isEditMode ? (
                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={activity.enabled !== false}
                      onChange={(event) =>
                        handleToggleActivityEnabled(activity.id, event.target.checked)
                      }
                      className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                    />
                    Activité visible pour les apprenants
                  </label>
                  <label className="block text-xs text-gray-600">Texte du bouton :</label>
                  <input
                    type="text"
                    value={activity.card.cta.label}
                    onChange={(e) => handleUpdateActivityText(activity.id, 'cta.label', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
                  />
                </div>
              ) : (
                <Link
                  to={activity.card.cta.to}
                  className="cta-button cta-button--primary inline-flex items-center gap-2"
                >
                  {activity.card.cta.label}
                  <span className="inline-block text-lg transition group-hover:translate-x-1">→</span>
                </Link>
              )}
            </div>
          </article>
        );
      })}
        {isEditMode ? (
          <button
            type="button"
            onClick={handleCreateStepSequenceActivity}
            disabled={!canUseStepSequenceShortcut}
            aria-disabled={!canUseStepSequenceShortcut}
            className={newSequenceButtonClasses}
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-current text-4xl font-light leading-none">
              +
            </span>
            <span className="text-sm font-semibold uppercase tracking-wide">
              {newSequenceLabel}
            </span>
            <span className={newSequenceDescriptionClasses}>{newSequenceDescription}</span>
          </button>
        ) : null}
      </div>
      </ActivityLayout>
    </>
  );
}

export default ActivitySelector;
