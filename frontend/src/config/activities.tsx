import {
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
import { StepSequenceActivity } from "../modules/step-sequence/StepSequenceActivity";
import { createDefaultExplorateurWorldConfig } from "../modules/step-sequence/modules/explorateur-world";
import {
  isCompositeStepDefinition,
  resolveStepComponentKey,
  type CompositeStepConfig,
  type StepDefinition,
} from "../modules/step-sequence/types";
import type { ModelConfig } from "../config";

type PersistedStepDefinition = StepDefinition & {
  __replaceSequence?: boolean;
};
const WORKSHOP_DEFAULT_TEXT = `L'automatisation est particulièrement utile pour structurer des notes de cours, créer des rappels et générer des résumés ciblés. Les étudiantes et étudiants qui savent dialoguer avec l'IA peuvent obtenir des analyses précises, du survol rapide jusqu'à des synthèses détaillées. Comprendre comment ajuster les paramètres du modèle aide à mieux contrôler la production, à gagner du temps et à repérer les limites de l'outil.`;

const PROMPT_DOJO_MISSIONS = [
  {
    id: "brief-clarity",
    title: "Mission 1 · Atelier campus",
    badge: "🎯 Clarté",
    level: "Débutant",
    description:
      "Préparer un atelier de révision pour aider la cohorte de Techniques de l’informatique à réussir l’intra.",
    targetScore: 75,
    objective:
      "Construire un plan d’atelier d’une heure incluant une activité d’ouverture, un segment pratique et une conclusion claire.",
    context:
      "Tu es pair-aidant au centre d’aide. L’atelier aura lieu en fin de journée avec 18 collègues un peu fatigués.",
    checkpoints: [
      "Mentionner les trois segments clés (départ, activités, clôture).",
      "Garder un ton motivant et concret pour un groupe collégial.",
      "Indiquer comment recueillir les questions de dernière minute.",
    ],
    starterPrompt:
      "Rôle: Tu es un tuteur pair qui anime un atelier dynamique.\nTâche: Proposer un plan d’atelier de 60 minutes pour revoir les structures de données avant l’intra.\nPublic: Étudiantes et étudiants de première année au cégep.\nContraintes: Prévoir trois segments (accroche, pratique guidée, conclusion). Mentionner un outil collaboratif utilisé.\nFormat attendu: Liste numérotée avec durées estimées.\nRéponds uniquement avec le plan.",
  },
  {
    id: "audience-adapt",
    title: "Mission 2 · Résumé associatif",
    badge: "🧭 Adaptation",
    level: "Intermédiaire",
    description:
      "Rédiger un résumé pour l’infolettre de l’association étudiante à partir d’un article sur le sommeil et les écrans.",
    targetScore: 82,
    objective:
      "Synthétiser l’article en trois points faciles à lire et proposer une mini-action pour la vie de campus.",
    context:
      "Le résumé sera envoyé par courriel à des étudiantes et étudiants de première année. Temps de lecture cible : 4 minutes.",
    checkpoints: [
      "Employer un ton bienveillant et accessible.",
      "Inclure une analogie liée à la routine collégiale (ex: soirée d’étude).",
      "Avertir d’un point de vigilance ou d’une limite de l’étude.",
    ],
    starterPrompt:
      "Rôle: Tu écris pour l’infolettre de l’association étudiante.\nTâche: Résumer un article du service de psychologie sur l’impact des écrans tard le soir.\nPublic: Collégiennes et collégiens de première année.\nContraintes: 130 mots maximum, analogie liée à la vie de campus, mentionner une limite.\nFormat attendu: trois paragraphes courts (idée clé, analogie, action proposée).\nRéponds uniquement avec le résumé.",
  },
  {
    id: "creative-brief",
    title: "Mission 3 · Courriel de stage",
    badge: "🚀 Créativité",
    level: "Avancé",
    description:
      "Annonce un léger retard à ton superviseur de stage tout en proposant un plan d’action crédible.",
    targetScore: 88,
    objective:
      "Informer d’un retard de trois jours sur le rapport de stage en rassurant sur les étapes suivantes.",
    context:
      "Tu es en Techniques de laboratoire. L’accès au labo a été restreint, d’où le retard.",
    checkpoints: [
      "Rester professionnel·le et factuel·le.",
      "Proposer deux mesures compensatoires et un nouveau jalon précis.",
      "Inviter à un court point Teams pour valider le plan.",
    ],
    starterPrompt:
      "Rôle: Tu es un·e stagiaire transparent·e et proactif·ve.\nTâche: Rédiger un courriel à ton superviseur pour annoncer un retard de 3 jours sur le rapport de stage et proposer un plan B.\nPublic: Superviseur de stage en entreprise.\nContraintes: Rester factuel, proposer deux mesures d’atténuation, fixer un nouveau jalon et proposer une rencontre Teams de 15 minutes.\nFormat attendu: Objet + courriel structuré en 4 paragraphes.\nRéponds uniquement avec le courriel.",
  },
] as const;

const PROMPT_DOJO_EVALUATOR_PROMPT =
  "Tu es un évaluateur pédagogique spécialisé dans la rédaction de prompts. Analyse le prompt suivant et attribue un score global ainsi que quatre sous-scores (0-100). Réponds uniquement avec un JSON strict, sans commentaire supplémentaire.\n\nFormat attendu (JSON strict): {\"total\":int,\"clarity\":int,\"specificity\":int,\"structure\":int,\"length\":int,\"comments\":\"string\",\"advice\":[\"string\",...]}.\n- \"comments\" : synthèse en 2 phrases max.\n- \"advice\" : pistes concrètes (3 max).\n- Utilise des entiers pour les scores.\n- Pas d’autre texte hors du JSON.";

const PROMPT_DOJO_STEP_SEQUENCE: StepDefinition[] = [
  {
    id: "prompt-dojo:introduction",
    component: "rich-content",
    config: {
      title: "Affûte ta consigne mission par mission",
      body: `Chaque mission te plonge dans un contexte différent. Tu disposes d’un briefing, de points de contrôle et d’un score cible à atteindre. Parcours les cartes ci-dessous, choisis la mission qui te motive puis prépare ton brief dans la zone guidée avant d’évaluer ton prompt final.`,
      sidebar: {
        type: "tips",
        title: "Comment progresser ?",
        tips: [
          "Observe les objectifs et contraintes propres à chaque mission.",
          "Note les points à vérifier dans ton prompt avant l’évaluation IA.",
          "Révise ton texte jusqu’à dépasser le score cible indiqué.",
        ],
      },
    },
  },
  {
    id: "prompt-dojo:missions",
    component: "info-cards",
    config: {
      eyebrow: "Sélectionne un défi",
      title: "Trois missions inspirées du Prompt Dojo",
      description:
        "Compare les badges et niveaux pour choisir le défi correspondant à ta maîtrise actuelle. Les cibles de score te donnent un repère pour itérer.",
      columns: 3,
      cards: PROMPT_DOJO_MISSIONS.map((mission) => ({
        title: `${mission.badge} ${mission.title}`,
        description: mission.description,
        tone: "sand",
        items: [
          `Objectif : ${mission.objective}`,
          `Contexte : ${mission.context}`,
          `Score cible : ${mission.targetScore}%`,
        ],
      })),
    },
  },
  {
    id: "prompt-dojo:draft",
    component: "form",
    config: {
      submitLabel: "Enregistrer mon brief",
      allowEmpty: false,
      fields: [
        {
          id: "mission",
          label: "Choisis la mission que tu veux relever",
          type: "single_choice",
          options: PROMPT_DOJO_MISSIONS.map((mission) => ({
            value: mission.id,
            label: `${mission.title} (${mission.level})`,
            description: mission.description,
          })),
        },
        {
          id: "objectif",
          label: "Formule ton objectif en 40 à 90 mots",
          type: "textarea_with_counter",
          minWords: 40,
          maxWords: 90,
          tone: "professionnel et motivant",
        },
        {
          id: "checklist",
          label: "Checklist du prompt final (3 à 5 puces)",
          type: "bulleted_list",
          minBullets: 3,
          maxBullets: 5,
          maxWordsPerBullet: 12,
          mustContainAny: ["ton", "format", "contrainte", "objectif"],
        },
      ],
    },
  },
  {
    id: "prompt-dojo:evaluate",
    component: "prompt-evaluation",
    config: {
      defaultText: PROMPT_DOJO_MISSIONS[0]?.starterPrompt ?? "",
      developerMessage: PROMPT_DOJO_EVALUATOR_PROMPT,
      model: "gpt-5-mini",
      verbosity: "medium",
      thinking: "medium",
    },
  },
  {
    id: "prompt-dojo:debrief",
    component: "rich-content",
    config: {
      title: "Analyse ton score IA",
      body: `Utilise le rapport pour comprendre où ton prompt excelle et où il reste flou. Ajuste ensuite ton brief : reformule les consignes manquantes, précise les contraintes ou ajoute un exemple. Quand tu dépasses la cible de la mission, exporte ton prompt gagnant pour ton portfolio.`,
      sidebar: {
        type: "tips",
        title: "Prochaines étapes",
        tips: [
          "Refais la mission avec un autre niveau pour varier les contextes.",
          "Compare deux prompts différents dans l’atelier pour voir l’impact des paramètres.",
          "Note les tournures qui te donnent systématiquement de bons scores.",
        ],
      },
    },
  },
];

const EXPLORATEUR_INTRODUCTION_STEP: StepDefinition = {
  id: "explorateur:introduction",
  component: "rich-content",
  config: {
    title: "Prépare ton exploration pixelisée",
    body: `Bienvenue dans Tiny Town, une mini-ville en pixel art où chaque quartier correspond à une compétence IA.

• Déplace-toi avec les flèches du clavier ou les touches WASD. Sur mobile, utilise le joystick flottant.
• Clique sur un bâtiment pour lancer la mission associée et suis les consignes à l'écran.
• Termine les quatre quartiers thématiques pour débloquer la mairie et valider ton parcours.`,
    sidebar: {
      type: "tips",
      title: "Astuces de navigation",
      tips: [
        "Observe les couleurs des bâtiments : elles rappellent la compétence évaluée.",
        "Rouvre un quartier quand tu veux pour compléter un objectif manquant.",
        "L’inventaire en haut à droite conserve tes objets de mission.",
      ],
    },
  },
};

const EXPLORATEUR_DEBRIEF_STEP: StepDefinition = {
  id: "explorateur:debrief",
  component: "rich-content",
  config: {
    title: "Capture ton bilan d’explorateur ou d’exploratrice",
    body: `Bravo pour cette exploration !

Depuis la ville, ouvre la mairie pour afficher ta carte de compétences. Utilise les boutons JSON et PDF pour exporter ton rapport, l’ajouter à ton portfolio ou le partager avec ton équipe.

Tu peux revenir dans n’importe quel quartier pour améliorer un score ou récolter les idées à transformer en prompts.`,
    sidebar: {
      type: "tips",
      title: "Et après ?",
      tips: [
        "Note trois apprentissages clés dans ton portfolio.",
        "Transforme les meilleures stratégies en consignes prêtes à réutiliser.",
        "Anime un atelier en montrant comment tu as débloqué la mairie.",
      ],
    },
  },
};

const CLARITY_TARGET = { x: 7, y: 3 } as const;

const CLARITY_PATH_STEP_SEQUENCE: StepDefinition[] = [
  {
    id: "clarity:introduction",
    component: "rich-content",
    config: {
      title: "Écris une consigne limpide pour guider le personnage",
      body: `Observe la grille 10×10. Ta mission consiste à formuler une instruction assez claire pour que l’IA trace un trajet optimal sans se cogner aux obstacles. Utilise les étapes suivantes pour positionner la cible, visualiser un plan puis rédiger ta consigne finale.`,
      sidebar: {
        type: "tips",
        title: "Conseils express",
        tips: [
          "Indique la direction et la distance plutôt que de vagues intentions.",
          "Mentionne les obstacles importants afin d’éviter les collisions.",
          "Utilise un vocabulaire simple : haut, bas, gauche, droite, nombre de cases.",
        ],
      },
    },
  },
  {
    id: "clarity:map",
    component: "clarity-map",
    config: {
      obstacleCount: 6,
      initialTarget: CLARITY_TARGET,
      promptStepId: "clarity:instruction",
      allowInstructionInput: true,
      instructionLabel: "Consigne transmise à l’IA",
      instructionPlaceholder:
        "Depuis le départ, avance de deux cases vers le bas, contourne l’obstacle par la droite puis remonte jusqu’à la cible…",
    },
  },
  {
    id: "clarity:instruction",
    component: "clarity-prompt",
    config: {
      promptLabel: "Rédige ta consigne finale",
      promptPlaceholder:
        "Exemple : ‘Depuis la case de départ, descends de trois cases, va deux cases à droite, monte de deux cases puis avance une case à droite pour atteindre la cible.’",
      model: "gpt-5-mini",
      verbosity: "medium",
      thinking: "medium",
      settingsMode: "read-only",
    },
  },
  {
    id: "clarity:debrief",
    component: "rich-content",
    config: {
      title: "Débrief et pistes d’amélioration",
      body: `Analyse les statistiques générées : nombre d’essais, surcoût de parcours et fidélité au plan. Si le personnage se bloque, identifie les zones ambiguës de ta consigne (direction manquante, distance imprécise, obstacle oublié). Réécris ensuite l’instruction et relance une exécution jusqu’à atteindre la cible sans détour.`,
      sidebar: {
        type: "tips",
        title: "Pour aller plus loin",
        tips: [
          "Teste une version plus concise de ta consigne pour voir l’impact sur le plan.",
          "Ajoute des contraintes bonus (ex : passer par une case particulière) et vérifie le comportement.",
          "Compare deux consignes différentes dans l’atelier pour voir laquelle est la plus efficace.",
        ],
      },
    },
  },
];

const CLARTE_MENU_REVELATION =
  "Ce qui aurait dû être demandé dès le départ :\n- Crée un menu complet de 2 jours.\n- Chaque jour doit comporter 3 repas : déjeuner, dîner, souper.\n- Chaque repas doit inclure un plat, une boisson et un dessert.\n- Utilise uniquement les aliments listés : pain, pâtes, tomates, pommes, lait, poulet.\n- Présente le tout en JSON structuré : jour → repas → {plat, boisson, dessert}.";

const CLARTE_DABORD_STEP_SEQUENCE: StepDefinition[] = [
  {
    id: "clarte-dabord:introduction",
    component: "rich-content",
    config: {
      title: "Clarifie la demande dès la première manche",
      body: `Tu joues l’IA : l’usager formule une requête incomplète pour préparer un menu étudiant. Trois manches successives apportent des précisions. Ton objectif est d’améliorer ta réponse à chaque étape tout en notant ce qu’il aurait fallu demander dès le départ.`,
      sidebar: {
        type: "tips",
        title: "Approche recommandée",
        tips: [
          "Repère les informations manquantes dès la première manche.",
          "Structure tes réponses dans les tableaux proposés pour éviter les oublis.",
          "À la fin, rédige ta checklist idéale pour guider l’usager la prochaine fois.",
        ],
      },
    },
  },
  {
    id: "clarte-dabord:stage-1",
    component: "form",
    config: {
      submitLabel: "Valider la manche 1",
      allowEmpty: false,
      fields: [
        {
          id: "menu_jour1_idees",
          label: "Jour 1 — Idées de plats (1–3 puces)",
          type: "bulleted_list",
          minBullets: 1,
          maxBullets: 3,
          maxWordsPerBullet: 6,
          mustContainAny: ["pain", "pâtes", "tomates", "pommes", "lait", "poulet"],
        },
        {
          id: "menu_jour2_idees",
          label: "Jour 2 — Idées de plats (1–3 puces)",
          type: "bulleted_list",
          minBullets: 1,
          maxBullets: 3,
          maxWordsPerBullet: 6,
          mustContainAny: ["pain", "pâtes", "tomates", "pommes", "lait", "poulet"],
        },
      ],
    },
  },
  {
    id: "clarte-dabord:stage-2",
    component: "form",
    config: {
      submitLabel: "Valider la manche 2",
      allowEmpty: false,
      fields: [
        {
          id: "menu_jour1_table",
          label: "Jour 1 — 3 repas (plat uniquement)",
          type: "table_menu_day",
          meals: ["Déjeuner", "Dîner", "Souper"],
        },
        {
          id: "menu_jour2_table",
          label: "Jour 2 — 3 repas (plat uniquement)",
          type: "table_menu_day",
          meals: ["Déjeuner", "Dîner", "Souper"],
        },
      ],
    },
  },
  {
    id: "clarte-dabord:stage-3",
    component: "form",
    config: {
      submitLabel: "Valider la manche 3",
      allowEmpty: false,
      fields: [
        {
          id: "menu_jour1_complet",
          label: "Jour 1 — plat / boisson / dessert",
          type: "table_menu_full",
          meals: ["Déjeuner", "Dîner", "Souper"],
        },
        {
          id: "menu_jour2_complet",
          label: "Jour 2 — plat / boisson / dessert",
          type: "table_menu_full",
          meals: ["Déjeuner", "Dîner", "Souper"],
        },
      ],
    },
  },
  {
    id: "clarte-dabord:debrief",
    component: "rich-content",
    config: {
      title: "Révèle la checklist idéale",
      body: CLARTE_MENU_REVELATION,
      sidebar: {
        type: "tips",
        title: "À retenir",
        tips: [
          "Une bonne consigne précise le format (ici : tableau JSON structuré).",
          "Mentionne les contraintes incontournables (ingrédients, nombre de repas, éléments à inclure).",
          "Teste ta checklist sur un autre scénario pour vérifier qu’elle fonctionne vraiment.",
        ],
      },
    },
  },
];

const WORKSHOP_DEFAULT_CONFIG_A: ModelConfig = {
  model: "gpt-5-nano",
  verbosity: "medium",
  thinking: "minimal",
};

const WORKSHOP_DEFAULT_CONFIG_B: ModelConfig = {
  model: "gpt-5-mini",
  verbosity: "high",
  thinking: "high",
};

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
  showHeader?: boolean;
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
  setStepSequence?: (steps: StepDefinition[] | undefined) => void;
}

