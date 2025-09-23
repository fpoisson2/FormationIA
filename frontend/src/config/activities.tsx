import React, {
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

import ActivityLayout from "../components/ActivityLayout";
import { admin, activities as activitiesClient } from "../api";
import { useAdminAuth } from "../providers/AdminAuthProvider";
import ClarityPath from "../pages/ClarityPath";
import ClarteDabord from "../pages/ClarteDabord";
import PromptDojo from "../pages/PromptDojo";
import WorkshopExperience from "../pages/WorkshopExperience";
import { StepSequenceActivity, type StepDefinition } from "../modules/step-sequence";
const LazyExplorateurIA = lazy(() => import("../pages/ExplorateurIA"));

const ExplorateurIALoader: ComponentType<ActivityProps> = (props) => (
  <React.Suspense
    fallback={
      <div className="p-8 text-center text-sm text-slate-500">
        Chargement de l'activité Explorateur IA…
      </div>
    }
  >
    <LazyExplorateurIA {...props} />
  </React.Suspense>
);

export interface ActivityHeaderConfig {
  eyebrow: string;
  title: string;
  subtitle?: string;
  badge?: string;
  titleAlign?: "left" | "center";
}

export interface ActivityLayoutOptions {
  activityId?: string;
  actions?: ReactNode;
  headerChildren?: ReactNode;
  beforeHeader?: ReactNode;
  outerClassName?: string;
  innerClassName?: string;
  headerClassName?: string;
  contentClassName?: string;
  contentAs?: keyof JSX.IntrinsicElements;
  withLandingGradient?: boolean;
  useDynamicViewportHeight?: boolean;
  withBasePadding?: boolean;
  withBaseContentSpacing?: boolean;
  withBaseInnerGap?: boolean;
}

export interface ActivityLayoutConfig
  extends ActivityHeaderConfig,
    ActivityLayoutOptions {}

export interface ActivityCardDefinition {
  title: string;
  description: string;
  highlights: string[];
  cta: {
    label: string;
    to: string;
  };
}

export interface ActivityProps {
  activityId: string;
  completionId: string;
  header: ActivityHeaderConfig;
  card: ActivityCardDefinition;
  layout: ActivityLayoutConfig;
  layoutOverrides: Partial<ActivityLayoutConfig>;
  setLayoutOverrides: (overrides: Partial<ActivityLayoutConfig>) => void;
  resetLayoutOverrides: () => void;
  navigateToActivities: () => void;
  isEditMode?: boolean;
  enabled?: boolean;
  stepSequence?: StepDefinition[];
}

export const COMPONENT_REGISTRY = {
  "workshop-experience": WorkshopExperience,
  "prompt-dojo": PromptDojo,
  "clarity-path": ClarityPath,
  "clarte-dabord": ClarteDabord,
  "explorateur-ia": ExplorateurIALoader,
  "step-sequence": StepSequenceActivity,
} as const satisfies Record<string, ComponentType<ActivityProps>>;

export type ActivityComponentKey = keyof typeof COMPONENT_REGISTRY;

interface ActivityCatalogEntryDefaults {
  completionId?: string;
  header: ActivityHeaderConfig;
  layout?: ActivityLayoutOptions;
  card: ActivityCardDefinition;
  enabled?: boolean;
  stepSequence?: StepDefinition[];
}

interface ActivityCatalogEntry {
  componentKey: ActivityComponentKey;
  path: string;
  defaults: ActivityCatalogEntryDefaults;
}

export const ACTIVITY_CATALOG: Record<string, ActivityCatalogEntry> = {
  atelier: {
    componentKey: "workshop-experience",
    path: "/atelier/*",
    defaults: {
      completionId: "atelier",
      enabled: true,
      header: {
        eyebrow: "Atelier comparatif IA",
        title: "Cadrez, comparez, synthétisez vos essais IA",
        subtitle:
          "Suivez une progression claire pour préparer votre contexte, explorer deux profils IA en flux continu puis transformer les sorties en ressources réutilisables.",
        badge: "Trois étapes guidées",
      },
      layout: {
        activityId: "atelier",
        headerClassName: "space-y-8",
        contentClassName: "space-y-12",
      },
      card: {
        title: "Atelier comparatif IA",
        description:
          "Objectif : cadrer ta demande, comparer deux configurations IA et capitaliser sur les essais.",
        highlights: [
          "Définir le contexte et les attentes",
          "Tester modèle, verbosité et raisonnement",
          "Assembler une synthèse réutilisable",
        ],
        cta: {
          label: "Lancer l’atelier",
          to: "/atelier/etape-1",
        },
      },
    },
  },
  "prompt-dojo": {
    componentKey: "prompt-dojo",
    path: "/prompt-dojo",
    defaults: {
      enabled: true,
      header: {
        eyebrow: "Prompt Dojo",
        title: "Affûte ton prompt mission par mission",
        subtitle:
          "Choisis un défi parmi les missions et franchis les étapes pour décrocher ton badge en atteignant le score IA visé.",
        badge: "Mode entraînement",
      },
      layout: {
        contentAs: "div",
        contentClassName: "gap-0",
      },
      card: {
        title: "Prompt Dojo — Mission débutant",
        description:
          "Objectif : t’entraîner à affiner une consigne en suivant des défis progressifs.",
        highlights: [
          "Défis à difficulté graduelle",
          "Retour immédiat sur la qualité du prompt",
          "Construction d’une version finale personnalisée",
        ],
        cta: {
          label: "Entrer dans le dojo",
          to: "/prompt-dojo",
        },
      },
    },
  },
  clarity: {
    componentKey: "clarity-path",
    path: "/parcours-clarte",
    defaults: {
      enabled: true,
      header: {
        eyebrow: "Parcours de la clarté",
        title: "Guide le bonhomme avec une consigne limpide",
        subtitle:
          "Écris une instruction en langue naturelle. Le backend demande au modèle gpt-5-nano un plan complet, valide la trajectoire puis te montre l’exécution pas à pas.",
        badge: "Mode jeu",
      },
      layout: {
        innerClassName: "relative",
        contentAs: "div",
        contentClassName: "gap-10",
      },
      card: {
        title: "Parcours de la clarté",
        description:
          "Objectif : expérimenter la précision des consignes sur un parcours 10×10.",
        highlights: [
          "Plan d’action IA généré avant l’animation",
          "Visualisation pas à pas avec obstacles",
          "Analyse des tentatives et du surcoût",
        ],
        cta: {
          label: "Tester la clarté",
          to: "/parcours-clarte",
        },
      },
    },
  },
  "clarte-dabord": {
    componentKey: "clarte-dabord",
    path: "/clarte-dabord",
    defaults: {
      enabled: true,
      header: {
        eyebrow: "Clarté d'abord !",
        title: "Identifie ce qu'il fallait dire dès la première consigne",
        subtitle:
          "Tu joues l'IA : l'usager précise son besoin manche après manche. Observe ce qui manquait au brief initial et retiens la checklist idéale.",
        badge: "Trois manches guidées",
      },
      layout: {
        contentAs: "div",
        contentClassName: "gap-10",
      },
      card: {
        title: "Clarté d’abord !",
        description:
          "Objectif : mesurer l’impact d’un brief incomplet et révéler la checklist idéale.",
        highlights: [
          "Deux missions thématiques en trois manches",
          "Champs guidés avec validations pédagogiques",
          "Révélation finale et export JSON du menu",
        ],
        cta: {
          label: "Lancer Clarté d’abord !",
          to: "/clarte-dabord",
        },
      },
    },
  },
  "explorateur-ia": {
    componentKey: "explorateur-ia",
    path: "/explorateur-ia",
    defaults: {
      completionId: "explorateur-ia",
      enabled: true,
      header: {
        eyebrow: "Activité 5",
        title: "L’Explorateur IA",
        subtitle:
          "Parcours une mini-ville façon Game Boy pour valider quatre compétences IA sans jamais taper au clavier.",
        badge: "Ville interactive",
      },
      layout: {
        outerClassName:
          "flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden px-0 pt-0 pb-0 lg:h-auto lg:min-h-screen lg:px-6 lg:pt-10 lg:pb-16",
        innerClassName:
          "flex h-full min-h-0 flex-1 w-full max-w-none gap-0 lg:h-auto lg:gap-12",
        headerClassName: "hidden lg:block",
        contentClassName:
          "flex h-full min-h-0 flex-1 flex-col space-y-0 lg:h-auto lg:space-y-12",
        withLandingGradient: false,
        useDynamicViewportHeight: true,
        withBasePadding: false,
        withBaseContentSpacing: false,
        withBaseInnerGap: false,
      },
      card: {
        title: "L’Explorateur IA",
        description:
          "Objectif : compléter un parcours ludique mêlant quiz, drag-and-drop, décisions et dilemmes éthiques.",
        highlights: [
          "Déplacements façon jeu vidéo et interactions à la souris",
          "Quatre mini-activités pédagogiques sans saisie de texte",
          "Export JSON immédiat et impression PDF du bilan",
        ],
        cta: {
          label: "Entrer dans la ville",
          to: "/explorateur-ia",
        },
      },
    },
  },
};

export interface ActivityCardOverrides
  extends Partial<Omit<ActivityCardDefinition, "highlights" | "cta">> {
  highlights?: string[];
  cta?: Partial<ActivityCardDefinition["cta"]>;
}

export interface ActivityConfigOverrides {
  header?: Partial<ActivityHeaderConfig>;
  layout?: Partial<ActivityLayoutOptions>;
  card?: ActivityCardOverrides;
  completionId?: string;
  stepSequence?: StepDefinition[];
}

export interface ActivityConfigEntry {
  id: string;
  componentKey?: string;
  path?: string;
  completionId?: string;
  enabled?: boolean;
  header?: ActivityHeaderConfig;
  layout?: ActivityLayoutOptions;
  card?: ActivityCardDefinition;
  stepSequence?: StepDefinition[];
  overrides?: ActivityConfigOverrides | null;
}

export interface ActivityDefinition {
  id: string;
  componentKey: ActivityComponentKey | string;
  path: string;
  component: ComponentType<ActivityProps> | null;
  completionId?: string;
  header: ActivityHeaderConfig;
  layout?: ActivityLayoutOptions;
  card: ActivityCardDefinition;
  enabled?: boolean;
  stepSequence?: StepDefinition[];
}

const ADMIN_ROLES = ["admin", "superadmin", "administrator"];

const SERIALIZABLE_LAYOUT_KEYS: Array<keyof ActivityLayoutOptions> = [
  "activityId",
  "outerClassName",
  "innerClassName",
  "headerClassName",
  "contentClassName",
  "contentAs",
  "withLandingGradient",
  "useDynamicViewportHeight",
  "withBasePadding",
  "withBaseContentSpacing",
  "withBaseInnerGap",
];

function resolveComponent(
  key: string | undefined
): ComponentType<ActivityProps> | null {
  if (!key) {
    return null;
  }
  return (
    COMPONENT_REGISTRY as Record<string, ComponentType<ActivityProps>>
  )[key] ?? null;
}

function cloneHeader(header: ActivityHeaderConfig): ActivityHeaderConfig {
  return { ...header };
}

function cloneLayout(
  layout: ActivityLayoutOptions | undefined
): ActivityLayoutOptions | undefined {
  if (!layout) {
    return undefined;
  }
  return { ...layout };
}

function cloneCard(card: ActivityCardDefinition): ActivityCardDefinition {
  return {
    ...card,
    highlights: [...card.highlights],
    cta: { ...card.cta },
  };
}

function cloneStepSequence(
  steps: StepDefinition[] | undefined
): StepDefinition[] | undefined {
  if (!steps) {
    return undefined;
  }
  return steps.map((step) => ({ ...step }));
}

function mergeStepSequence(
  base: StepDefinition[] | undefined,
  override: StepDefinition[] | undefined
): StepDefinition[] | undefined {
  if (!base && !override) {
    return undefined;
  }
  if (!base || base.length === 0) {
    return cloneStepSequence(override);
  }
  if (!override || override.length === 0) {
    return cloneStepSequence(base);
  }

  const baseMap = new Map(base.map((step) => [step.id, step]));
  const overrideMap = new Map(override.map((step) => [step.id, step]));
  const mergedBase = base.map((step) => {
    const overrideStep = overrideMap.get(step.id);
    return overrideStep ? { ...step, ...overrideStep } : { ...step };
  });

  const mergedExtra = override
    .filter((step) => !baseMap.has(step.id))
    .map((step) => ({ ...step }));

  return [...mergedBase, ...mergedExtra];
}

function buildFallbackDefinition(
  id: string,
  entry: ActivityConfigEntry | null | undefined
): ActivityDefinition {
  const fallbackPath = entry?.path ?? `/activites/${id}`;
  const baseHeader: ActivityHeaderConfig = entry?.header
    ? cloneHeader(entry.header)
    : {
        eyebrow: "Activité",
        title: `Activité ${id}`,
      };
  if (!baseHeader.title) {
    baseHeader.title = `Activité ${id}`;
  }

  const rawCard = entry?.card;
  const baseCard: ActivityCardDefinition = rawCard
    ? {
        ...rawCard,
        highlights: Array.isArray(rawCard.highlights)
          ? [...rawCard.highlights]
          : [],
        cta: rawCard.cta
          ? { ...rawCard.cta }
          : { label: "Découvrir", to: fallbackPath },
      }
    : {
        title: baseHeader.title,
        description: "",
        highlights: [],
        cta: { label: "Découvrir", to: fallbackPath },
      };

  if (!baseCard.cta) {
    baseCard.cta = { label: "Découvrir", to: fallbackPath };
  }

  const componentKey = entry?.componentKey ?? "unknown";

  return {
    id,
    componentKey,
    path: fallbackPath,
    component: resolveComponent(componentKey),
    completionId: entry?.completionId ?? id,
    header: baseHeader,
    layout: entry?.layout ? cloneLayout(entry.layout) : undefined,
    card: baseCard,
    enabled: entry?.enabled !== false,
    stepSequence: cloneStepSequence(entry?.stepSequence),
  };
}

function buildDefinitionFromCatalog(
  id: string,
  entry: ActivityConfigEntry | null | undefined
): ActivityDefinition {
  const catalogEntry = ACTIVITY_CATALOG[id];
  if (!catalogEntry) {
    return buildFallbackDefinition(id, entry);
  }

  const { componentKey, path, defaults } = catalogEntry;
  return {
    id,
    componentKey,
    path,
    component: resolveComponent(componentKey),
    completionId: defaults.completionId ?? id,
    header: cloneHeader(defaults.header),
    layout: cloneLayout(defaults.layout),
    card: cloneCard(defaults.card),
    enabled: defaults.enabled !== false,
    stepSequence: cloneStepSequence(defaults.stepSequence),
  };
}

function extractHeaderOverrides(
  overrides: Partial<ActivityLayoutConfig>
): Partial<ActivityHeaderConfig> {
  const header: Partial<ActivityHeaderConfig> = {};
  ("eyebrow,title,subtitle,badge,titleAlign"
    .split(",") as Array<keyof ActivityHeaderConfig>)
    .forEach((key) => {
      const value = overrides[key];
      if (value !== undefined) {
        header[key] = value as ActivityHeaderConfig[typeof key];
      }
    });
  return header;
}

function extractLayoutOverrides(
  overrides: Partial<ActivityLayoutConfig>
): Partial<ActivityLayoutOptions> {
  const layout: Partial<ActivityLayoutOptions> = {};
  SERIALIZABLE_LAYOUT_KEYS.forEach((key) => {
    const value = overrides[key];
    if (value !== undefined) {
      layout[key] = value as ActivityLayoutOptions[typeof key];
    }
  });
  return layout;
}

function arraysEqual<T>(a: T[] | undefined, b: T[] | undefined): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function configsEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (typeof a !== "object" || !a || !b) {
    return false;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("Unable to compare step configurations", error);
    }
    return false;
  }
}

