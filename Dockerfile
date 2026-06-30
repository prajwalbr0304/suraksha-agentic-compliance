# syntax=docker/dockerfile:1.4

FROM node:20-slim AS deps
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key
ARG NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET=compliance-documents

ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET=${NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=secret,id=NEXT_PUBLIC_SUPABASE_URL,required=false \
  --mount=type=secret,id=NEXT_PUBLIC_SUPABASE_ANON_KEY,required=false \
  --mount=type=secret,id=NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET,required=false \
  NEXT_PUBLIC_SUPABASE_URL="$(cat /run/secrets/NEXT_PUBLIC_SUPABASE_URL 2>/dev/null || echo "$NEXT_PUBLIC_SUPABASE_URL")" \
  NEXT_PUBLIC_SUPABASE_ANON_KEY="$(cat /run/secrets/NEXT_PUBLIC_SUPABASE_ANON_KEY 2>/dev/null || echo "$NEXT_PUBLIC_SUPABASE_ANON_KEY")" \
  NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET="$(cat /run/secrets/NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET 2>/dev/null || echo "$NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET")" \
  npm run build

FROM node:20-slim AS runner
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=7860
ENV AGENT_HOST=127.0.0.1
ENV AGENT_PORT=8088
ENV AGENT_SERVICE_URL=http://127.0.0.1:8088
ENV ENABLE_SCHEDULER=0

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/agent-service ./agent-service
COPY --from=builder /app/scripts/start-hf-space.sh ./scripts/start-hf-space.sh

RUN python3 -m venv /opt/suraksha-agent-venv \
  && /opt/suraksha-agent-venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/suraksha-agent-venv/bin/pip install --no-cache-dir -r agent-service/requirements.txt \
  && chmod +x scripts/start-hf-space.sh

EXPOSE 7860

CMD ["./scripts/start-hf-space.sh"]
