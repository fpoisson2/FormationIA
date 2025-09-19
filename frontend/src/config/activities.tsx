import React, { useCallback, useState, useEffect, type ComponentType, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import ActivityLayout from "../components/ActivityLayout";
import { admin } from "../api";
import { useAdminAuth } from "../providers/AdminAuthProvider";
import ClarityPath from "../pages/ClarityPath";
import ClarteDabord from "../pages/ClarteDabord";
import PromptDojo from "../pages/PromptDojo";
import WorkshopExperience from "../pages/WorkshopExperience";

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
}

export interface ActivityLayoutConfig extends ActivityHeaderConfig, ActivityLayoutOptions {}

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
}

export interface ActivityDefinition {
  id: string;
  path: string;
  component: ComponentType<ActivityProps>;
  completionId?: string;
  header: ActivityHeaderConfig;
  layout?: ActivityLayoutOptions;
  card: ActivityCardDefinition;
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
  };
  return base;
}

export function buildActivityElement(definition: ActivityDefinition): JSX.Element {
  const baseLayout = buildBaseLayout(definition);
  const completionId = definition.completionId ?? definition.id;
  const Component = definition.component;

  const ActivityElement = () => {
    const navigate = useNavigate();
    const { token, isEditMode, setEditMode, status: adminStatus, user: adminUser } = useAdminAuth();
    const [overrides, setOverrides] = useState<Partial<ActivityLayoutConfig>>({});
    const [currentDefinition, setCurrentDefinition] = useState<ActivityDefinition>(definition);

    const ADMIN_ROLES = ["admin", "superadmin", "administrator"];
    const normaliseRoles = (roles: string[] | undefined | null): string[] =>
      (roles ?? []).map((role) => role.toLowerCase().trim());
    const canAccessAdmin = (roles: string[]): boolean =>
      roles.some((role) => ADMIN_ROLES.includes(role));

    const isAdminAuthenticated = adminStatus === "authenticated";
    const userRoles = normaliseRoles(adminUser?.roles);
    const canShowAdminButton = isAdminAuthenticated && canAccessAdmin(userRoles);

    // Charger la configuration sauvegardée au montage
    useEffect(() => {
      if (canShowAdminButton && token) {
        const loadCurrentConfig = async () => {
          try {
            const response = await admin.activities.get(token);
            if (response.activities && response.activities.length > 0) {
              const savedActivity = response.activities.find((activity: any) => activity.id === definition.id);
              if (savedActivity) {
                setCurrentDefinition(savedActivity as ActivityDefinition);
              }
            }
          } catch (error) {
            console.warn('Aucune configuration sauvegardée trouvée pour cette activité');
          }
        };
        loadCurrentConfig();
      }
    }, [canShowAdminButton, token, definition.id]);

    const currentBaseLayout = buildBaseLayout(currentDefinition);
    const mergedLayout: ActivityLayoutConfig = {
      ...currentBaseLayout,
      ...overrides,
      actions: canShowAdminButton ? (
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
      ) : baseLayout.actions,
    };

    const handleNavigateToActivities = useCallback(() => {
      navigate("/activites", { state: { completed: completionId } });
    }, [navigate]);

    const handleSetOverrides = useCallback((next: Partial<ActivityLayoutConfig>) => {
      setOverrides(next);
    }, []);

    const handleResetOverrides = useCallback(() => {
      setOverrides({});
    }, []);

    const handleHeaderEdit = useCallback((field: 'eyebrow' | 'title' | 'subtitle' | 'badge', value: string) => {
      setOverrides(prev => ({
        ...prev,
        [field]: value
      }));
    }, []);

    const handleSaveActivity = useCallback(async () => {
      // Créer la configuration mise à jour basée sur la définition actuelle
      const updatedDefinition = {
        ...currentDefinition,
        header: {
          ...currentDefinition.header,
          ...overrides
        }
      };

      // Charger toutes les activités actuelles
      try {
        const response = await admin.activities.get(token);
        const allActivities = response.activities.length > 0 ? response.activities : ACTIVITY_DEFINITIONS;

        // Mettre à jour l'activité courante
        const updatedActivities = allActivities.map((activity: any) =>
          activity.id === currentDefinition.id ? updatedDefinition : activity
        );

        // Sauvegarder
        await admin.activities.save({ activities: updatedActivities }, token);

        // Mettre à jour l'état local avec la nouvelle définition
        setCurrentDefinition(updatedDefinition);
        setOverrides({});

        alert('Activité sauvegardée avec succès !');
      } catch (error) {
        console.error('Erreur lors de la sauvegarde:', error);
        throw error;
      }
    }, [currentDefinition, overrides, token]);

    return (
      <ActivityLayout
        {...mergedLayout}
        onHeaderEdit={handleHeaderEdit}
        activityConfig={currentDefinition}
        onSaveActivity={handleSaveActivity}
      >
        <Component
          activityId={currentDefinition.id}
          completionId={completionId}
          header={currentDefinition.header}
          card={currentDefinition.card}
          layout={mergedLayout}
          layoutOverrides={overrides}
          setLayoutOverrides={handleSetOverrides}
          resetLayoutOverrides={handleResetOverrides}
          navigateToActivities={handleNavigateToActivities}
          isEditMode={isEditMode}
        />
      </ActivityLayout>
    );
  };

  ActivityElement.displayName = `Activity(${definition.id})`;

  return <ActivityElement />;
}

export const ACTIVITY_DEFINITIONS: ActivityDefinition[] = [
  {
    id: "atelier",
    path: "/atelier/*",
    component: WorkshopExperience,
    completionId: "atelier",
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
  {
    id: "prompt-dojo",
    path: "/prompt-dojo",
    component: PromptDojo,
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
  {
    id: "clarity",
    path: "/parcours-clarte",
    component: ClarityPath,
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
  {
    id: "clarte-dabord",
    path: "/clarte-dabord",
    component: ClarteDabord,
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
];
