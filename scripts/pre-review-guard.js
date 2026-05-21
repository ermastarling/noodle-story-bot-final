#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execFileSync, execSync } from "child_process";

const cwd = process.cwd();
const args = new Set(process.argv.slice(2));

function safeExec(command) {
  try {
    return execSync(command, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function getChangedFiles() {
  if (args.has("--all")) {
    const all = safeExec("git ls-files");
    return all ? all.split("\n").filter(Boolean) : [];
  }

  const unstaged = safeExec("git diff --name-only --diff-filter=ACMRTUXB");
  const staged = safeExec("git diff --cached --name-only --diff-filter=ACMRTUXB");
  const local = unique([
    ...(unstaged ? unstaged.split("\n").filter(Boolean) : []),
    ...(staged ? staged.split("\n").filter(Boolean) : [])
  ]);
  if (local.length) return local;

  const mergeBase = safeExec("git merge-base HEAD origin/main");
  if (mergeBase) {
    const out = safeExec(`git diff --name-only --diff-filter=ACMRTUXB ${mergeBase}...HEAD`);
    if (out) return out.split("\n").filter(Boolean);
  }

  const fallback = safeExec("git diff --name-only --diff-filter=ACMRTUXB HEAD~1...HEAD");
  return fallback ? fallback.split("\n").filter(Boolean) : [];
}

function getAddedLines(relPath) {
  let diff = "";
  try {
    diff = execFileSync("git", ["diff", "--cached", "--unified=0", "--", relPath], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    try {
      diff = execFileSync("git", ["diff", "--unified=0", "--", relPath], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
    } catch {
      diff = "";
    }
  }
  if (!diff) return [];
  const lines = [];
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+")) continue;
    if (line.startsWith("+++")) continue;
    lines.push(line.slice(1));
  }
  return lines;
}

function read(relPath) {
  const abs = path.join(cwd, relPath);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function unique(arr) {
  return [...new Set(arr)].sort();
}

const changed = getChangedFiles();
const changedJs = changed.filter((f) => /\.(js|mjs|cjs)$/.test(f));
const changedReadable = changed.length ? changed.join(", ") : "(none)";

const errors = [];
const warnings = [];
const addedByFile = new Map(changed.map((f) => [f, getAddedLines(f)]));

if (!changed.length) {
  warnings.push("No changed files detected. Run with --all to scan entire repository.");
}

// 1) Env var docs check (recurring PR feedback in #91/#93/#94).
const envVarPattern = /process\.env\.([A-Z][A-Z0-9_]+)/g;
const envVarBracketPattern = /process\.env\[("|')([A-Z][A-Z0-9_]+)\1\]/g;
const helperEnvVarPattern = /\b(?:parseNumberEnv|parseStringEnv|parseBooleanEnv|readEnv|getEnv|[A-Za-z0-9_]*Env)\(\s*("|')([A-Z][A-Z0-9_]+)\1/g;
const codeEnvVars = new Set();
for (const file of changedJs) {
  const added = addedByFile.get(file) || [];
  const joined = added.join("\n");
  for (const match of joined.matchAll(envVarPattern)) {
    const name = match[1];
    if (name.startsWith("NOODLE_")) codeEnvVars.add(name);
  }
  for (const match of joined.matchAll(envVarBracketPattern)) {
    const name = match[2];
    if (name.startsWith("NOODLE_")) codeEnvVars.add(name);
  }
  for (const match of joined.matchAll(helperEnvVarPattern)) {
    const name = match[2];
    if (name.startsWith("NOODLE_")) codeEnvVars.add(name);
  }
}

const readme = read("README.md") || "";
const undocumentedEnv = unique([...codeEnvVars].filter((name) => !readme.includes(name)));
if (undocumentedEnv.length) {
  errors.push(
    `README.md is missing env var docs: ${undocumentedEnv.join(", ")}`
  );
}

// 2) Stream safety checks (recurring PR feedback in #92/#94).
for (const file of changedJs) {
  const content = read(file);
  if (!content) continue;
  const added = addedByFile.get(file) || [];
  const addedJoined = added.join("\n");

  const streamDecls = [...addedJoined.matchAll(/(?:const|let)?\s*(\w+)\s*=\s*fs\.createWriteStream\(/g)];
  for (const m of streamDecls) {
    const varName = m[1];
    const hasErrorListener = new RegExp(`${varName}\\.on\\(("|')error\\1`).test(content);
    if (!hasErrorListener) {
      errors.push(`${file}: ${varName} is missing an error listener.`);
    }

    const writes = new RegExp(`${varName}\\.write\\(`).test(content);
    if (writes) {
      const hasBackpressureHandling =
        new RegExp(`${varName}\\.on\\(("|')drain\\1`).test(content) ||
        /writableNeedDrain/.test(content) ||
        /needsDrain/.test(content);
      if (!hasBackpressureHandling) {
        errors.push(`${file}: ${varName}.write(...) has no visible backpressure handling.`);
      }
    }
  }
}

// 3) Large-window analyzer safety check (recurring PR feedback in #94).
for (const file of changedJs.filter((f) => f.startsWith("scripts/"))) {
  const added = addedByFile.get(file) || [];
  const joined = added.join("\n");
  const spreadMinMax = [...joined.matchAll(/Math\.(min|max)\(\s*\.\.\.[^)]+\)/g)].map((m) => m[0]);
  if (spreadMinMax.length) {
    errors.push(
      `${file}: avoid spread with Math.min/Math.max on dynamic arrays (${unique(spreadMinMax).join(" | ")}).`
    );
  }
}

if (warnings.length) {
  process.stdout.write(`Pre-review warnings:\n- ${warnings.join("\n- ")}\n`);
}

if (errors.length) {
  process.stderr.write("Pre-review guard failed.\n");
  process.stderr.write(`Changed files: ${changedReadable}\n`);
  process.stderr.write(`- ${errors.join("\n- ")}\n`);
  process.exit(1);
}

process.stdout.write("Pre-review guard passed.\n");
if (changed.length) {
  process.stdout.write(`Scanned changed files: ${changedReadable}\n`);
}
