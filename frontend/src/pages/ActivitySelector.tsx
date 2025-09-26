import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import ActivityLayout from "../components/ActivityLayout";
import { AdminModal } from "../components/admin/AdminModal";
import {
  getProgress,
  admin,
  activities as activitiesClient,
  type ActivityConfig,
  type ActivitySelectorHeaderConfig,
  type ProgressResponse,
  type ActivityGenerationDetailsPayload,
  type GenerateActivityPayload,
  type ActivityGenerationAdminConfig,
} from "../api";
import {
  getDefaultActivityDefinitions,
  resolveActivityDefinition,
  serializeActivityDefinition,
  type ActivityConfigEntry,
  type ActivityDefinition,
} from "../config/activities";
import {
  MODEL_OPTIONS,
  THINKING_OPTIONS,
  VERBOSITY_OPTIONS,
  type ModelChoice,
  type ThinkingChoice,
  type VerbosityChoice,
} from "../config";
import {
  getStepComponent,
  STEP_COMPONENT_REGISTRY,
  StepSequenceContext,
  isCompositeStepDefinition,
  resolveStepComponentKey,
  type CompositeStepConfig,
  type StepDefinition,
} from "../modules/step-sequence";
import "../modules/step-sequence/modules";
import { useLTI } from "../hooks/useLTI";
import { useAdminAuth } from "../providers/AdminAuthProvider";

const ADMIN_ROLES = ["admin", "superadmin", "administrator"];

const STEP_SEQUENCE_COMPONENT_KEY = "step-sequence";

const STEP_TYPE_LABELS: Record<string, string> = {
  composite: "Étape composite",
  form: "Formulaire",
  "rich-content": "Contenu riche",
  video: "Vidéo",
  "workshop-context": "Atelier · Contexte",
  "workshop-comparison": "Atelier · Comparaison",
  "workshop-synthesis": "Atelier · Synthèse",
};

const HIDDEN_STEP_COMPONENT_PREFIXES = ["workshop-"];

const NOOP = () => {};

function extractErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const trimmed = error.message?.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { detail?: unknown };
      const detail = parsed?.detail;
      if (typeof detail === "string" && detail.trim().length > 0) {
        return detail.trim();
      }
    } catch {
      // ignore malformed JSON payloads
    }
  }

  return trimmed;
}

interface ActivityGenerationFormState {
  theme: string;
  audience: string;
  objectives: string;
  deliverable: string;
  constraints: string;
}

const DEFAULT_GENERATION_MODEL: ModelChoice =
  MODEL_OPTIONS.find((option) => option.value === "gpt-5-mini")?.value ??
  MODEL_OPTIONS[0]?.value ??
  "gpt-5-mini";

const DEFAULT_GENERATION_VERBOSITY: VerbosityChoice = "medium";
const DEFAULT_GENERATION_THINKING: ThinkingChoice = "medium";

