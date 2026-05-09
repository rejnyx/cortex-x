'use strict';

// Sprint 2.10 — qa-retrofit prompt + skill + profile + templates structure tests.
// Validates the artifacts shipped this sprint exist, are well-formed, and reference
// each other consistently. This test is a structure gate, not a behavior test —
// the prompt itself is executed by Claude Code, not unit-tested in CI.
//
// Per cortex-x convention: zero deps, node:test, hand-rolled assertions.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function read(p) {
  return fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
}

function exists(p) {
  return fs.existsSync(path.join(REPO_ROOT, p));
}

describe('Sprint 2.10 — qa-retrofit artifacts exist', () => {
  test('prompts/qa-retrofit.md exists', () => {
    assert.equal(exists('prompts/qa-retrofit.md'), true);
  });

  test('profiles/qa-engineer.yaml exists', () => {
    assert.equal(exists('profiles/qa-engineer.yaml'), true);
  });

  test('templates/testing-strategy.md.hbs exists', () => {
    assert.equal(exists('templates/testing-strategy.md.hbs'), true);
  });

  test('templates/testing-gaps.md.hbs exists', () => {
    assert.equal(exists('templates/testing-gaps.md.hbs'), true);
  });

  test('shared/skills/test-audit/SKILL.md exists', () => {
    assert.equal(exists('shared/skills/test-audit/SKILL.md'), true);
  });

  test('docs/research/sprint-2.10-qa-retrofit-2026-05-09.md (R1 memo) exists', () => {
    assert.equal(exists('docs/research/sprint-2.10-qa-retrofit-2026-05-09.md'), true);
  });
});

