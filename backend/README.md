# Daubert Backend

NestJS + TypeORM + Postgres API server. Runs on port 8081 in development.

## External API

### GET /external/trace

Keyed, rate-limited wallet trace. Called server-to-server by the marketing site only — there is no browser CORS allowance, even with a valid key.

Headers:
- `X-Daubert-Website-Key: <key>` — required. Compared in constant time against `DAUBERT_WEBSITE_API_KEY`.

Query:
- `address` (required) — EVM address (`0x` + 40 hex), Tron address (base58, 34 chars starting with T), Bitcoin address (base58 starting with `1…`/`3…`, or bech32 starting with `bc1…`), or Solana address (base58, 32-44 chars)
- `chain` (required) — one of `ethereum | polygon | arbitrum | base | tron | bitcoin | solana`
- `hops` (optional, default 1) — 1 or 2

Limits:
- 10 requests / minute per visitor IP (counted from `X-Forwarded-For`)
- 5 incoming + 5 outgoing per address (root and hop-2 alike), fanout 5, node cap 100, edge cap 200

Example:
```
curl "http://localhost:8081/external/trace?address=0x4f3b...c91d&chain=ethereum&hops=2" \
  -H "X-Daubert-Website-Key: $DAUBERT_WEBSITE_API_KEY"
```

Response:
```json
{
  "root": "0x4f3b...",
  "chain": "ethereum",
  "hops": 2,
  "nodes": [
    { "id": "0x4f3b...", "address": "0x4f3b...", "chain": "ethereum", "isRoot": true, "txCount": 18, "label": null }
  ],
  "edges": [
    { "id": "0x4f3b...->0x8a2e...->ETH", "from": "0x4f3b...", "to": "0x8a2e...", "token": {...}, "amount": "120.0", "txCount": 3, "lastTimestamp": "...", "lastTxHash": "..." }
  ],
  "truncated": false,
  "cachedAt": "2026-05-17T..."
}
```

## Environment Variables

See `.env.example` for all required and optional variables. Copy it to `.env` and fill in the values before starting the server.

## Development

```bash
# From monorepo root
npm run db   # start Postgres on port 5433
npm run be   # start NestJS dev server on port 8081
```

## Database Migrations

All migrations go through `./migrations.sh`. Never call TypeORM migration commands directly.

```bash
# Generate a new migration
./migrations.sh [--dev|--prod] --generate <MigrationName>

# Apply migrations (prod only — dev uses synchronize: true)
./migrations.sh --prod --run
```
