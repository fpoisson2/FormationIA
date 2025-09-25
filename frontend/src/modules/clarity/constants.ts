import type { GridCoord, PlanAction } from "./types";

export const GRID_SIZE = 10;

export const START_POSITION: GridCoord = { x: 0, y: 0 };

export const DIRECTION_LABELS: Record<PlanAction["dir"], string> = {
  up: "Monter",
  down: "Descendre",
  left: "Aller à gauche",
  right: "Aller à droite",
};

export const CLARITY_TIPS = [
  "Indique la direction ET la distance quand c’est possible.",
  "Découpe en étapes si nécessaire (“puis…”, “ensuite…”).",
  "Nomme explicitement l’objectif (“jusqu’à l’objet en bas à droite”).",
];

export const MICRO_TIPS = [
  "Précise la destination exacte.",
  "Indique un nombre de pas pour chaque direction.",
  "Évite les mots vagues : “un peu”, “par là”.",
];
