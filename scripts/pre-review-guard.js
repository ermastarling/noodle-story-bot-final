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

function hasV2BuilderOverwritePattern(addedSource = "") {
  if (!addedSource) return false;
  const spreadBuilderPattern = /\.\.\.\s*buildComponentsV2(?:PayloadWithNoticeCards|MenuPayload|NoticeCardPayload|TextPayload)\s*\(/g;
  if (!spreadBuilderPattern.test(addedSource)) return false;

  const lines = addedSource.split("\n");
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (!/\.\.\.\s*buildComponentsV2(?:PayloadWithNoticeCards|MenuPayload|NoticeCardPayload|TextPayload)\s*\(/.test(line)) {
      continue;
    }

    for (let lookahead = idx + 1; lookahead < Math.min(lines.length, idx + 45); lookahead += 1) {
      const next = lines[lookahead];
      if (/^\s*components\s*:/.test(next)) {
        return true;
      }
      if (/^\s*}\s*;?\s*$/.test(next)) {
        break;
      }
    }
  }

  return false;
}

function hasChannelTypeCoercionRisk(addedSource = "") {
  if (!addedSource) return false;
  const lines = addedSource.split("\n");
  for (const line of lines) {
    const numericVoiceCheck = /Number\([^)]*type[^)]*\)\s*===\s*[A-Z0-9_]*VOICE[A-Z0-9_]*/.test(line);
    if (!numericVoiceCheck) continue;

    const hasCompatibilitySignal = /GUILD_VOICE|isGuildVoiceCounterChannelType|toUpperCase\(\)/.test(addedSource);
    if (!hasCompatibilitySignal) {
      return true;
    }
  }
  return false;
}

function extractFunctionBody(source = "", functionName = "") {
  const startPattern = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*{`);
  const match = startPattern.exec(source);
  if (!match) return "";

  const start = match.index + match[0].length;
  let depth = 1;
  for (let idx = start; idx < source.length; idx += 1) {
    const ch = source[idx];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(start, idx);
    }
  }

  return "";
}

function hasConversionShortCircuitRegression(fileContent = "") {
  const body = extractFunctionBody(fileContent, "convertPayloadToComponentsV2");
  if (!body) return false;
  if (!/buildComponentsV2PayloadWithNoticeCards\s*\(/.test(body)) return false;
  return !/isComponentsV2Payload\s*\(\s*payload\s*\)/.test(body);
}

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

// 4) Components V2 contract safety check (PR #169 regression class).
for (const file of changedJs) {
  const added = addedByFile.get(file) || [];
  const joined = added.join("\n");
  if (!joined) continue;
  if (!hasV2BuilderOverwritePattern(joined)) continue;
  errors.push(
    `${file}: avoid overwriting components after spreading a buildComponentsV2* payload. Compose action rows into mainComponents/notices before building the V2 payload.`
  );
}

// 5) Channel-type compatibility safety check (mixed string/numeric runtime support).
for (const file of changedJs) {
  const added = addedByFile.get(file) || [];
  const joined = added.join("\n");
  if (!joined) continue;
  if (!hasChannelTypeCoercionRisk(joined)) continue;
  errors.push(
    `${file}: numeric-only voice channel type checks detected. Include string/numeric compatibility handling (for example via a shared helper).`
  );
}

// 6) Conversion-helper short-circuit safety check (avoid re-wrapping prebuilt V2 payloads).
for (const file of changedJs.filter((f) => f.startsWith("src/commands/") && f.endsWith(".js"))) {
  const added = addedByFile.get(file) || [];
  const joined = added.join("\n");
  if (!joined.includes("convertPayloadToComponentsV2")) continue;

  const content = read(file) || "";
  if (!hasConversionShortCircuitRegression(content)) continue;
  errors.push(
    `${file}: convertPayloadToComponentsV2 must short-circuit prebuilt Components V2 payloads via isComponentsV2Payload(payload).`
  );
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
