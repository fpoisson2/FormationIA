import { registerStepComponent } from "../registry";

import { RichContentStep } from "./RichContentStep";
import type {
  RichContentChecklistItem,
  RichContentChecklistSidebar,
  RichContentMediaItem,
  RichContentSidebar,
  RichContentStepConfig,
  RichContentStepContent,
  RichContentTipsSidebar,
} from "./RichContentStep";

registerStepComponent("rich-content", RichContentStep);

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
