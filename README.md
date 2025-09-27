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
   - `FRONTEND_ORIGIN` · origine autorisée pour la couche CORS du backend (défaut `https://formationia.ve2fpd.com,http://localhost:5173`)
   - `VITE_API_BASE_URL` · URL du backend vue par le navigateur (par défaut `http://localhost:8001`)

## Lancer l’environnement Docker

```bash
docker-compose up --build
```

- Frontend : http://localhost:4173
- Backend  (FastAPI + client Responses) : http://localhost:8001
- L’écran de connexion utilise les variables `VITE_LOGIN_USERNAME` / `VITE_LOGIN_PASSWORD` (défaut : `test` / `Telecom2025$`).

Le backend expose désormais trois agents principaux :

- `POST /api/summary` — Résumé envoyé en flux continu (texte brut) avec contrôle du modèle GPT-5, de la verbosité (`low`/`medium`/`high`) et de l’effort de raisonnement (`minimal`/`medium`/`high`).
- `POST /api/flashcards` — Génération de cartes d’étude (JSON) en réutilisant les mêmes paramètres.
- `POST /api/plan` — Conversion d’une consigne naturelle en plan JSON structuré (≤30 actions) pour piloter le « Parcours de la clarté ». La réponse est streamée en SSE (`plan`, `step`, `done|blocked`, `stats`).

Un endpoint `GET /health` permet de vérifier la disponibilité du service et la présence de la clé configurée.

### Intégration LTI 1.3

Le backend agit aussi comme outil LTI 1.3 (voir `LTI-SETUP.md` pour la procédure complète). Principales routes côté serveur :

- `GET/POST /lti/login` : point d’entrée OIDC tiers qui redirige l’usager vers Moodle avec les paramètres `state`/`nonce`.
- `POST /lti/launch` : valide l’`id_token`, crée la session LTI et redirige vers le frontend. La session est stockée côté serveur pendant `LTI_SESSION_TTL` secondes (par défaut 4 h).
- `GET /api/lti/context` : retourne l’identité et le contexte du lancement (protégé par le cookie de session LTI).
- `POST /api/lti/score` : publie un score via Assignment & Grade Services lorsque l’activité est réussie.
- `DELETE /api/lti/session` : termine la session (nettoie le cookie côté navigateur et le store en mémoire).