function stepDefinitionsEqual(
  a: StepDefinition,
  b: StepDefinition
): boolean {
  return (
    a.id === b.id &&
    a.component === b.component &&
    configsEqual(a.config, b.config)
  );
}

function diffStepSequence(
  base: StepDefinition[] | undefined,
  current: StepDefinition[] | undefined
): StepDefinition[] | undefined {
  const normalizedBase = base ?? [];
  const normalizedCurrent = current ?? [];

  if (normalizedCurrent.length === 0) {
    return normalizedBase.length === 0 ? undefined : [];
  }

  if (normalizedBase.length !== normalizedCurrent.length) {
    return normalizedCurrent.map((step) => ({ ...step }));
  }

  const hasDifference = normalizedCurrent.some((step, index) => {
    const baseStep = normalizedBase[index];
    if (!baseStep) {
      return true;
    }
    return !stepDefinitionsEqual(baseStep, step);
  });

  if (!hasDifference) {
    return undefined;
  }

  return normalizedCurrent.map((step) => ({ ...step }));
}

function diffHeader(
  base: ActivityHeaderConfig,
  current: ActivityHeaderConfig
): Partial<ActivityHeaderConfig> | undefined {
  const diff: Partial<ActivityHeaderConfig> = {};
  ("eyebrow,title,subtitle,badge,titleAlign"
    .split(",") as Array<keyof ActivityHeaderConfig>)
    .forEach((key) => {
      if (base[key] !== current[key]) {
        diff[key] = current[key];
      }
    });
  return Object.keys(diff).length > 0 ? diff : undefined;
}

