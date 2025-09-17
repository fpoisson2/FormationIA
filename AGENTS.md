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

## Santé du service `GET /health`
- Vérifie la présence de `OPENAI_API_KEY` et répond `{ "status": "ok", "openai_key_loaded": true|false }`.

Les agents partagent la même clé (variable d’environnement `OPENAI_API_KEY`) et s’appuient sur `text={"verbosity": ...}` ainsi que `reasoning={"effort": ..., "summary": "auto"}` tels que configurés dans `backend/app/main.py`.
