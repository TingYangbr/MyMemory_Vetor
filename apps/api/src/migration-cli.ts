/**
 * CLI de migrations — use via npm scripts:
 *
 *   npm run migration:run     → aplica todas as migrations pendentes
 *   npm run migration:revert  → desfaz a última migration aplicada
 *   npm run migration:show    → lista o status de cada migration
 */
import "reflect-metadata";
import { AppDataSource } from "./data-source.js";

// Importa migration classes diretamente (sem glob) para evitar o bug
// de emptyQuery do TypeORM ao usar import() dinâmico com pg 8.20.x
import { InitialSchema1700000000000 } from "./migrations/1700000000000-InitialSchema.js";
import { SeedDev1700000000001 } from "./migrations/1700000000001-SeedDev.js";
import { CategoryCampoPatternsAndDadosEspecificos1700000000025 } from "./migrations/1700000000025-CategoryCampoPatternsAndDadosEspecificos.js";
import { PgvectorMemoChunks1700000000100 } from "./migrations/1700000000100-PgvectorMemoChunks.js";

// Injeta as classes diretamente no DataSource antes de inicializar
AppDataSource.setOptions({
  migrations: [
    InitialSchema1700000000000,
    SeedDev1700000000001,
    CategoryCampoPatternsAndDadosEspecificos1700000000025,
    PgvectorMemoChunks1700000000100,
  ],
});

const command = process.argv[2];

if (!command || !["run", "revert", "show"].includes(command)) {
  console.error("Uso: migration-cli.ts <run|revert|show>");
  process.exit(1);
}

await AppDataSource.initialize();

try {
  if (command === "run") {
    const ran = await AppDataSource.runMigrations({ transaction: "each" });
    if (ran.length === 0) {
      console.log("Nenhuma migration pendente.");
    } else {
      console.log(`${ran.length} migration(s) aplicada(s):`);
      ran.forEach((m) => console.log(`  ✔ ${m.name}`));
    }
  }

  if (command === "revert") {
    await AppDataSource.undoLastMigration({ transaction: "each" });
    console.log("Última migration revertida.");
  }

  if (command === "show") {
    const migrations = await AppDataSource.showMigrations();
    if (!migrations) {
      console.log("Todas as migrations estão aplicadas.");
    } else {
      console.log("Existem migrations pendentes (veja a lista acima).");
    }
  }
} finally {
  await AppDataSource.destroy();
}
