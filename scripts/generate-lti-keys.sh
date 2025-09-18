#!/bin/bash

# Script pour générer les clés RSA nécessaires à l'intégration LTI 1.3
# Usage: ./scripts/generate-lti-keys.sh

set -e

KEYS_DIR="lti-keys"
PRIVATE_KEY="$KEYS_DIR/lti-private.pem"
PUBLIC_KEY="$KEYS_DIR/lti-public.pem"

echo "🔐 Génération des clés RSA pour LTI 1.3..."

# Créer le répertoire s'il n'existe pas
mkdir -p "$KEYS_DIR"

# Générer la clé privée RSA 2048 bits
echo "📝 Génération de la clé privée..."
openssl genrsa -out "$PRIVATE_KEY" 2048

# Extraire la clé publique
echo "🔑 Extraction de la clé publique..."
openssl rsa -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY"

# Afficher les chemins des fichiers
echo "✅ Clés générées avec succès:"
echo "   Clé privée: $PRIVATE_KEY"
echo "   Clé publique: $PUBLIC_KEY"

echo ""
echo "📋 Configuration requise:"
echo "   LTI_PRIVATE_KEY_PATH=$(pwd)/$PRIVATE_KEY"
echo "   LTI_PUBLIC_KEY_PATH=$(pwd)/$PUBLIC_KEY"
echo ""
echo "🔗 URLs à configurer dans Moodle:"
echo "   Initiate Login URL: https://votre-domaine.com/lti/login"
echo "   Redirect/Launch URL: https://votre-domaine.com/lti/launch"
echo "   JWKS URL: https://votre-domaine.com/.well-known/jwks.json"
echo ""
echo "⚠️  IMPORTANT: Ne jamais committer la clé privée dans Git!"
echo "   Ajoutez '$KEYS_DIR/' à votre .gitignore"