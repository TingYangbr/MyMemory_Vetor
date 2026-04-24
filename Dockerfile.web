# ─── Build ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /build

# Manifests primeiro — camada de cache para npm ci
COPY package.json           ./package.json
COPY package-lock.json      ./package-lock.json
COPY tsconfig.base.json     ./tsconfig.base.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json  ./apps/api/package.json
COPY apps/web/package.json  ./apps/web/package.json

RUN npm ci

# O vite.config.ts aponta @mymemory/shared direto para o .ts fonte —
# não precisa compilar o shared antes, só copiar os fontes.
COPY packages/shared/ ./packages/shared/
COPY apps/web/        ./apps/web/

# Remove tsbuildinfo local para garantir compilação limpa dentro do container
RUN rm -f packages/shared/tsconfig.tsbuildinfo \
 && npm run build --workspace=@mymemory/web

# ─── Nginx ────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=builder /build/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
