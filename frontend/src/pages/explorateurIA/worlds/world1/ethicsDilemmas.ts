export type EthicsOption = {
  id: string;
  label: string;
  fb: string;
  score: number;
};

export type EthicsDilemma = {
  s: string;
  options: EthicsOption[];
};

export const DILEMMAS: EthicsDilemma[] = [
  {
    s: "Un outil génère un résumé contenant des stéréotypes.",
    options: [
      {
        id: "ignorer",
        label: "Ignorer",
        fb: "Risque d'amplifier le biais et de diffuser une erreur.",
        score: 0,
      },
      {
        id: "corriger",
        label: "Corriger et justifier",
        fb: "Bonne pratique: signalez et corrigez les biais.",
        score: 100,
      },
      {
        id: "expliquer",
        label: "Demander des explications",
        fb: "Utile, mais sans correction le risque demeure.",
        score: 60,
      },
    ],
  },
  {
    s: "Un modèle révèle des données sensibles dans un exemple.",
    options: [
      {
        id: "ignorer",
        label: "Ignorer",
        fb: "Non-conforme à la protection des données.",
        score: 0,
      },
      {
        id: "corriger",
        label: "Supprimer et anonymiser",
        fb: "Conforme aux bonnes pratiques.",
        score: 100,
      },
      {
        id: "expliquer",
        label: "Demander justification",
        fb: "Insuffisant sans retrait immédiat.",
        score: 40,
      },
    ],
  },
];