function diffLayout(
  base: ActivityLayoutOptions | undefined,
  current: ActivityLayoutOptions | undefined
): Partial<ActivityLayoutOptions> | undefined {
  const diff: Partial<ActivityLayoutOptions> = {};
  SERIALIZABLE_LAYOUT_KEYS.forEach((key) => {
    const baseValue = base?.[key];
    const currentValue = current?.[key];
    if (baseValue !== currentValue) {
      diff[key] = currentValue as ActivityLayoutOptions[typeof key];
    }
  });
  return Object.keys(diff).length > 0 ? diff : undefined;
}

function diffCard(
  base: ActivityCardDefinition,
  current: ActivityCardDefinition
): ActivityCardOverrides | undefined {
  const diff: ActivityCardOverrides = {};
  if (base.title !== current.title) {
    diff.title = current.title;
  }
  if (base.description !== current.description) {
    diff.description = current.description;
  }
  if (!arraysEqual(base.highlights, current.highlights)) {
    diff.highlights = [...current.highlights];
  }
  const ctaDiff: Partial<ActivityCardDefinition["cta"]> = {};
  if (base.cta.label !== current.cta.label) {
    ctaDiff.label = current.cta.label;
  }
  if (base.cta.to !== current.cta.to) {
    ctaDiff.to = current.cta.to;
  }
  if (Object.keys(ctaDiff).length > 0) {
    diff.cta = ctaDiff;
  }
  return Object.keys(diff).length > 0 ? diff : undefined;
}

