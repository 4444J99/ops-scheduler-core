# Scheduler core

A reusable TypeScript library for schedule selection, resource admission, and fenced
SQLite-compatible execution records. Targets are supplied by the caller. This repository
contains no deployed worker, schedule authority, product manifest, provider configuration,
credentials, deployment workflow, operational records, or product data.

## Check the source

Use Node.js 24 or newer:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

The tests create in-memory SQLite databases and synthetic `example/*` targets. They exercise
duplicate claims, owner/generation fencing, uncertain outcomes, accepted-versus-completed
receipts, dispatch budgets, atomic reservation rollback, bounded queue selection, additive
migration preservation, cron parsing, admission, and environment isolation. They require no
network, credentials, Cloudflare account, local listener, or private repository checkout.

## Interfaces

`validateNewRegistration(target)` requires a named capability and measured resource budget.
`validateAllocation(targets, allowance, overhead, reservePercent)` checks caller-supplied
capacity; the library does not embed a provider plan or treat a quota as permission to spend.
`assertController(target, environment)` rejects unidentified controllers and staging-to-production
invocation. These checks do not grant provider authority.

`getDueTargets(targets, scheduledTime)` returns due payloads from an explicit target list.
Natural schedules take precedence over continuation schedules. `logicalRunKey` binds target,
environment, minute slot, and mode, so changing source revisions does not replay a logical job.

`RunStore` accepts the structural database interface exported from `src/types.ts`. Its schema
and query behavior are exercised with SQLite; provider-specific D1 runtime and deployment
compatibility still require the consuming owner's validation. The retained implementation
caps concurrent claims and selected work at four, and fleet dispatch reservations at 2,000
per UTC day. These are implementation safeguards, not provider allowances or a claim that
account-wide resource budgets are enforced.

Migrations are additive source artifacts. Applying them to an existing database, authorizing
a source revision, invoking a product, reconciling uncertain work, deploying a resource, and
retaining operational evidence remain responsibilities of the runtime owner. This package
does none of those operations by itself. An `accepted` receipt keeps its exclusion lock;
timeouts remain `uncertain` until the owner reconciles them.

## Consumption boundary

The runtime owner supplies its private target manifest and invocation adapter, pins a reviewed
core revision, compiles or bundles this TypeScript source in its existing build, and validates
that combination in its own release path. Native Node type stripping is used for this
repository's tests; this is not a prebuilt JavaScript package. The runtime owner remains the only
normal scheduler/deployer for its resources. Publishing this source does not activate another
clock or demonstrate a production run.

`form-manifest.yaml` records the explicit extraction allowlist. Exact source provenance is
retained separately by the owner. The public history begins independently; private history
and operational source files are excluded.
`package.json` remains private and UNLICENSED: no package publication or open-source license
grant is implied. Source publication and npm package publication are separate actions.
