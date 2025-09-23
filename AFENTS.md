# Tests frontend FormationIA

Ce dépôt fournit un fichier d'environnement dédié aux tests Vite/Vitest pour le frontend.

## Préparation

1. Installez les dépendances JavaScript :
   ```bash
   cd frontend
   npm install
   ```
2. Le fichier `frontend/.env.test` est chargé automatiquement par Vitest. Il configure l'URL du backend (`VITE_API_BASE_URL`),
   une clé API factice (`VITE_API_AUTH_KEY`) et les identifiants de démonstration (`VITE_LOGIN_USERNAME` / `VITE_LOGIN_PASSWORD`).
   Vous pouvez l'adapter si votre backend tourne sur une autre adresse.

## Lancer la suite de tests

Depuis le dossier `frontend`, exécutez l'une des commandes suivantes :

```bash
npm test          # exécute Vitest en mode run via le script package.json
npx vitest run    # lance directement Vitest avec les mêmes variables d'environnement
```

Les deux commandes consomment automatiquement les variables définies dans `.env.test`, ce qui évite d'exposer des secrets dans le dépôt tout en offrant un comportement reproductible.