export const COMPONENT_REGISTRY = {
  "workshop-experience": StepSequenceActivity,
  "prompt-dojo": StepSequenceActivity,
  "clarity-path": StepSequenceActivity,
  "clarte-dabord": StepSequenceActivity,
  "explorateur-ia": StepSequenceActivity,
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
    componentKey: "step-sequence",
    path: "/atelier",
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
          to: "/atelier",
        },
      },
      stepSequence: [
        {
          id: "workshop-prepare-context",
          component: "workshop-context",
          config: {
            defaultText: WORKSHOP_DEFAULT_TEXT,
          },
        },
        {
          id: "workshop-compare-models",
          component: "workshop-comparison",
          config: {
            contextStepId: "workshop-prepare-context",
            defaultConfigA: WORKSHOP_DEFAULT_CONFIG_A,
            defaultConfigB: WORKSHOP_DEFAULT_CONFIG_B,
          },
        },
        {
          id: "workshop-synthesis",
          component: "workshop-synthesis",
          config: {
            contextStepId: "workshop-prepare-context",
            comparisonStepId: "workshop-compare-models",
          },
        },
      ],
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
      stepSequence: PROMPT_DOJO_STEP_SEQUENCE,
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
      stepSequence: CLARITY_PATH_STEP_SEQUENCE,
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
      stepSequence: CLARTE_DABORD_STEP_SEQUENCE,
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
          "flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden px-0 pt-0 pb-0",
        innerClassName:
          "flex h-full min-h-0 flex-1 w-full max-w-none gap-0",
        headerClassName: "hidden",
        contentClassName:
          "flex h-full min-h-0 flex-1 flex-col space-y-0",
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
      stepSequence: [
        EXPLORATEUR_INTRODUCTION_STEP,
        {
          id: "explorateur:world",
          component: "explorateur-world",
          config: createDefaultExplorateurWorldConfig(),
        },
        EXPLORATEUR_DEBRIEF_STEP,
      ],
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
  stepSequence?: PersistedStepDefinition[];
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
  stepSequence?: PersistedStepDefinition[];
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
  "showHeader",
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

