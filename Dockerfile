FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
COPY patches patches
RUN pnpm install --frozen-lockfile --store-dir /app/.pnpm-store
COPY . .
ARG NEXT_PUBLIC_AG_GRID_LICENSE_KEY
ENV NEXT_PUBLIC_AG_GRID_LICENSE_KEY=$NEXT_PUBLIC_AG_GRID_LICENSE_KEY
RUN pnpm build
ENV NODE_ENV=production PAYPAL_MODE=replay
RUN mkdir -p /app/workspace && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "apps/web", "--hostname", "0.0.0.0"]
