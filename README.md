# FormationIA — Atelier interactif multi-étapes

Cette version transforme le prototype purement client en une application complète hébergée dans Docker, avec un backend Python qui dialogue avec l’API Responses en flux continu et une interface React organisée en trois étapes distinctes.

## Structure du projet

- `backend/` · API FastAPI servant les résumés (flux continu) et les cartes d’étude
- `frontend/` · Application React + Tailwind + React Router
- `docker-compose.yml` · Orchestration des deux services
- `AGENTS.md` · Référence rapide des agents exposés par l’API

## Prérequis

1. Docker et Docker Compose
2. Une clé API valide avec accès à la gamme `gpt-5` (nano, mini ou full)

## Configuration

1. Dupliquer le fichier d’exemple puis renseigner vos secrets :

   ```bash
   cp .env.example .env
   ```

2. Modifiez `.env` si nécessaire :
   - `OPENAI_API_KEY` · clé d’accès au service utilisée par le backend
   - `FRONTEND_ORIGIN` · origine autorisée pour la couche CORS du backend
   - `VITE_API_BASE_URL` · URL du backend vue par le navigateur (par défaut `http://localhost:8000`)

## Lancer l’environnement Docker

```bash
docker-compose up --build
```

- Frontend : http://localhost:4173
- Backend  (FastAPI + client Responses) : http://localhost:8000

Le backend ouvre deux routes principales :

- `POST /api/summary` — Résumé envoyé en flux continu (texte brut) avec contrôle du modèle GPT-5, de la verbosité (`low`/`medium`/`high`) et de l’effort de raisonnement (`minimal`/`medium`/`high`).
- `POST /api/flashcards` — Génération de cartes d’étude (JSON) en réutilisant les mêmes paramètres.

Un endpoint `GET /health` permet de vérifier la disponibilité du service et la présence de la clé configurée.

## Lancer sans Docker

Backend :

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend :

```bash
cd frontend
npm install
npm run dev -- --host
```

Définissez les mêmes variables d’environnement (`OPENAI_API_KEY`, `VITE_API_BASE_URL`, etc.) dans votre shell ou via des fichiers `.env` locaux (`frontend/.env.local`).

## Parcours pédagogique

1. **Étape 1 — Préparer** : contextualisez votre texte et découvrez les bonnes pratiques de cadrage.
2. **Étape 2 — Explorer** : choisissez le modèle, la verbosité et l’effort de raisonnement pour deux configurations, puis observez les résumés apparaître en flux continu.
3. **Étape 3 — Synthétiser** : comparez les deux profils, générez des cartes d’étude si besoin, puis produisez une synthèse finale structurée.

Chaque étape intègre des encarts pédagogiques sur l’IA afin de rythmer l’apprentissage et d’ancrer les notions clés.

## Notes

- Le frontend est compilé lors de la construction de l’image Docker et servi par Nginx (fallback SPA déjà configuré).
- Les contrôles UI gèrent les erreurs réseau et affichent l’état du flux continu pour faciliter les démonstrations.
- Le backend s’appuie sur le SDK `openai>=1.99.2` (utilisé ici comme client Responses) afin d’accéder aux paramètres de verbosité et de raisonnement des modèles GPT-5.
- L’interface adopte l’esthétique du Cégep Limoilou (palette noir/rouge, typographie Poppins, bandeaux arrondis) tout en conservant la progression pédagogique en trois pages distinctes.
