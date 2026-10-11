# The web app: builds the PWA, then serves it with nginx, which also proxies /api to the
# api container, so the session cookie stays same-origin. Build context is the repo root.
FROM node:22-alpine AS build
WORKDIR /src

# Workspace manifests first, so `npm ci` is cached until dependencies change.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/api-provider/package.json packages/api-provider/
COPY packages/drive-provider/package.json packages/drive-provider/
RUN npm ci

COPY packages ./packages
COPY apps/web ./apps/web
RUN npm run build -w @family-hub/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