export function resolveActivityDefinition(
  entry: ActivityConfigEntry | null | undefined
): ActivityDefinition {
  if (!entry || !entry.id) {
    throw new Error("Une configuration d'activité doit contenir un identifiant.");
  }

  const base = buildDefinitionFromCatalog(entry.id, entry);
  const overrides = entry.overrides ?? undefined;

  const componentKey = entry.componentKey ?? base.componentKey;
  const component = resolveComponent(componentKey) ?? base.component;

  const headerOverride = overrides?.header ?? entry.header;
  const layoutOverride = overrides?.layout ?? entry.layout;
  const cardOverride = overrides?.card ?? entry.card;
  const completionOverride = overrides?.completionId ?? entry.completionId;
  const stepSequenceOverride = overrides?.stepSequence ?? entry.stepSequence;

  const header = headerOverride
    ? { ...base.header, ...headerOverride }
    : base.header;
  const layout = layoutOverride
    ? { ...(base.layout ?? {}), ...layoutOverride }
    : base.layout;
  const card = cardOverride
    ? {
        ...base.card,
        ...cardOverride,
        highlights: Array.isArray(cardOverride.highlights)
          ? [...cardOverride.highlights]
          : base.card.highlights,
        cta: cardOverride.cta
          ? { ...base.card.cta, ...cardOverride.cta }
          : base.card.cta,
      }
    : base.card;

  const stepSequence = mergeStepSequence(base.stepSequence, stepSequenceOverride);

  const enabled =
    entry.enabled !== undefined
      ? entry.enabled !== false
      : base.enabled !== false;

  const path = entry.path ?? base.path;
  const completionId = completionOverride ?? base.completionId ?? entry.id;

  return {
    ...base,
    componentKey,
    component,
    path,
    completionId,
    header,
    layout,
    card,
    enabled,
    stepSequence,
  };
}

