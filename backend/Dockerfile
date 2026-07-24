# ---------- Build stage ----------
FROM node:22-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY nest-cli.json ./
COPY tsconfig.json ./
RUN npm ci --legacy-peer-deps

COPY . .
# Give tsc/nest headroom on constrained build machines. The build itself only
# needs ~1.8 GB now that specs are excluded (tsconfig.build.json), but the
# default old-space ceiling (~2 GB) leaves no margin — raise it so growth in
# the type-checked surface doesn't OOM the image build.
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

# ---------- Runtime stage ----------
FROM node:22-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

RUN useradd -r -u 1001 -g users -m -d /home/nodeapp nodeapp

# Copy node_modules from builder (includes compiled native addons like isolated-vm)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Public assets (logo, favicon) served via useStaticAssets at runtime.
COPY --from=builder /app/public ./public
COPY package*.json ./
RUN npm prune --omit=dev --legacy-peer-deps && npm cache clean --force

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

USER 1001

CMD ["node", "dist/main.js"]
