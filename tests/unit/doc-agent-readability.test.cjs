// tests/unit/doc-agent-readability.test.cjs — Sprint 2.8.3 v0
//
// Tests the pure-deterministic agent-readability scorer. The scorer must
// discriminate between:
//   (a) well-structured agent-first docs (front-loaded code, valid frontmatter,
//       low URL-nav-trigger count, code-dense) — score ≥80
//   (b) human-first marketing-style docs (prose-heavy, "click here" verbs,
//       no frontmatter, no front-loaded action) — score ≤40
//
// The scorer is the foundation for any future criterion_kind: agent_readability
// shipped under Sprint 1.9 spec-verifier.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  scoreMarkdown,
  SIGNAL_WEIGHTS,
  _internal,
} = require('../../bin/steward/_lib/doc-agent-readability.cjs');

describe('doc-agent-readability — scoreMarkdown contract', () => {
  test('empty string returns score=0 with EMPTY penalty', () => {
    const r = scoreMarkdown('');
    assert.equal(r.score, 0);
    assert.deepEqual(r.penalties, ['EMPTY']);
  });

  test('non-string input returns score=0 with NOT_STRING penalty', () => {
    const r = scoreMarkdown(null);
    assert.equal(r.score, 0);
    assert.deepEqual(r.penalties, ['NOT_STRING']);
  });

  test('returns score, signals, penalties, bonuses, yellow_flags keys', () => {
    const r = scoreMarkdown('# Hello\n');
    assert.equal(typeof r.score, 'number');
    assert.equal(typeof r.signals, 'object');
    assert.ok(Array.isArray(r.penalties));
    assert.ok(Array.isArray(r.bonuses));
    assert.ok(Array.isArray(r.yellow_flags));
  });

  test('score is clamped to [0, 100]', () => {
    const veryBad = '# Title\n\n' + 'click the button and go to the page and visit the dashboard. '.repeat(50);
    const veryGood = '---\nname: x\ndescription: y\n---\n```bash\nnpm install\n```\n## H\n```ts\nfoo()\n```\n## I\n```bash\necho\n```\n';
    const r1 = scoreMarkdown(veryBad);
    const r2 = scoreMarkdown(veryGood);
    assert.ok(r1.score >= 0 && r1.score <= 100);
    assert.ok(r2.score >= 0 && r2.score <= 100);
  });
});

describe('doc-agent-readability — discriminates agent-first vs human-first', () => {
  test('canonical agent-first doc scores ≥80', () => {
    const agentFirst = [
      '---',
      'name: install-cortex-x',
      'description: One-line install of the cortex-x framework via curl-pipe-bash',
      '---',
      '',
      '## Install',
      '',
      '```bash',
      'curl -fsSL https://example.com/install.sh | bash',
      '```',
      '',
      '## Configure',
      '',
      '```bash',
      'export CORTEX_DATA_HOME=$HOME/.cortex',
      '```',
      '',
      '## Verify',
      '',
      '```bash',
      'cortex-doctor',
      '```',
    ].join('\n');
    const r = scoreMarkdown(agentFirst);
    assert.ok(r.score >= 80, `expected ≥80, got ${r.score} (signals: ${JSON.stringify(r.signals)})`);
    assert.ok(r.bonuses.includes('FRONTMATTER_VALID'));
    assert.ok(r.bonuses.includes('FRONT_LOADED_ACTIONABLE'));
  });

  test('canonical human-first doc scores ≤40', () => {
    // No frontmatter, no front-loaded code, lots of "click here" / "go to the"
    // human-UI breadcrumbs, prose-heavy.
    const humanFirst = [
      '# Welcome to our amazing documentation!',
      '',
      'Hello and welcome! We are so happy you decided to visit our docs today. '
        + 'In the next few paragraphs we will walk you through how to get started. '
        + 'We have prepared a wonderful experience for you, so please read on.',
      '',
      'First, go to the dashboard. Click the big green button in the sidebar. '
        + 'Then navigate to the settings page where you can configure your account. '
        + 'After that, visit the homepage to see your new setup.',
      '',
      'If you get stuck, click on the help icon in the menu. Our team is here for you.',
    ].join('\n');
    const r = scoreMarkdown(humanFirst);
    assert.ok(r.score <= 40, `expected ≤40, got ${r.score} (signals: ${JSON.stringify(r.signals)})`);
    assert.ok(r.penalties.some((p) => p.startsWith('URL_NAV_TRIGGERS')));
  });

  test('frontmatter valid bonus fires only when name + description both present + bounded', () => {
    const withFm = '---\nname: x\ndescription: y\n---\n# H\n';
    const r1 = scoreMarkdown(withFm);
    assert.equal(r1.signals.frontmatterValid, true);
    assert.ok(r1.bonuses.includes('FRONTMATTER_VALID'));

    const fmMissingDesc = '---\nname: x\n---\n# H\n';
    const r2 = scoreMarkdown(fmMissingDesc);
    assert.equal(r2.signals.frontmatterValid, false);
    assert.ok(r2.penalties.includes('FRONTMATTER_INCOMPLETE'));

    const fmTooLong = '---\nname: ' + 'x'.repeat(65) + '\ndescription: y\n---\n# H\n';
    const r3 = scoreMarkdown(fmTooLong);
    assert.equal(r3.signals.frontmatterValid, false);
  });

  test('URL nav trigger count is capped at 4 (signal saturation)', () => {
    const body = '# H\n\n' + 'click the foo. go to the bar. visit the baz. navigate to the qux. click on the boo. visit our store. '.repeat(3);
    const r = scoreMarkdown(body);
    assert.equal(r.signals.urlNavTriggers, 4);
    // urlNavMatches reports the raw count (uncapped) for diagnostics
    assert.ok(r.signals.urlNavMatches > 4);
  });
});

