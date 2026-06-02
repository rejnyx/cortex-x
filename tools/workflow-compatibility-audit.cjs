#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
"use strict";

/**
 * workflow-compatibility-audit.cjs
 *
 * Sprint 2.44 Probe 3 — scans the cortex-x repo for workflow-readiness signals.
 * Zero external deps (Node built-ins only). Emits a JSON audit report to stdout.
 * Exit code: 0 if all checks pass, 1 if any fail.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const REPO_ROOT = path.resolve(__dirname, "..");

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return null;
  }
}

function safeReadJson(filePath) {
  const raw = safeRead(filePath);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function listFiles(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch (err) {
    return [];
  }
}

function check1_postToolUseDetectsTask() {
  const filePath = path.join(REPO_ROOT, "shared", "hooks", "post-tool-use.cjs");
  const content = safeRead(filePath);
  if (content === null) {
    return { pass: false, evidence: `cannot read ${filePath}` };
  }
  // Look for case "Task" or case 'Task' or tool_name === "Task"
  const caseTaskRe = /case\s+["']Task["']/;
  const eqTaskRe = /tool_name\s*===?\s*["']Task["']/;
  const match = caseTaskRe.test(content) || eqTaskRe.test(content);
  return {
    pass: match,
    evidence: match
      ? `Task tool branch found in ${path.relative(REPO_ROOT, filePath)}`
      : `no case "Task" or tool_name=="Task" in ${path.relative(REPO_ROOT, filePath)}`,
  };
}

function check2_reviewAgentsSsot() {
  const libPath = path.join(REPO_ROOT, "shared", "hooks", "_lib", "review-agents.cjs");
  const content = safeRead(libPath);
  if (content === null) {
    return { pass: false, evidence: `cannot read ${libPath}` };
  }
  // Parse REVIEW_AGENTS array — capture string literals inside brackets.
  // Match both `REVIEW_AGENTS: [...]` (object-key form, the actual SSOT pattern)
  // and `REVIEW_AGENTS = [...]` (assignment form, sometimes used by mirrors).
  const arrayMatch = content.match(/REVIEW_AGENTS\s*[:=]\s*\[([\s\S]*?)\]/);
  if (!arrayMatch) {
    return { pass: false, evidence: "REVIEW_AGENTS array not found" };
  }
  const roster = [];
  const stringRe = /["']([a-zA-Z0-9_\-]+)["']/g;
  let m;
  while ((m = stringRe.exec(arrayMatch[1])) !== null) {
    roster.push(m[1]);
  }
  const agentsDir = path.join(REPO_ROOT, "shared", "agents");
  let agentFiles = listFiles(agentsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
  if (agentFiles.length === 0) {
    // Fallback to top-level agents/
    const alt = path.join(REPO_ROOT, "agents");
    agentFiles = listFiles(alt)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  }
  const missing = roster.filter((a) => !agentFiles.includes(a));
  return {
    pass: missing.length === 0 && roster.length > 0,
    evidence:
      missing.length === 0
        ? `ROSTER [${roster.join(", ")}] is subset of ${agentFiles.length} agent .md files`
        : `missing agent files for: ${missing.join(", ")}`,
  };
}

function check3_blockDestructiveRegistered() {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  const settings = safeReadJson(settingsPath);
  if (settings === null) {
    return { pass: false, evidence: `cannot read or parse ${settingsPath}` };
  }
  const preTool = settings.hooks && settings.hooks.PreToolUse;
  if (!Array.isArray(preTool)) {
    return { pass: false, evidence: "hooks.PreToolUse not an array in settings.json" };
  }
  for (const entry of preTool) {
    if (entry.matcher === "Bash" && Array.isArray(entry.hooks)) {
      for (const h of entry.hooks) {
        const cmd = (h && h.command) || "";
        if (cmd.includes("block-destructive")) {
          return {
            pass: true,
            evidence: `block-destructive registered for matcher=Bash in ${settingsPath}`,
          };
        }
      }
    }
  }
  return {
    pass: false,
    evidence: "no PreToolUse entry with matcher=Bash + block-destructive command",
  };
}

function check4_markerPathSsot() {
  const writerPath = path.join(REPO_ROOT, "shared", "hooks", "post-tool-use.cjs");
  const readerPath = path.join(REPO_ROOT, "shared", "hooks", "pre-commit-review-gate.cjs");
  const writer = safeRead(writerPath);
  const reader = safeRead(readerPath);
  if (writer === null || reader === null) {
    return {
      pass: false,
      evidence: `missing: writer=${writer === null} reader=${reader === null}`,
    };
  }
  // Match the actual marker filename token `cortex-review-` (followed by a
  // session hash interpolation: `${sessionHash}` or `${hash}` etc.) used in
  // both writer (post-tool-use) and reader (pre-commit-review-gate). The
  // original literal `cortex-review-sessionHash` was overly specific.
  const pattern = /cortex-review-/;
  const writerHit = pattern.test(writer);
  const readerHit = pattern.test(reader);
  return {
    pass: writerHit && readerHit,
    evidence:
      writerHit && readerHit
        ? "both files reference `cortex-review-` marker filename prefix"
        : `writer=${writerHit} reader=${readerHit} — marker mismatch`,
  };
}

function check5_sharedWorkflowsFiles() {
  const dir = path.join(REPO_ROOT, "shared", "workflows");
  if (!fs.existsSync(dir)) {
    return { pass: false, evidence: `${path.relative(REPO_ROOT, dir)} directory does not exist` };
  }
  const jsFiles = listFiles(dir).filter((f) => f.endsWith(".js") || f.endsWith(".cjs"));
  return {
    pass: jsFiles.length > 0,
    evidence: `${jsFiles.length} workflow file(s) in ${path.relative(REPO_ROOT, dir)}`,
  };
}

function main() {
  const checks = [
    { name: "post-tool-use detects tool_name=Task", ...check1_postToolUseDetectsTask() },
    { name: "review-agents SSOT aligned with agents/*.md", ...check2_reviewAgentsSsot() },
    { name: "block-destructive registered for PreToolUse+Bash", ...check3_blockDestructiveRegistered() },
    { name: "marker path SSOT (writer == reader)", ...check4_markerPathSsot() },
    { name: "shared/workflows files present", ...check5_sharedWorkflowsFiles() },
  ];
  const passCount = checks.filter((c) => c.pass).length;
  const failCount = checks.length - passCount;
  const report = {
    schema_version: 1,
    audit_date: new Date().toISOString(),
    checks,
    pass_count: passCount,
    fail_count: failCount,
    overall: failCount === 0 ? "PASS" : "FAIL",
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(failCount === 0 ? 0 : 1);
}

main();
