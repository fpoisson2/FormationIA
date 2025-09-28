# AGENTS

Ce dépôt expose plusieurs points d'accès backend (agents FastAPI) ainsi qu'un frontend React administrable via un mode test. Les instructions ci-dessous s'appliquent à l'ensemble du projet.

## Agents backend disponibles

Les agents sont orchestrés par `backend/app/main.py` et reposent tous sur la variable d'environnement `OPENAI_API_KEY`.

### Agent de synthèse `POST /api/summary`
- **Rôle** : transformer un texte source en résumé diffusé en flux continu.
- **Paramètres** : `text` (≥ 10 caractères), `model` (`gpt-5-nano` | `gpt-5-mini` | `gpt-5`), `verbosity` (`low` | `medium` | `high`), `thinking` (`minimal` | `medium` | `high`).
- **Retour** : flux `text/plain` contenant la réponse principale, suivi d'un bloc « Résumé du raisonnement » lorsque disponible.

### Agent cartes d'étude `POST /api/flashcards`
- **Rôle** : générer 1 à 6 cartes d'étude (Q/R) prêtes à exporter.
- **Paramètres** : identiques à l'agent de synthèse avec `card_count` (int, défaut 3).
- **Retour** : `JSON { "cards": [{ "question": ..., "reponse": ... }, ...] }`.

### Agent parcours de la clarté `POST /api/plan`
- **Rôle** : convertir une consigne naturelle en plan d'actions JSON (≤ 30 entrées) sur une grille 10×10.
- **Paramètres** : `start`, `goal`, `blocked`, `instruction`, `runId`.
- **Retour** : flux SSE `text/event-stream` comprenant `plan`, `step`, `done|blocked` et `stats`.

### Santé du service `GET /health`
- Vérifie la présence de `OPENAI_API_KEY` et répond `{ "status": "ok", "openai_key_loaded": true|false }`.

## Frontend : mode test administrateur

Le frontend React dispose d'un mode test permettant de contourner la page de connexion pour capturer des captures d'écran ou vérifier rapidement les pages protégées.

- Définissez `VITE_ADMIN_TEST_MODE=true` dans `.env.local` ou via la ligne de commande avant de lancer `npm run dev --prefix frontend`.
- Depuis `/admin/connexion`, utilisez le bandeau « mode test » pour déclencher la session de démonstration. Le routeur préserve automatiquement la destination initialement demandée.
- Après ouverture du bandeau, cliquez sur « Lancer la session de démonstration » pour accéder aux captures d'écran et à l'ensemble des interfaces protégées.
- Les tests et captures d'écran peuvent être réalisés sans véritables identifiants ni appels réseau aux APIs d'authentification.

## Tests frontend

- `npm run build --prefix frontend` : garantit que Vite/Babel peut analyser le bundle (utile avant toute capture d'écran).
- `npm --prefix frontend test -- --run` : lance Vitest en mode run. Vous pouvez désormais utiliser `npm run test:frontend` depuis la racine du dépôt (scripts déclarés dans `package.json`). Pensez à exécuter `npm run install:frontend` si le binaire Vitest n'est pas encore installé. Certaines suites (`ClarityMapStep` / `VideoStep`) peuvent être instables ; documentez toute erreur connue dans vos comptes rendus.

Respectez ces indications lors de la mise à jour du projet ou de la préparation de démonstrations.
