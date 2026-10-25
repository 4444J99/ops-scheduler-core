# Scheduler core boundary

This is reusable source, not a deployment owner. Keep examples and tests synthetic.
Do not add real product manifests, provider/account identifiers, credentials, operational
records, release artifacts, deployment entrypoints, or scheduled workflows.

Accept target lists and runtime adapters from the caller. Preserve queued work, idempotency,
fencing, uncertain-outcome locks, and evidence semantics. Changes to reusable code are tested
here; deployment and operational completion belong to the consuming resource owner.

Run `npm run typecheck` and `npm test`. A passing source check is not a live runtime receipt.
All tracked files must be explicitly listed in `form-manifest.yaml`.
