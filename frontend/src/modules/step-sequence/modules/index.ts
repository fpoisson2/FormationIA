import { registerStepComponent } from "../registry";

import { RichContentStep } from "./RichContentStep";
import { VideoStep } from "./VideoStep";
import type {
  RichContentChecklistItem,
  RichContentChecklistSidebar,
  RichContentMediaItem,
  RichContentSidebar,
  RichContentStepConfig,
  RichContentStepContent,
  RichContentTipsSidebar,
} from "./RichContentStep";
import type {
  VideoCaption,
  VideoSource,
  VideoStepConfig,
  VideoStepContent,
  VideoSourceType,
} from "./VideoStep";

registerStepComponent("rich-content", RichContentStep);
registerStepComponent("video", VideoStep);

/**
 * Configuration attendue par le module `rich-content`.
 *
 * @property title Titre principal affiché en haut du contenu.
 * @property body Corps du texte, rendu en blocs multiligne.
 * @property media Liste d’illustrations (URL, alt, légende) affichées dans une grille.
 * @property sidebar Bloc optionnel situé dans la colonne latérale (astuces ou checklist).
 * @property onChange Callback déclenché en mode édition à chaque modification des champs.
 */
export type { RichContentStepConfig, RichContentStepContent };
export type { RichContentMediaItem };
export type {
  RichContentSidebar,
  RichContentTipsSidebar,
  RichContentChecklistSidebar,
  RichContentChecklistItem,
};
export { RichContentStep };
export type {
  VideoCaption,
  VideoSource,
  VideoSourceType,
  VideoStepConfig,
  VideoStepContent,
};
export { VideoStep };