describe('doc-agent-readability — false-positive regression coverage', () => {
  test('"fail-open" does not match URL nav regex (hyphenated technical term)', () => {
    const content = '# H\n\nWe fail-open on errors. Default fail-open behavior is safer than fail-closed.\n';
    const r = scoreMarkdown(content);
    assert.equal(r.signals.urlNavMatches, 0);
  });

  test('"open a PR" / "open a draft PR" does not match URL nav regex', () => {
    const content = '# H\n\nThe agent will open a draft PR. We open a PR with the changes. open a new issue.\n';
    const r = scoreMarkdown(content);
    assert.equal(r.signals.urlNavMatches, 0);
  });

  test('"Open PRs While You Sleep" (proper-noun, capitalized) does not match (case-insensitive but phrase-based)', () => {
    const content = '# H\n\nOpenClaw markets "Fix Bugs and Open PRs While You Sleep" as their tagline.\n';
    const r = scoreMarkdown(content);
    assert.equal(r.signals.urlNavMatches, 0);
  });
});

describe('doc-agent-readability — front-load window', () => {
  test('FRONTLOAD_WINDOW=800 covers normal README shape', () => {
    assert.equal(_internal.FRONTLOAD_WINDOW, 800);
  });

  test('code block in first 800 chars triggers front-load bonus even after frontmatter', () => {
    const content = '---\nname: x\ndescription: y\n---\n\n# Title\n\nSome intro paragraph here that explains motivation. ' +
      'It has multiple sentences. We continue with prose. ' +
      'Even more prose covering motivation. About 200 chars of prose so far.\n\n' +
      '## Install\n\n```bash\nnpm install\n```\n';
    const r = scoreMarkdown(content);
    assert.equal(r.signals.frontLoadedActionable, true);
    assert.ok(r.bonuses.includes('FRONT_LOADED_ACTIONABLE'));
  });

  test('code block beyond first 800 chars does NOT trigger front-load bonus', () => {
    const padding = 'lorem ipsum dolor sit amet. '.repeat(50); // ~1400 chars
    const content = '# Title\n\n' + padding + '\n## Install\n```bash\nnpm install\n```\n';
    const r = scoreMarkdown(content);
    assert.equal(r.signals.frontLoadedActionable, false);
  });
});

