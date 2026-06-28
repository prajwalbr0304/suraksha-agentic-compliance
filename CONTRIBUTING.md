# Contributing to Suraksha OS

Thanks for your interest in improving Suraksha OS! This guide covers local setup, the
development workflow, and the standards we follow.

## Project layout

```
.
├── app/                 # Next.js App Router (pages, layouts, API routes)
├── components/          # React UI components
├── lib/                 # Domain logic, auth, services, Supabase client
├── hooks/               # React data hooks
├── data/                # Static/mock data and navigation
├── agent-service/       # Python FastAPI + Google ADK multi-agent service
├── supabase/migrations/ # SQL schema & migrations
├── scripts/             # Operational, QA and showcase scripts
├── tests/               # Playwright specs
└── docs/                # Documentation + showcase screenshots/video
```

## Prerequisites

- Node.js 20+ and npm
- A Supabase project (URL, anon key, service-role key)
- *(For the agent service)* Python 3.11+ and either a Gemini API key or Ollama running locally

## Local setup

```bash
# 1) Web app
npm install
cp .env.example .env.local        # fill in Supabase + agent settings
npm run dev                       # http://localhost:3000

# 2) Agent service (separate terminal)
cd agent-service
python -m venv .venv
.venv\Scripts\activate            # Windows (use: source .venv/bin/activate elsewhere)
pip install -r requirements.txt
uvicorn app.main:app --port 8088
```

> **Never commit secrets.** `.env`, `.env.local`, and `agent-service/.env` are git-ignored.
> Use `.env.example` / `agent-service/.env.example` as templates.

## Development workflow

1. Create a branch: `git checkout -b feat/short-description` (or `fix/…`, `docs/…`, `chore/…`).
2. Make focused changes with clear, conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`).
3. Run the checks below locally before opening a PR.
4. Open a Pull Request using the template; link any related issue.

## Quality checks

```bash
npm run lint            # ESLint
npx tsc --noEmit        # TypeScript type-check
npm run build           # Production build
npm run test            # verify + secret scan
npm run test:playwright # end-to-end tests (requires a running app)
```

CI runs lint, type-check and build on every pull request — keep them green.

## Coding standards

- TypeScript everywhere in the web app; prefer explicit types at module boundaries.
- Keep components focused; colocate hooks/services with their domain.
- Don't add comments that merely restate code; explain *why*, not *what*.
- Enforce tenant isolation (`organization_id`) and RBAC/ABAC on every new API route.
- Add/adjust a Playwright spec when changing user-facing behavior.

## Regenerating the showcase

```bash
npm run showcase        # → docs/showcase/screenshots + docs/showcase/video
```

Thanks for contributing! 🛡️
