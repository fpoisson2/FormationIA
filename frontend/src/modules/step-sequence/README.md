# Step sequence module

Ce module fournit un mini-orchestrateur pour afficher une suite de composants React représentant des étapes métier.

## Enregistrement des composants

```ts
import { registerStepComponent } from "@/modules/step-sequence";

registerStepComponent("information", InformationStep);
registerStepComponent("confirmation", ConfirmationStep);
```

Chaque clé d’enregistrement est utilisée par la définition d’étape pour résoudre dynamiquement le composant à afficher.

## Rendu

```tsx
import { StepSequenceContainer } from "@/modules/step-sequence";

type WizardProps = { isEditMode?: boolean };

function Wizard({ isEditMode }: WizardProps) {
  return (
    <StepSequenceContainer
      isEditMode={isEditMode}
      onComplete={(payloads) => console.log(payloads)}
      steps={[
        { id: "info", component: "information" },
        { id: "confirm", component: "confirmation" },
      ]}
    />
  );
}
```

Le conteneur gère l’index courant, les `payloads` renvoyés par chaque étape via `onAdvance` et déclenche `onComplete` lorsque la dernière étape appelle `onAdvance`.

## Contexte

Les composants d’étape peuvent accéder aux informations partagées en appelant le hook `useStepSequence`.

```tsx
import { useStepSequence } from "@/modules/step-sequence";

function ConfirmationStep() {
  const { onAdvance, isEditMode } = useStepSequence();

  return (
    <div>
      {isEditMode ? "Aperçu" : "Mode utilisateur"}
      <button onClick={() => onAdvance({ confirmed: true })}>Continuer</button>
    </div>
  );
}
```

## Étapes composites

Le composant `composite` permet d’orchestrer plusieurs modules d’étape au sein d’une même vue tout en agrégant leurs `payloads`.

```tsx
import type { CompositeStepConfig } from "@/modules/step-sequence";

const recapConfig: CompositeStepConfig = {
  modules: [
    { id: "context", component: "rich-content", slot: "main", config: null },
    { id: "feedback", component: "form", slot: "sidebar", config: null },
  ],
};

const steps = [
  { id: "recap", composite: recapConfig },
];
```

Chaque entrée de `modules[]` doit fournir un `id` unique, la clé `component` enregistrée dans le registre ainsi que un `slot` (`"main"` pour la zone centrale, `"sidebar"` pour la colonne latérale, `"footer"` pour un bloc pleine largeur). Les configurations spécifiques sont transmises via la propriété `config` (utiliser `null` lorsqu'aucun réglage n'est nécessaire).

Le composite expose aux sous-modules un contexte StepSequence complet, mais intercepte leurs appels `onAdvance` afin de stocker les `payloads` localement (sous la forme `{ [moduleId]: payload }`).

Deux comportements sont possibles pour finaliser l’étape :

- `autoAdvance: true` : l’étape est validée automatiquement lorsque tous les sous-modules ont déclenché `onAdvance`.
- par défaut, un bouton « Continuer » est affiché et fusionne les `payloads` des modules avant de quitter l’étape.

## Activité clé en main

Le module expose également un composant `StepSequenceActivity` utilisable via le registre global des activités. Il attend une configuration de métadonnées respectant la forme suivante :

```ts
type StepSequenceActivityConfig = {
  steps: StepDefinition[];
};
```

Les étapes peuvent provenir directement des props ou de la clé `steps` de ces métadonnées. Lorsque la dernière étape appelle `onAdvance`, le callback `onComplete` fourni à l’activité est déclenché avec les `payloads` agrégés par identifiant d’étape.

## Tools pour la génération assistée

Le fichier `tools.ts` expose une série de tools au format `Responses` pour générer dynamiquement des étapes et des activités complètes. Chaque entrée de `STEP_SEQUENCE_TOOLS` regroupe un schéma JSON (clé `definition`) et un handler TypeScript (`handler`).

```ts
import { STEP_SEQUENCE_TOOLS } from "@/modules/step-sequence";

const richContentStep = STEP_SEQUENCE_TOOLS.create_rich_content_step.handler({
  title: "Introduction",
  body: "Définissons la mission et les objectifs.",
});

const activityPayload = STEP_SEQUENCE_TOOLS.build_step_sequence_activity.handler({
  activityId: "atelier",
  steps: [richContentStep],
});
```

L’utilitaire `generateStepId` est également disponible pour dériver des identifiants compatibles avec les conventions existantes (`workshop-…`, `step-…`, etc.).
