# AGENTS

Ce projet met à disposition deux "agents" côté serveur, exposés par l’API FastAPI (`backend/app/main.py`). Ils orchestrent les appels à l’API Responses.

## Agent de synthèse `POST /api/summary`
- **Rôle** : transformer un texte source en résumé diffusé en flux continu.
- **Paramètres** :
  - `text` (string) : contenu à résumer (≥ 10 caractères).
  - `model` (string) : un des modèles supportés (`gpt-5-nano`, `gpt-5-mini`, `gpt-5`).
  - `verbosity` (enum) : `low`, `medium`, `high` pour exploiter le paramètre natif de verbosité.
  - `thinking` (enum) : `minimal`, `medium`, `high` pour ajuster l’effort de raisonnement.
- **Retour** : flux `text/plain` contenant la réponse principale, suivi d’un bloc « Résumé du raisonnement » généré automatiquement lorsque disponible.

## Agent cartes d’étude `POST /api/flashcards`
- **Rôle** : générer 1 à 6 cartes d’étude (Q/R) prêtes à exporter.
- **Paramètres** : identiques à l’agent de synthèse, avec `card_count` (int, défaut 3).
- **Retour** : `JSON { "cards": [{ "question": ..., "reponse": ... }, ...] }`.

## Agent parcours de la clarté `POST /api/plan`
- **Rôle** : convertir une consigne naturelle en plan d’actions JSON (≤30) sur une grille 10×10.
- **Paramètres** :
  - `start` (objet `{x:int,y:int}`) : position initiale (0–9).
  - `goal` (objet `{x:int,y:int}`) : position cible (0–9).
  - `blocked` (liste) : cases interdites optionnelles.
  - `instruction` (string) : consigne en français.
  - `runId` (string) : identifiant de partie (permet d’agréger les tentatives).
- **Retour** : flux SSE `text/event-stream` avec les événements suivants :
  - `plan` : JSON strict `{"plan":[{"dir":"left|right|up|down","steps":int}],"notes?":"..."}` validé par le backend.
  - `step` : cases visitées séquentiellement (`{"x":n,"y":m,"dir":"...","i":k}`).
  - `done` ou `blocked` : issue de la trajectoire (`reason=obstacle|goal_not_reached`).
  - `stats` : récapitulatif (`attempts`, `stepsExecuted`, `optimalPathLength`, `surcout`, `ambiguity?`, `success`).

## Santé du service `GET /health`
- Vérifie la présence de `OPENAI_API_KEY` et répond `{ "status": "ok", "openai_key_loaded": true|false }`.

Les agents partagent la même clé (variable d’environnement `OPENAI_API_KEY`) et s’appuient sur `text={"verbosity": ...}` ainsi que `reasoning={"effort": ..., "summary": "auto"}` tels que configurés dans `backend/app/main.py`.
