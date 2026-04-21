import "reflect-metadata";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { DataSource } from "typeorm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.POSTGRES_HOST ?? process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.POSTGRES_PORT ?? process.env.MYSQL_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? process.env.MYSQL_USER ?? "mymemory",
  password: process.env.POSTGRES_PASSWORD ?? process.env.MYSQL_PASSWORD ?? "mymemory_secret",
  database: process.env.POSTGRES_DB ?? process.env.MYSQL_DATABASE ?? "mymemory",
  synchronize: false,
  logging: false,
  entities: [],
  migrations: [],  // Migrations são injetadas pelo migration-cli ou server.ts
  migrationsTableName: "typeorm_migrations",
});
