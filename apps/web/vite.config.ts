import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function gitShortSha(): string {
  try {
    const s = execSync("git rev-parse --short HEAD", {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{4,40}$/i.test(s) ? s : "";
  } catch {
    return "";
  }
}

const appBuildIso = new Date().toISOString();
const gitCommitShort = gitShortSha();

export default defineConfig({
  define: {
    __APP_BUILD_ISO__: JSON.stringify(appBuildIso),
    __GIT_COMMIT_SHORT__: JSON.stringify(gitCommitShort),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@mymemory/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      /** Sem limite curto: `POST /api/memos/image/process` (OCR + IA) pode exceder o default (~2 min) do proxy. */
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      "/media": { target: "http://127.0.0.1:4000", changeOrigin: true },
    },
  },
});