function cloneCompositeConfig(
  composite: CompositeStepConfig
): CompositeStepConfig {
  return {
    ...composite,
    modules: composite.modules.map((module) => ({ ...module })),
  };
}

function cloneStepDefinition(step: StepDefinition): StepDefinition {
  if (isCompositeStepDefinition(step)) {
    return {
      ...step,
      composite: cloneCompositeConfig(step.composite),
    };
  }

  const cloned: StepDefinition = { ...step };
  if (Object.prototype.hasOwnProperty.call(step, "config")) {
    (cloned as { config?: unknown }).config = step.config;
  }
  return cloned;
}

function stripStepMetadata(
  step: PersistedStepDefinition
): StepDefinition {
  const { __replaceSequence, ...rest } = step;
  return rest as StepDefinition;
}

function cloneStepSequence(
  steps: PersistedStepDefinition[] | StepDefinition[] | undefined
): StepDefinition[] | undefined {
  if (!steps) {
    return undefined;
  }
  return steps.map((step) =>
    cloneStepDefinition(stripStepMetadata(step as PersistedStepDefinition))
  );
}

function mergeStepSequence(
  base: StepDefinition[] | undefined,
  override: PersistedStepDefinition[] | undefined
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
  const overrideEntries = override.map((step) => ({
    step: stripStepMetadata(step),
    replace: step.__replaceSequence === true,
  }));
  const overrideMap = new Map(overrideEntries.map(({ step }) => [step.id, step]));
  const shouldReplace = overrideEntries.some((entry) => entry.replace);

  const mergeWithBase = (
    source: StepDefinition,
    fallback: StepDefinition | undefined
  ): StepDefinition => {
    if (!fallback) {
      return cloneStepDefinition(source);
    }

    if (isCompositeStepDefinition(source) || isCompositeStepDefinition(fallback)) {
      const composite = isCompositeStepDefinition(source)
        ? source.composite
        : isCompositeStepDefinition(fallback)
        ? fallback.composite
        : undefined;

      const merged = {
        ...cloneStepDefinition(fallback),
        ...source,
      } as StepDefinition;

      if (composite) {
        (merged as { composite: CompositeStepConfig }).composite =
          cloneCompositeConfig(composite);
        delete (merged as { config?: unknown }).config;
      }

      return merged;
    }

    const hasConfigOverride = Object.prototype.hasOwnProperty.call(
      source,
      "config"
    );
    const configValue = hasConfigOverride
      ? (source as { config?: unknown }).config
      : (fallback as { config?: unknown }).config;

    const merged = {
      ...cloneStepDefinition(fallback),
      ...source,
    } as StepDefinition;

    if (configValue !== undefined) {
      (merged as { config?: unknown }).config = configValue;
    } else {
      delete (merged as { config?: unknown }).config;
    }

    return merged;
  };

  if (shouldReplace) {
    return overrideEntries.map(({ step }) =>
      mergeWithBase(step, baseMap.get(step.id))
    );
  }

  const mergedBase = base.map((baseStep) => {
    const overrideStep = overrideMap.get(baseStep.id);
    return mergeWithBase(overrideStep ?? baseStep, baseStep);
  });

  const mergedExtra = overrideEntries
    .map(({ step }) => step)
    .filter((step) => !baseMap.has(step.id))
    .map((step) => mergeWithBase(step, undefined));

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
  if (a.id !== b.id) {
    return false;
  }

  const componentA = resolveStepComponentKey(a);
  const componentB = resolveStepComponentKey(b);
  if (componentA !== componentB) {
    return false;
  }

  if (isCompositeStepDefinition(a) || isCompositeStepDefinition(b)) {
    if (!isCompositeStepDefinition(a) || !isCompositeStepDefinition(b)) {
      return false;
    }
    return configsEqual(a.composite, b.composite);
  }

  return configsEqual(a.config, b.config);
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
    overrides.stepSequence = stepSequenceDiff.map((step) => ({
      ...step,
      __replaceSequence: true,
    }));
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
    showHeader: definition.layout?.showHeader ?? false,
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

    const handleUpdateStepSequence = useCallback(
      (steps: StepDefinition[] | undefined) => {
        setCurrentDefinition((prev) => ({
          ...prev,
          stepSequence: steps ? cloneStepSequence(steps) : undefined,
        }));
      },
      []
    );

    const editButtonClassName = isEditMode
      ? "inline-flex items-center justify-center rounded-full border border-red-600/20 bg-red-50 px-4 py-2 text-xs font-medium text-red-700 transition hover:border-red-600/40 hover:bg-red-100"
      : "inline-flex items-center justify-center rounded-full border border-orange-600/20 bg-orange-50 px-4 py-2 text-xs font-medium text-orange-700 transition hover:border-orange-600/40 hover:bg-orange-100";

    const adminEditButton = canShowAdminButton ? (
      <div className="mt-12 flex justify-center">
        <button
          onClick={() => setEditMode(!isEditMode)}
          className={editButtonClassName}
        >
          {isEditMode ? "Quitter l'édition" : "Mode édition"}
        </button>
      </div>
    ) : null;

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
            setStepSequence={handleUpdateStepSequence}
          />
        ) : (
          <div className="space-y-4 rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800">
            <h2 className="text-lg font-semibold">Activité indisponible</h2>
            <p>
              Le composant « {currentDefinition.componentKey} » est introuvable. Vérifiez la configuration de l'activité.
            </p>
          </div>
        )}
        {adminEditButton}
      </ActivityLayout>
    );
  };

  ActivityElement.displayName = `Activity(${configEntry.id})`;

  return <ActivityElement />;
}
