# Contexte de construction : le dossier web/  (docker compose build web)
# Aucun secret n'est nécessaire à la construction ; ils sont fournis à l'exécution.

FROM node:24.14.0-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# `postinstall` lance `prisma generate` (ne se connecte pas à la base).
RUN npm ci

FROM node:24.14.0-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build
# Cette étape (avec toutes les dépendances, prisma et tsx) sert au service « tools » :
# migrations et création d'utilisateurs.
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24.14.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN groupadd --system --gid 10001 web && useradd --system --uid 10001 --gid web --no-create-home web
COPY --from=builder --chown=web:web /app/.next/standalone ./
COPY --from=builder --chown=web:web /app/.next/static ./.next/static
COPY --from=builder --chown=web:web /app/public ./public
USER web
EXPOSE 3000
CMD ["node", "server.js"]