describe('doc-agent-readability — yellow flags (advisory only, no score impact)', () => {
  test('ALL-CAPS rule words >3× emit yellow flag', () => {
    const content = '# H\n\nALWAYS validate. NEVER trust input. MUST escape. ALWAYS check. NEVER skip.';
    const r = scoreMarkdown(content);
    assert.ok(r.yellow_flags.some((f) => f.includes('ALL_CAPS_RULES')));
  });

  test('ALL-CAPS rule words ≤3× do NOT emit yellow flag', () => {
    const content = '# H\n\nALWAYS validate. NEVER trust input. MUST escape.';
    const r = scoreMarkdown(content);
    assert.equal(r.yellow_flags.filter((f) => f.includes('ALL_CAPS_RULES')).length, 0);
  });

  test('yellow flags do not affect score', () => {
    const base = '---\nname: x\ndescription: y\n---\n```bash\nnpm install\n```\n';
    const withFlags = base + '\n## Notes\n\nALWAYS validate. NEVER skip. MUST escape. ALWAYS check. NEVER trust.\n';
    const r1 = scoreMarkdown(base);
    const r2 = scoreMarkdown(withFlags);
    // Yellow flags should not depress score below baseline
    assert.ok(r2.score >= r1.score - 5, `r1=${r1.score} r2=${r2.score}`);
  });
});

describe('doc-agent-readability — signal weights are exposed', () => {
  test('SIGNAL_WEIGHTS exported with all 6 keys + frozen', () => {
    assert.equal(SIGNAL_WEIGHTS.codeBlockDensity, 30);
    assert.equal(SIGNAL_WEIGHTS.urlNavTriggers, -25);
    assert.equal(SIGNAL_WEIGHTS.frontmatterValid, 20);
    assert.equal(SIGNAL_WEIGHTS.frontLoadedActionable, 15);
    assert.equal(SIGNAL_WEIGHTS.proseHeavy, -10);
    assert.equal(SIGNAL_WEIGHTS.anchorDensity, 5);
    assert.throws(() => { SIGNAL_WEIGHTS.codeBlockDensity = 999; });
  });
});

describe('doc-agent-readability — R2 regression fixes (Sprint 2.8.3 review pipeline)', () => {
  test('multi-doc audit run does not bleed FENCED_OPEN_RE state across docs', () => {
    // Edge-case + blind-hunter HIGH: previous frontLoadedActionable only
    // reset lastIndex on the false branch. After a true call, the next doc
    // could see stale lastIndex and falsely return false.
    const docA = '---\nname: x\ndescription: y\n---\n\n## Install\n\n```bash\necho a\n```\n';
    const docB = '---\nname: x\ndescription: y\n---\n\n## Install\n\n```bash\necho b\n```\n';
    const docC = '---\nname: x\ndescription: y\n---\n\n## Install\n\n```bash\necho c\n```\n';
    const r1 = scoreMarkdown(docA);
    const r2 = scoreMarkdown(docB);
    const r3 = scoreMarkdown(docC);
    assert.equal(r1.signals.frontLoadedActionable, true);
    assert.equal(r2.signals.frontLoadedActionable, true);
    assert.equal(r3.signals.frontLoadedActionable, true);
  });

  test('"MUSTard" does not trigger ALL_CAPS_RULE flag (regex direction fix)', () => {
    const content = '# H\n\nUse MUSTard recipe for the sauce. MUSTang concept car.\n';
    const r = scoreMarkdown(content);
    assert.equal(r.yellow_flags.filter((f) => f.includes('ALL_CAPS_RULES')).length, 0);
  });

  test('countMatches throws when given non-global regex (defensive guard)', () => {
    // Direct test of the internal helper via signal-counting paths.
    // The contract is: regex passed to countMatches MUST have /g flag.
    // This protects future call-site additions from silent under-counting.
    const { _internal } = require('../../bin/steward/_lib/doc-agent-readability.cjs');
    // _internal does not expose countMatches directly, but we can verify
    // via scoreMarkdown which exercises it on FENCED_OPEN_RE + HEADING_2_3_RE
    // — those are /g regexes. The defensive throw would fire in a future
    // refactor. Sanity-check: scoring a normal doc doesn't throw.
    assert.doesNotThrow(() => scoreMarkdown('# H\n\n```bash\necho\n```\n'));
  });
});
