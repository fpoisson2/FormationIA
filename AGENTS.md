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

## Agent polyvalent `POST /api/ai`
- **Rôle** : exposer un appel brut à l’API Responses avec contrôle du modèle, de la verbosité, de l’effort de raisonnement et de la structure attendue.
- **Paramètres** :
  - `messages` (ou `input`) : tableau d’objets `{ role, content }` transmis tels quels au SDK Responses (contenu texte ou liste `{ type: "text", text: "..." }`).
  - `model` (string) : modèle de la gamme GPT-5 autorisé par `SUPPORTED_MODELS`.
  - `verbosity` (enum `low|medium|high`) : verbosité de la génération textuelle.
  - `thinking` (enum `minimal|medium|high`) : effort de raisonnement alloué au modèle.
  - `structuredOutput` (optionnel) : `{ name, schema, strict }` pour activer `response_format=json_schema` (strict par défaut) et récupérer une sortie JSON validée.
  - `stream` (bool, défaut `false`) : si vrai, la réponse est streamée (`text/plain` pour le texte, `application/json` pour le JSON).
- **Retour** :
  - Sans streaming : `JSON { output: string, reasoning: string|null }` ou `JSON { result: any, reasoning: string|null }` si `structuredOutput` est utilisé.
  - Avec streaming : flux texte ou JSON (concaténé) selon la nature de la sortie.

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

## Ajouter une activité frontend

1. Dupliquez le gabarit `frontend/src/pages/templates/ActivityBlank.tsx` pour créer votre composant. Le template inclut déjà l’appel à `useActivityCompletion` qui marque l’activité comme réussie et renvoie vers la liste.
2. Importez votre composant dans `frontend/src/config/activities.tsx`, ajoutez-le au `COMPONENT_REGISTRY`, puis déclarez une entrée dans `ACTIVITY_CATALOG` avec un identifiant, une route (`path`) et les métadonnées par défaut (`header`, `card`, `layout`).
3. Activez le mode édition admin pour ajuster titres et mise en page, puis utilisez le bouton « Sauvegarder » de l’entête pour persister la configuration.

### API accessibles côté frontend

Toutes les activités peuvent appeler les routes suivantes (préfixées par `VITE_API_BASE_URL`) pour composer leur expérience :

- `GET /api/progress` · état courant des activités afin d’afficher la progression.
- `POST /api/progress/activity` · marquer la complétion et déclencher la publication LTI le cas échéant.
- `POST /api/summary` · flux textuel continu pour synthétiser un contenu.
- `POST /api/ai` · appel polyvalent à l’API Responses (choix du modèle, verbosité, raisonnement, streaming, sortie structurée JSON optionnelle).
- Pour les besoins spécifiques à une activité existante, référez-vous directement aux routeurs FastAPI correspondants dans `backend/app/main.py` ou rapprochez-vous de l’équipe backend.
