/**
 * Session Start — Global Hook
 * Auto-detects PROGRESS.md, CLAUDE.md, MEMORY.md in ANY project.
 * Injects sprint state + git context at session start.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

function readFile(fp) {
  try { return fs.readFileSync(path.join(ROOT, fp), 'utf8'); } catch { return null; }
}

function getProjectName() {
  const pkg = readFile('package.json');
  if (pkg) {
    try { return JSON.parse(pkg).name; } catch {}
  }
  return path.basename(ROOT);
}

function getActiveSprint(progress) {
  if (!progress) return { name: null, stories: [], nextStory: null };
  const lines = progress.split('\n');
  const stories = [];
  let inActive = false;
  let sprintName = null;
  let nextStory = null;

  for (const line of lines) {
    // Detect active sprint/phase (### or ####, NOT marked done)
    if (/^#{2,4}\s+.*(Sprint|Fáze|Phase|Milestone|V\d)/i.test(line) && !line.includes('done') && !line.match(/[✅✓☑]/)) {
      if (inActive) break; // only first active
      inActive = true;
      sprintName = line.replace(/^#{2,4}\s+/, '').trim();
    } else if (/^#{2,4}\s+.*(Sprint|Fáze|Phase|Milestone|V\d)/i.test(line) && (line.includes('done') || line.match(/[✅✓☑]/))) {
      inActive = false;
    }

    // Parse story rows in tables or checklists
    if (inActive) {
      if (/^\|/.test(line) && !line.includes('---') && !/Story|Popis|Status|Description/i.test(line)) {
        stories.push(line.trim());
        if (!nextStory && /pending|todo|⬜|planned/i.test(line)) {
          const match = line.match(/\|\s*([\w\d.]+)\s*\|/);
          if (match) nextStory = match[1];
        }
      }
      // Checklist format: - [ ] or - [x]
      if (/^[-*]\s+\[[ x]\]/i.test(line)) {
        stories.push(line.trim());
        if (!nextStory && /\[ \]/.test(line)) {
          nextStory = line.replace(/^[-*]\s+\[ \]\s*/, '').slice(0, 60);
        }
      }
    }
  }
  return { name: sprintName, stories, nextStory };
}

function exec(cmd) {
  try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: 5000 }).trim(); } catch { return null; }
}

// Detect project files
const progress = readFile('PROGRESS.md');
const hasClaude = fs.existsSync(path.join(ROOT, 'CLAUDE.md'));
const hasMemory = fs.existsSync(path.join(ROOT, 'MEMORY.md')) ||
  fs.existsSync(path.join(ROOT, '.claude', 'memory', 'MEMORY.md'));
const recovery = readFile('.claude/compact-state.md');

const { name: sprint, stories, nextStory } = getActiveSprint(progress);
const branch = exec('git branch --show-current');
const commits = exec('git log --oneline -5');
const status = exec('git status --short');

const projectName = getProjectName();

const ctx = [`=== ${projectName} — Session Context ===`];
ctx.push('');

// Sprint tracking
if (sprint) {
  ctx.push(`Active Phase: ${sprint}`);
  if (nextStory) ctx.push(`Next Story: ${nextStory}`);
  if (stories.length > 0) {
    const done = stories.filter(s => /done|✅|✓|☑|\[x\]/i.test(s)).length;
    ctx.push(`Progress: ${done}/${stories.length} stories`);
  }
} else if (progress) {
  ctx.push('PROGRESS.md exists but no active sprint detected');
}

// Git state
if (branch) ctx.push(`\nGit Branch: ${branch}`);
if (commits) {
  ctx.push('Recent commits:');
  commits.split('\n').forEach(c => ctx.push(`  ${c}`));
}
if (status) {
  const files = status.split('\n').length;
  ctx.push(`\nUncommitted changes: ${files} file(s)`);
}

// Available docs
const docs = [];
if (hasClaude) docs.push('CLAUDE.md');
if (progress) docs.push('PROGRESS.md');
if (hasMemory) docs.push('MEMORY.md');
if (recovery) docs.push('.claude/compact-state.md (recovery available)');
if (docs.length > 0) ctx.push(`\nDocs: ${docs.join(', ')}`);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: ctx.join('\n')
  }
}));
