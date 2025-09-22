export type DecisionOption = {
  id: string;
  title: string;
  impact: string;
  next: number | null;
};

export type DecisionStep = {
  prompt: string;
  options: DecisionOption[];
};

export const DECISIONS: DecisionStep[] = [
  {
    prompt: "Votre équipe doit annoncer un projet. Choisissez une stratégie de communication:",
    options: [
      { id: "A", title: "A — Rapide", impact: "+ vitesse / – profondeur", next: 1 },
      { id: "B", title: "B — Équilibrée", impact: "+ clarté / – temps", next: 1 },
      { id: "C", title: "C — Personnalisée", impact: "+ pertinence / – effort", next: 1 },
    ],
  },
  {
    prompt: "Le public réagit. Ensuite?",
    options: [
      { id: "A", title: "A — FAQ automatisée", impact: "+ échelle / – nuance", next: null },
      { id: "B", title: "B — Atelier interactif", impact: "+ engagement / – logistique", next: null },
      { id: "C", title: "C — Messages ciblés", impact: "+ efficacité / – données", next: null },
    ],
  },
];