const ACTIVITY_GENERATION_FIELDS: Array<{
  key: keyof ActivityGenerationFormState;
  label: string;
  description: string;
  placeholder: string;
  rows?: number;
}> = [
  {
    key: "theme",
    label: "Thématique de l'activité",
    description:
      "Décris le sujet central, le contexte ou la situation à partir de laquelle l'apprenant doit travailler.",
    placeholder: "Ex. : Évaluer l'impact de l'IA sur le service client d'une collectivité locale",
    rows: 2,
  },
  {
    key: "audience",
    label: "Profil des apprenants",
    description:
      "Précise le public cible, son rôle, son niveau d'expérience et ses attentes principales.",
    placeholder: "Ex. : Équipe support de première ligne, familiarisée avec les chatbots mais novice en IA générative",
    rows: 2,
  },
  {
    key: "objectives",
    label: "Objectifs pédagogiques",
    description:
      "Indique les compétences, connaissances ou livrables que les participants doivent maîtriser en fin d'activité.",
    placeholder:
      "Ex. : Identifier les risques d'automatisation, définir des garde-fous de confidentialité, préparer un plan d'amélioration",
    rows: 3,
  },
  {
    key: "deliverable",
    label: "Production attendue",
    description:
      "Mentionne ce que l'apprenant doit produire ou décider (plan d'action, grille d'analyse, message clé, etc.).",
    placeholder: "Ex. : Une synthèse argumentée et un plan de déploiement en trois phases",
    rows: 2,
  },
  {
    key: "constraints",
    label: "Contraintes ou ressources",
    description:
      "Ajoute les contraintes de ton, les formats imposés, les outils disponibles ou les ressources incontournables.",
    placeholder: "Ex. : Ton collaboratif, intégrer la charte interne, durée maximale 30 minutes, s'appuyer sur deux études de cas",
    rows: 3,
  },
];

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
  const componentKey = resolveStepComponentKey(step);
  const selectOptions = useMemo(() => {
    const mapped = stepTypeOptions.map((type) => ({
      value: type,
      label: getStepTypeLabel(type),
      disabled: false,
    }));

    if (componentKey && !stepTypeOptions.includes(componentKey)) {
      mapped.unshift({
        value: componentKey,
        label: getStepTypeLabel(componentKey),
        disabled: true,
      });
    }

    return mapped;
  }, [componentKey, stepTypeOptions]);
  const StepComponent = useMemo(
    () => (componentKey ? getStepComponent(componentKey) : undefined),
    [componentKey]
  );

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
      stepCount: 1,
      steps: [step],
      payloads: {},
      isEditMode: true,
      onAdvance: NOOP,
      onUpdateConfig: handleConfigUpdate,
      goToStep: () => {},
      activityContext: null,
    }),
    [handleConfigUpdate, step]
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
            value={componentKey ?? ""}
            onChange={handleTypeChange}
            className="rounded-lg border border-orange-200 px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-orange-400 focus:outline-none"
            disabled={selectOptions.length === 0}
          >
            {selectOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-3 rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm">
          {StepComponent ? (
            <StepSequenceContext.Provider value={contextValue}>
              <StepComponent
                definition={step}
                config={isCompositeStepDefinition(step) ? step.composite : step.config}
                payload={undefined}
                isActive
                isEditMode
                onAdvance={NOOP}
                onUpdateConfig={handleConfigUpdate}
              />
            </StepSequenceContext.Provider>
          ) : (
            <p className="text-sm text-orange-700">
              Aucun composant enregistré pour « {componentKey ?? "inconnu"} ».
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
    () =>
      Object.keys(STEP_COMPONENT_REGISTRY)
        .filter(
          (key) =>
            !HIDDEN_STEP_COMPONENT_PREFIXES.some((prefix) =>
              key.startsWith(prefix)
            )
        )
        .sort((a, b) => a.localeCompare(b)),
    []
  );

  const buildEditableActivities = useCallback(
    (
      storedActivities?: ActivityConfigEntry[] | null,
      options?: { includeMissingDefaults?: boolean }
    ) => {
      const includeMissingDefaults = options?.includeMissingDefaults ?? true;

      if (storedActivities == null) {
        if (!includeMissingDefaults) {
          return [];
        }
        return defaultActivities.map((activity) =>
          resolveActivityDefinition({ id: activity.id })
        );
      }

      if (storedActivities.length === 0) {
        if (!includeMissingDefaults) {
          return [];
        }
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

      if (includeMissingDefaults) {
        for (const activity of defaultActivities) {
          if (!seen.has(activity.id)) {
            merged.push(resolveActivityDefinition({ id: activity.id }));
          }
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
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [generationForm, setGenerationForm] =
    useState<ActivityGenerationFormState>({
      theme: "",
      audience: "",
      objectives: "",
      deliverable: "",
      constraints: "",
    });
  const [savedActivityGenerationConfig, setSavedActivityGenerationConfig] =
    useState<ActivityGenerationAdminConfig | null>(null);
  const [generationModel, setGenerationModel] = useState<ModelChoice>(
    DEFAULT_GENERATION_MODEL
  );
  const [generationVerbosity, setGenerationVerbosity] =
    useState<VerbosityChoice>(DEFAULT_GENERATION_VERBOSITY);
  const [generationThinking, setGenerationThinking] =
    useState<ThinkingChoice>(DEFAULT_GENERATION_THINKING);
  const [isGeneratingActivity, setIsGeneratingActivity] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationSuccessMessage, setGenerationSuccessMessage] =
    useState<string | null>(null);
  const [generationReasoningSummary, setGenerationReasoningSummary] =
    useState<string | null>(null);
  const generationControllerRef = useRef<AbortController | null>(null);
  const loadConfigMutexRef = useRef(false);
  const [generationStatusMessage, setGenerationStatusMessage] =
    useState<string | null>(null);
  const [activeGenerationJobId, setActiveGenerationJobId] =
    useState<string | null>(null);
  const [lastGeneratedActivityId, setLastGeneratedActivityId] =
    useState<string | null>(null);
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

  const existingActivityIds = useMemo(
    () => editableActivities.map((activity) => activity.id),
    [editableActivities]
  );

  const trimmedGenerationForm = useMemo(
    () => ({
      theme: generationForm.theme.trim(),
      audience: generationForm.audience.trim(),
      objectives: generationForm.objectives.trim(),
      deliverable: generationForm.deliverable.trim(),
      constraints: generationForm.constraints.trim(),
    }),
    [generationForm]
  );

  const generationModelHelper = useMemo(
    () =>
      MODEL_OPTIONS.find((option) => option.value === generationModel)?.helper ??
      "",
    [generationModel]
  );

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

  const generateActivityButtonClasses = `group flex min-h-[18rem] w-full flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed p-8 text-center transition ${
    canUseStepSequenceShortcut
      ? "border-sky-300 bg-white/70 text-sky-700 hover:border-sky-400 hover:bg-sky-50 hover:text-sky-800"
      : "cursor-not-allowed border-gray-200 bg-gray-50/80 text-gray-400"
  }`;
  const generateActivityLabel = canUseStepSequenceShortcut
    ? "Générer une activité avec l'IA"
    : "Modules StepSequence indisponibles";
  const generateActivityDescription = canUseStepSequenceShortcut
    ? "Décris tes besoins et laisse l’IA proposer une séquence personnalisée."
    : "Ajoutez un module d’étape pour débloquer la génération automatique.";
  const generateActivityDescriptionClasses = `text-xs ${
    canUseStepSequenceShortcut
      ? "text-sky-700 opacity-80"
      : "text-gray-400"
  }`;

  useEffect(() => {
    return () => {
      generationControllerRef.current?.abort();
    };
  }, []);

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
    if (!isEditMode) {
      setGenerationSuccessMessage(null);
      setGenerationReasoningSummary(null);
      setLastGeneratedActivityId(null);
    }
  }, [isEditMode]);

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

  const loadSavedConfig = useCallback(async () => {
    if (loadConfigMutexRef.current) {
      return;
    }

    loadConfigMutexRef.current = true;
    setIsLoading(true);
    try {
      const response = await activitiesClient.getConfig();
      const rawActivities = Array.isArray(response.activities)
        ? (response.activities as ActivityConfigEntry[])
        : undefined;
      const includeMissingDefaults = response.usesDefaultFallback !== false;
      setEditableActivities(
        buildEditableActivities(rawActivities, { includeMissingDefaults })
      );
      const savedHeader = sanitizeHeaderConfig(response.activitySelectorHeader);
      setHeaderOverrides(savedHeader ?? {});
      const savedGenerationConfig =
        response.activityGeneration &&
        typeof response.activityGeneration === "object"
          ? (response.activityGeneration as ActivityGenerationAdminConfig)
          : null;
      setSavedActivityGenerationConfig(savedGenerationConfig);
    } catch (error) {
      console.warn(
        "Aucune configuration sauvegardée trouvée, utilisation de la configuration par défaut",
        error
      );
      setEditableActivities(buildEditableActivities());
      setHeaderOverrides({});
      setSavedActivityGenerationConfig(null);
    } finally {
      setIsLoading(false);
      loadConfigMutexRef.current = false;
    }
  }, [buildEditableActivities]);

  useEffect(() => {
    void loadSavedConfig();
  }, [loadSavedConfig]);

  const refreshGeneratedActivity = useCallback(
    async (activityId: string | null) => {
      if (!activityId) {
        return null;
      }

      try {
        const response = await admin.activities.get(token);
        const rawActivities = Array.isArray(response.activities)
          ? (response.activities as ActivityConfigEntry[])
          : [];
        const target = rawActivities.find((activity) => activity.id === activityId);
        if (!target) {
          return null;
        }

        const resolved = resolveActivityDefinition(target);
        setEditableActivities((previous) => {
          const filtered = previous.filter(
            (activity) => activity.id !== resolved.id
          );
          return [...filtered, resolved];
        });

        return resolved;
      } catch (error) {
        throw error;
      }
    },
    [token]
  );

  useEffect(() => {
    if (!activeGenerationJobId) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    generationControllerRef.current?.abort();
    generationControllerRef.current = controller;

    const waitFor = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }

        let timeoutId: number;

        const onAbort = () => {
          window.clearTimeout(timeoutId);
          reject(new DOMException("Aborted", "AbortError"));
        };

        controller.signal.addEventListener("abort", onAbort, { once: true });

        timeoutId = window.setTimeout(() => {
          controller.signal.removeEventListener("abort", onAbort);
          resolve();
        }, ms);
      });

    const monitor = async () => {
      try {
        while (!cancelled) {
          const status = await admin.activities.getGenerationJob(
            activeGenerationJobId,
            token,
            { signal: controller.signal }
          );

          if (status.message) {
            setGenerationStatusMessage(status.message);
          }
          if (status.reasoningSummary) {
            setGenerationReasoningSummary(status.reasoningSummary.trim());
          }

          if (status.status === "complete") {
            const reasoning = status.reasoningSummary?.trim() ?? null;
            setGenerationReasoningSummary(reasoning);
            setGenerationStatusMessage(null);
            setGenerationError(null);

            try {
              const resolved = await refreshGeneratedActivity(
                status.activityId ?? null
              );
              const titleCandidate =
                (status.activityTitle && status.activityTitle.trim()) ||
                resolved?.card?.title?.trim() ||
                resolved?.id;

              if (resolved?.id) {
                setLastGeneratedActivityId(resolved.id);
              }

              setGenerationSuccessMessage(
                titleCandidate
                  ? `L’activité « ${titleCandidate} » a été générée et ajoutée à la configuration.`
                  : "Une nouvelle activité a été générée et ajoutée à la configuration."
              );
            } catch (error) {
              console.error("Erreur lors du chargement de l'activité générée:", error);
              const detail =
                extractErrorMessage(error) ||
                (error instanceof Error ? error.message : null);
              setGenerationError(
                detail
                  ?? "L’activité a été générée mais n’a pas pu être chargée automatiquement."
              );
            }

            setActiveGenerationJobId(null);
            return;
          }

          if (status.status === "error") {
            const detail =
              (status.error && status.error.trim()) ||
              status.message?.trim() ||
              null;
            setGenerationError(
              detail ?? "La génération de l'activité a échoué. Veuillez réessayer."
            );
            setGenerationReasoningSummary(null);
            setGenerationStatusMessage(null);
            setActiveGenerationJobId(null);
            return;
          }

          await waitFor(1500);
        }
      } catch (error) {
        if ((error as DOMException).name === "AbortError" || cancelled) {
          return;
        }
        console.error("Erreur lors du suivi de la génération:", error);
        const detail =
          extractErrorMessage(error) ||
          (error instanceof Error ? error.message : null);
        setGenerationError(
          detail ?? "La génération de l'activité a été interrompue."
        );
        setGenerationReasoningSummary(null);
        setGenerationStatusMessage(null);
        setActiveGenerationJobId(null);
      } finally {
        if (generationControllerRef.current === controller) {
          generationControllerRef.current = null;
        }
      }
    };

    void monitor();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeGenerationJobId, refreshGeneratedActivity, token]);

  const handleMoveActivity = (fromIndex: number, toIndex: number) => {
    if (!isEditMode) return;

    const newActivities = [...editableActivities];
    const [movedActivity] = newActivities.splice(fromIndex, 1);
    newActivities.splice(toIndex, 0, movedActivity);
    setEditableActivities(newActivities);
  };

  const handleRemoveActivity = useCallback(
    (activityId: string) => {
      if (!isEditMode) return;

      setEditableActivities((prev) =>
        prev.filter((activity) => activity.id !== activityId)
      );
      setDraggedIndex(null);
      setDragOverIndex(null);
    },
    [isEditMode]
  );

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
          const nextStep: StepDefinition =
            component === "composite"
              ? {
                  id: stepId,
                  component,
                  composite: {
                    modules: [],
                    autoAdvance: null,
                    continueLabel: null,
                  },
                }
              : {
                  id: stepId,
                  component,
                };
          const nextSteps: StepDefinition[] = [
            ...baseSteps.map((step) => ({ ...step })),
            nextStep,
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
            if (component === "composite") {
              const existingComposite = isCompositeStepDefinition(step)
                ? step.composite
                : undefined;
              return {
                id: step.id,
                component,
                composite:
                  existingComposite ?? {
                    modules: [],
                    autoAdvance: null,
                    continueLabel: null,
                  },
              };
            }
            return {
              id: step.id,
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
            if (isCompositeStepDefinition(step)) {
              return {
                ...step,
                composite:
                  (config as CompositeStepConfig) ?? {
                    modules: [],
                    autoAdvance: null,
                    continueLabel: null,
                  },
              };
            }
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

      const payload: ActivityConfig = {
        activities: serializedActivities,
        activitySelectorHeader: headerConfig,
      };
      if (savedActivityGenerationConfig) {
        payload.activityGeneration = savedActivityGenerationConfig;
      }

      await admin.activities.save(payload, token);
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

  const handleGenerationFieldChange = useCallback(
    (field: keyof ActivityGenerationFormState, value: string) => {
      setGenerationForm((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    []
  );

  const handleOpenGenerationModal = useCallback(() => {
    setGenerationError(null);
    setGenerationStatusMessage(null);
    setIsGenerateModalOpen(true);
  }, []);

  const handleCloseGenerationModal = useCallback(() => {
    if (isGeneratingActivity) {
      return;
    }
    setIsGenerateModalOpen(false);
  }, [isGeneratingActivity]);

  const handleDismissGenerationMessage = useCallback(() => {
    setGenerationSuccessMessage(null);
    setGenerationReasoningSummary(null);
    setLastGeneratedActivityId(null);
    setGenerationStatusMessage(null);
  }, []);

  const handleDismissGenerationError = useCallback(() => {
    setGenerationError(null);
    setGenerationStatusMessage(null);
  }, []);

  const handleSubmitGeneration = useCallback(async () => {
    if (isGeneratingActivity) {
      return;
    }
    setIsGeneratingActivity(true);
    setGenerationError(null);
    setGenerationReasoningSummary(null);
    setGenerationSuccessMessage(null);
    setGenerationStatusMessage("Initialisation de la génération...");
    setLastGeneratedActivityId(null);
    setActiveGenerationJobId(null);

    generationControllerRef.current?.abort();
    const controller = new AbortController();
    generationControllerRef.current = controller;

    try {
      const details: ActivityGenerationDetailsPayload = {};
      if (trimmedGenerationForm.theme) {
        details.theme = trimmedGenerationForm.theme;
      }
      if (trimmedGenerationForm.audience) {
        details.audience = trimmedGenerationForm.audience;
      }
      if (trimmedGenerationForm.objectives) {
        details.objectives = trimmedGenerationForm.objectives;
      }
      if (trimmedGenerationForm.deliverable) {
        details.deliverable = trimmedGenerationForm.deliverable;
      }
      if (trimmedGenerationForm.constraints) {
        details.constraints = trimmedGenerationForm.constraints;
      }

      const payload: GenerateActivityPayload = {
        model: generationModel,
        verbosity: generationVerbosity,
        thinking: generationThinking,
        details,
        existingActivityIds,
      };

      const job = await admin.activities.generate(payload, token, {
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      if (!job?.jobId) {
        throw new Error("Réponse inattendue du service de génération.");
      }

      if (job.status === "error") {
        const detail =
          (job.error && job.error.trim()) || job.message?.trim() || null;
        throw new Error(detail ?? "La génération de l'activité a échoué.");
      }

      setActiveGenerationJobId(job.jobId);
      setIsGenerateModalOpen(false);
      setGenerationForm({
        theme: "",
        audience: "",
        objectives: "",
        deliverable: "",
        constraints: "",
      });

      if (job.message) {
        setGenerationStatusMessage(job.message);
      } else {
        setGenerationStatusMessage("Tâche de génération enregistrée.");
      }
      if (job.reasoningSummary) {
        setGenerationReasoningSummary(job.reasoningSummary.trim());
      }
    } catch (error) {
      if ((error as DOMException).name === "AbortError") {
        return;
      }
      console.error("Erreur lors de la génération d'activité:", error);
      const detail =
        extractErrorMessage(error) ||
        (error instanceof Error ? error.message : null);
      setGenerationError(
        detail ?? "La génération de l'activité a échoué. Veuillez réessayer."
      );
      setGenerationStatusMessage(null);
      setActiveGenerationJobId(null);
    } finally {
      setIsGeneratingActivity(false);
      if (generationControllerRef.current === controller) {
        generationControllerRef.current = null;
      }
    }
  }, [
    existingActivityIds,
    generationModel,
    generationThinking,
    generationVerbosity,
    isGeneratingActivity,
    trimmedGenerationForm,
    token,
  ]);

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
            <>
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
                    Vous pouvez maintenant modifier les textes, réorganiser les activités par glisser-déposer ou avec les flèches, ajouter ou supprimer des points clés et retirer des activités de la sélection.
                  </p>
                </div>
              </div>
            </>
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
      {activeGenerationJobId ? (
        <div className="animate-section mb-6 space-y-3 rounded-3xl border border-sky-200/60 bg-sky-50/80 p-6 text-sky-900 shadow-sm backdrop-blur">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-700/80">
              Génération d’activité en cours
            </p>
            <p className="text-sm leading-relaxed md:text-base">
              Le backend crée actuellement l’activité. Vous recevrez une notification dès qu’elle sera prête.
            </p>
            {generationStatusMessage ? (
              <p className="text-xs text-sky-800/80">{generationStatusMessage}</p>
            ) : null}
          </div>
        </div>
      ) : null}
      {generationError ? (
        <div className="animate-section mb-6 space-y-3 rounded-3xl border border-red-200/80 bg-red-50/90 p-6 text-red-900 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-red-700/80">
                Génération indisponible
              </p>
              <p className="text-sm leading-relaxed md:text-base">{generationError}</p>
            </div>
            <button
              type="button"
              onClick={handleDismissGenerationError}
              className="inline-flex items-center justify-center self-start rounded-full border border-red-400/40 px-3 py-1 text-xs font-semibold text-red-700 transition hover:border-red-500/70 hover:text-red-900"
            >
              Fermer
            </button>
          </div>
        </div>
      ) : null}
      {generationSuccessMessage ? (
        <div className="animate-section mb-6 space-y-3 rounded-3xl border border-sky-200/70 bg-sky-50/90 p-6 text-sky-900 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-sky-700/80">
                Activité générée
              </p>
              <p className="text-sm leading-relaxed md:text-base">
                {generationSuccessMessage}
              </p>
              {generationReasoningSummary ? (
                <p className="text-xs text-sky-800/80">
                  {generationReasoningSummary}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleDismissGenerationMessage}
              className="inline-flex items-center justify-center self-start rounded-full border border-sky-400/40 px-3 py-1 text-xs font-semibold text-sky-700 transition hover:border-sky-500/70 hover:text-sky-900"
            >
              Fermer
            </button>
          </div>
          <p className="text-xs text-sky-800/70">
            Pensez à enregistrer vos modifications pour rendre l’activité disponible aux apprenants.
          </p>
        </div>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2">
        {activitiesToDisplay.map((activity: ActivityDefinition, index: number) => {
          const isDisabled = activity.enabled === false;
          const isCompleted = completedMap[activity.id];
          const isRecentlyGenerated =
            isEditMode && !isDisabled && lastGeneratedActivityId === activity.id;
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
          const generatedClasses = isRecentlyGenerated
            ? "border-sky-200 ring-4 ring-sky-200"
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
              className={`group relative flex h-full flex-col gap-6 rounded-3xl border p-8 shadow-sm backdrop-blur transition ${hoverClasses} ${statusClasses} ${editClasses} ${generatedClasses} ${dragClasses}`.trim()}
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
              <div className="absolute right-6 top-6 flex flex-col items-end gap-2">
                <label className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-gray-600 shadow-sm">
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
                <button
                  type="button"
                  onClick={() => {
                    const shouldRemove = window.confirm(`Supprimer l’activité « ${activity.card.title} » ?`);
                    if (shouldRemove) {
                      handleRemoveActivity(activity.id);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white/80 px-3 py-1 text-xs font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50"
                  aria-label={`Supprimer ${activity.card.title}`}
                >
                  Supprimer
                  <span aria-hidden="true">×</span>
                </button>
              </div>
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
        {activitiesToDisplay.length === 0 && !isEditMode ? (
          <div className="col-span-full flex flex-col items-center justify-center rounded-3xl border border-dashed border-gray-300 bg-white/70 p-8 text-center text-sm text-gray-500">
            Aucune activité n’est disponible pour le moment.
          </div>
        ) : null}
        {isEditMode ? (
          <>
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
            <button
              type="button"
              onClick={handleOpenGenerationModal}
              disabled={!canUseStepSequenceShortcut}
              aria-disabled={!canUseStepSequenceShortcut}
              className={generateActivityButtonClasses}
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full border border-current text-3xl leading-none">
                🪄
              </span>
              <span className="text-sm font-semibold uppercase tracking-wide">
                {generateActivityLabel}
              </span>
              <span className={generateActivityDescriptionClasses}>
                {generateActivityDescription}
              </span>
            </button>
          </>
        ) : null}
      </div>
      </ActivityLayout>
      <AdminModal
        open={isGenerateModalOpen}
        onClose={handleCloseGenerationModal}
        title="Générer une activité avec l'IA"
        description="Décris la situation pédagogique pour recevoir une proposition d'activité StepSequence personnalisée."
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={handleCloseGenerationModal}
              disabled={isGeneratingActivity}
              className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 text-sm font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-charcoal)]/40 hover:text-[color:var(--brand-black)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSubmitGeneration}
              disabled={isGeneratingActivity}
              className="inline-flex items-center justify-center rounded-full border border-sky-500/50 bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:border-sky-600 hover:bg-sky-700 disabled:cursor-not-allowed disabled:border-sky-200 disabled:bg-sky-200"
            >
              {isGeneratingActivity ? "Génération en cours..." : "Générer l'activité"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
          L’IA propose une base structurée (carte d’activité, header et étapes). Vous pourrez ensuite modifier chaque élément
          avant d’enregistrer la configuration.
        </p>
        <p className="text-xs text-[color:var(--brand-charcoal)]/70">
          Tous les champs ci-dessous sont optionnels&nbsp;: indique seulement les éléments qui apportent du contexte à la génération.
        </p>
        {generationError ? (
          <div className="rounded-xl border border-red-200/80 bg-red-50/80 p-3 text-sm text-red-700">
            {generationError}
          </div>
        ) : null}
        {isGeneratingActivity ? (
          <div className="space-y-1 rounded-xl border border-sky-200/70 bg-sky-50/80 p-3 text-xs text-sky-900">
            <p className="text-sm font-semibold text-sky-900">Génération en cours…</p>
            {generationStatusMessage ? (
              <p className="text-xs text-sky-900/80">{generationStatusMessage}</p>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-4">
          {ACTIVITY_GENERATION_FIELDS.map((field) => (
            <label
              key={field.key}
              className="flex flex-col gap-2 text-sm text-[color:var(--brand-charcoal)]"
            >
              <span className="font-semibold text-[color:var(--brand-black)]">{field.label}</span>
              <span className="text-xs text-[color:var(--brand-charcoal)]/70">
                {field.description}
              </span>
              <textarea
                value={generationForm[field.key]}
                onChange={(event) =>
                  handleGenerationFieldChange(field.key, event.target.value)
                }
                rows={field.rows ?? 3}
                placeholder={field.placeholder}
                className="resize-none rounded-xl border border-[color:var(--brand-charcoal)]/15 px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-orange-400 focus:outline-none focus:ring-0"
              />
            </label>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-2 text-sm text-[color:var(--brand-charcoal)]">
            <span className="font-semibold text-[color:var(--brand-black)]">Modèle</span>
            <select
              value={generationModel}
              onChange={(event) => setGenerationModel(event.target.value as ModelChoice)}
              className="rounded-xl border border-[color:var(--brand-charcoal)]/15 px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-orange-400 focus:outline-none"
            >
              {MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {generationModelHelper ? (
              <span className="text-xs text-[color:var(--brand-charcoal)]/70">
                {generationModelHelper}
              </span>
            ) : null}
          </label>
          <label className="flex flex-col gap-2 text-sm text-[color:var(--brand-charcoal)]">
            <span className="font-semibold text-[color:var(--brand-black)]">Verbosité</span>
            <select
              value={generationVerbosity}
              onChange={(event) =>
                setGenerationVerbosity(event.target.value as VerbosityChoice)
              }
              className="rounded-xl border border-[color:var(--brand-charcoal)]/15 px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-orange-400 focus:outline-none"
            >
              {VERBOSITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm text-[color:var(--brand-charcoal)]">
            <span className="font-semibold text-[color:var(--brand-black)]">Raisonnement</span>
            <select
              value={generationThinking}
              onChange={(event) =>
                setGenerationThinking(event.target.value as ThinkingChoice)
              }
              className="rounded-xl border border-[color:var(--brand-charcoal)]/15 px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-orange-400 focus:outline-none"
            >
              {THINKING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </AdminModal>
    </>
  );
}

export default ActivitySelector;
