import { registerStepComponent } from "../registry";

import { FormStep } from "./FormStep";
import { RichContentStep } from "./RichContentStep";
import { SimulationChatStep } from "./SimulationChatStep";
import { VideoStep } from "./VideoStep";
import { PromptEvaluationStep } from "./PromptEvaluationStep";
import type { FormStepConfig, FormStepValidationFn } from "./FormStep";
import {
  createDefaultFieldSpec,
  defaultValidateFormValues,
  isFormAnswerEmpty,
  sanitizeFormValues,
  validateFieldSpec,
} from "./FormStep";
import type {
  SimulationChatConfig,
  SimulationChatPayload,
  SimulationChatStageConfig,
} from "./SimulationChatStep";
import "./workshop";
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

registerStepComponent("form", FormStep);
registerStepComponent("rich-content", RichContentStep);
registerStepComponent("simulation-chat", SimulationChatStep);
registerStepComponent("video", VideoStep);
registerStepComponent("prompt-evaluation", PromptEvaluationStep);

/**
 * Configuration attendue par le module `rich-content`.
 *
 * @property title Titre principal affiché en haut du contenu.
 * @property body Corps du texte, rendu en blocs multiligne.
 * @property media Liste d’illustrations (URL, alt, légende) affichées dans une grille.
 * @property sidebar Bloc optionnel situé dans la colonne latérale (astuces ou checklist).
 * @property onChange Callback déclenché en mode édition à chaque modification des champs.
 */
export type { FormStepConfig, FormStepValidationFn };
export {
  FormStep,
  createDefaultFieldSpec,
  defaultValidateFormValues,
  isFormAnswerEmpty,
  sanitizeFormValues,
  validateFieldSpec,
};
export type { SimulationChatConfig, SimulationChatPayload, SimulationChatStageConfig };
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

export type {
  PromptEvaluationStepConfig,
  PromptEvaluationScore,
  PromptEvaluationStepPayload,
} from "./PromptEvaluationStep";
export { PromptEvaluationStep };

export * from "./workshop";
