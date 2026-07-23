# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run db:up          # start Postgres + Redis via docker compose (required for dev AND tests)
npm run dev            # tsx watch index.ts
npm run typecheck      # tsc --noEmit — the only "build"; nothing is ever compiled to disk
npm test               # vitest in watch mode
npm run db:generate    # drizzle-kit generate — after editing src/db/schema.ts
npm run db:migrate     # drizzle-kit migrate — apply to the running database
```

Run a single test file or test:

```bash
npx vitest run src/routes/auth.routes.test.ts
npx vitest run -t 'refreshes with a valid token'
```

There is no bundler, no `dist/`, and no lint setup. `tsx` executes TypeScript directly and
`tsconfig.json` sets `noEmit`, so `npm run typecheck` is the whole static-checking story.

## Testing model

Tests run against the **real** Postgres and Redis from `docker-compose.yml` — there are no mocks
and no separate test database. Consequences worth knowing before writing tests:

- `npm run db:up` must be running or every test fails at connection time.
- `vitest.config.ts` sets `fileParallelism: false` because all files share one database.
- `src/test/setup.ts` opens Redis (`index.ts` never runs under test), deletes `rate:*` keys before
  each test, and closes both Redis and the PG pool in `afterAll`. Leaving a handle open hangs Vitest.
- Rate limiting is per-IP and supertest always hits from the same IP, so a test file issuing more
  than 5 requests to `/auth/*` in one window gets 429s unless the counters are cleared.
- Tests insert real rows; each file is responsible for deleting what it created (see the
  `afterAll` in `auth.routes.test.ts`, which keys off a `Date.now()`-unique email).

## Architecture

Express 5 + Drizzle ORM (1.0-rc) + Postgres + Redis. ESM throughout (`"type": "module"`).

**Error flow is centralized and load-bearing.** Route handlers do not try/catch and do not call
`next(err)` — they `throw` typed errors from `src/lib/errors.ts` (`ValidationError`,
`UnauthorizedError`, `ConflictError`, …), and Express 5's automatic promise-rejection forwarding
carries them to `errorHandler`. That single middleware is what converts anything thrown into the
uniform `{ success, code, message, details? }` JSON body. Adding a new failure mode means adding an
`AppError` subclass, not writing a response in a route. Non-`AppError` escapes are treated as bugs:
logged in full, returned as a generic 500.

Middleware order in `src/app.ts` is fixed: routes → `notFoundHandler` → `errorHandler` (last, and it
must keep all four parameters or Express won't recognize it as error middleware).

**Auth is cookie-based with two tokens and a Redis-backed session family.**

- Access token: 15m, cookie `token`, carries `sub`/`jti`/`sid`. Verified by `src/middleware/auth.ts`,
  which re-validates the payload shape after signature check and populates `req.user`
  (typed in `src/types/express.d.ts`).
- Refresh token: 30d, cookie `refreshToken`, `path: '/auth/refresh'` so it's only ever sent there.
- `family:{sid}` in Redis holds the *one* currently-valid refresh JTI for a session. `/auth/refresh`
  rotates it; presenting a spent JTI means replay, so the whole family is deleted. Rotation uses
  `KEEPTTL` deliberately — a fresh `EX` would let a session renew forever.
- `denylist:{jti}` revokes an already-signed access token on logout, with a TTL equal to the token's
  remaining life.

**Redis failures fail open by design.** Both the denylist check in `auth.ts` and the counter in
`rateLimiter.ts` log and continue when Redis is unreachable — a Redis outage must not take
authentication offline. Preserve this when touching either file.

**Config is validated once at boot.** `src/config/env.ts` zod-parses `process.env` and calls
`process.exit(1)` on failure, so `env` is a fully-typed non-optional object everywhere downstream.
Never read `process.env` directly outside that file (`drizzle.config.ts` is the one exception, since
drizzle-kit runs outside the app). Adding a variable means adding it to the schema.

`index.ts` connects Redis *before* `app.listen`, and exits on `unhandledRejection` /
`uncaughtException` rather than continuing in an unknown state.

## Database

`src/db/schema.ts` is the source of truth; `src/db/relations.ts` declares relations separately via
drizzle 1.0's `defineRelations` and is passed into `drizzle()` in `src/db/index.ts`. Migrations in
`drizzle/` are generated, never hand-edited.

Two schema decisions that constrain new code: roles live on `memberships` (`UNIQUE (user_id,
organization_id)`), not on `users`, so a user can hold different roles in different organizations —
authorization checks must resolve role *per organization*. Uniqueness is scoped rather than global
(`UNIQUE (team_id, name)` on projects, `UNIQUE (organization_id, name)` on teams).

Routes currently query `db` directly; there is no service or repository layer yet. `README.md`
documents this as a known limitation to address once domain logic grows past auth.

## Current state

Only `/auth/*` is implemented (`register`, `login`, `refresh`, `logout`, `me`). Tables for
organizations, teams, projects, memberships, and activity logs are migrated but have no routes, and
the role enum exists with no permission enforcement wired up. Tasks/comments/labels are not in the
schema at all.

Note that `README.md` is an in-depth design document but has drifted in a few places — it states
there are no tests and no Docker Compose (both now exist) and describes a 60s rate-limit window
where the code uses 30s. Trust the code.
