# MyMemory

Monorepo com API (Fastify + Node.js) e frontend (React + Vite).

```
apps/
├── api/   → Fastify API (TypeScript, Node 20)
└── web/   → React SPA (Vite)
packages/
└── shared/ → Tipos e utilitários compartilhados
```

---

## Desenvolvimento local

### Pré-requisitos

- Node.js 20+
- Docker (para o MySQL local)

### Subir o banco de dados

```bash
docker compose up -d
```

Isso sobe um MySQL 8.4 na porta 3306 com as credenciais padrão do `.env.example`.

### Instalar dependências e rodar

```bash
cp .env.example .env       # ajuste se necessário
npm install
npm run dev --workspace=@mymemory/api   # API na porta 4000
npm run dev --workspace=@mymemory/web   # Web na porta 5173
```

As migrations rodam automaticamente ao iniciar a API — o banco será criado na primeira execução.

---

## Migrations (TypeORM)

O schema do banco é gerenciado pelo TypeORM via migrations em `apps/api/src/migrations/`.

### Comandos

```bash
# Ver status (quais já foram aplicadas)
npm run migration:show --workspace=@mymemory/api

# Aplicar migrations pendentes manualmente
npm run migration:run --workspace=@mymemory/api

# Reverter a última migration
npm run migration:revert --workspace=@mymemory/api

# Criar uma nova migration vazia
npm run migration:create --workspace=@mymemory/api -- apps/api/src/migrations/NomeDaMigracao
```

### Fluxo para uma nova alteração no schema

1. Crie a migration: `npm run migration:create -- apps/api/src/migrations/DescricaoDaMudanca`
2. Preencha os métodos `up()` (aplica) e `down()` (reverte) no arquivo gerado
3. Teste localmente: `npm run migration:run --workspace=@mymemory/api`
4. Faça o commit e suba uma nova imagem — a migration será aplicada automaticamente no deploy

---

## Deploy de produção

O deploy usa imagens Docker enviadas a um registry privado. O servidor apenas faz pull e executa os containers via Docker Compose + Traefik.

### Pré-requisitos (sua máquina)

- Docker instalado e rodando
- Acesso ao registry: `docker login registry.mymemory.com.br`

### Build e push das imagens

> **Mac com Apple Silicon (M1/M2/M3):** use `--platform linux/amd64` — o servidor roda em amd64.

```bash
TAG=v1.0.0   # ou: TAG=$(git rev-parse --short HEAD)

docker build --platform linux/amd64 -f ../Dockerfile.api \
  -t registry.mymemory.com.br/mymemory/api:${TAG} \
  -t registry.mymemory.com.br/mymemory/api:latest \
  . && \
docker build --platform linux/amd64 -f ../Dockerfile.web \
  -t registry.mymemory.com.br/mymemory/web:${TAG} \
  -t registry.mymemory.com.br/mymemory/web:latest \
  . && \
docker push registry.mymemory.com.br/mymemory/api:${TAG} && \
docker push registry.mymemory.com.br/mymemory/api:latest && \
docker push registry.mymemory.com.br/mymemory/web:${TAG} && \
docker push registry.mymemory.com.br/mymemory/web:latest
```

### Configuração do servidor (primeira vez)

```bash
# No servidor — copie docker-compose.yml e .env.example do diretório de deploy
cp .env.example .env
nano .env   # preencher todos os valores

docker login registry.mymemory.com.br
docker network create traefik-net   # se ainda não existir
```

### Deploy

```bash
# No servidor
docker compose pull
docker compose up -d
```

Na primeira execução com banco vazio, a API cria todas as tabelas automaticamente. Para confirmar:

```bash
docker compose logs api | grep -i migra
# Esperado: 1 migration(s) aplicada(s): InitialSchema1700000000000
```

### Comandos de migration no servidor (opcional)

```bash
docker compose exec api node dist/migration-cli.js show
docker compose exec api node dist/migration-cli.js run
docker compose exec api node dist/migration-cli.js revert
```

### Rollback de versão

```bash
# Altere IMAGE_TAG no .env e repita o deploy
docker compose pull
docker compose up -d
```
