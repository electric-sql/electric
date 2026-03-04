# ElectricSQL — Skill Spec

ElectricSQL is a read-path sync engine for Postgres that streams real-time data changes to clients via HTTP shapes. It solves partial replication, fan-out, and data delivery so developers can build fast, local-first apps without rolling their own sync. Electric is read-only — writes go through the developer's own API endpoints and are reconciled via a txid handshake.

## Domains

| Domain                      | Description                                                                               | Skills                             |
| --------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| Syncing Data                | Configuring and consuming real-time data streams from Postgres tables via shapes          | shape-streaming                    |
| Securing Access             | Proxying Electric, authenticating requests, and securing Postgres for replication         | proxy-and-auth, postgres-security  |
| Running in Production       | Deploying Electric, troubleshooting sync, and operating Postgres with logical replication | debugging-sync, deployment         |
| Integrating with Frameworks | Using Electric with ORMs and collaboration libraries                                      | yjs-collaboration, orm-integration |
| Building Features           | End-to-end developer journey from schema design through working UI                        | schema-and-shapes, new-feature-e2e |

## Skill Inventory

| Skill             | Type        | Domain                      | What it covers                                                                    | Failure modes |
| ----------------- | ----------- | --------------------------- | --------------------------------------------------------------------------------- | ------------- |
| Shape Streaming   | core        | Syncing Data                | ShapeStream, Shape, options, parsers, column mappers, error handling              | 7             |
| Proxy and Auth    | core        | Securing Access             | ELECTRIC_PROTOCOL_QUERY_PARAMS, proxy setup, CORS, auth tokens, tenant isolation  | 6             |
| Postgres Security | core        | Securing Access             | REPLICATION role, SELECT grants, REPLICA IDENTITY, publications                   | 3             |
| Schema and Shapes | core        | Building Features           | Table design for shapes, single-table constraint, WHERE design, replica mode      | 3             |
| Debugging Sync    | lifecycle   | Running in Production       | Fast-loop detection, stale cache, MissingHeadersError, WAL growth, HTTP/1.1 limit | 4             |
| Deployment        | lifecycle   | Running in Production       | Docker, Electric Cloud, DATABASE_URL, ELECTRIC_SECRET, wal_level, storage         | 4             |
| Yjs Collaboration | composition | Integrating with Frameworks | ElectricProvider, resume state, awareness, parseToDecoder, debouncing             | 3             |
| New Feature E2E   | lifecycle   | Building Features           | Schema + shapes + proxy + UI journey, old API migration, txid handshake           | 3             |
| ORM Integration   | composition | Integrating with Frameworks | Drizzle, Prisma, txid from ORM, migrations preserving REPLICA IDENTITY            | 2             |

## Failure Mode Inventory

### Shape Streaming (7 failure modes)

| #   | Mistake                                            | Priority | Source              | Cross-skill? |
| --- | -------------------------------------------------- | -------- | ------------------- | ------------ |
| 1   | Returning void from onError stops sync permanently | CRITICAL | client.ts:409-418   | —            |
| 2   | Using columns without including primary key        | HIGH     | shapes.md:181       | —            |
| 3   | Setting offset without handle for resumption       | HIGH     | client.ts:1997-2003 | —            |
| 4   | Using non-deterministic functions in WHERE clause  | HIGH     | known_functions.ex  | —            |
| 5   | Not parsing custom Postgres types                  | HIGH     | AGENTS.md:300-308   | —            |
| 6   | Using reserved parameter names in params           | MEDIUM   | client.ts:1984-1985 | —            |
| 7   | Mutating shape options on a running stream         | MEDIUM   | AGENTS.md:106       | —            |

### Proxy and Auth (6 failure modes)

| #   | Mistake                                                | Priority | Source             | Cross-skill? |
| --- | ------------------------------------------------------ | -------- | ------------------ | ------------ |
| 1   | Forwarding all client params to Electric               | CRITICAL | proxy-auth example | —            |
| 2   | Not deleting content-encoding/content-length headers   | CRITICAL | proxy-auth example | —            |
| 3   | Exposing ELECTRIC_SECRET/SOURCE_SECRET to browser      | CRITICAL | AGENTS.md:17-20    | —            |
| 4   | SQL injection in WHERE clause via string interpolation | CRITICAL | auth.md            | —            |
| 5   | Not exposing Electric response headers via CORS        | HIGH     | error.ts:109-118   | —            |
| 6   | Calling Electric directly from production client       | CRITICAL | AGENTS.md:19-20    | —            |

### Postgres Security (3 failure modes)

| #   | Mistake                                  | Priority | Source                  | Cross-skill? |
| --- | ---------------------------------------- | -------- | ----------------------- | ------------ |
| 1   | Missing REPLICA IDENTITY FULL on tables  | HIGH     | troubleshooting.md:373  | —            |
| 2   | Electric user without REPLICATION role   | HIGH     | postgres-permissions.md | —            |
| 3   | Using connection pooler for DATABASE_URL | CRITICAL | deployment.md:91        | —            |

### Schema and Shapes (3 failure modes)

| #   | Mistake                                             | Priority | Source             | Cross-skill? |
| --- | --------------------------------------------------- | -------- | ------------------ | ------------ |
| 1   | Designing shapes that span multiple tables          | HIGH     | AGENTS.md:104-105  | —            |
| 2   | Using enum columns without casting to text in WHERE | MEDIUM   | known_functions.ex | —            |
| 3   | Not setting up txid handshake for optimistic writes | HIGH     | AGENTS.md:116-119  | —            |

### Debugging Sync (4 failure modes)

