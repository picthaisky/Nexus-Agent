// k6 load test for the Nexus-Agent inference endpoint.
//
// Run:
//   k6 run -e API_BASE=http://localhost:5190 \
//          -e API_KEY=$NEXUS_API_KEY \
//          tests/load/k6_inference.js
//
// Smoke test (10 VUs · 1 minute) → expect p95 < 5s and error_rate < 1%.

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("nexus_errors");
const latency = new Trend("nexus_latency_ms");

const API_BASE = __ENV.API_BASE || "http://localhost:5190";
const API_KEY = __ENV.API_KEY || "";

export const options = {
  scenarios: {
    smoke: {
      executor: "constant-vus",
      vus: 10,
      duration: "1m",
    },
  },
  thresholds: {
    nexus_errors: ["rate<0.01"],
    nexus_latency_ms: ["p(95)<5000"],
    http_req_failed: ["rate<0.02"],
  },
};

export default function () {
  const payload = JSON.stringify({
    messages: [{ role: "user", content: "Ping. Respond with one word." }],
    temperature: 0.1,
    max_tokens: 16,
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
    },
    timeout: "60s",
  };

  const t0 = Date.now();
  const res = http.post(`${API_BASE}/inference/generate`, payload, params);
  latency.add(Date.now() - t0);

  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "has content": (r) => !!r.json("content"),
  });
  errorRate.add(!ok);
  sleep(1);
}
