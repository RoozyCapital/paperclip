#!/bin/bash
set -e

# ============================================
# Paperclip VPS Setup Script
# ============================================
# Usage: ./scripts/vps-setup.sh
# ============================================

echo "🚀 Paperclip VPS Setup"
echo "======================"

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run as root: sudo ./scripts/vps-setup.sh"
  exit 1
fi

# Get VPS IP
VPS_IP=$(curl -s ifconfig.me)
echo "📍 Detected VPS IP: $VPS_IP"

# Generate secrets
POSTGRES_PASSWORD=$(openssl rand -base64 24)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)

echo ""
echo "🔐 Generated secrets:"
echo "   PostgreSQL Password: $POSTGRES_PASSWORD"
echo "   Better Auth Secret: ${BETTER_AUTH_SECRET:0:16}..."
echo ""

# Create .env file
cat > .env << EOF
# PostgreSQL
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# Better Auth
BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET

# VPS IP Address
VPS_IP=$VPS_IP
EOF

echo "✅ Created .env file"

# Install Docker if not present
if ! command -v docker &> /dev/null; then
  echo "📦 Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "✅ Docker installed"
fi

# Install Docker Compose if not present
if ! command -v docker-compose &> /dev/null; then
  echo "📦 Installing Docker Compose..."
  apt-get update && apt-get install -y docker-compose-plugin
  echo "✅ Docker Compose installed"
fi

# Create deployment directory
mkdir -p /opt/paperclip
cd /opt/paperclip

# Copy docker-compose file if not exists
if [ ! -f docker-compose.production.yml ]; then
  echo "📦 Creating docker-compose.production.yml..."
  cat > docker-compose.production.yml << 'COMPOSE_EOF'
version: "3.8"

services:
  postgres:
    image: postgres:16-alpine
    container_name: paperclip-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: paperclip
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: paperclip
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U paperclip"]
      interval: 10s
      timeout: 5s
      retries: 5

  paperclip:
    image: ghcr.io/${GITHUB_REPO}:canary
    container_name: paperclip-app
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "3100:3100"
    environment:
      DATABASE_URL: postgres://paperclip:${POSTGRES_PASSWORD}@postgres:5432/paperclip
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: http://${VPS_IP}:3100
      PAPERCLIP_AUTH_PUBLIC_BASE_URL: http://${VPS_IP}:3100
      PAPERCLIP_DEPLOYMENT_MODE: authenticated
      PAPERCLIP_DEPLOYMENT_EXPOSURE: public
      PAPERCLIP_MIGRATION_AUTO_APPLY: "true"
      PORT: 3100
      HOST: 0.0.0.0
      SERVE_UI: "true"
    volumes:
      - paperclip_data:/paperclip

volumes:
  postgres_data:
    driver: local
  paperclip_data:
    driver: local
COMPOSE_EOF
  echo "✅ Created docker-compose.production.yml"
fi

# Copy .env file if not exists
if [ ! -f .env ]; then
  cat > .env << ENV_EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
VPS_IP=$VPS_IP
ENV_EOF
  echo "✅ Created .env file"
fi

# Source .env and start services
echo ""
echo "🔨 Starting Paperclip..."
set -a
source .env
set +a

docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d

echo ""
echo "✅ Paperclip is running!"
echo ""
echo "📍 Access your instance at: http://$VPS_IP:3100"
echo ""
echo "📝 Next steps:"
echo "   1. Open http://$VPS_IP:3100 in your browser"
echo "   2. Click 'Sign Up' to create your admin account"
echo "   3. Login and claim the instance"
echo ""
echo "📋 PostgreSQL password saved in .env file"
echo "   (Keep this safe! You'll need it for backups)"
echo ""
echo "🔧 Useful commands:"
echo "   docker compose -f docker-compose.production.yml logs -f  # View logs"
echo "   docker compose -f docker-compose.production.yml down     # Stop services"
echo "   docker compose -f docker-compose.production.yml up -d    # Start services"
