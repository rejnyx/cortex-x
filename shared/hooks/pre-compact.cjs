/**
 * Pre-Compact — Global Hook
 * Saves sprint state before context compaction for recovery.
 * Works in ANY project with PROGRESS.md.
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const STATE_FILE = path.join(ROOT, '.claude', 'compact-state.md');

function readFile(fp) {
  try { return fs.readFileSync(path.join(ROOT, fp), 'utf8'); } catch { return null; }
}

function extractActiveStories(progress) {
  if (!progress) return { sprint: null, stories: [] };
  const lines = progress.split('\n');
  const stories = [];
  let inActive = false;
  let sprint = null;

  for (const line of lines) {
    if (/^#{2,4}\s+.*(Sprint|Fáze|Phase|Milestone|V\d)/i.test(line) && !line.match(/[✅✓☑]/) && !line.includes('done')) {
      if (inActive) break;
      inActive = true;
      sprint = line.replace(/^#{2,4}\s+/, '').trim();
    } else if (/^#{2,4}\s+.*(Sprint|Fáze|Phase|Milestone|V\d)/i.test(line) && (line.match(/[✅✓☑]/) || line.includes('done'))) {
      inActive = false;
    }
    if (inActive && /^\|/.test(line) && !line.includes('---') && !/Story|Popis|Status/i.test(line)) {
      stories.push(line.trim());
    }
    if (inActive && /^[-*]\s+\[[ x]\]/i.test(line)) {
      stories.push(line.trim());
    }
  }
  return { sprint, stories };
}

const projectName = path.basename(ROOT);
const progress = readFile('PROGRESS.md');
const { sprint, stories } = extractActiveStories(progress);

console.log('=== PRE-COMPACT STATE ===');
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Project: ${projectName}`);
if (sprint) {
  const done = stories.filter(s => /done|✅|✓|☑|\[x\]/i.test(s)).length;
  console.log(`\nActive Phase: ${sprint}`);
  console.log(`Progress: ${done}/${stories.length} stories`);
}

// Build recovery file
const hasClaude = fs.existsSync(path.join(ROOT, 'CLAUDE.md'));
const state = [
  '# Compact Recovery State',
  `> Auto-generated at ${new Date().toISOString()}`,
  `> Project: ${projectName}`,
  '',
  '## Resume Instructions',
  'After compaction, read PROGRESS.md to find where you left off.',
  hasClaude ? 'Read CLAUDE.md for project context.' : '',
  '',
  '## Active Phase',
  sprint || 'None detected',
  '',
  '## Stories',
  stories.length > 0 ? stories.join('\n') : 'None in progress',
].filter(Boolean).join('\n');

try {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, state);
  console.log(`\nRecovery state saved to: .claude/compact-state.md`);
} catch (e) { console.log(`\nFailed to save state: ${e.message}`); }
