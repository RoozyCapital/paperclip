# VPS Deployment Guide

## Quick Start (One Command)

```bash
sudo ./scripts/vps-setup.sh
```

This will:
1. Detect your VPS public IP
2. Generate secure passwords/secrets
3. Install Docker (if needed)
4. Build and start Paperclip with PostgreSQL
5. Print access instructions

## What You Get

- **Paperclip UI**: `http://YOUR_VPS_IP:3100`
- **PostgreSQL**: Local only (port 5432 not exposed)
- **Authentication**: Required (email/password login)
- **Data Persistence**: Docker volumes

## First Time Setup

1. Open `http://YOUR_VPS_IP:3100` in your browser
2. Click **Sign Up** to create your admin account
3. Login with your new account
4. You'll see a **"Claim this instance"** screen
5. Click **Claim** to become the instance admin
6. Start creating companies and agents!

## Security Notes

### ⚠️ Public IP Access (No Domain)

When accessing via public IP:
- **HTTP only** (no SSL/HTTPS)
- Session cookies are **not encrypted**
- Anyone on the network can potentially intercept

### Recommendations

1. **Use VPN/Tailscale** (recommended)
   - Install Tailscale on VPS
   - Access via Tailscale IP (e.g., `http://100.x.x.x:3100`)
   - Encrypted, private, no port forwarding needed

2. **Add HTTPS with Nginx** (better)
   - Get a domain name
   - Setup Nginx reverse proxy
   - Use Let's Encrypt for free SSL
   - Forward port 443 instead of 3100

3. **Use a firewall**
   ```bash
   # Allow only specific IPs (replace with your IP)
   ufw allow from YOUR_IP to any port 3100
   ufw enable
   ```

## Manual Setup (Without Script)

### 1. Create `.env` File

```bash
cat > .env << EOF
POSTGRES_PASSWORD=$(openssl rand -base64 24)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
VPS_IP=$(curl -s ifconfig.me)
EOF
```

### 2. Build and Run

```bash
docker compose -f docker-compose.production.yml up -d --build
```

### 3. Check Logs

```bash
docker compose -f docker-compose.production.yml logs -f
```

## Backup & Restore

### Backup PostgreSQL

```bash
docker exec paperclip-db pg_dump -U paperclip paperclip > backup_$(date +%Y%m%d).sql
```

### Restore PostgreSQL

```bash
docker exec -i paperclip-db psql -U paperclip paperclip < backup.sql
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose -f docker-compose.production.yml logs paperclip

# Common issues:
# - Missing .env file
# - PostgreSQL not ready (wait 30 seconds)
# - Port 3100 already in use
```

### Can't Connect from Browser

1. Check if container is running: `docker ps`
2. Check firewall: `sudo ufw status`
3. Check port is open: `curl http://localhost:3100/api/health`
4. Check VPS security group (cloud providers)

### Reset Admin Password

If you lose admin access:

```bash
# Stop the app
docker compose -f docker-compose.production.yml down

# Remove data (CAUTION: deletes all data!)
docker volume rm paperclip_postgres_data paperclip_paperclip_data

# Restart fresh
docker compose -f docker-compose.production.yml up -d
```

Then sign up again as a new admin.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password |
| `BETTER_AUTH_SECRET` | Yes | Auth secret (min 32 chars) |
| `VPS_IP` | Yes | Your VPS public IP |
| `DATABASE_URL` | Auto | Auto-configured by Docker |
| `BETTER_AUTH_URL` | Auto | Auto-configured from VPS_IP |
| `PAPERCLIP_AUTH_PUBLIC_BASE_URL` | Auto | Auto-configured from VPS_IP |

## Architecture

```
┌─────────────────────────────────────┐
│           VPS (Public IP)           │
├─────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  │
│  │  Paperclip   │  │ PostgreSQL  │  │
│  │  (port 3100) │──│ (port 5432) │  │
│  └──────┬───────┘  └─────────────┘  │
│         │                            │
└─────────┼────────────────────────────┘
          │
    ┌─────┴─────┐
    │  Browser   │
    │  (HTTP)    │
    └───────────┘
```

## Next Steps

After deployment:
1. [Create your first company](https://paperclip.readthedocs.io/)
2. [Hire your first agent](https://paperclip.readthedocs.io/)
3. [Create tasks and goals](https://paperclip.readthedocs.io/)

---

*For more details, see [doc/DEPLOYMENT-MODES.md](../doc/DEPLOYMENT-MODES.md)*