export function serializeActivityDefinition(
  definition: ActivityDefinition
): ActivityConfigEntry {
  const base = resolveActivityDefinition({ id: definition.id });
  const overrides: ActivityConfigOverrides = {};

  const headerDiff = diffHeader(base.header, definition.header);
  if (headerDiff) {
    overrides.header = headerDiff;
  }

  const layoutDiff = diffLayout(base.layout, definition.layout);
  if (layoutDiff) {
    overrides.layout = layoutDiff;
  }

  const cardDiff = diffCard(base.card, definition.card);
  if (cardDiff) {
    overrides.card = cardDiff;
  }

  const stepSequenceDiff = diffStepSequence(
    base.stepSequence,
    definition.stepSequence
  );
  if (stepSequenceDiff !== undefined) {
    overrides.stepSequence = stepSequenceDiff;
  }

  if (
    definition.completionId &&
    definition.completionId !== base.completionId
  ) {
    overrides.completionId = definition.completionId;
  }

  const payload: ActivityConfigEntry = {
    id: definition.id,
    componentKey: definition.componentKey,
    path: definition.path,
    enabled: definition.enabled !== false,
  };

  if (Object.keys(overrides).length > 0) {
    payload.overrides = overrides;
  }

  return payload;
}

export function getDefaultActivityDefinitions(): ActivityDefinition[] {
  return Object.keys(ACTIVITY_CATALOG).map((id) =>
    resolveActivityDefinition({ id })
  );
}

