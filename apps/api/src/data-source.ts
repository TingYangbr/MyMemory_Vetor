import "reflect-metadata";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { DataSource } from "typeorm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

// Resolve migration path for both tsx (src/*.ts) and compiled (dist/*.js) runtimes
const isTs = __filename.endsWith(".ts");
const migrationsPath = path.join(
  __dirname,
  isTs ? "migrations/*.ts" : "migrations/*.js"
);

export const AppDataSource = new DataSource({
  type: "mysql",
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  username: process.env.MYSQL_USER ?? "mymemory",
  password: process.env.MYSQL_PASSWORD ?? "mymemory_secret",
  database: process.env.MYSQL_DATABASE ?? "mymemory",
  synchronize: false,
  logging: false,
  entities: [],
  migrations: [migrationsPath],
  migrationsTableName: "typeorm_migrations",
});
