# Task Management API

[![CI](https://github.com/mrouabeh/taskmanagementapi/actions/workflows/ci.yml/badge.svg)](https://github.com/mrouabeh/taskmanagementapi/actions/workflows/ci.yml)

REST API for team task management. Orgs → teams → projects → tasks → comments, scoped per
org with role-based access. JWTs in httpOnly cookies, refresh token rotation. Backend only.

Node 20+ / TypeScript (ESM via `tsx`), Express 5, Postgres + Drizzle, Redis, BullMQ +
Nodemailer, Zod, Vitest + Supertest.

## Running it

```bash
npm install
npm run db:up        # Postgres 5432, Redis 6379
npm run db:migrate
npm run dev
npm run worker       # separate process, only for reset emails
```

`.env`:

```
DATABASE_URL=postgresql://postgres:123@localhost:5432/postgres
REDIS_URL=redis://localhost:6379
JWT_SECRET=
REFRESH_SECRET=
PORT=3000
APP_URL=http://localhost:3000
SMTP_URL=            # unset -> emails are logged, not sent
MAIL_FROM=no-reply@localhost
```

Other scripts: `typecheck` (`tsc --noEmit`, the only build step), `test`, `db:generate`,
`db:down`, `format`.

## API

Cookie-based auth, no `Authorization` header. Errors are uniform:
`{ success, code, message, details? }`. Global rate limit of 60 req/60s per IP via a
sliding window counter, 429 + `Retry-After` over the limit.

```
POST   /auth/register | login | refresh | logout | forgot-password | reset-password
GET    /auth/me

/orgs
/orgs/:orgId/members
/orgs/:orgId/teams
/orgs/:orgId/teams/:teamId/projects
/orgs/:orgId/teams/:teamId/projects/:projectId/tasks
/orgs/:orgId/teams/:teamId/projects/:projectId/tasks/:taskId/comments
```

All six support `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`. Orgs, teams, projects and
tasks also have `GET /:id`; members and comments don't. Nesting is resolved by middleware,
so a handler reaching `req.project` can trust it.

| Resource | Read | Write | Delete |
|---|---|---|---|
| Organizations | member | admin | owner |
| Members | member | admin | admin, or yourself |
| Teams | member | admin | admin |
| Projects | member | member | admin |
| Tasks | member | member | admin |
| Comments | member | member | author, or admin |

Non-members get 404, not 403. Under-privileged members get 403.

### Pagination

Teams, tasks and comments take `?page=` (default 1, max 10,000) and `?limit=` (default 20,
max 100); anything else is a 400. Orgs, members and projects are unpaginated.

```json
{ "success": true, "teams": [], "pagination": { "page": 1, "limit": 20, "hasMore": true } }
```

## Design notes

- **Rate limiting is a sliding window counter**: two Redis keys per IP (current and previous
  60s block), rate estimated as `previous * (1 - elapsed) + current`. No boundary burst, no
  timestamp log. `INCR` and `EXPIRE NX` share a `MULTI`, so no key survives without a TTL.
- **Pagination** is offset-based. Lists over-fetch one row past `limit` for `hasMore`, no
  `COUNT(*)`. Ordered by `(created_at, id)` so pages don't shuffle.
- **Redis fails open.** Denylist and limiter log and continue; an outage shouldn't take auth
  offline.
- **Roles live on memberships**, unique on `(user_id, organization_id)`. Owner in one org,
  guest in another.
- **Refresh reuse is theft.** One valid JTI per session family; a spent one deletes the
  family. `KEEPTTL` on rotation caps session lifetime.
- **Two invariants the DB can't express**: only owners grant admin/owner, and an org never
  hits zero owners. Both row-lock against count-then-delete races.
- **Deleting a user keeps their work.** Memberships cascade; `assignee_id`, `created_by_id`
  and `comments.user_id` are `SET NULL`.
- **Timestamps are `timestamptz`.** Plain `timestamp` mixed local `DEFAULT now()` with UTC
  from the ORM, landing `updated_at` before `created_at`.
- **Reset tokens** are SHA-256 hashes, expire in 30 min, consumed by the
  `DELETE ... RETURNING` that validates them. `forgot-password` replies the same either way.

## Tests

91 integration tests, 10 files, against real Postgres and Redis. No mocks, no separate test
database. CI runs migrations on an empty DB first so a broken chain fails there.

```bash
npm run db:up
npx vitest run
```
