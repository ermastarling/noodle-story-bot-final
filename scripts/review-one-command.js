#!/usr/bin/env node
import { execSync } from "child_process";

function run(command, label) {
  process.stdout.write(`\n[review:one-command] ${label}\n`);
  execSync(command, {
    cwd: process.cwd(),
    stdio: "inherit"
  });
}

function main() {
  run("npm run lint", "lint");
  run("npm test", "tests");
  run("npm run review:guard", "pre-review guard");
  run("npm run review:audit-gate", "audit gate");
  process.stdout.write("\n[review:one-command] COMPLETE\n");
}

main();
