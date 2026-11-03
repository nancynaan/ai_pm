# syntax=docker/dockerfile:1

# ---- dependencies (all workspaces, incl. dev tools for the build) ----
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

# ---- build shared, server and web ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web
RUN npm run build

# ---- runtime: production dependencies of the server only ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production
# Agents call Claude through the Claude Code CLI on the user's subscription
# (signed in with CLAUDE_CODE_OAUTH_TOKEN from .env). Pinned; no self-updates inside the container.
ARG CLAUDE_CODE_VERSION=2.1.316
ENV DISABLE_AUTOUPDATER=1
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace=apps/server && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY apps/server/drizzle apps/server/drizzle
COPY agents agents
COPY skills skills
COPY config config
COPY seed seed
USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