| #   | Mistake                                                  | Priority | Source                     | Cross-skill? |
| --- | -------------------------------------------------------- | -------- | -------------------------- | ------------ |
| 1   | Proxy/CDN not including query params in cache key        | HIGH     | client.ts:929-1002         | —            |
| 2   | SSE responses buffered by proxy                          | HIGH     | troubleshooting.md:69-109  | —            |
| 3   | Running 6+ shapes in local dev without HTTP/2            | MEDIUM   | troubleshooting.md:28-53   | —            |
| 4   | Leaving replication slot active when Electric is stopped | HIGH     | troubleshooting.md:203-316 | —            |

### Deployment (4 failure modes)

| #   | Mistake                                          | Priority | Source                | Cross-skill? |
| --- | ------------------------------------------------ | -------- | --------------------- | ------------ |
| 1   | Not setting wal_level to logical                 | CRITICAL | postgres.conf         | —            |
| 2   | Running without ELECTRIC_SECRET in production    | CRITICAL | CHANGELOG.md:832-834  | —            |
| 3   | Using ephemeral storage for ELECTRIC_STORAGE_DIR | MEDIUM   | deployment.md:133-157 | —            |
| 4   | Using deprecated ELECTRIC_QUERY_DATABASE_URL     | MEDIUM   | CHANGELOG.md:415      | —            |

### Yjs Collaboration (3 failure modes)

| #   | Mistake                                          | Priority | Source           | Cross-skill? |
| --- | ------------------------------------------------ | -------- | ---------------- | ------------ |
| 1   | Not persisting resume state for reconnection     | HIGH     | types.ts:102-112 | —            |
| 2   | Missing BYTEA parser for shape streams           | HIGH     | utils.ts         | —            |
| 3   | Not setting debounceMs for collaborative editing | MEDIUM   | y-electric.ts    | —            |

### New Feature E2E (3 failure modes)

| #   | Mistake                                      | Priority | Source            | Cross-skill?    |
| --- | -------------------------------------------- | -------- | ----------------- | --------------- |
| 1   | Using old electrify() bidirectional sync API | CRITICAL | AGENTS.md:386-392 | shape-streaming |
| 2   | Using path-based table URL pattern           | HIGH     | CHANGELOG.md:1124 | shape-streaming |
| 3   | Using shape_id instead of handle             | MEDIUM   | CHANGELOG.md:1123 | —               |

### ORM Integration (2 failure modes)

| #   | Mistake                                       | Priority | Source                 | Cross-skill? |
| --- | --------------------------------------------- | -------- | ---------------------- | ------------ |
| 1   | Not returning txid from ORM write operations  | HIGH     | AGENTS.md:116-119      | —            |
| 2   | Running migrations that drop replica identity | MEDIUM   | troubleshooting.md:373 | —            |

## Tensions

| Tension                                  | Skills                               | Agent implication                                                                                 |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Security vs. getting-started simplicity  | proxy-and-auth ↔ deployment         | Agents generate code that calls Electric directly with ELECTRIC_INSECURE=true, skipping the proxy |
| Shape immutability vs. dynamic filtering | shape-streaming ↔ schema-and-shapes | Agents treat shape params like query keys, mutating options instead of creating new streams       |
| Read-only sync vs. full-stack data flow  | new-feature-e2e ↔ orm-integration   | Agents trained on old ElectricSQL generate bidirectional sync, skipping write-path API and txid   |

## Cross-References

| From              | To                | Reason                                                              |
| ----------------- | ----------------- | ------------------------------------------------------------------- |
| shape-streaming   | proxy-and-auth    | Shape URLs must point to proxy routes, not directly to Electric     |
| proxy-and-auth    | postgres-security | Proxy injects secrets that Postgres security enforces               |
| schema-and-shapes | orm-integration   | Schema design affects both shapes (read) and ORM queries (write)    |
| new-feature-e2e   | proxy-and-auth    | E2E feature journey includes setting up proxy routes for new shapes |
| debugging-sync    | deployment        | Many sync issues stem from deployment configuration                 |
| deployment        | postgres-security | Deployment requires correct Postgres configuration                  |
| shape-streaming   | debugging-sync    | onError semantics and backoff are essential for diagnosing problems |

## Subsystems & Reference Candidates

| Skill             | Subsystems      | Reference candidates                               |
| ----------------- | --------------- | -------------------------------------------------- |
| shape-streaming   | —               | WHERE clause types/functions, default type parsers |
| orm-integration   | Drizzle, Prisma | —                                                  |
| yjs-collaboration | —               | —                                                  |

## Remaining Gaps

| Skill           | Question                                                                           | Status |
| --------------- | ---------------------------------------------------------------------------------- | ------ |
| orm-integration | Specific Drizzle/Prisma patterns for txid? ORM gotchas with REPLICA IDENTITY FULL? | open   |
| debugging-sync  | Most common Discord support questions? What do developers misunderstand most?      | open   |

## Recommended Skill File Structure

- **Core skills:** shape-streaming, proxy-and-auth, postgres-security, schema-and-shapes
- **Lifecycle skills:** debugging-sync, deployment, new-feature-e2e
- **Composition skills:** yjs-collaboration, orm-integration
- **Reference files:** shape-streaming (WHERE clause reference, parser reference)

## Composition Opportunities

| Library     | Integration points                                              | Composition skill needed?           |
| ----------- | --------------------------------------------------------------- | ----------------------------------- |
| TanStack DB | Collections, live queries, optimistic mutations, txid handshake | No — TanStack DB has its own skills |
| Yjs         | ElectricProvider, document sync, awareness                      | Yes — yjs-collaboration             |
| Drizzle ORM | Write-path queries, txid retrieval, migrations                  | Yes — orm-integration               |
| Prisma      | Write-path queries, txid retrieval, migrations                  | Yes — orm-integration               |