describe('Sprint 2.10 — qa-retrofit prompt has all 7 phases', () => {
  const promptText = read('prompts/qa-retrofit.md');

  test('phase 0 (detect)', () => {
    assert.match(promptText, /## Phase 0 — Detect/);
  });

  test('phase 1 (test inventory)', () => {
    assert.match(promptText, /## Phase 1 — Test inventory/);
  });

  test('phase 2 (4 parallel agents quality-model audit)', () => {
    assert.match(promptText, /## Phase 2 — Quality-model audit/);
    assert.match(promptText, /Agent A/);
    assert.match(promptText, /Agent B/);
    assert.match(promptText, /Agent C/);
    assert.match(promptText, /Agent D/);
  });

  test('phase 3 (human gate, 5 questions)', () => {
    assert.match(promptText, /## Phase 3 — Human gate/);
    assert.match(promptText, /### Q1/);
    assert.match(promptText, /### Q5/);
  });

  test('phase 4 (auto-research, QA-specific concerns)', () => {
    assert.match(promptText, /## Phase 4 — Auto-research/);
    assert.match(promptText, /e2e-strategy/);
    assert.match(promptText, /mutation-fitness/);
  });

  test('phase 5 (synthesis)', () => {
    assert.match(promptText, /## Phase 5 — Synthesis/);
    assert.match(promptText, /testing-strategy\.md/);
    assert.match(promptText, /testing-gaps\.md/);
  });

  test('phase 6 (sample-test seeding, opt-in)', () => {
    assert.match(promptText, /## Phase 6 — Sample-test seeding \(OPT-IN/);
    assert.match(promptText, /--seed-tests/);
  });

  test('phase 5e (auto-research-nudge pattern, Sprint 2.10.1)', () => {
    assert.match(promptText, /Phase 5e — Auto-research-nudge/);
    assert.match(promptText, /Research nudge:/);
  });

  test('phase 5f (auto-research-PER-GAP, Sprint 2.10.3, qa-tester profile)', () => {
    assert.match(promptText, /Phase 5f — Auto-research-PER-GAP/);
    assert.match(promptText, /Cap at 15 gaps/);
    assert.match(promptText, /Privacy note/);
    assert.match(promptText, /junior tester/i);
  });

  test('phase 4 references DevOps/CI concerns (Sprint 2.10.1)', () => {
    assert.match(promptText, /ci-pipeline-testing/);
    assert.match(promptText, /container-security/);
    assert.match(promptText, /deploy-safety/);
    assert.match(promptText, /secret-supply-chain/);
    assert.match(promptText, /iac-testing/);
  });

  test('phase 7 (final on_complete)', () => {
    assert.match(promptText, /## Phase 7 — Final on_complete/);
  });
});

describe('Sprint 2.10 — qa-retrofit grounded references', () => {
  const promptText = read('prompts/qa-retrofit.md');

  test('references ISO 25010:2023 (9 chars, includes Safety)', () => {
    assert.match(promptText, /ISO\/IEC 25010:2023/);
  });

  test('references Bach HTSM SFDPOT methodology', () => {
    assert.match(promptText, /SFDPOT/);
    assert.match(promptText, /Heuristic Test Strategy Model|HTSM/);
  });

  test('references tsDetect 5-detector starter (Assertion Roulette etc.)', () => {
    assert.match(promptText, /Assertion Roulette/);
    assert.match(promptText, /Eager Test/);
    assert.match(promptText, /tsDetect/);
  });

  test('references OWASP ASVS 5.0 for security testing', () => {
    assert.match(promptText, /OWASP ASVS/);
  });

  test('declares AI-augmented-tester philosophy explicitly (not replacement)', () => {
    assert.match(promptText, /AI-augmented tester/);
    assert.match(promptText, /not.*replacement|amplifies/i);
  });
});

describe('Sprint 2.10 — qa-engineer profile structure', () => {
  const profileText = read('profiles/qa-engineer.yaml');

  test('declares risk-tiered quality gates', () => {
    assert.match(profileText, /high_risk_modules/);
    assert.match(profileText, /mid_risk_modules/);
    assert.match(profileText, /low_risk_modules/);
  });

  test('declares mutation_score thresholds', () => {
    assert.match(profileText, /mutation_score:\s*75/);
    assert.match(profileText, /mutation_score:\s*60/);
  });

  test('declares CI gating philosophy', () => {
    assert.match(profileText, /ci_gates/);
    assert.match(profileText, /block_on_red/);
    assert.match(profileText, /soft_block/);
  });

  test('declares 10 QA-specific concerns + 5 DevOps/CI quality concerns (Sprint 2.10.1)', () => {
    assert.match(profileText, /qa_concerns/);
    // Testing concerns
    assert.match(profileText, /e2e-strategy/);
    assert.match(profileText, /mutation-fitness/);
    assert.match(profileText, /security-testing/);
    assert.match(profileText, /a11y-testing/);
    assert.match(profileText, /risk-based-prioritization/);
    // DevOps/CI concerns (Sprint 2.10.1 expansion)
    assert.match(profileText, /ci-pipeline-testing/);
    assert.match(profileText, /iac-testing/);
    assert.match(profileText, /container-security/);
    assert.match(profileText, /deploy-safety/);
    assert.match(profileText, /secret-supply-chain/);
  });

  test('declares auto_research_nudge pattern (Sprint 2.10.1)', () => {
    assert.match(profileText, /auto_research_nudge/);
    assert.match(profileText, /enabled: true/);
    assert.match(profileText, /skip_for_trivial: true/);
  });

  test('declares auto_research_per_gap pattern (Sprint 2.10.3, junior-tester focused)', () => {
    assert.match(profileText, /auto_research_per_gap/);
    assert.match(profileText, /max_gaps:\s*15/);
    assert.match(profileText, /parallel_waves:\s*5/);
    assert.match(profileText, /apply_to:\s*\[P0,\s*P1\]/);
    assert.match(profileText, /flat_subscription_safe:\s*true/);
    assert.match(profileText, /hard_stop_at_gap_count:\s*15/);
  });

  test('grounded in ISO 25010:2023 + ASVS 5.0 + HTSM + tsDetect', () => {
    assert.match(profileText, /ISO\/IEC 25010:2023/);
    assert.match(profileText, /OWASP ASVS 5\.0/);
    assert.match(profileText, /Heuristic Test Strategy Model/);
    assert.match(profileText, /tsDetect/);
  });
});

describe('Sprint 2.10 — testing-strategy template hbs slots', () => {
  const templateText = read('templates/testing-strategy.md.hbs');

  test('has frontmatter with slug + date + based_on chain', () => {
    assert.match(templateText, /^---\nphase: 5-qa-strategy/);
    assert.match(templateText, /\{\{slug\}\}/);
    assert.match(templateText, /\{\{date\}\}/);
    assert.match(templateText, /based_on:/);
  });

  test('has pyramid plan slots (now / 3mo / 12mo)', () => {
    assert.match(templateText, /\{\{unitNow\}\}/);
    assert.match(templateText, /\{\{unit3mo\}\}/);
    assert.match(templateText, /\{\{unit12mo\}\}/);
  });

  test('has tool decision slots with research+src citations', () => {
    assert.match(templateText, /\{\{e2eTool\}\}/);
    assert.match(templateText, /\{\{mutTool\}\}/);
    assert.match(templateText, /\[research:/);
    assert.match(templateText, /\[src:/);
  });

  test('has 9 ISO 25010:2023 char target slots', () => {
    assert.match(templateText, /\{\{funcTarget\}\}/);
    assert.match(templateText, /\{\{perfTarget\}\}/);
    assert.match(templateText, /\{\{secTarget\}\}/);
    assert.match(templateText, /\{\{safetyTarget\}\}/);
  });
});

describe('Sprint 2.10 — testing-gaps template hbs slots', () => {
  const templateText = read('templates/testing-gaps.md.hbs');

  test('has frontmatter with phase 5-qa-gaps', () => {
    assert.match(templateText, /phase: 5-qa-gaps/);
  });

  test('has P0 / P1 / P2 backlog sections', () => {
    assert.match(templateText, /## P0 — block-release-worthy/);
    assert.match(templateText, /## P1 — sprint-worthy/);
    assert.match(templateText, /## P2 — backlog/);
  });

  test('has SKIP and OPEN QUESTIONS sections', () => {
    assert.match(templateText, /## SKIP/);
    assert.match(templateText, /## OPEN QUESTIONS/);
  });

  test('has off-limits zones (Phase 3 Q4) section', () => {
    assert.match(templateText, /## Off-limits zones \(Phase 3 Q4\)/);
  });

  test('every gap slot has audit + src + research citation tags', () => {
    // Mandatory 3-hop traceability per cortex-x synthesizer rules.
    assert.match(templateText, /\[audit: §/);
    assert.match(templateText, /\[src:/);
    assert.match(templateText, /\[research:/);
  });
});

describe('Sprint 2.10 — test-audit skill cross-references', () => {
  const skillText = read('shared/skills/test-audit/SKILL.md');

  test('declares name=test-audit + non-empty description', () => {
    assert.match(skillText, /^---\nname: test-audit/);
    assert.match(skillText, /description: .{50,}/);
  });

  test('references qa-retrofit prompt path', () => {
    assert.match(skillText, /qa-retrofit\.md/);
  });

  test('disambiguates from /audit + /start + /scan siblings', () => {
    assert.match(skillText, /Don't confuse with/);
    assert.match(skillText, /\/audit/);
    assert.match(skillText, /\/start/);
    assert.match(skillText, /\/scan/);
  });

  test('declares the AI-augmented-tester philosophy', () => {
    assert.match(skillText, /AI-augmented tester/);
  });
});

describe('Sprint 2.10 — planner agent QA concern override', () => {
  const plannerText = read('agents/planner.md');

  test('documents qa-engineer profile override', () => {
    assert.match(plannerText, /qa-engineer.*profile/);
  });

  test('declares the 10 QA-specific concerns', () => {
    assert.match(plannerText, /e2e-strategy/);
    assert.match(plannerText, /mutation-fitness/);
    assert.match(plannerText, /security-testing/);
    assert.match(plannerText, /risk-based-prioritization/);
  });

  test('declares topic naming convention with -qa- infix', () => {
    assert.match(plannerText, /\{stack-or-profile\}-qa-\{concern\}-\{year\}/);
  });
});

describe('Sprint 2.10.2 — installer profile selection (--profile=qa-tester)', () => {
  const installSh = read('install.sh');
  const installPs1 = read('install.ps1');

  test('install.sh accepts --profile=<name> CLI arg', () => {
    assert.match(installSh, /--profile=\*/);
    assert.match(installSh, /CORTEX_PROFILE=/);
  });

  test('install.sh has interactive profile prompt (TTY-gated)', () => {
    assert.match(installSh, /Which role best describes you\?/);
    assert.match(installSh, /qa-tester.*QA engineer/i);
    assert.match(installSh, /ai-engineer/);
    assert.match(installSh, /minimal/);
  });

  test('install.sh validates known profiles + falls back to dev', () => {
    assert.match(installSh, /dev\|qa-tester\|ai-engineer\|minimal/);
    assert.match(installSh, /falling back to 'dev'/);
  });

  test('install.sh installs /test-audit user-skill when profile=qa-tester', () => {
    assert.match(installSh, /CORTEX_PROFILE.*=.*"qa-tester"/);
    assert.match(installSh, /skills\/test-audit/);
    assert.match(installSh, /shared\/skills\/test-audit\/SKILL\.md/);
  });

  test('install.sh writes profile to user.yaml', () => {
    assert.match(installSh, /profile:\s*\$CORTEX_PROFILE/);
  });

  test('install.sh banner is profile-aware (qa-tester recommends /test-audit)', () => {
    assert.match(installSh, /Next step \(QA tester\)/);
    assert.match(installSh, /\/test-audit/);
    assert.match(installSh, /qa-engineer.*profiles/);
  });

  test('install.ps1 mirrors --profile + interactive prompt + qa-tester install', () => {
    assert.match(installPs1, /\$Profile\s*=/);
    assert.match(installPs1, /Which role best describes you\?/);
    assert.match(installPs1, /qa-tester.*QA engineer/i);
    assert.match(installPs1, /\$Profile\s+-eq\s+"qa-tester"/);
    assert.match(installPs1, /skills\/test-audit/);
  });

  test('install.ps1 writes profile to user.yaml + has profile-aware banner', () => {
    assert.match(installPs1, /profile:\s*\$Profile/);
    assert.match(installPs1, /"qa-tester"\s*\{/);
    assert.match(installPs1, /\/test-audit/);
  });
});

describe('Sprint 2.10 — R1 memo three-hop traceability', () => {
  const memoText = read('docs/research/sprint-2.10-qa-retrofit-2026-05-09.md');

  test('has frontmatter with sprint=2.10 + status=R1', () => {
    assert.match(memoText, /sprint: 2\.10/);
    assert.match(memoText, /status: R1/);
  });

  test('has acceptance criteria section', () => {
    assert.match(memoText, /## Acceptance criteria/);
  });

  test('has out-of-scope section (explicit non-goals)', () => {
    assert.match(memoText, /## Out of scope/);
  });

  test('has risks + mitigations section', () => {
    assert.match(memoText, /## Risks \+ mitigations/);
  });

  test('cites at least 30 sources', () => {
    // Sources are numbered [1] through [N] in the bibliography section.
    const matches = memoText.match(/^\[\d+\] https?:\/\//gm) || [];
    assert.ok(matches.length >= 30, `expected at least 30 cited URLs, got ${matches.length}`);
  });

  test('references the 4 raw research caches in c:\\tmp', () => {
    assert.match(memoText, /qa-research-1-ai-augmented/);
    assert.match(memoText, /qa-research-2-ecommerce/);
    assert.match(memoText, /qa-research-3-deep-audit/);
    assert.match(memoText, /qa-research-4-admin-security/);
  });
});
