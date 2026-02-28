# Production Deployment Checklist

## Pre-Deployment Checklist

### Environment Setup
- [ ] Docker 24.0+ installed
- [ ] Docker Compose plugin installed
- [ ] 4GB+ RAM available (8GB+ recommended)
- [ ] 20GB+ disk space available
- [ ] Ports 10790-10792, 9090, 3000 available

### Configuration
- [ ] `.env.production` created from `.env.example`
- [ ] `INTERAGENT_SECRET` set to strong random value
- [ ] `OPENAI_API_KEY` configured
- [ ] Optional: `ANTHROPIC_API_KEY` configured
- [ ] Optional: Blockchain configuration set
- [ ] Optional: Messaging platform tokens configured

### Secrets Management
- [ ] `.env.production` permissions set to 600
- [ ] `.env.production` added to `.gitignore`
- [ ] No secrets committed to repository
- [ ] Secrets rotation plan documented

### Dependencies
- [ ] Automaton dependencies installed: `cd automaton && pnpm install`
- [ ] Automaton builds successfully: `cd automaton && pnpm build`
- [ ] Automaton tests pass: `cd automaton && pnpm test`
- [ ] Nanobot dependencies installed: `cd nanobot && pip install -e .`
- [ ] Nanobot tests pass: `cd nanobot && pytest`

### Infrastructure
- [ ] Docker volumes created for persistence
- [ ] Backup strategy in place
- [ ] Monitoring stack configured (optional)
- [ ] Logging stack configured (optional)
- [ ] Reverse proxy configured (for production)
- [ ] SSL/TLS certificates configured (for production)

### CI/CD (Optional)
- [ ] GitHub Actions workflow configured
- [ ] GitHub secrets configured:
  - [ ] `SSH_PRIVATE_KEY`
  - [ ] `PRODUCTION_HOST`
  - [ ] `PRODUCTION_USER`
- [ ] SSH access to production server verified
- [ ] Deployment workflow tested

## Deployment Steps

### 1. Initial Deployment
```bash
# Build images
./deploy.sh build

# Start core services
./deploy.sh start

# Verify status
./deploy.sh status
./scripts/health-check.sh
```

### 2. Verification
- [ ] Automaton health check passes: `curl http://localhost:10790/health`
- [ ] Nanobot health check passes: `curl http://localhost:10792/health`
- [ ] Docker containers running: `docker ps`
- [ ] No errors in logs: `./deploy.sh logs`
- [ ] Services can communicate

### 3. Monitoring Setup (Optional)
```bash
# Start monitoring
./deploy.sh start-monitoring

# Verify Prometheus
curl http://localhost:9090/-/healthy

# Verify Grafana
curl http://localhost:3000/api/health
```

- [ ] Prometheus accessible
- [ ] Grafana accessible
- [ ] Metrics being collected
- [ ] Alerts configured

### 4. Logging Setup (Optional)
```bash
# Start logging
./deploy.sh start-logging

# Verify Elasticsearch
curl http://localhost:9200/_cluster/health

# Verify Kibana
curl http://localhost:5601/api/status
```

- [ ] Elasticsearch healthy
- [ ] Logstash processing logs
- [ ] Kibana accessible
- [ ] Log indices created

## Post-Deployment Verification

### Functionality Tests
- [ ] Automaton can create tasks
- [ ] Automaton can send messages to Nanobot
- [ ] Nanobot can receive messages from Automaton
- [ ] Nanobot can send responses to Automaton
- [ ] Interagent communication working
- [ ] WebSocket connections stable

### Performance Tests
- [ ] Response time < 5s for API calls
- [ ] Memory usage within limits
- [ ] CPU usage within limits
- [ ] No memory leaks detected
- [ ] Database performance acceptable

### Security Checks
- [ ] All secrets properly configured
- [ ] No default passwords in use
- [ ] Only necessary ports exposed
- [ ] TLS/SSL enabled (for production)
- [ ] Rate limiting configured
- [ ] Input validation working

### Backup Verification
- [ ] Database backup tested
- [ ] Volume backup tested
- [ ] Restore procedure tested
- [ ] Backup automation configured

## Monitoring Setup

### Prometheus Alerts
- [ ] `AutomatonServiceDown` alert configured
- [ ] `NanobotServiceDown` alert configured
- [ ] `HighResponseTime` alert configured
- [ ] `HighErrorRate` alert configured
- [ ] Alert notifications configured

### Grafana Dashboards
- [ ] Automaton Performance dashboard
- [ ] Nanobot Metrics dashboard
- [ ] Interagent Communication dashboard
- [ ] System Resources dashboard

### Log Aggregation
- [ ] Elasticsearch indices created
- [ ] Logstash pipeline working
- [ ] Kibana indexes configured
- [ ] Log retention policy set

## Rollback Plan

### Rollback Triggers
- [ ] Health checks failing
- [ ] Error rate > 10%
- [ ] Response time > 10s
- [ ] Memory/CPU usage > 90%
- [ ] Data corruption detected

### Rollback Steps
```bash
# Stop current deployment
./deploy.sh stop

# Checkout previous version
git checkout <previous-tag>

# Restart services
./deploy.sh start

# Verify rollback
./scripts/health-check.sh
```

### Rollback Verification
- [ ] Previous version stable
- [ ] Health checks passing
- [ ] Data integrity verified
- [ ] No data loss

## Ongoing Operations

### Daily Checks
- [ ] Service health checks
- [ ] Log review for errors
- [ ] Resource usage monitoring
- [ ] Backup verification

### Weekly Tasks
- [ ] Security updates applied
- [ ] Log rotation check
- [ ] Performance review
- [ ] Capacity planning review

### Monthly Tasks
- [ ] Secret rotation
- [ ] Backup restoration test
- [ ] Security audit
- [ ] Performance optimization review
- [ ] Disaster recovery drill

## Contact Information

- **Deployment Lead**: [Name]
- **On-Call Engineer**: [Name]
- **Emergency Contact**: [Contact]
- **Documentation**: `/docs/DEPLOYMENT.md`

## Notes

- Date: ____________________
- Deployed By: ____________________
- Version: ____________________
- Issues Encountered: ____________________
- Follow-up Required: ____________________
