#!/usr/bin/env node
import fs from "fs";
import { execSync } from "child_process";

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checked(body, snippet) {
  const re = new RegExp(`-\\s*\\[[xX]\\]\\s*[^\\n]*${esc(snippet)}`, "i");
  return re.test(body);
}

function validate(body) {
  const errors = [];

  const targetDevelop = checked(body, "Target is develop");
  const targetMain = checked(body, "Target is main");

  if (targetDevelop && targetMain) {
    errors.push("Choose only one target branch checkbox (develop or main).");
  } else if (!targetDevelop && !targetMain) {
    errors.push("Select a target branch checkbox (develop or main).");
  }

  const commonRequired = [
    "This PR contains one focused change only",
    "Branch was started/synced from the correct upstream target",
    "I reviewed staged changes before commit",
    "Each commit is a logical unit with a clear conventional message",
    "I checked branch divergence",
    "I cleaned up commit history"
  ];

  for (const item of commonRequired) {
    if (!checked(body, item)) errors.push(`Missing required checklist item: ${item}`);
  }

  if (targetDevelop) {
    const developRequired = [
      "I rebased this branch on latest origin/develop",
      "This PR is intended for integration/QA testing",
      "Any release notes or rollout impact are captured for later promotion to main"
    ];
    for (const item of developRequired) {
      if (!checked(body, item)) errors.push(`Missing develop-target item: ${item}`);
    }
  }

  if (targetMain) {
    const mainRequired = [
      "I rebased this branch on latest origin/main",
      "This change is release-ready and already validated at appropriate level",
      "Merge plan keeps main history clean"
    ];
    for (const item of mainRequired) {
      if (!checked(body, item)) errors.push(`Missing main-target item: ${item}`);
    }
  }

  return errors;
}

function readCurrentPrBody() {
  try {
    const out = execSync("gh pr view --json body --jq .body", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return out;
  } catch {
    throw new Error(
      "Unable to read current PR body. Ensure gh is installed and authenticated, and that this branch has an open PR. "
      + "Alternatively run with --body-file <path>."
    );
  }
}

function parseArgs(argv) {
  const out = { bodyFile: null, currentPr: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--body-file") {
      out.bodyFile = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === "--current-pr") {
      out.currentPr = true;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  let body = "";

  try {
    if (args.bodyFile) {
      body = fs.readFileSync(args.bodyFile, "utf8");
    } else if (args.currentPr) {
      body = readCurrentPrBody();
    } else {
      process.stderr.write("Usage: node scripts/validate-pr-checklist.js --current-pr OR --body-file <path>\n");
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exit(2);
  }

  const errors = validate(body || "");
  if (errors.length) {
    process.stderr.write("PR checklist validation failed:\n");
    for (const err of errors) process.stderr.write(`- ${err}\n`);
    process.exit(1);
  }

  process.stdout.write("PR checklist validation passed.\n");
}

main();
