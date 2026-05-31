# CPI Work Allocation — Deployment Runbook

Single-box AWS EC2 deployment. Postgres runs in Docker on the same instance as
the Node API and the Nginx-served SPA build.

This document is the **operational reference** that lives in the repo. The
companion files in this `deploy/` directory are referenced throughout:

| File | Purpose |
|---|---|
| `deploy/nginx.conf` | Production Nginx server block — copy to `/etc/nginx/sites-available/cpi` |
| `deploy/backup-db.sh` | Nightly `pg_dump` + rotation, optional S3 upload |
| `deploy/deploy.sh` | Idempotent redeploy script for the iteration loop |
| `cpi-work-allocation-api/docker-compose.prod.yml` | Loopback-bound Postgres, env-driven password |
| `cpi-work-allocation-api/.env.production.example` | Template for the API's prod `.env` |
| `cpi-work-allocation-api/.env-postgres.example` | Template for the Postgres container env |
| `cpi-work-allocation-frontend/.env.production.example` | Template for the frontend's prod build env |

---

## 1. AWS resources

### EC2 instance

- **Type**: `t3a.small` (2 vCPU, 2 GB RAM)
- **AMI**: Ubuntu Server 22.04 LTS
- **Storage**: 50 GiB gp3, encrypted
- **Region**: `ap-southeast-1` (Singapore)
- **Elastic IP**: allocated and associated

### Security group `cpi-web-sg`

| Port | Source | Purpose |
|---|---|---|
| 22 | Your IP only | SSH |
| 80 | `0.0.0.0/0` | HTTP (redirects to HTTPS) |
| 443 | `0.0.0.0/0` | HTTPS |

Ports 4000 (API) and 5433 (Postgres) stay on `127.0.0.1` only — no inbound rule.

---

## 2. First-time server bootstrap

SSH in: `ssh -i ~/.ssh/cpi-ec2-key.pem ubuntu@<elastic-ip>`

```bash
sudo apt-get update && sudo apt-get upgrade -y

# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Nginx, Certbot, Postgres client, git, build tools
sudo apt-get install -y nginx certbot python3-certbot-nginx postgresql-client git build-essential

# Docker Engine + Compose plugin
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu
# Log out + back in (or `newgrp docker`) so the group change takes effect.

# PM2
sudo npm install -g pm2

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

---

## 3. First-time app setup

### 3.1 Clone

```bash
sudo mkdir -p /opt/cpi && sudo chown ubuntu:ubuntu /opt/cpi
cd /opt/cpi
git clone https://github.com/<your-org>/cpi-work-allocation-app.git
cd cpi-work-allocation-app
```

### 3.2 Configure env files

```bash
# Postgres container password
cd cpi-work-allocation-api
cp .env-postgres.example .env-postgres
nano .env-postgres                # set POSTGRES_PASSWORD (openssl rand -hex 24)
chmod 600 .env-postgres

# API runtime env — note the password must MATCH the one in .env-postgres
cp .env.production.example .env
nano .env                          # fill in all REPLACE_WITH_* placeholders
chmod 600 .env

# Frontend build env
cd ../cpi-work-allocation-frontend
cp .env.production.example .env.production
nano .env.production              # set VITE_API_URL to https://yourdomain (origin only, no /api)
```

### 3.3 Start Postgres

```bash
cd /opt/cpi/cpi-work-allocation-app/cpi-work-allocation-api
docker compose -f docker-compose.prod.yml --env-file .env-postgres up -d
docker ps                          # cpi-postgres should be "healthy" on 127.0.0.1:5433
```

Smoke-test the connection:

```bash
psql "$(grep ^DATABASE_URL .env | cut -d= -f2- | tr -d '\"')" -c "select version();"
```

### 3.4 Initial build + migrate + seed

```bash
# From the repo root
cd /opt/cpi/cpi-work-allocation-app

# Shared package (file: dependency — has to be built explicitly)
cd cpi-work-allocation-shared && npm ci && npm run build

# API
cd ../cpi-work-allocation-api && npm ci && npm run build

# 1) Apply the schema
npx prisma migrate deploy

# 2) Seed config tables (teams, clients, categories, work types, inference rules).
#    Idempotent — safe to re-run. Does NOT touch users or transactional data.
npx tsx scripts/seed-config.ts

# 3) Create the master admin (jbmatibag@cpi.com.ph / admin123!).
#    Wipes transactional + user data first; config tables are preserved.
npx tsx scripts/reset-db.ts

# Frontend
cd ../cpi-work-allocation-frontend && npm ci && npm run build
```

> Do **not** use `npm run db:seed` here. That command runs `prisma/seed.ts`
> which seeds 11 demo employees alongside the config — fine for local dev,
> wrong for production. The two scripts above give you config + one admin.

### 3.5 PM2

```bash
# Create the log directory before starting PM2 for the first time.
sudo mkdir -p /var/log/cpi && sudo chown ubuntu:ubuntu /var/log/cpi

