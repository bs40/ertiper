# Ertiper flight board, multi-user edition, for bunny.net Magic Containers (linux/amd64).
# Secrets are passed as environment variables by Magic Containers, never baked into the image.

# --- Build stage: install everything and copy Leaflet + fonts into public/vendor ---------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY scripts ./scripts
RUN mkdir -p public && node scripts/vendor.mjs

# --- Runtime stage: production dependencies only, non-root ------------------------------------
FROM node:24-alpine
# The commit is reported by /api/health so deploy.ps1 can tell when a rollout has finished.
ARG GIT_COMMIT=unknown
ENV NODE_ENV=production \
    PORT=8080 \
    GIT_COMMIT=$GIT_COMMIT
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
COPY data ./data
COPY public ./public
COPY --from=build /app/public/vendor ./public/vendor
# Read-only app files; the process runs as the unprivileged "node" user.
RUN chown -R root:root /app && chmod -R a-w /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server/index.js"]
