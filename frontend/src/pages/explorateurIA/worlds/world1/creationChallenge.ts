export type CreationSpec = {
  action: string | null;
  media: string | null;
  style: string | null;
  theme: string | null;
};

export type CreationPool = {
  action: string[];
  media: string[];
  style: string[];
  theme: string[];
};

export const CREATION_POOL: CreationPool = {
  action: ["créer", "rédiger", "composer"],
  media: ["affiche", "article", "capsule audio"],
  style: ["cartoon", "académique", "minimaliste"],
  theme: ["énergie", "ville intelligente", "biodiversité"],
};
