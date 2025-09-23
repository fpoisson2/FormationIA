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
