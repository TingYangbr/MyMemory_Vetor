/**
 * CLI de migrations — use via npm scripts:
 *
 *   npm run migration:run     → aplica todas as migrations pendentes
 *   npm run migration:revert  → desfaz a última migration aplicada
 *   npm run migration:show    → lista o status de cada migration
 *
 * Para criar uma nova migration vazia:
 *   npm run migration:create -- src/migrations/NomeDaMigracao
 */
import { AppDataSource } from "./data-source.js";

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
