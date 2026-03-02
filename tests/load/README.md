# Load Testing with K6

This directory contains load testing scenarios for the AutoJieDan system using [K6](https://k6.io/).

## Prerequisites

1. Install K6:
   ```bash
   # macOS
   brew install k6

   # Linux
   sudo apt-get install k6

   # Or download from https://k6.io/
   ```

2. Ensure the service is running:
   ```bash
   docker compose up -d automaton
   ```

## Test Scenarios

### 1. Constant Load Test
- **Purpose**: Simulates steady traffic over time
- **Configuration**: 10 VUs for 5 minutes
- **Use Case**: Baseline performance measurement

### 2. Spike Test
- **Purpose**: Tests system behavior under sudden traffic spikes
- **Configuration**: 0 → 50 → 50 → 0 VUs (4 minutes total)
- **Use Case**: Prepare for traffic surges (e.g., marketing campaigns)

## Thresholds

| Metric | Threshold | Description |
|--------|-----------|-------------|
| p(95) Response Time | < 500ms | 95% of requests complete within 500ms |
| p(99) Response Time | < 1000ms | 99% of requests complete within 1s |
| Error Rate | < 1% | Less than 1% of requests fail |

## Usage

### Run All Scenarios
```bash
k6 run k6-scenario.js
```

### Run Specific Scenario
```bash
k6 run --stage constant_load k6-scenario.js
k6 run --stage spike_test k6-scenario.js
```

### Custom Base URL
```bash
BASE_URL=http://localhost:10790 k6 run k6-scenario.js
```

### With Output File
```bash
k6 run --out json=results.json k6-scenario.js
```

## Test Endpoints

- **Project Score API**: `POST /api/v1/projects/score`
  - Submits a project for scoring
  - Validates response includes score and analysis

- **Health Check**: `GET /health`
  - Lightweight endpoint check
  - Verifies service availability

## Interpreting Results

### Green Status (Passed)
All thresholds met. System performs within acceptable limits.

### Red Status (Failed)
One or more thresholds exceeded:
- Check response time percentiles
- Verify error rate
- Review system metrics (CPU, memory)

### Common Issues

| Issue | Possible Cause | Solution |
|-------|----------------|----------|
| High response times | Insufficient resources | Scale up containers |
| Connection errors | Service not running | Check `docker compose ps` |
| 5xx errors | Application errors | Check application logs |

## CI/CD Integration

### GitHub Actions Example
```yaml
- name: Run load tests
  run: |
    docker compose up -d automaton
    sleep 30
    k6 run tests/load/k6-scenario.js
```

### GitLab CI Example
```yaml
load_test:
  stage: test
  script:
    - docker compose up -d automaton
    - sleep 30
    - k6 run tests/load/k6-scenario.js
```

## Tips

1. **Warm-up**: Run a quick test first to ensure everything is working
2. **Monitoring**: Use `docker compose logs -f automaton` to monitor during tests
3. **Iterate**: Adjust VUs and duration based on expected production load
4. **Baseline**: Establish baseline metrics before making changes

## References

- [K6 Documentation](https://k6.io/docs/)
- [K6 Thresholds](https://k6.io/docs/using-k6/thresholds/)
- [K6 Scenarios](https://k6.io/docs/using-k6/scenarios/)
