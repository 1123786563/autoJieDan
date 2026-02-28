# Production Deployment Guide

## Overview

This guide covers deploying Automaton + Nanobot to production using Docker Compose.

## Prerequisites

### Required
- Docker 24.0+
- Docker Compose plugin
- 4GB+ RAM minimum (8GB+ recommended with monitoring/logging)
- 20GB+ disk space

### Optional
- GitHub account (for CI/CD)
- SSH access to production server
- Domain name (for production access)

## Quick Start

### 1. Environment Configuration

```bash
# Copy environment template
cp .env.example .env.production

# Edit with your values
vim .env.production
```

**Required variables:**
- `INTERAGENT_SECRET` - Shared secret for inter-service authentication
- `OPENAI_API_KEY` - OpenAI API key (or other LLM provider)

### 2. Start Core Services

```bash
# Start Automaton + Nanobot
./deploy.sh start

# Check status
./deploy.sh status

# Health check
./scripts/health-check.sh
```

### 3. Start Monitoring (Optional)

```bash
# Start Prometheus + Grafana
./deploy.sh start-monitoring

# Access dashboards
# Prometheus: http://localhost:9090
# Grafana: http://localhost:3000 (admin/admin)
```

### 4. Start Logging (Optional)

```bash
# Start ELK stack
./deploy.sh start-logging

# Access Kibana
# Kibana: http://localhost:5601
```

## Service Ports

| Service | Port | Purpose |
|---------|------|---------|
| Automaton HTTP | 10790 | REST API |
| Automaton WS | 10791 | WebSocket |
| Nanobot HTTP | 10792 | REST API |
| Prometheus | 9090 | Metrics |
| Grafana | 3000 | Dashboards |
| Elasticsearch | 9200 | Log storage |
| Kibana | 5601 | Log visualization |

## Deployment Commands

```bash
# Start services
./deploy.sh start                  # Core services
./deploy.sh start-monitoring       # Monitoring stack
./deploy.sh start-logging          # Logging stack

# Stop services
./deploy.sh stop                   # All services
./deploy.sh stop-monitoring        # Monitoring stack
./deploy.sh stop-logging           # Logging stack

# Status and logs
./deploy.sh status                 # Service status
./deploy.sh logs                   # All logs
./deploy.sh logs automaton         # Specific service
./deploy.sh health                 # Health checks

# Build images
./deploy.sh build                  # Build all images
```

## CI/CD Deployment

### GitHub Actions

The project includes a GitHub Actions workflow for automated deployment:

1. **Trigger**: Push tags (e.g., `v1.0.0`)
2. **Build**: Run tests and build Docker images
3. **Push**: Upload images to GitHub Container Registry
4. **Deploy**: Deploy to production via SSH
5. **Verify**: Run health checks

### Setup CI/CD

1. **Configure GitHub Secrets:**
   ```
   SSH_PRIVATE_KEY          # SSH key for production server
   PRODUCTION_HOST          # Production server hostname
   PRODUCTION_USER          # SSH user on production server
   ```

2. **Tag and push:**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. **Monitor deployment:**
   - Check GitHub Actions tab
   - Verify health checks pass
   - Check logs: `./deploy.sh logs`

## Health Checks

### Automated Health Checks

```bash
# Run all health checks
./scripts/health-check.sh

# Check specific service logs
./scripts/health-check.sh --logs automaton 50
```

### Manual Health Checks

```bash
# Automaton
curl http://localhost:10790/health

# Nanobot
curl http://localhost:10792/health

# Docker status
docker ps
docker compose ps
```

## Troubleshooting

### Services won't start

1. Check logs:
   ```bash
   ./deploy.sh logs automaton
   ./deploy.sh logs nanobot
   ```

2. Verify environment variables:
   ```bash
   docker compose config
   ```

3. Check resource usage:
   ```bash
   docker stats
   ```

### Health checks failing

1. Verify services are running:
   ```bash
   docker ps
   ```

2. Check container logs:
   ```bash
   docker logs automaton
   docker logs nanobot
   ```

3. Restart services:
   ```bash
   ./deploy.sh restart
   ```

### Database issues

Automaton uses SQLite with persistent volumes:

```bash
# Check volumes
docker volume ls

# Backup database
docker exec automaton cp /root/.automaton/data/automaton.db ./backup.db

# Reset database (⚠️ DANGER)
docker compose down -v
./deploy.sh start
```

## Monitoring

### Prometheus Metrics

Access metrics at:
- Automaton: http://localhost:10790/metrics
- Nanobot: http://localhost:10792/metrics
- Prometheus: http://localhost:9090

### Grafana Dashboards

1. Login to Grafana (admin/admin)
2. Navigate to Dashboards
3. View pre-configured dashboards:
   - Automaton Performance
   - Nanobot Metrics
   - Interagent Communication

### Alerting

Prometheus alerts are configured in `deploy/prometheus/alerts.yml`:

- **AutomatonServiceDown**: Triggered after 2 minutes of downtime
- **NanobotServiceDown**: Triggered after 2 minutes of downtime
- **HighResponseTime**: Warning when response time > 5s
- **HighErrorRate**: Warning when error rate > 5%

## Security

### Secrets Management

1. **Never commit** `.env.production` to version control
2. Use strong random secrets:
   ```bash
   openssl rand -hex 32
   ```
3. Rotate secrets regularly
4. Use different secrets for different environments

### Network Security

1. Services run in isolated Docker network
2. Only necessary ports exposed
3. Use reverse proxy (nginx) for production
4. Enable TLS/SSL for external access

### Updates

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
./deploy.sh build
./deploy.sh restart
```

## Backup and Recovery

### Backup

```bash
# Backup databases
docker exec automaton sqlite3 /root/.automaton/data/automaton.db ".backup /tmp/backup.db"
docker cp automaton:/tmp/backup.db ./automaton-backup-$(date +%Y%m%d).db

# Backup volumes
docker run --rm -v automaton-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/automaton-data-$(date +%Y%m%d).tar.gz /data
```

### Recovery

```bash
# Stop services
./deploy.sh stop

# Restore database
docker cp ./automaton-backup.db automaton:/tmp/restore.db
docker exec automaton sqlite3 /root/.automaton/data/automaton.db ".restore /tmp/restore.db"

# Start services
./deploy.sh start
```

## Scaling

### Horizontal Scaling

For multiple instances:

```yaml
# In docker-compose.yml
automaton:
  deploy:
    replicas: 3
```

### Load Balancing

Use nginx or traefik as reverse proxy:

```nginx
upstream automaton {
    server automaton1:10790;
    server automaton2:10790;
    server automaton3:10790;
}
```

## Support

For issues or questions:
1. Check logs: `./deploy.sh logs`
2. Run health checks: `./scripts/health-check.sh`
3. Review documentation in `docs/`
4. Check GitHub Issues
