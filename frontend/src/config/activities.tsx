import ClarityPath from "../pages/ClarityPath";
import ClarteDabord from "../pages/ClarteDabord";
import PromptDojo from "../pages/PromptDojo";
import WorkshopExperience from "../pages/WorkshopExperience";

export interface ActivityDefinition {
  id: string;
  title: string;
  description: string;
  highlights: string[];
  cta: {
    label: string;
    to: string;
  };
  path: string;
  element: JSX.Element;
}

export const ACTIVITY_DEFINITIONS: ActivityDefinition[] = [
  {
    id: "atelier",
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
    path: "/atelier/*",
    element: <WorkshopExperience />,
  },
  {
    id: "prompt-dojo",
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
    path: "/prompt-dojo",
    element: <PromptDojo />,
  },
  {
    id: "clarity",
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
    path: "/parcours-clarte",
    element: <ClarityPath />,
  },
  {
    id: "clarte-dabord",
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
    path: "/clarte-dabord",
    element: <ClarteDabord />,
  },
];