function buildBaseLayout(definition: ActivityDefinition): ActivityLayoutConfig {
  const base: ActivityLayoutConfig = {
    activityId: definition.layout?.activityId ?? definition.id,
    eyebrow: definition.header.eyebrow,
    title: definition.header.title,
    subtitle: definition.header.subtitle,
    badge: definition.header.badge,
    titleAlign: definition.header.titleAlign,
    actions: definition.layout?.actions,
    headerChildren: definition.layout?.headerChildren,
    beforeHeader: definition.layout?.beforeHeader,
    outerClassName: definition.layout?.outerClassName,
    innerClassName: definition.layout?.innerClassName,
    headerClassName: definition.layout?.headerClassName,
    contentClassName: definition.layout?.contentClassName,
    contentAs: definition.layout?.contentAs,
    withLandingGradient: definition.layout?.withLandingGradient,
    useDynamicViewportHeight: definition.layout?.useDynamicViewportHeight,
    withBasePadding: definition.layout?.withBasePadding,
  };
  return base;
}

export function buildActivityElement(
  configEntry: ActivityConfigEntry
): JSX.Element {
  const ActivityElement = () => {
    const navigate = useNavigate();
    const {
      token,
      isEditMode,
      setEditMode,
      status: adminStatus,
      user: adminUser,
    } = useAdminAuth();

    const baseDefinition = useMemo(
      () => resolveActivityDefinition({ id: configEntry.id }),
      [configEntry.id]
    );
    const baseLayout = useMemo(
      () => buildBaseLayout(baseDefinition),
      [baseDefinition]
    );

    const [overrides, setOverrides] =
      useState<Partial<ActivityLayoutConfig>>({});
    const [currentDefinition, setCurrentDefinition] = useState<ActivityDefinition>(
      () => resolveActivityDefinition(configEntry)
    );

    const isAdminAuthenticated = adminStatus === "authenticated";
    const userRoles = (adminUser?.roles ?? []).map((role) =>
      role.toLowerCase().trim()
    );
    const canShowAdminButton =
      isAdminAuthenticated &&
      userRoles.some((role) => ADMIN_ROLES.includes(role));

    const configSignature = useMemo(
      () => JSON.stringify(configEntry),
      [configEntry]
    );

    useEffect(() => {
      setCurrentDefinition(resolveActivityDefinition(configEntry));
      setOverrides({});
    }, [configSignature]);

    useEffect(() => {
      let cancelled = false;

      const loadCurrentConfig = async () => {
        try {
          const response = await activitiesClient.getConfig();
          if (cancelled) {
            return;
          }
          if (Array.isArray(response.activities)) {
            const savedActivity = response.activities.find(
              (activity: any) => activity?.id === configEntry.id
            );
            if (savedActivity) {
              setCurrentDefinition(
                resolveActivityDefinition(savedActivity as ActivityConfigEntry)
              );
              return;
            }
          }
          setCurrentDefinition(resolveActivityDefinition(configEntry));
        } catch (error) {
          if (!cancelled) {
            console.warn(
              "Aucune configuration sauvegardée trouvée pour cette activité"
            );
            setCurrentDefinition(resolveActivityDefinition(configEntry));
          }
        }
      };

      void loadCurrentConfig();

      return () => {
        cancelled = true;
      };
    }, [configEntry.id]);

    useEffect(() => {
      if (!isEditMode && currentDefinition.enabled === false) {
        navigate("/activites", {
          replace: true,
          state: { disabled: currentDefinition.id },
        });
      }
    }, [currentDefinition.enabled, currentDefinition.id, isEditMode, navigate]);

    const currentBaseLayout = useMemo(
      () => buildBaseLayout(currentDefinition),
      [currentDefinition]
    );
    const mergedLayout: ActivityLayoutConfig = {
      ...currentBaseLayout,
      ...overrides,
      actions: canShowAdminButton
        ? (
            <div className="flex items-center gap-2">
              {isEditMode ? (
                <>
                  <button
                    onClick={() => setEditMode(false)}
                    className="inline-flex items-center justify-center rounded-full border border-red-600/20 bg-red-50 px-4 py-2 text-xs font-medium text-red-700 transition hover:border-red-600/40 hover:bg-red-100"
                  >
                    Quitter l'édition
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditMode(true)}
                  className="inline-flex items-center justify-center rounded-full border border-orange-600/20 bg-orange-50 px-4 py-2 text-xs font-medium text-orange-700 transition hover:border-orange-600/40 hover:bg-orange-100"
                >
                  Mode édition
                </button>
              )}
            </div>
          )
        : baseLayout.actions,
    };
    const mergedBeforeHeader = mergedLayout.beforeHeader;

    const handleNavigateToActivities = useCallback(() => {
      const completionId =
        currentDefinition.completionId ?? currentDefinition.id;
      navigate("/activites", { state: { completed: completionId } });
    }, [currentDefinition.completionId, currentDefinition.id, navigate]);

    const handleSetOverrides = useCallback(
      (next: Partial<ActivityLayoutConfig>) => {
        setOverrides(next);
      },
      []
    );

    const handleResetOverrides = useCallback(() => {
      setOverrides({});
    }, []);

    const handleHeaderEdit = useCallback(
      (field: "eyebrow" | "title" | "subtitle" | "badge", value: string) => {
        setOverrides((prev) => ({
          ...prev,
          [field]: value,
        }));
      },
      []
    );

    const handleSaveActivity = useCallback(async () => {
      const headerOverrides = extractHeaderOverrides(overrides);
      const layoutOverrides = extractLayoutOverrides(overrides);

      const updatedDefinition: ActivityDefinition = {
        ...currentDefinition,
        header: {
          ...currentDefinition.header,
          ...headerOverrides,
        },
        layout: layoutOverrides
          ? {
              ...(currentDefinition.layout ?? {}),
              ...layoutOverrides,
            }
          : currentDefinition.layout,
      };

      try {
        const response = await activitiesClient.getConfig();
        const existingActivities = Array.isArray(response.activities)
          ? (response.activities as ActivityConfigEntry[])
          : [];

        const serialized = serializeActivityDefinition(updatedDefinition);

        const baseActivities =
          existingActivities.length > 0
            ? existingActivities
            : Object.keys(ACTIVITY_CATALOG).map(
                (id) => ({ id } as ActivityConfigEntry)
              );

        let found = false;
        const updatedActivities = baseActivities
          .filter((activity) => activity && activity.id)
          .map((activity) => {
            if (activity.id === serialized.id) {
              found = true;
              return serialized;
            }
            return activity;
          });
        if (!found) {
          updatedActivities.push(serialized);
        }

        await admin.activities.save(
          {
            activities: updatedActivities,
            activitySelectorHeader: response.activitySelectorHeader,
          },
          token
        );

        setCurrentDefinition(resolveActivityDefinition(serialized));
        setOverrides({});

        alert("Activité sauvegardée avec succès !");
      } catch (error) {
        console.error("Erreur lors de la sauvegarde:", error);
        throw error;
      }
    }, [currentDefinition, overrides, token]);

    const Component = currentDefinition.component;

    return (
      <ActivityLayout
        {...mergedLayout}
        beforeHeader={
          <>
            {currentDefinition.enabled === false && (
              <div className="animate-section rounded-3xl border border-red-200/80 bg-red-50/90 p-4 text-sm text-red-800 shadow-sm backdrop-blur">
                Cette activité est actuellement désactivée. Elle sera masquée pour les apprenants.
              </div>
            )}
            {mergedBeforeHeader}
          </>
        }
        onHeaderEdit={handleHeaderEdit}
        activityConfig={currentDefinition}
        onSaveActivity={handleSaveActivity}
      >
        {Component ? (
          <Component
            activityId={currentDefinition.id}
            completionId={
              currentDefinition.completionId ?? currentDefinition.id
            }
            header={{
              ...currentDefinition.header,
              ...extractHeaderOverrides(overrides),
            }}
            card={currentDefinition.card}
            layout={mergedLayout}
            layoutOverrides={overrides}
            setLayoutOverrides={handleSetOverrides}
            resetLayoutOverrides={handleResetOverrides}
            navigateToActivities={handleNavigateToActivities}
            isEditMode={isEditMode}
            enabled={currentDefinition.enabled !== false}
            stepSequence={currentDefinition.stepSequence}
          />
        ) : (
          <div className="space-y-4 rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800">
            <h2 className="text-lg font-semibold">Activité indisponible</h2>
            <p>
              Le composant « {currentDefinition.componentKey} » est introuvable. Vérifiez la configuration de l'activité.
            </p>
          </div>
        )}
      </ActivityLayout>
    );
  };

  ActivityElement.displayName = `Activity(${configEntry.id})`;

  return <ActivityElement />;
}
