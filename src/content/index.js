import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadContentBundle(version = 1) {
  const p = path.join(__dirname, "..", "..", "content", `bundle.v${version}.json`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadSettingsCatalog() {
  const p = path.join(__dirname, "..", "..", "content", "settings.catalog.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}
