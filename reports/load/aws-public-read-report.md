# FitLook AWS Public-Read Load Test Report

Generated: 2026-08-05T12:37:04.019Z
Base URL: https://fitlook.in
Stage duration: 20s
Targets: 10, 50, 100 VUs
Traffic profile: public GET routes only

## Stage Results

| Simultaneous users | Requests | Avg latency | p90 latency | p95 latency | p99 latency | Failure rate | Check pass rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 161 | 33.88 ms | 43.51 ms | 54.13 ms | 66.46 ms | 0 | 1 |
| 50 | 363 | 29.07 ms | 41.58 ms | 44.81 ms | 54.29 ms | 0.07 | 0.97 |
| 100 | 605 | 30.61 ms | 40.76 ms | 44.45 ms | 64.77 ms | 0.1 | 0.95 |

## Overall

- Requests: 1130
- Request rate: 15.86 req/s
- HTTP failure rate: 0.08
- Check pass rate: 0.96
- p95 latency: 45.52 ms
- p99 latency: 64.39 ms

## Slowest Endpoints

| Endpoint | Requests | Avg latency | p90 latency | p95 latency | p99 latency | Failure rate | Check pass rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GET /api/products?q= | 230 | 36.63 ms | 43.26 ms | 53.96 ms | 64.39 ms | 0.09 | 0.95 |
| GET /api/products | 255 | 39.34 ms | 43.57 ms | 48.13 ms | 63.42 ms | 0.06 | 0.97 |
| GET /api/products?category= | 141 | 35.61 ms | 44.46 ms | 47.86 ms | 67.58 ms | 0.12 | 0.94 |
| GET /api/recommendations/similar/:productId | 97 | 21.15 ms | 24.5 ms | 31.73 ms | 45.71 ms | 0.04 | 0.98 |
| GET /api/products?featured= | 162 | 20.64 ms | 25.28 ms | 30.24 ms | 37.11 ms | 0.08 | 0.96 |
| GET /api/products/:id | 98 | 22.13 ms | 23.99 ms | 24.92 ms | 37.31 ms | 0.06 | 0.97 |
| GET /api/health | 147 | 24.52 ms | 21.48 ms | 22.38 ms | 35.8 ms | 0.08 | 0.96 |

## Notes

- This is a safe production-facing read test. It does not sign up users, create products, call admin routes, or write recommendation events.
- Results include public internet, TLS, nginx, backend, Redis, and MongoDB/Atlas latency.
- Use the broader `backend-load.k6.js` script only against staging or when write/auth/admin traffic is explicitly intended.

## Artifacts

- Raw k6 summary: `reports/load/aws-public-read-summary.json`
- This report: `reports/load/aws-public-read-report.md`
