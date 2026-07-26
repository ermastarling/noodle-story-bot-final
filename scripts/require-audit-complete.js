#!/usr/bin/env node
import { execSync } from "child_process";

function run(command) {
  return execSync(command, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runJson(command) {
  const out = run(command);
  return JSON.parse(String(out || "{}"));
}

function normalizeVerdict(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";

  const completeLine = text.match(/\b(?:verdict|status)\s*:\s*COMPLETE\b/i);
  if (completeLine) return "COMPLETE";

  const blockedLine = text.match(/\b(?:verdict|status)\s*:\s*BLOCKED\b/i);
  if (blockedLine) return "BLOCKED";

  if (/\bCOMPLETE\b/i.test(text) && !/\bBLOCKED\b/i.test(text)) return "COMPLETE";
  if (/\bBLOCKED\b/i.test(text)) return "BLOCKED";
  return "";
}

function getCurrentPrContext() {
  const pr = runJson("gh pr view --json number");
  const repo = runJson("gh repo view --json owner,name");

  const prNumber = Number(pr?.number);
  const owner = String(repo?.owner?.login || "").trim();
  const name = String(repo?.name || "").trim();

  if (!Number.isFinite(prNumber) || !owner || !name) {
    throw new Error("Unable to resolve current PR context. Ensure this branch has an open PR and gh is authenticated.");
  }

  return { owner, name, prNumber };
}

function readUnresolvedThreadCount({ owner, name, prNumber }) {
  const query = "query($owner:String!,$name:String!,$number:Int!){ repository(owner:$owner,name:$name){ pullRequest(number:$number){ reviewThreads(first:100){ nodes{ isResolved isOutdated } } } } }";
  const out = runJson(`gh api graphql -f query='${query}' -f owner=${owner} -f name=${name} -F number=${prNumber}`);
  const nodes = out?.data?.repository?.pullRequest?.reviewThreads?.nodes;
  if (!Array.isArray(nodes)) return NaN;
  return nodes.filter((node) => !node?.isResolved && !node?.isOutdated).length;
}

function main() {
  let context;
  try {
    context = getCurrentPrContext();
  } catch (error) {
    process.stderr.write(`Audit gate BLOCKED: ${error?.message || error}\n`);
    process.exit(1);
  }

  const unresolved = readUnresolvedThreadCount(context);
  if (!Number.isFinite(unresolved)) {
    process.stderr.write("Audit gate BLOCKED: unable to evaluate unresolved review threads.\n");
    process.exit(1);
  }

  const providedVerdict = String(process.env.NOODLE_AUDIT_VERDICT || "").trim();
  const verdict = normalizeVerdict(providedVerdict);

  if (verdict !== "COMPLETE") {
    process.stderr.write(
      "Audit gate BLOCKED: verdict must be COMPLETE. "
      + "Set NOODLE_AUDIT_VERDICT='COMPLETE' only after running the strict PR auditor.\n"
    );
    process.exit(1);
  }

  if (unresolved > 0) {
    process.stderr.write(`Audit gate BLOCKED: unresolved review threads remain (${unresolved}).\n`);
    process.exit(1);
  }

  process.stdout.write(
    `Audit gate COMPLETE: verdict=COMPLETE and unresolved review threads=0 for PR #${context.prNumber}.\n`
  );
}

main();
