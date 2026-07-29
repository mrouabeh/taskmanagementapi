[README.md](https://github.com/user-attachments/files/30198023/README.md)
# Task Management Tool

A mini REST API for team task management — the backend behind something like Linear, Jira, or Trello.

Multi-tenant organizations, teams, projects, and tasks with role-based authorization, JWT session auth with refresh token rotation, and Redis for rate limiting and session state.

> **Status: in progress.** Authentication is complete and hardened. The relational schema is designed and migrated. Organization CRUD with per-organization role authorization is implemented; endpoints for teams, projects, and tasks are the current work. See [Build Status](#build-status) for exactly what is and isn't implemented — nothing in this README describes code that doesn't exist.

Backend-only by design. The deliverable is the API: its schema, its authorization model, and its documentation.

---

## Table of Contents

- [Build Status](#build-status)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Authentication Design](#authentication-design)
- [Data Model](#data-model)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)
- [Project Structure](#project-structure)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)

---

## Build Status

### Implemented

| Area | Detail |
|---|---|
| Register / login / logout | bcrypt hashing, timing-safe login, uniform error messages |
| Access + refresh tokens | httpOnly cookies, 15m access / 30d refresh |
| Refresh token rotation | Token family tracking in Redis with reuse detection |
| Logout revocation | Access token JTI denylist, refresh family deletion |
| Rate limiting | Fixed-window per IP, Redis-backed, `Retry-After` header |
| Input validation | Zod schemas at the route boundary |
| Error handling | Typed `AppError` hierarchy, single error middleware |
| Env validation | Zod-parsed at boot, process exits on invalid config |
| Database schema | Users, organizations, memberships, teams, projects, activity logs — migrated |
| Organization endpoints | Full CRUD: create (creator becomes owner), list-mine, read, update, delete |
| Member endpoints | Roster, add by email, change role, remove — with an owner-only ceiling and a last-owner guard |
| Team endpoints | Full CRUD scoped to an organization; delete refuses while the team still has projects |
| Project endpoints | Full CRUD scoped to a team, with status transitions and archive tracking |
| Per-organization authorization | `requireRole` resolves the caller's role per org; non-members get 404, under-privileged members 403 |
| Docker Compose | Postgres and Redis via `npm run db:up` |
| Tests | 68 integration tests against a real Postgres and Redis |

### Not yet built

| Area | Notes |
|---|---|
| Tasks, comments, attachments, labels | Tables not yet in the schema |
| Team membership | No `team_members` table — any org member reaches every team |
| Project ownership | No `created_by` column, so any member may edit any project in their team |
| Email verification, password reset | Planned |
| Search, filtering, pagination, sorting | Planned |
| Notifications | Planned |
| Redis caching of org/task data | Redis currently serves auth and rate limiting only |
| Service / repository layers | Routes currently query the database directly |
| OpenAPI docs | Planned |

---

## Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js + TypeScript (ESM, run via `tsx`) |
| Framework | Express 5 |
| Database | PostgreSQL |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| Cache / session state | Redis |
| Validation | Zod |
| Auth | JWT access + refresh tokens in httpOnly cookies |
| Hashing | bcrypt |

Express 5 matters here: it forwards rejected promises from async handlers to the error middleware automatically, so route handlers can `throw` typed errors without a `try/catch` wrapper in every one.

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker, for `npm run db:up` — it starts Postgres on `5432` and Redis on `6379`

If you already run Postgres or Redis natively on those ports, the containers will not bind and the app will silently use your local servers instead. That works, but they are then the databases the tests read and write.

### Setup

```bash
git clone https://github.com/mrouabeh/taskmanagementapi.git
cd taskmanagementtool
npm install
```

Create a `.env` in the project root:

```env
DATABASE_URL=postgres://user:password@localhost:5432/taskmanagement
PORT=3000
NODE_ENV=development
JWT_SECRET=<a long random string>
REFRESH_SECRET=<a different long random string>
```

Apply the schema and start the server:

```bash
npm run db:migrate
npm run dev
```

The server refuses to boot if any environment variable is missing or malformed — the Zod schema in `src/config/env.ts` validates `process.env` and calls `process.exit(1)` with the field errors printed. Failing at startup beats failing on the first request that happens to need the missing value.

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with file watching |
| `npm start` | Start once |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|:---:|---|---|
| `DATABASE_URL` | yes | — | Postgres connection string |
| `JWT_SECRET` | yes | — | Access token signing secret |
| `REFRESH_SECRET` | yes | — | Refresh token signing secret — must differ from `JWT_SECRET` |
| `PORT` | no | `3000` | HTTP port |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |

Two separate secrets, not one. If they were shared, an access token would be a structurally valid refresh token and vice versa — the signature alone would no longer tell the two apart.

---

## API Reference

Every response carries a `success` boolean. Errors are uniform: `{ success, code, message, details? }`.

Base path: `/auth`

Authentication is cookie-based. The browser sends `token` and `refreshToken` automatically; there is no `Authorization` header. Both cookies are `httpOnly` and `sameSite: strict`, and `secure` in production.

### `POST /auth/register`

Rate limited.

```json
{ "name": "Mohamed", "email": "m@example.com", "password": "at-least-8-chars" }
```

`201` on success. `409 CONFLICT` if the email is taken. `400 VALIDATION_FAILED` on schema failure.

```json
{
  "success": true,
  "message": "User registered successfully!",
  "user": { "id": 1, "email": "m@example.com" }
}
```

### `POST /auth/login`

Rate limited. Sets the `token` and `refreshToken` cookies.

```json
{ "email": "m@example.com", "password": "at-least-8-chars" }
```

`200` on success, `401 UNAUTHORIZED` otherwise.

### `POST /auth/refresh`

Rate limited. Requires the `refreshToken` cookie; deliberately **not** behind the auth middleware, since the access token is expected to be expired by the time a client calls this. Issues a new access token and a new refresh token.

`401` if the cookie is missing, invalid, expired, replayed, or the session was revoked.

### `POST /auth/logout`

Requires authentication. Denylists the current access token for its remaining lifetime, deletes the refresh token family, and clears both cookies.

### `GET /auth/me`

Requires authentication. Returns the current user, or `401` if the token is valid but the user record no longer exists.

```json
{ "success": true, "user": { "id": 1, "name": "Mohamed", "email": "m@example.com" } }
```

---

Base path: `/orgs`

Every route below requires authentication. Routes carrying `:orgId` run through `loadMembership`, which resolves the caller's role in that organization and returns `404` — not `403` — when they are not a member, so a private organization is indistinguishable from one that does not exist.

### Organizations

| Method | Path | Min role | Notes |
|---|---|---|---|
| `POST` | `/orgs` | — | Creator becomes `owner`. `409` on a duplicate slug |
| `GET` | `/orgs` | — | Organizations the caller belongs to, with their role in each |
| `GET` | `/orgs/:orgId` | `member` | |
| `PATCH` | `/orgs/:orgId` | `admin` | `409` on a duplicate slug |
| `DELETE` | `/orgs/:orgId` | `owner` | Cascades to memberships, teams, projects, and activity logs |

### Members

| Method | Path | Min role | Notes |
|---|---|---|---|
| `GET` | `/orgs/:orgId/members` | `member` | Roster joined to `users` for email and name |
| `POST` | `/orgs/:orgId/members` | `admin` | Body `{ email, role? }`; `404` if no such user, `409` if already a member |
| `PATCH` | `/orgs/:orgId/members/:membershipId` | `admin` | Body `{ role }` |
| `DELETE` | `/orgs/:orgId/members/:membershipId` | any member for self | Removing anyone else needs `admin` |

Two invariants are enforced here:

**Owner-only ceiling.** Granting or touching an `admin` or `owner` membership requires `owner`. Without it any admin could mint a peer or a superior and the hierarchy would mean nothing.

**Last-owner guard.** The final `owner` cannot be removed or demoted (`409`). No route grants a role from outside an organization, so an organization that reaches zero owners is permanently unadministrable.

Deleting your own membership is how you leave an organization, which is why `DELETE` has no route-level role gate — the check distinguishes self-removal from removing somebody else. Changing your *own* role is always refused, so nobody self-promotes.

### Teams

| Method | Path | Min role | Notes |
|---|---|---|---|
| `GET` | `/orgs/:orgId/teams` | `member` | |
| `POST` | `/orgs/:orgId/teams` | `admin` | Body `{ name }`; `409` on a duplicate name **within the org** |
| `GET` | `/orgs/:orgId/teams/:teamId` | `member` | |
| `PATCH` | `/orgs/:orgId/teams/:teamId` | `admin` | Body `{ name }` — renaming is the only mutation |
| `DELETE` | `/orgs/:orgId/teams/:teamId` | `admin` | `409` while the team still has projects |

`organizationId` is never accepted from a request body. It comes from the URL segment that `loadMembership` already validated, which is what stops an admin of one organization from writing into another. Every `:teamId` and `:membershipId` lookup is filtered by organization for the same reason — a real id belonging to somebody else's organization returns `404`.

`DELETE` on a team refuses while projects exist because `projects.team_id` cascades: without the check, one request would silently destroy every project in the team. Note this is application-level policy over a database-level cascade — deleting the *organization* still takes the whole tree with it.

### Projects

| Method | Path | Min role | Notes |
|---|---|---|---|
| `GET` | `…/teams/:teamId/projects` | `member` | |
| `POST` | `…/teams/:teamId/projects` | `member` | Body `{ name, description?, status? }`; `409` on a duplicate name **within the team** |
| `GET` | `…/projects/:projectId` | `member` | |
| `PATCH` | `…/projects/:projectId` | `member` | Any subset of `{ name, description, status }`; an empty body is `400` |
| `DELETE` | `…/projects/:projectId` | `admin` | |

Projects nest one level deeper, under `/orgs/:orgId/teams/:teamId/projects`. A `loadTeam` middleware resolves `:teamId` scoped to the caller's organization before any handler runs, so a team id from another organization is a `404` regardless of which project route was addressed. Every `:projectId` lookup is then filtered by team, so a real project id belonging to a different team is also a `404`.

**Writes are `member`, deletion is `admin`.** Everything a member can do is reversible — rename, re-describe, or set `status: 'archived'` to shelve a project. Only the irreversible operation is gated, and archiving gives members a way to clear finished work without needing an admin.

**`archivedAt` is derived, never accepted.** The update schema rejects it outright; the route sets it whenever `status` changes and clears it when the status moves away from `archived`. That keeps the timestamp and the enum from ever disagreeing. Sending only a `name` leaves an archived project's timestamp untouched.

**`updatedAt` is written explicitly by the route.** The column has a `DEFAULT`, but Postgres only applies defaults on `INSERT` — it never touches a column on `UPDATE` unless the statement names it.

---

## Authentication Design

The parts worth explaining in an interview.

### Tokens live in httpOnly cookies, not localStorage

JavaScript cannot read an `httpOnly` cookie, so an XSS payload cannot exfiltrate the session. `sameSite: strict` is what covers CSRF, since the cookie is now sent automatically and would otherwise ride along on cross-site requests.

The refresh cookie is scoped with `path: '/auth/refresh'`. It is therefore not attached to ordinary API calls — the long-lived credential is only on the wire for the one endpoint that consumes it. (Note that `clearCookie` on logout must repeat the same `path`, or it clears nothing.)

### Login does not leak which emails exist

If the API returned "user not found" and "wrong password" differently, it would be an account enumeration oracle. Both paths return the same `401` with the same message.

Message parity alone isn't enough, though — skipping the bcrypt compare when no user is found would make the "no such user" response measurably faster and leak the same information through timing. So the compare always runs, against a hardcoded dummy hash when there's no user or no stored password:

```ts
const passwordResult = await bcrypt.compare(password, user?.hashedpassword ?? DUMMY_HASH)
if (!user || !passwordResult) throw new UnauthorizedError("Invalid email or password.")
```

### Refresh token rotation with reuse detection

Every refresh issues a new refresh token and invalidates the old one. A session is a *family*, keyed by a `sid` claim carried in both tokens, with the currently valid JTI stored in Redis at `family:{sid}`.

On refresh, the presented JTI is compared against the stored one:

- **Match** — rotate: generate a new JTI, overwrite the key, issue new tokens.
- **Missing key** — the session expired or was logged out. `401`.
- **Mismatch** — a token that was already spent has been presented again. That means it was captured, because a legitimate client discards the old token the moment it receives a new one. The server can't distinguish the thief from the victim, so it deletes the entire family and forces both to re-authenticate.

The rotation write uses `KEEPTTL`:

```ts
await redisClient.set(`family:${sid}`, newJti, { KEEPTTL: true })
```

Preserving the original 30-day expiry is the whole point. Writing a fresh `EX` on every refresh would let an active session extend itself indefinitely, and a stolen token inside an active session would never expire.

The mismatch check is ordered after the missing-key check on purpose — `null !== jti` is also true, so checking mismatch first would report "revoked" for sessions that had merely expired.

### Logout revokes an already-signed token

A JWT is valid until it expires; the server can't unsign one. To make logout immediate, the access token's JTI is written to `denylist:{jti}` with a TTL equal to its *remaining* lifetime, and the auth middleware checks that key on every request. The TTL means Redis evicts the entry exactly when the token would have expired anyway, so the denylist stays bounded rather than growing forever.

The denylist check fails **open** — if Redis is unreachable the request is logged and allowed through. That's a deliberate availability-over-security tradeoff for a supporting check: the alternative is that a Redis outage locks out every authenticated user. The signature check, which is the actual security boundary, never depends on Redis.

### A valid signature is not a valid payload

`jwt.verify` proves the token was signed by us. It proves nothing about the shape of what's inside. The middleware validates the payload independently before trusting it — that `sub` is a positive integer, and that `jti`, `exp`, and `sid` are present and of the right type — rather than assuming a well-formed claim set.

### Registration handles the concurrent-signup race

The route checks for an existing email before inserting, but that check is not the thing that guarantees uniqueness. Two simultaneous requests can both pass it. The unique index on `users.email` is the real constraint, so the insert catches Postgres error `23505` and converts it to the same `409` the pre-check would have produced.

---

## Data Model

Currently migrated:

```
users ──< memberships >── organizations
                               │
                               ├──< teams ──< projects
                               │
                               └──< activity_logs >── users
```

| Table | Purpose |
|---|---|
| `users` | Account, unique email, bcrypt hash |
| `organizations` | Tenant root, unique slug |
| `memberships` | Join table carrying the user's role in an organization |
| `teams` | Scoped to an organization, unique name per org |
| `projects` | Scoped to a team, unique name per team, status enum |
| `activity_logs` | Append-only event record |

### Decisions

**Role lives on the membership, not the user.** `memberships.user_role` is what makes a person an Owner in one organization and a Guest in another. Putting the role on `users` would have made it global and forced a rewrite the moment a user joined a second org.

```sql
UNIQUE (user_id, organization_id)
```

That constraint is what prevents a user from holding two conflicting roles in the same organization.

**Cascades are chosen per relationship.** Deleting an organization cascades to its memberships and activity logs, since neither means anything without it. Enum-backed columns (`user_role`, `project_status`) keep invalid states out of the database rather than relying on application code to be careful.

**`activity_logs` is append-only** and uses a polymorphic `(entity_type, entity_id)` pair so any future entity can be logged without a new column — indexed as a composite, since the pair is only ever queried together.

**Uniqueness is scoped, not global.** `UNIQUE (team_id, name)` on projects means two teams can each have a "Website" project, which is what you want in a multi-tenant system.

**Timestamps are `timestamptz`, not `timestamp`.** They began as `timestamp without time zone`, which quietly produced wrong data: `DEFAULT now()` stores local wall-clock, while an ORM serialising a JavaScript `Date` stores UTC. With the server on UTC+1, every project edited through the API ended up with an `updated_at` an hour *before* its `created_at`. `timestamptz` stores an absolute instant, so both writers agree regardless of who generates the value or where the server runs.

---

## Error Handling

Every operational error is a typed class extending `AppError`, carrying an HTTP status and a stable machine-readable code:

| Class | Status | Code |
|---|---|---|
| `ValidationError` | 400 | `VALIDATION_FAILED` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `CONFLICT` |
| `TooManyRequestsError` | 429 | `RATE_LIMITED` |
| `InternalError` | 500 | `INTERNAL_ERROR` |

A single error middleware is the only place that writes an error response:

```json
{ "success": false, "code": "CONFLICT", "message": "A user with this email already exists!" }
```

The distinction the handler is built around: **an `AppError` is an error we threw on purpose; anything else is a bug.** Typed errors return their own message. Everything else is logged in full and returned as a generic `500` that says nothing — stack traces and internal messages never cross the wire in production. The underlying message is appended as `debug` only when `NODE_ENV !== 'production'`.

It also handles the cases Express raises before any route runs — `entity.parse.failed` for malformed JSON, `entity.too.large` for oversized bodies — and bails out via `next(err)` if headers were already sent, since at that point only Express can safely tear down the response.

---

## Rate Limiting

Fixed-window counter in Redis, keyed by IP, applied to the auth routes:

```ts
const currentRequests = await redisClient.incr(key)
if (currentRequests === 1) await redisClient.expire(key, 30)
```

`INCR` on a missing key creates it at 1, which is the signal to set the window's TTL. When the limit trips, `TooManyRequestsError` carries the key's remaining TTL, and the error middleware surfaces it as a `Retry-After` header so clients know exactly when to retry instead of hammering blindly.

Like the denylist, this **fails open** — a Redis outage should not take authentication offline.

---

## Project Structure

```
index.ts               # boot: connect Redis, listen, crash handlers
drizzle/               # generated migrations
src
├── app.ts             # express wiring, middleware order
├── redis.ts           # shared redis client
├── config/            # zod-validated env
├── db/                # drizzle client, schema, relations
├── lib/               # AppError hierarchy
├── middleware/        # auth, rate limiter, error handler, resource loaders
├── routes/            # route handlers
├── testroutes/        # integration suites, run against the real database
├── validation/        # zod request schemas
└── types/             # express request augmentation
```

Routers nest to mirror the URL: `app.ts` mounts `/orgs`, which mounts `/:orgId/members` and `/:orgId/teams`, which in turn mounts `/:teamId/projects`. Every router in that chain sets `mergeParams: true` — without it a child sees none of its ancestors' params, `loadMembership` reads an undefined `:orgId`, and every nested route returns `404` no matter how correct the handler is.

Access is resolved by middleware before any handler runs, each layer narrowing the last: `auth` establishes the user, `loadMembership` resolves their role in the organization, `loadTeam` confirms the team belongs to it. A handler that reaches `req.team` can trust it without re-checking.

Middleware order in `app.ts` is load-bearing: `notFoundHandler` sits after all routes so it only runs when nothing matched, and `errorHandler` is mounted last because Express only recognizes error middleware that is both four-arity and registered after everything it protects.

`index.ts` connects to Redis *before* binding the port, so the process never accepts traffic it can't serve. `unhandledRejection` and `uncaughtException` both log and exit rather than continuing — a process in an unknown state should be replaced by the supervisor, not kept alive.

---

## Known Limitations

Being explicit about what would need to change before this ran in production:

- **Rate limiting is per-IP and fixed-window.** Users behind a shared NAT share a bucket, and the window boundary allows a burst of up to 2× the limit across two adjacent windows. A sliding window or token bucket keyed per user would be the fix. The `INCR`/`EXPIRE` pair is also two round trips — if the process dies between them the key never expires. A Lua script or `SET NX` would make it atomic.
- **The current limit is 5 requests per 30 seconds**, which is a development value, not a production one.
- **The Redis client uses default connection settings** rather than a configurable URL, so it only talks to `localhost:6379`.
- **Route handlers query the database directly.** As the domain logic grows past authentication, this needs the service/repository split so that permission checks live in one enforceable layer.
- **`users.hashedpassword` is nullable**, which anticipates OAuth accounts but currently just means the login path has to defend against it.
- **Tests share one real database.** There are no mocks and no separate test database, so `vitest.config.ts` sets `fileParallelism: false` and each suite deletes the rows it created. Fast and honest about SQL behaviour, but it means the suite cannot run without `npm run db:up`.
- **Teams are not an access boundary.** There is no `team_members` table, so every member of an organization implicitly reaches every team in it — and therefore every project inside those teams.
- **Projects have no owner.** Without a `created_by` column, "only the creator may edit this" is not expressible, so any member can edit or archive any project in their team.
- **Migrations are not tracked in this database.** There is no `__drizzle_migrations` table — the schema was applied by hand rather than through `drizzle-kit migrate`, so running it here would try to replay every migration from the first `CREATE TABLE`. The migration files themselves are accurate and would apply cleanly to a fresh database.

---

## Roadmap

- [ ] Tasks: title, description, assignee, creator, due date, priority, labels, status
- [ ] Comments and attachments
- [x] Organization CRUD endpoints
- [x] Team CRUD endpoints
- [x] Project CRUD endpoints
- [x] Permission middleware enforcing the four roles per organization
- [x] Member management: adding by email, role changes, removal, self-service leaving
- [ ] Invitations for users who have not registered yet
- [ ] `team_members` join table, if teams should gate access
- [ ] Email verification and password reset
- [ ] Search, filtering, cursor pagination, sorting
- [ ] Notifications
- [ ] Redis caching for organization membership and task lists
- [ ] Service and repository layers
- [x] Docker Compose (Postgres, Redis)
- [ ] OpenAPI spec and Swagger UI
- [x] Integration test suite — auth, organizations, memberships, teams, projects
