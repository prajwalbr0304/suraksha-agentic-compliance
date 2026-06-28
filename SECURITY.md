# Security Policy

Suraksha OS handles regulatory and compliance data, so we take security seriously.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report privately via one of:

- GitHub's [private vulnerability reporting](https://github.com/prajwalbr0304/suraksha-agentic-compliance/security/advisories/new) (Security → Report a vulnerability), or
- a direct message to the maintainer (**@prajwalbr0304**).

Please include:

- a description of the issue and its impact,
- steps to reproduce (proof-of-concept if possible),
- affected component (web app, API route, agent service, database), and
- any suggested remediation.

We aim to acknowledge reports within **72 hours** and to provide a remediation timeline
after triage.

## Scope & hardening model

Suraksha OS enforces defense in depth:

- **Authentication** on every non-public route and API (`Authorization: Bearer …`).
- **RBAC + ABAC + Postgres Row-Level Security** — the database is the source of truth; the UI gate is convenience.
- **Tenant isolation** by `organization_id` on every query and agent task.
- **Secret-scoped agent service** — mutating endpoints require a shared `X-Agent-Secret`.
- **Audit logging** of agent and user actions with full provenance.

## Secrets

- Never commit secrets. `.env`, `.env.local`, and `agent-service/.env` are git-ignored.
- If a credential is ever exposed, **rotate it immediately** and purge it from history.
- `npm run scan:secrets` runs a basic secret scan; CI and pre-merge reviews should keep it clean.

## Supported versions

This project is under active development; only the latest `main` is supported.
