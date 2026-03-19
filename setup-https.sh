#!/bin/bash
# ─── HTTPS SETUP WITH LET'S ENCRYPT ──────────────────────
echo "🔒 Setting up HTTPS..."

if [ -z "$DOMAIN" ]; then
  echo "❌ Set DOMAIN first: export DOMAIN=yourdomain.com"
  exit 1
fi

if [ -z "$EMAIL" ]; then
  echo "❌ Set EMAIL first: export EMAIL=you@email.com"
  exit 1
fi

# Create cert directories
mkdir -p certbot/conf certbot/www

# Get certificate
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email $EMAIL \
  --agree-tos \
  --no-eff-email \
  -d $DOMAIN

# Update nginx.conf with real domain
sed -i "s/yourdomain.com/$DOMAIN/g" nginx.conf

echo "✅ HTTPS configured for $DOMAIN"
echo "🔄 Restart: docker compose restart nginx"
