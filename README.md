# Task Management Tool

[![CI](https://github.com/mrouabeh/taskmanagementapi/actions/workflows/ci.yml/badge.svg)](https://github.com/mrouabeh/taskmanagementapi/actions/workflows/ci.yml)

A mini REST API for team task management. Organizations contain teams, teams contain projects,
projects contain tasks, tasks have comments. Everything is scoped per organization with
role-based access, and sessions use JWTs in httpOnly cookies with refresh token rotation.

Backend only. There's no frontend and there isn't going to be one.

## Stack

Node + TypeScript (ESM, run through `tsx`), Express 5, Postgres via Drizzle ORM, Redis for
rate limiting and session state, Zod for validation, Vitest and Supertest for the tests.

Express 5 matters here: it forwards rejected promises from async handlers to the error
middleware automatically, so routes just `throw` and never need a try/catch wrapper.

## Running it

You need Node 20+ and Docker.

```bash
npm install
npm run db:up        # Postgres on 5432, Redis on 6379
npm run db:migrate
npm run dev
```

Create a `.env` first:

```
DATABASE_URL=postgresql://postgres:123@localhost:5432/postgres
REDIS_URL=redis://localhost:6379
JWT_SECRET=<anything>
REFRESH_SECRET=<something else>
PORT=3000
```

If you already run Postgres or Redis natively on those ports, the containers won't bind and
the app will quietly use your local ones instead.

### Scripts

| | |
|---|---|
| `npm run dev` | watch mode |
| `npm run typecheck` | `tsc --noEmit`, the only build step |
| `npm test` | Vitest in watch mode |
| `npm run db:generate` | new migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | apply migrations |
| `npm run format` | Prettier |

There's no bundler and no `dist/`. `tsconfig.json` sets `noEmit`, so typecheck is the whole
static-checking story.

## API

Auth is cookie-based. The browser sends `token` and `refreshToken` automatically, so there's
no `Authorization` header. Errors are uniform: `{ success, code, message, details? }`.

### Auth

```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
```

Rate limited to 5 requests per 30 seconds per IP.

### Everything else

Routes nest to mirror ownership. Each layer is resolved by middleware before any handler
runs, so a handler that reaches `req.project` can trust it.

```
/orgs
/orgs/:orgId/members
/orgs/:orgId/teams
/orgs/:orgId/teams/:teamId/projects
/orgs/:orgId/teams/:teamId/projects/:projectId/tasks
/orgs/:orgId/teams/:teamId/projects/:projectId/tasks/:taskId/comments
```

All five support `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`.

Minimum roles:

| Resource | Read | Write | Delete |
|---|---|---|---|
| Organizations | member | admin | owner |
| Members | member | admin | admin, or yourself |
| Teams | member | admin | admin |
| Projects | member | member | admin |
| Tasks | member | member | admin |
| Comments | member | member | author, or admin |

Non-members get 404 rather than 403, so a private organization looks the same as one that
doesn't exist. Under-privileged members get 403.

## Design notes

**Roles live on memberships, not users.** `memberships` carries `(user_id, organization_id,
role)` with a unique constraint on the first two. The same person can be an owner in one
organization and a guest in another, and every authorization check resolves the role for the
organization in the URL.

**Refresh tokens rotate, and reuse is treated as theft.** Redis holds one valid refresh JTI
per session family. Presenting a spent one means the token leaked, so the whole family is
deleted and both the thief and the real user have to log in again. Rotation uses `KEEPTTL`
so a session can't renew itself indefinitely.

**Two invariants the database can't express.** Only an owner can grant or remove admin and
owner roles, otherwise any admin could promote themselves. And an organization can never
reach zero owners, because no route grants a role from outside, so an ownerless organization
would be permanently unadministrable. Both checks take a row lock, because count-then-delete
races otherwise.

**Deleting a user doesn't delete their work.** Memberships cascade, since a membership
without a user means nothing. But `tasks.assignee_id`, `tasks.created_by_id` and
`comments.user_id` are `SET NULL`, so the work outlives the account.

**Timestamps are `timestamptz`.** They started as plain `timestamp`, which produced wrong
data: `DEFAULT now()` writes local wall-clock, the ORM writes UTC, and on a UTC+1 server
every edited row ended up with `updated_at` an hour before `created_at`.

## Tests

87 integration tests across 9 files, run against a real Postgres and Redis. No mocks, no
separate test database.

```bash
npm run db:up
npx vitest run
```

Consequences of that setup: `fileParallelism` is off since every file shares one database,
each file cleans up the rows it created, and the rate limiter counters get cleared between
sign-ups because Supertest always connects from the same IP.

CI runs migrations against an empty database first, so a broken migration chain fails there
rather than on a deploy.

## Not built

- Pagination. Every list endpoint returns all rows.
- `activity_logs` exists in the schema but nothing writes to it.
- No `team_members` table, so every member of an organization can reach every team.
- Labels, attachments, notifications, email verification, password reset.
- No service or repository layer. Routes query the database directly.
- OpenAPI docs.

## Known limitations

Rate limiting is fixed-window per IP, so users behind shared NAT share a bucket and the
window boundary allows a burst of up to double the limit. `INCR` and `EXPIRE` are also two
round trips; if the process dies between them the key never expires.

Redis failures fail open by design. Both the token denylist and the rate limiter log and
continue when Redis is unreachable, because an outage shouldn't take authentication offline.

`users.hashedpassword` is nullable to leave room for OAuth accounts, which means the login
path has to defend against it.
