import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const toIco = require("to-ico");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const src = path.join(publicDir, "favicon.png");
const out = path.join(publicDir, "favicon.ico");

const png = fs.readFileSync(src);
const buf = await toIco([png]);
fs.writeFileSync(out, buf);
console.log("Wrote", out);
