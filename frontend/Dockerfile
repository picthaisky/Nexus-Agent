# ============================================================
# Cyber-Thai Command Center — Frontend Dockerfile
# ============================================================
# Build:  docker build -t nexus-agent-frontend:latest ./frontend
# Run:    docker run -p 5173:80 nexus-agent-frontend:latest
# ============================================================

# ── Stage 1: Build the static bundle ────────────────────────
FROM node:26-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY src ./src

RUN npm run build

# ── Stage 2: Serve via nginx ────────────────────────────────
FROM nginx:1.31-alpine AS production

LABEL org.opencontainers.image.source="https://github.com/picthaisky/Nexus-Agent"
LABEL org.opencontainers.image.description="Cyber-Thai Command Center — React dashboard for Nexus-Agent"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
