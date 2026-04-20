import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Diretório `apps/api` */
export const apiPackageRoot = path.resolve(__dirname, "..");

/** Pasta de uploads (absoluta) */
export function uploadsAbsolutePath(): string {
  return path.isAbsolute(config.uploadsDir)
    ? config.uploadsDir
    : path.join(apiPackageRoot, config.uploadsDir);
}
