FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared-types packages/shared-types
COPY apps/api apps/api
RUN pnpm --filter @pharmacy-os/shared-types build && pnpm --filter @pharmacy-os/api build
RUN pnpm --filter @pharmacy-os/api deploy --prod /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
EXPOSE 4000
USER node
CMD ["node", "dist/main.js"]
