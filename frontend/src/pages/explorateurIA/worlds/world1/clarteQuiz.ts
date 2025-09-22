export type ClarteQuizOption = {
  id: string;
  text: string;
  explain: string;
  score: number;
};

export type ClarteQuizQuestion = {
  q: string;
  options: ClarteQuizOption[];
};

export const CLARTE_QUESTIONS: ClarteQuizQuestion[] = [
  {
    q: "Quel est le meilleur énoncé pour obtenir un plan clair?",
    options: [
      {
        id: "A",
        text: "Écris un plan.",
        explain: "Trop vague : objectifs, sections, longueur… manquent.",
        score: 0,
      },
      {
        id: "B",
        text: "Donne un plan en 5 sections sur l'énergie solaire pour débutants, avec titres et 2 sous-points chacun.",
        explain: "Précis, contraint et adapté au public cible.",
        score: 100,
      },
      {
        id: "C",
        text: "Plan énergie solaire?",
        explain: "Formulation télégraphique, ambiguë.",
        score: 10,
      },
    ],
  },
];
