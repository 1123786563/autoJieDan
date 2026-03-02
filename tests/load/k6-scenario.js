/**
 * K6 Load Testing Scenario for AutoJieDan
 *
 * This script tests the project scoring API and health check endpoint
 * under various load conditions.
 *
 * Scenarios:
 * 1. constant_load - Steady load test (10 VUs, 5 minutes)
 * 2. spike_test - Spike test (0→50→50→0 VUs)
 *
 * Thresholds:
 * - p(95) response time < 500ms
 * - p(99) response time < 1000ms
 * - Error rate < 1%
 *
 * Usage:
 *   k6 run k6-scenario.js
 *   k6 run --stage k6-scenario.js  # Run specific stage only
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

// Configuration from environment variables
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const PROJECT_SCORE_ENDPOINT = `${BASE_URL}/api/v1/projects/score`;
const HEALTH_ENDPOINT = `${BASE_URL}/health`;

export const options = {
  // Scenarios configuration
  scenarios: {
    // Scenario 1: Constant load test
    // Simulates steady traffic over 5 minutes
    constant_load: {
      executor: 'constant-vus',
      vus: 10,
      duration: '5m',
      gracefulStop: '30s',
    },

    // Scenario 2: Spike test
    // Simulates sudden traffic spike
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },   // Ramp up to 50 VUs
        { duration: '2m', target: 50 },   // Stay at 50 VUs
        { duration: '1m', target: 0 },    // Ramp down to 0
      ],
      gracefulStop: '30s',
    },
  },

  // Thresholds for pass/fail criteria
  thresholds: {
    // 95% of requests must complete below 500ms
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],

    // Error rate must be below 1%
    'http_req_failed': ['rate<0.01'],

    // HTTP request成功率
    'checks': ['rate>0.99'],
  },

  // Summary configuration
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
};

/**
 * Generate a random project for scoring
 */
function generateProject() {
  const titles = [
    'React Component Development',
    'Python API Service',
    'Vue.js Dashboard',
    'Node.js Microservice',
    'TypeScript Library',
  ];

  const descriptions = [
    'Build a responsive UI component with modern best practices',
    'Create a RESTful API with authentication and database integration',
    'Develop a data visualization dashboard with real-time updates',
    'Implement a scalable microservice with message queue integration',
    'Build a reusable type-safe library for common utilities',
  ];

  const skills = ['React', 'Python', 'Vue.js', 'Node.js', 'TypeScript'];

  const randomTitle = titles[Math.floor(Math.random() * titles.length)];
  const randomDesc = descriptions[Math.floor(Math.random() * descriptions.length)];
  const randomSkill = skills[Math.floor(Math.random() * skills.length)];

  return {
    title: randomTitle,
    description: randomDesc,
    required_skills: [randomSkill],
    budget: {
      amount: Math.floor(Math.random() * 5000) + 500, // $500-$5500
      currency: 'USD',
    },
    deadline: new Date(Date.now() + Math.floor(Math.random() * 30) * 24 * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * Test the project scoring API
 */
function testProjectScore() {
  const project = generateProject();

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const response = http.post(PROJECT_SCORE_ENDPOINT, JSON.stringify(project), params);

  check(response, {
    'project score status is 200': (r) => r.status === 200,
    'project score response has score': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.score === 'number' && body.score >= 0 && body.score <= 100;
      } catch {
        return false;
      }
    },
    'project score response has analysis': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.analysis === 'string';
      } catch {
        return false;
      }
    },
  });

  return response;
}

/**
 * Test the health check endpoint
 */
function testHealthCheck() {
  const response = http.get(HEALTH_ENDPOINT);

  check(response, {
    'health check status is 200': (r) => r.status === 200,
    'health check response is healthy': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'healthy' || body.healthy === true;
      } catch {
        return false;
      }
    },
  });

  return response;
}

/**
 * Main test function
 * Each VU will execute this function repeatedly
 */
export default function () {
  // Test health check first (lightweight)
  testHealthCheck();

  // Small delay between requests
  sleep(Math.random() * 2 + 1); // 1-3 seconds

  // Test project scoring API (main workload)
  testProjectScore();

  // Random think time between iterations
  sleep(Math.random() * 3 + 2); // 2-5 seconds
}

/**
 * Setup function - runs once before the test
 */
export function setup() {
  console.log(`Starting load test against: ${BASE_URL}`);
  console.log(`Project Score Endpoint: ${PROJECT_SCORE_ENDPOINT}`);
  console.log(`Health Endpoint: ${HEALTH_ENDPOINT}`);

  // Verify endpoints are accessible
  const healthResponse = http.get(HEALTH_ENDPOINT);
  if (healthResponse.status !== 200) {
    console.warn(`Warning: Health endpoint returned status ${healthResponse.status}`);
  }

  return {
    startTime: new Date().toISOString(),
    baseUrl: BASE_URL,
  };
}

/**
 * Teardown function - runs once after the test
 */
export function teardown(data) {
  console.log(`Load test completed at: ${new Date().toISOString()}`);
  console.log(`Test started at: ${data.startTime}`);
}