cd /opt/cpi/cpi-work-allocation-app
pm2 start deploy/ecosystem.config.js --env production
pm2 logs cpi-api --lines 30        # expect "API listening on http://localhost:4000"
pm2 save
pm2 startup systemd                # copy + run the sudo command it prints
```

> The ecosystem config runs **1 worker** with a 200 MB memory ceiling — correct
> for a t3a.small where Postgres shares the same 2 GB RAM.  Upgrade to 2 workers
> only after moving to a t3a.medium or larger.

### 3.6 Nginx + TLS

```bash
# Edit the server_name in deploy/nginx.conf to your real domain first
sudo cp /opt/cpi/cpi-work-allocation-app/deploy/nginx.conf /etc/nginx/sites-available/cpi
sudo ln -sf /etc/nginx/sites-available/cpi /etc/nginx/sites-enabled/cpi
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Point your DNS A record at the Elastic IP, wait for propagation, then:
sudo certbot --nginx -d work-allocation.cpi.com.ph --redirect --agree-tos -m jbmatibag@cpi.com.ph -n
```

### 3.7 Nightly backup cron

```bash
sudo mkdir -p /opt/backups && sudo chown ubuntu:ubuntu /opt/backups
cp /opt/cpi/cpi-work-allocation-app/deploy/backup-db.sh /opt/cpi/backup-db.sh
chmod +x /opt/cpi/backup-db.sh

# Run once now to verify
/opt/cpi/backup-db.sh
ls -lh /opt/backups

# Schedule (02:00 nightly)
crontab -e
# Add this line:
#   0 2 * * * /opt/cpi/backup-db.sh >> /var/log/cpi-backup.log 2>&1
```

To push backups off-box, set up an S3 bucket and an EC2 IAM role with
`s3:PutObject` permission, then add `BACKUP_S3_BUCKET=cpi-app-backups` to the
cron line.

### 3.8 Smoke test

Open `https://app.yourdomain.com` and walk through:

1. Log in: `jbmatibag@cpi.com.ph` / `admin123!`
2. Enter the OTP from the Outlook inbox
3. Confirm empty dashboards, populated config dropdowns
4. Create + submit + approve one allocation end-to-end

If all four pass, the deploy is complete.

---

## 4. The iteration loop (your day-to-day)

```
local: fix bug → commit → git push origin main
server: ssh in → ./deploy/deploy.sh
verify in browser → repeat
```

### On the server

```bash
cd /opt/cpi/cpi-work-allocation-app
./deploy/deploy.sh
```

What `deploy.sh` does:

1. Refuses to run if the working tree is dirty (prevents stomping on hot fixes).
2. `git pull --ff-only` from origin.
3. Rebuilds `cpi-work-allocation-shared` (it's a `file:` dependency — npm
   won't rebuild it on its own).
4. `npm ci && npm run build` for the API.
5. `npx prisma migrate deploy` for new migrations.
6. `pm2 restart cpi-api --update-env` (picks up any `.env` changes too).
7. `npm ci && npm run build` for the frontend.
8. `sudo systemctl reload nginx` so new hashed assets are served.

Flags for partial redeploys:

| Flag | When to use |
|---|---|
| `--no-pull` | Testing local edits on the server before pushing |
| `--skip-frontend` | API-only change — saves ~30s of Vite build |
| `--skip-migrate` | No schema changes in this deploy |

---

## 5. Operations cheat sheet

```bash
# Live logs
pm2 logs cpi-api --lines 100
docker logs cpi-postgres --tail 100
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log

# Process health
pm2 status
docker ps
sudo systemctl status nginx

# Disk pressure
df -h /
du -sh /var/lib/docker /opt/backups /opt/cpi

# Manual DB shell
psql "$(grep ^DATABASE_URL /opt/cpi/cpi-work-allocation-app/cpi-work-allocation-api/.env | cut -d= -f2- | tr -d '\"')"

# Postgres minor version upgrade (16.x → 16.y)
cd /opt/cpi/cpi-work-allocation-app/cpi-work-allocation-api
docker compose -f docker-compose.prod.yml --env-file .env-postgres pull
docker compose -f docker-compose.prod.yml --env-file .env-postgres up -d
```

---

## 6. Restore from backup

```bash
# Pick the dump to restore
ls -lh /opt/backups
DUMP=/opt/backups/cpi-20260601-020000.sql.gz

# Restore. The dump has --clean --if-exists baked in so this overwrites
# whatever is currently in the cpi_work_allocation database.
gunzip -c "$DUMP" \
  | docker exec -i cpi-postgres psql -U cpi -d cpi_work_allocation

# Restart the API so connection pools pick up the new state
pm2 restart cpi-api
```

**Test this once, now, before you have real data.** Restoring under pressure
for the first time during an incident is the most common reason backups
don't actually save anyone.

---

## 7. Known follow-ups (post-launch)

1. Rotate the `admin123!` password on first login.
2. Set up CloudWatch alarm: EC2 status check + disk-used > 80%.
3. Enable S3 backup uploads (set `BACKUP_S3_BUCKET` in the cron line).
4. Take a weekly EBS snapshot as a whole-volume second layer of backup.
5. Move SMTP password from `.env` to AWS Secrets Manager once the deploy is stable.
6. Set an AWS Budget alert at ~$50/mo so a runaway doesn't surprise you.