L’intégration est compatible avec les flux LTI Advantage standards et expose aussi un workflow **LTI Deep Linking 2.0** (cf. [spécification IMS](https://www.imsglobal.org/spec/lti-dl/v2p0/)). Une requête `LtiDeepLinkingRequest` ouvre un sélecteur natif listant les parcours FormationIA ; l’outil renvoie un `LtiDeepLinkingResponse` contenant autant de `ltiResourceLink` que d’activités choisies, chacune avec un item de note (`scoreMaximum = 1`).

Les clés publiques/privées sont chargées depuis l’environnement (`LTI_PRIVATE_KEY_PATH`, `LTI_PUBLIC_KEY_PATH`) ou des variables inline. Les plateformes LTI peuvent être découvertes dynamiquement à partir des requêtes Moodle : si aucun JSON n’est fourni, le backend dérive automatiquement les endpoints (`/mod/lti/*`) depuis l’`issuer` et enregistre les `deployment_id` rencontrés. Vous pouvez toutefois fournir une configuration statique via `LTI_PLATFORM_CONFIG_PATH` pour figer ces métadonnées.

### Administration LTI

Un store persistant (`storage/admin.json` par défaut ou `ADMIN_STORAGE_PATH`) conserve désormais :

- Les plateformes LTI autorisées (issuer, client ID, endpoints, déploiements)
- Les chemins des clés privées/publiques
- Les comptes locaux (`LocalUser`) avec rôles (`admin`, `facilitator`, etc.), état d’activation et empreinte de mot de passe `bcrypt`

Les opérations s’exposent via deux routeurs FastAPI protégés par un jeton signé (`ADMIN_AUTH_SECRET`) et un cookie sécurisé (`ADMIN_SESSION_COOKIE_NAME`) :

- `POST /api/admin/auth/login` / `POST /api/admin/auth/logout` / `GET /api/admin/auth/me` · cycle d’authentification local avec cookie HTTPOnly, TTL configurable (`ADMIN_SESSION_TTL`, `ADMIN_SESSION_REMEMBER_TTL`) et introspection du profil courant
- `GET/POST/PATCH /api/admin/users` · gestion des comptes locaux (création, mise à jour des rôles, activation/désactivation)
- `POST /api/admin/users/{username}/reset-password` · réinitialisation du mot de passe (un compte non-admin ne peut modifier que sa propre entrée)
- `GET /api/admin/lti-platforms` · Liste les plateformes connues
- `POST/PUT/PATCH /api/admin/lti-platforms` · Création/mise à jour des métadonnées (issuer, endpoints, déploiements)
- `DELETE /api/admin/lti-platforms` · Retire une configuration (si elle n’est pas marquée read-only)
- `GET /api/admin/lti-keys` · Visualise l’état des chemins de clés
- `POST /api/admin/lti-keys` · Téléverse ou remplace les fichiers PEM aux emplacements configurés

Variables principales :

- `ADMIN_AUTH_SECRET` (obligatoire) · secret HMAC utilisé pour signer les tokens et cookies admin
- `ADMIN_STORAGE_PATH` (optionnel) · chemin vers le fichier JSON persistant
- `ADMIN_SESSION_COOKIE_NAME`, `ADMIN_SESSION_TTL`, `ADMIN_SESSION_REMEMBER_TTL`, `ADMIN_COOKIE_*` · personnalisations du cookie admin (domaine, SameSite, Secure)
- `ADMIN_DEFAULT_USERNAME` / `ADMIN_DEFAULT_PASSWORD` · création automatique d’un compte admin au premier démarrage

### Persistance des progrès

Chaque page d’activité notifie désormais le backend via `POST /api/progress/activity` lorsqu’elle est complétée. Le backend conserve ces informations dans un fichier JSON durable (`storage/progress.json` par défaut ou `PROGRESS_STORAGE_PATH`).

- Les usagers LTI sont identifiés par `issuer + sub`. Les utilisateurs non authentifiés reçoivent un cookie `formationia_progress` qui permet de retenir leur état entre les visites.
- Les missions « Clarté d’abord » enregistrent aussi les réponses stade par stade (`POST /api/submit`) afin qu’un run puisse être repris ultérieurement.
- `GET /api/progress` fournit l’état courant (utilisé sur l’écran `ActivitySelector` pour afficher un crochet vert).

Lorsque l’activité est validée, le frontend déclenche automatiquement `POST /api/lti/score` (si une session LTI est active) pour envoyer un score « 1/1 » dans le carnet de notes de la plateforme. Chaque activité (« Parcours de la clarté », « Prompt Dojo », « Clarté d’abord », Atelier comparatif) renvoie ainsi son résultat au LMS pour alimenter le suivi global des apprenants.

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

## Configuration production & Docker

Pour un déploiement durable, ajustez les points suivants :

- **Clés LTI** : générez-les via `./scripts/generate-lti-keys.sh`, montez le dossier dans le container backend (`./lti-keys:/app/lti-keys`) et exposez les chemins via
  - `LTI_PRIVATE_KEY_PATH=/app/lti-keys/lti-private.pem`
  - `LTI_PUBLIC_KEY_PATH=/app/lti-keys/lti-public.pem`
- **Metadata plateforme** : optionnel, fournissez `LTI_PLATFORM_CONFIG_PATH` pour pointer vers un JSON monté en volume si vous souhaitez verrouiller explicitement les `issuer`/`client_id`/`deployment_id`. En l’absence de fichier, le backend déduit automatiquement la configuration depuis les paramètres reçus pendant le login/launch.
- **URLs de redirection** : définissez `LTI_LAUNCH_URL` et `LTI_POST_LAUNCH_URL` sur des URLs HTTPS valides (le front doit être servi sur le même domaine pour éviter les blocages cookies).
- **Cookies** : adaptez `LTI_COOKIE_DOMAIN`, `LTI_COOKIE_SECURE`, `LTI_COOKIE_SAMESITE` ainsi que leurs équivalents pour le suivi de progression (`PROGRESS_COOKIE_*`). En production, on recommandera `*_SECURE=true` et `*_SAMESITE=none` si le LMS est sur un autre domaine.
- **Persistance des données** : pour ne pas perdre l’historique des activités et la configuration admin, mappez le dossier `backend/storage`/`storage` ou définissez `PROGRESS_STORAGE_PATH` et `ADMIN_STORAGE_PATH` vers un chemin monté (volume Docker ou stockage partagé).
- **Réseau Docker** : le `docker-compose.yml` est prêt à se connecter au réseau `moodle-docker_default` afin de dialoguer avec une instance Moodle locale. Adaptez `network_mode`/`networks` selon votre architecture ou supprimez la section si vous n’en avez pas besoin.
- **Variables Responses** : gardez `OPENAI_API_KEY` hors du dépôt (fichiers `.env` injectés à l’exécution).

Référez-vous à `LTI-SETUP.md` pour la configuration détaillée côté Moodle (client ID, JWKS, services AGS/NRPS).

## Parcours pédagogique

1. **Étape 1 — Préparer** : contextualisez votre texte et découvrez les bonnes pratiques de cadrage.
2. **Étape 2 — Explorer** : choisissez le modèle, la verbosité et l’effort de raisonnement pour deux configurations, puis observez les résumés apparaître en flux continu (avec un court résumé du raisonnement fourni automatiquement).
3. **Étape 3 — Synthétiser** : comparez les deux profils, générez des cartes d’étude si besoin, puis produisez une synthèse finale structurée.
4. **Parcours de la clarté** : nouvelle activité ludique (React + SSE) où l’étudiant formule une consigne précise pour déplacer un bonhomme sur une grille 10×10. Le backend récupère un plan complet via `gpt-5-nano`, simule la trajectoire puis renvoie les statistiques clés (tentatives, surcoût, temps de résolution, hypothèses du modèle).
5. **Clarté d’abord !** : jeu auto-portant en trois manches pour deux missions (menu étudiant, résumé d’article). Des champs guidés et validés côté frontend aident à constater l’impact d’un brief incomplet avant la révélation finale (checklist et export JSON pour la mission menu).

Chaque module intègre des encarts pédagogiques pour ancrer les notions clés et illustrer les bonnes pratiques de prompting.

## Notes

- Le frontend est compilé lors de la construction de l’image Docker et servi par Nginx (fallback SPA déjà configuré).
- Les contrôles UI gèrent les erreurs réseau et affichent l’état du flux continu pour faciliter les démonstrations.
- Le backend s’appuie sur le SDK `openai>=1.99.2` (utilisé ici comme client Responses) afin d’accéder aux paramètres de verbosité et de raisonnement des modèles GPT-5.
- L’interface adopte l’esthétique du Cégep Limoilou (palette noir/rouge, typographie Poppins, bandeaux arrondis) tout en conservant la progression pédagogique en trois pages distinctes.

### Vérification manuelle — page « Liste d’activités »

La connexion administrateur peut être simulée grâce au **mode test** pour confirmer l’accès au catalogue d’activités sans identifiants réels :

1. Lancer le frontend localement :
   ```bash
   cd frontend
   npm install
   VITE_ADMIN_TEST_MODE=1 npm run dev -- --host
   ```
2. Depuis un navigateur, ouvrir `http://localhost:5173/activites` ; la redirection mène à la page de connexion.
3. Cliquer sur **« Lancer la session de démonstration »** dans l’encart *Mode test activé*.
4. Vérifier que la navigation retourne sur `/activites` et que la grille des activités (cartes « Activité ») s’affiche correctement.

### Vérification manuelle — carrefour NESO

Après avoir appliqué les correctifs de sprites de chemin, vous pouvez confirmer visuellement que la tuile de croisement NESO (`mapTile_128.png`) est bien sélectionnée :

1. Lancer le frontend localement (`cd frontend && npm install && npm run dev -- --host`).
2. Ouvrir http://localhost:5173 et naviguer jusqu’à l’activité « Explorateur IA ».
3. Activer/désactiver quelques chemins pour créer une intersection nord-est-sud-ouest et vérifier que la tuile de carrefour s’affiche correctement.
