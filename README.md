# SLSEA Solar Generation API (NB6007CEM Coursework)

A REST API for monitoring rooftop solar generation across Sri Lanka, built for the Sri Lanka Sustainable Energy Authority (SLSEA). It records telemetry from 220+ solar installations and serves jurisdiction-filtered analytics to national, province, and district analysts under a **strict write–read split**: installation meters may only append readings to their own installation, while analysts may only read data inside their own jurisdiction.

## Live URLs

- **Live API URL:** https://slsea-solar-api-qy9n.onrender.com
- **Live Swagger UI:** https://slsea-solar-api-qy9n.onrender.com/api-docs
- **OpenAPI Spec:** https://slsea-solar-api-qy9n.onrender.com/openapi.json

## Tech Stack

| Layer      | Technology                              |
| ---------- | --------------------------------------- |
| Runtime    | Node.js                                 |
| Framework  | Express                                 |
| Database   | SQLite (`better-sqlite3`)               |
| Auth       | JSON Web Tokens (JWT)                   |
| Docs       | OpenAPI 3.0 + `swagger-ui-express`      |

## Local Setup

Prerequisites: Node.js 20+ and npm.

```bash
npm install          # install dependencies
npm run db:rebuild   # create schema, seed demo data, run 30 verification checks
npm start            # start the server on PORT (default 3000)
```

Once running:

- Swagger UI: <http://localhost:3000/api-docs>
- OpenAPI spec: <http://localhost:3000/openapi.json>
- Health check: <http://localhost:3000/health>

Other useful scripts:

```bash
npm run dev     # start with hot reload (nodemon)
npm run db:seed # seed only (idempotent — skips if data exists)
npm run db:verify
```

## Authentication

Every request must carry `Authorization: Bearer <token>`. Two scopes exist and never cross:

- `installation-write` — a meter appends readings to **its own** installation only. The token's `installation_id` claim must equal the installation ID in the URI.
- `analyst-read` — an SLSEA analyst reads data, automatically filtered to the jurisdiction in the token. Reading outside it returns `403`.

### Device Write Token — payload

```json
{
  "scope": "installation-write",
  "installation_id": 1,
  "meter_id": "SL-M-1001",
  "iat": 1791474209,
  "exp": 1791481409,
  "aud": "slsea-solar-api-clients",
  "iss": "slsea-solar-api",
  "sub": "SL-M-1001"
}
```

### Analyst Read Token — payload

```json
{
  "name": "Chamara Alwis",
  "role": "analyst",
  "scope": "analyst-read",
  "jurisdiction_type": "district",
  "jurisdiction_id": 1,
  "iat": 1791474209,
  "exp": 1791481409,
  "aud": "slsea-solar-api-clients",
  "iss": "slsea-solar-api",
  "sub": "12"
}
```

### Minting a token

This build ships without an identity provider — these endpoints issue tokens for the seeded demo identities:

```bash
# Device (installation meter) token
curl -X POST https://[your-url]/auth/device-token \
  -H "Content-Type: application/json" \
  -d '{"installation_id": 1}'

# Analyst token (jurisdiction comes from the user record)
curl -X POST https://[your-url]/auth/token \
  -H "Content-Type: application/json" \
  -d '{"email": "chamara.alwis@slsea.gov.lk"}'
```

Seeded demo users include `nimal.perera@slsea.gov.lk` (national), `kanchana.silva@slsea.gov.lk` (province), and `chamara.alwis@slsea.gov.lk` (district). The server also prints ready-to-use preset tokens for all four identities at start-up.

## Key Endpoints

- `POST /solar-installations/{installation-id}/readings` — append a reading (**device write**; mismatched `installation_id` → `403`, duplicate timestamp → `409`)
- `GET /solar-installations/{installation-id}/readings` — paginated telemetry with `start_time`/`end_time` filtering, `sort`/`order` whitelisting, and a default page size of 50
- `GET /districts/{district-id}/generation-summary` — processing resource: current total power (kW), today's energy (kWh), and installation count for a district
- `GET /solar-installations/{installation-id}/composite` — installation bundled with its most recent reading
- `GET /provinces` — jurisdiction-scoped list; a district token sees only its own district's parent province

Full request/response schemas for all 18 endpoints are at `/api-docs`.

## Environment Variables

| Variable      | Default                          | Purpose                        |
| ------------- | -------------------------------- | ------------------------------ |
| `PORT`        | `3000`                           | HTTP port (set by Render/Railway) |
| `JWT_SECRET`  | dev fallback — **set in production** | Signing key for JWTs       |
| `DB_FILE`     | `data/slsea.db`                  | SQLite file path               |
| `NODE_ENV`    | `development`                    | `production` enables prod mode |
| `JWT_EXPIRES_IN` | `2h`                          | Token lifetime                 |

## Error Format

All errors return the same envelope:

```json
{
  "code": "RESOURCE_NOT_FOUND",
  "message": "Solar installation not found",
  "detail": { "installation_id": 99999 }
}
```

Common codes: `VALIDATION_ERROR` (400), `AUTHENTICATION_REQUIRED` (401), `INSUFFICIENT_SCOPE` / `FORBIDDEN` (403), `RESOURCE_NOT_FOUND` (404), `DUPLICATE_READING` (409).

## Data Integrity

`generation_readings` is **append-only**: SQL triggers reject every `UPDATE` and `DELETE`, and a unique index rejects duplicate timestamps per installation. `npm run db:verify` runs 30 checks covering schema, referential integrity, seed realism, and the append-only guarantees.
