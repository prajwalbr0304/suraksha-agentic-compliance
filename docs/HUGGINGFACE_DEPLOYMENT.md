# Hugging Face Spaces Deployment

Suraksha OS can run as a Docker-based Hugging Face Space. The Space runs both:

- the Next.js web app on Hugging Face's public port `7860`
- the FastAPI Python agent service internally on `127.0.0.1:8088`

Supabase remains external because it provides database, auth, row-level
security, and file storage.

## 1. Create the Space

1. Go to Hugging Face -> Spaces -> New Space.
2. Use a lowercase, URL-safe name such as `suraksha-os` or
   `suraksha-compliance-os`.
3. Choose **Docker** as the SDK.
4. Choose **Free** hardware for a demo.
5. Prefer **Apache 2.0** for the license to match this repository.
6. Keep the Space name handy as `owner/space-name`, for example
   `prajwalbr0304/suraksha-os-demo`.

## 2. Add GitHub repository secrets

In GitHub -> Settings -> Secrets and variables -> Actions, add:

| Secret | Required | Value |
| --- | --- | --- |
| `HF_TOKEN` | Yes | Hugging Face access token with write access to the Space |
| `HF_SPACE_ID` | Yes | Space id, for example `prajwalbr0304/suraksha-os-demo` |
| `NEXT_PUBLIC_SUPABASE_URL` | Recommended | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Recommended | Supabase anon/public key |
| `NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET` | Optional | Defaults to `compliance-documents` |

The deploy workflow uses placeholders when Supabase public values are not set,
which is useful for a landing-page-only smoke demo. Authenticated product flows
need real Supabase values.

## 3. Add Hugging Face Space secrets

In the Space -> Settings -> Variables and secrets, add the runtime values:

| Secret | Required for | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | App runtime | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | App runtime | Supabase anon/public key |
| `SUPABASE_URL` | Agent runtime | Same value as `NEXT_PUBLIC_SUPABASE_URL`; optional because the startup script derives it |
| `SUPABASE_SERVICE_ROLE_KEY` | API routes | Supabase service-role key |
| `NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET` | Uploads/downloads | Usually `compliance-documents` |
| `AGENT_SERVICE_URL` | Agent console | Optional; defaults to `http://127.0.0.1:8088` inside the Space |
| `AGENT_SHARED_SECRET` | Agent runs | Any strong shared secret; used by the Next API routes and FastAPI service |
| `GEMINI_API_KEY` | Agent LLM | Required for live Gemini agent runs |
| `ENABLE_SCHEDULER` | Agent autonomy | Defaults to `0` in the Space; set `1` only after Supabase and Gemini are configured |

Do not put `SUPABASE_SERVICE_ROLE_KEY` in a public variable. It must be a Space
secret.

The `NEXT_PUBLIC_*` values must exist before the Space Docker image builds.
The Dockerfile reads them as Hugging Face build secrets during `next build`, so
restart/rebuild the Space after changing them. If they are missing during build,
the login page may render but browser auth calls will fail because the client
bundle was built with placeholder Supabase values.

Without Supabase secrets, the public landing page can load but authenticated
workflows and API routes cannot read/write product data. Without `GEMINI_API_KEY`
or a reachable local LLM, the agent health endpoint works but live agent runs are
disabled.

## 4. Deploy

Run **Deploy to Hugging Face Space** from the GitHub Actions tab, or push to
`main`. The workflow lints, type-checks, builds, then force-pushes a clean Docker
Space repository to Hugging Face.

The demo URL will be:

```text
https://huggingface.co/spaces/<owner>/<space-name>
```

Hugging Face also exposes the running app at:

```text
https://<owner>-<space-name>.hf.space
```

## Local Docker smoke test

```bash
docker build -t suraksha-os .
docker run --rm -p 7860:7860 --env-file .env.local suraksha-os
```

Then open `http://localhost:7860`.

The container also starts the internal agent service at
`http://127.0.0.1:8088/health`.
