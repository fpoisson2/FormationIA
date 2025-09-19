# Configuration LTI 1.3 pour FormationIA

Ce guide explique comment configurer l'intégration LTI 1.3 entre FormationIA et Moodle.

## Étape 1: Générer les clés cryptographiques

```bash
# Exécuter le script de génération des clés
./scripts/generate-lti-keys.sh
```

Le script crée:
- `lti-keys/lti-private.pem` - Clé privée RSA 2048 bits
- `lti-keys/lti-public.pem` - Clé publique correspondante

⚠️ **Important**: Ajoutez `lti-keys/` à votre `.gitignore` pour éviter de committer les clés.

## Étape 2: Configuration des variables d'environnement

Ajoutez ces variables à votre fichier `.env`:

```bash
# Clés LTI (chemins vers les fichiers)
LTI_PRIVATE_KEY_PATH=/chemin/vers/lti-keys/lti-private.pem
LTI_PUBLIC_KEY_PATH=/chemin/vers/lti-keys/lti-public.pem

# Administration FormationIA
ADMIN_AUTH_SECRET=change-me
# Optionnel: création automatique d'un compte admin initial
ADMIN_DEFAULT_USERNAME=admin
ADMIN_DEFAULT_PASSWORD=MotDePasseFort123!

# URLs de redirection
LTI_LAUNCH_URL=https://votre-domaine.com/lti/launch
LTI_POST_LAUNCH_URL=https://votre-domaine.com

# Configuration des cookies (pour HTTPS)
LTI_COOKIE_SECURE=true
LTI_COOKIE_SAMESITE=none
LTI_COOKIE_DOMAIN=votre-domaine.com

# Durée des sessions (en secondes)
LTI_SESSION_TTL=14400  # 4 heures
LTI_STATE_TTL=600      # 10 minutes
```

## Étape 3: (Optionnel) Verrouiller les plateformes autorisées

Le backend peut découvrir automatiquement les plateformes LTI à partir des requêtes de login/launch : il déduit les endpoints (`/mod/lti/*`) depuis l'`issuer`, mémorise les `deployment_id` rencontrés et associe chaque `client_id` au vol. Vous n'avez donc plus besoin d'éditer un fichier JSON pour démarrer.

Pour des environnements plus stricts, vous pouvez tout de même fournir un fichier de configuration via la variable `LTI_PLATFORM_CONFIG_PATH`. Le format reste identique à l'ancien `backend/app/lti-platforms.json` :

```json
[
  {
    "issuer": "https://votre-moodle.example.com",
    "client_id": "votre_client_id_ici",
    "authorization_endpoint": "https://votre-moodle.example.com/mod/lti/auth.php",
    "token_endpoint": "https://votre-moodle.example.com/mod/lti/token.php",
    "jwks_uri": "https://votre-moodle.example.com/mod/lti/certs.php",
    "deployment_id": "votre_deployment_id_ici",
    "audience": null
  }
]
```

### Où trouver ces informations dans Moodle:

1. **Issuer**: URL de base de votre Moodle
2. **Client ID**: Généré par Moodle lors de l'enregistrement de l'outil
3. **Deployment ID**: Visible dans la configuration de l'outil externe
4. **Endpoints**: Suivent généralement le format standard Moodle

## Étape 4: Enregistrer l'outil dans Moodle

### 4.1 Créer un External Tool

1. Allez dans **Administration du site → Plugins → Activités → Outil externe → Gérer les outils**
2. Cliquez sur **Configurer un outil manuellement**

### 4.2 Configuration de base

- **Nom de l'outil**: FormationIA
- **URL de l'outil**: `https://votre-domaine.com/`
- **Version LTI**: LTI 1.3
- **Clé publique**: Copier le contenu de `lti-keys/lti-public.pem`

### 4.3 URLs importantes

- **Initiate Login URL**: `https://votre-domaine.com/lti/login`
- **Redirection URI(s)**: `https://votre-domaine.com/lti/launch`
- **JWKS URL**: `https://votre-domaine.com/.well-known/jwks.json`

### 4.4 Services

Activez les services suivants:
- ✅ **Assignment and Grade Services (AGS)** - Pour le retour de notes
- ✅ **Names and Role Provisioning Services (NRPS)** - Pour les informations utilisateur

### 4.5 Paramètres de confidentialité

- **Partager le nom du lanceur avec l'outil**: Oui
- **Partager l'adresse e-mail du lanceur avec l'outil**: Oui
- **Accepter les notes de l'outil**: Oui

## Étape 5: Tester l'intégration

### 5.1 Ajouter l'activité dans un cours

1. Dans un cours Moodle, **Activer le mode édition**
2. **Ajouter une activité ou une ressource → Outil externe**
3. Sélectionner **FormationIA** dans la liste des outils préconfigurés

### 5.2 Configuration de l'activité

- **Nom de l'activité**: ex. "Formation IA - Prompt Dojo"
- **Note maximale**: 1 (pour Pass/Fail) ou 100 (pour pourcentage)
- **Méthode d'évaluation**: Note passante

### 5.3 Critères de réussite

L'outil retourne automatiquement:
- **Score 1/1** (réussi) quand l'apprenant atteint l'objectif de la mission
- **Score 0/1** (non réussi) en cas d'échec

## Étape 6: Débogage

### Logs côté FormationIA

```bash
# Vérifier les logs du backend
docker-compose logs backend

# Ou si lancé directement
tail -f logs/app.log
```

### Vérification de la configuration

```bash
# Tester l'endpoint JWKS
curl https://votre-domaine.com/.well-known/jwks.json

# Vérifier que les endpoints répondent
curl -I https://votre-domaine.com/lti/login
curl -I https://votre-domaine.com/lti/launch
```

### Erreurs courantes

1. **"Plateforme LTI inconnue"**
   - Assurez-vous que Moodle envoie bien `iss` et `client_id` dans la requête de login (dépend de la configuration de l'outil). Si vous utilisez un fichier via `LTI_PLATFORM_CONFIG_PATH`, vérifiez les valeurs déclarées.

2. **"Session LTI expirée"**
   - L'utilisateur doit relancer l'activité depuis Moodle
   - Vérifiez la configuration des cookies

3. **"Erreur de signature JWT"**
   - Vérifiez que les clés publique/privée correspondent
   - Contrôlez l'URL JWKS dans Moodle

4. **"Score non envoyé"**
   - Vérifiez que AGS est activé dans Moodle
   - Contrôlez les scopes dans la configuration de l'outil

## Support et maintenance

### Rotation des clés

Deux approches possibles:

1. **Via l’API admin** (recommandé)

   - Authentifiez-vous sur `/api/admin/login`
   - Appelez `POST /api/admin/lti-keys` avec les nouvelles clés PEM
   - Moodle consommera instantanément la nouvelle clé via JWKS (mettez tout de même à jour l’interface Moodle si nécessaire)

2. **Manuellement sur le disque**

   ```bash
   # Sauvegarder les anciennes clés
   mv lti-keys lti-keys-backup

   # Générer de nouvelles clés
   ./scripts/generate-lti-keys.sh

   # Mettre à jour la clé publique dans Moodle
   ```

### Monitoring

Surveillez ces métriques:
- Taux de réussite des launches LTI
- Erreurs de retour de notes
- Durée des sessions utilisateur

## Activités supportées

L'intégration LTI fonctionne avec:
- ✅ **Prompt Dojo** - Missions de rédaction de prompts
- ✅ **Clarity Path** - Jeu de navigation par instructions

Le score est automatiquement envoyé à Moodle quand l'apprenant réussit l'activité.
