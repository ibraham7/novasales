FROM oven/bun:1.4.2 AS build

WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

COPY . .

ARG SUPABASE_URL
ARG SUPABASE_PUBLISHABLE_KEY
ENV NITRO_PRESET=node_server
ENV VITE_SUPABASE_URL=${SUPABASE_URL}
ENV VITE_SUPABASE_PUBLISHABLE_KEY=${SUPABASE_PUBLISHABLE_KEY}

RUN bun run build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=build --chown=node:node /app/.output ./.output

USER node
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
