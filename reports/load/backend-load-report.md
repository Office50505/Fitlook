# FitLook Backend Load Test Report

Generated: 2026-07-04T09:44:28.283Z
Base URL: http://localhost:5054
Stage duration: 15s
External/paid generation enabled: false
Global product delete enabled: false

## Stage Results

| Simultaneous users | Requests | Avg latency | p90 latency | p95 latency | p99 latency | Failure rate | Check pass rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 150 | 25.47 ms | 84.6 ms | 108.61 ms | 188.19 ms | 0 | 1 |
| 100 | 1500 | 16.68 ms | 47.81 ms | 95.51 ms | 127.43 ms | 0 | 1 |
| 1000 | 2790 | 9378.3 ms | 30000.51 ms | 30001.1 ms | 30003.65 ms | 0.2 | 0.9 |
| 10000 | 27942 | 9947.89 ms | 30000.5 ms | 30000.83 ms | 30003.35 ms | 0.37 | 0.82 |

## Overall

- Requests: 32408
- Request rate: 215.16 req/s
- HTTP failure rate: 0.33
- Check pass rate: 0.83
- p95 latency: 30000.81 ms

## Endpoint Coverage Notes

- Smoke coverage runs before the staged load and exercises public, authenticated, recommendation, try-on, and admin product routes.
- By default, paid/external AI generation endpoints are validation-tested to avoid spending FAL credits or hammering remote services.
- `DELETE /api/products` is disabled by default because it soft-deletes the active catalog. Enable it only with `INCLUDE_DELETE_ALL_PRODUCTS=true` in an isolated database.

## Artifacts

- Raw k6 summary: `reports/load/backend-load-summary.json`
- This report: `reports/load/backend-load-report.md`
