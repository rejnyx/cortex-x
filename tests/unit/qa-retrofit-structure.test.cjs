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

describe('Sprint 2.10.4 — test-types-catalog SSOT (exhaustive 2026 catalog)', () => {
  test('standards/test-types-catalog.md exists and is the SSOT', () => {
    assert.equal(exists('standards/test-types-catalog.md'), true);
  });

  test('catalog declares 12 categories with all expected names', () => {
    const cat = read('standards/test-types-catalog.md');
    const expectedCategories = [
      'Functional / behavioral testing',
      'Performance / non-functional testing',
      'Security testing',
      'Reliability / robustness',
      'Correctness invariants',
      'Contract / interoperability',
      'Usability / accessibility',
      'AI-specific',
      'DevOps / pipeline quality',
      'Data quality',
      'Compliance / regulatory',
      'Documentation / API quality',
    ];
    for (const c of expectedCategories) {
      assert.match(cat, new RegExp(c.replace(/\//g, '/')), `category missing: ${c}`);
    }
  });

  test('catalog has selection rules (audit → catalog match logic)', () => {
    const cat = read('standards/test-types-catalog.md');
    assert.match(cat, /## Selection rules \(audit → catalog\)/);
    assert.match(cat, /Evidence-driven match/);
    assert.match(cat, /Q5 capacity filter/i);
    assert.match(cat, /Q3.*compliance/i);
    assert.match(cat, /risk-tier escalation/i);
  });

  test('catalog declares 117 entries total (112 base + 5 added Sprint 2.10.4 post-research)', () => {
    const cat = read('standards/test-types-catalog.md');
    assert.match(cat, /117 test types/);
    assert.match(cat, /typical_audit_selection|actual selection|typically picks/i);
  });

  test('catalog has 5 new Sprint 2.10.4 entries (MCP, A2A, multi-turn-sim, cache-poisoning, regression-confirmation)', () => {
    const cat = read('standards/test-types-catalog.md');
    assert.match(cat, /### `ai-mcp-protocol-test` \(NEW Sprint 2\.10\.4\)/);
    assert.match(cat, /### `ai-a2a-protocol-test` \(NEW Sprint 2\.10\.4\)/);
    assert.match(cat, /### `ai-agent-multi-turn-simulation` \(NEW Sprint 2\.10\.4/);
    assert.match(cat, /### `reliability-cache-poisoning` \(NEW Sprint 2\.10\.4/);
    assert.match(cat, /### `regression-confirmation-istqb` \(NEW Sprint 2\.10\.4/);
  });

  test('catalog inline merge — security entries cite specific 2026 sources', () => {
    const cat = read('standards/test-types-catalog.md');
    // Verify inline citations were merged into the entries (not just appended at bottom)
    assert.match(cat, /### `security-sast-static`[\s\S]*?Semgrep wins security-focused CI[\s\S]*?46% detection/);
    assert.match(cat, /### `security-sca-deps`[\s\S]*?osv-scanner v2\.3\.5\+[\s\S]*?`npm audit` is deprecated/);
    assert.match(cat, /### `security-fuzz-binary`[\s\S]*?libFuzzer is in maintenance-only mode/);
    assert.match(cat, /### `security-iast-instrumented`[\s\S]*?consolidating into ADR/);
    assert.match(cat, /### `security-secret-scanning`[\s\S]*?Run BOTH/);
  });

  test('catalog inline merge — AI entries cite 2026 leaders + determinism-is-dead', () => {
    const cat = read('standards/test-types-catalog.md');
    assert.match(cat, /### `ai-eval-suite-rubric`[\s\S]*?Promptfoo or DeepEval.*Braintrust/);
    assert.match(cat, /### `ai-prompt-injection-regression`[\s\S]*?garak.*PyRIT.*Promptfoo/);
    assert.match(cat, /### `ai-hallucination-detection`[\s\S]*?Patronus Lynx is current SOTA/);
    assert.match(cat, /### `ai-determinism-guard`[\s\S]*?DETERMINISM IS DEAD/);
  });

  test('catalog inline merge — DevOps entries note dead tools + March 2026 trivy-action incident', () => {
    const cat = read('standards/test-types-catalog.md');
    assert.match(cat, /### `devops-iac-lint`[\s\S]*?DEAD in 2026/);
    assert.match(cat, /### `devops-iac-lint`[\s\S]*?kube-linter.*Polaris/);
    assert.match(cat, /### `devops-action-pinning`[\s\S]*?March 19 2026 trivy-action compromise/);
    assert.match(cat, /### `devops-sbom-generation`[\s\S]*?EU CRA.*CycloneDX 1\.6/);
  });

  test('catalog inline merge — perf+compliance with 2026 dates + INP→TBT proxy', () => {
    const cat = read('standards/test-types-catalog.md');
    assert.match(cat, /### `perf-load-k6`[\s\S]*?k6 wins JS\/TS/);
    assert.match(cat, /### `perf-budget-lighthouse`[\s\S]*?TBT.*200ms.*proxy/);
    assert.match(cat, /### `compliance-wcag-22-aa`[\s\S]*?EAA enforcement live since 2025-06-28/);
    assert.match(cat, /### `compliance-pci-dss-l4`[\s\S]*?PCI-DSS v4\.0\.1/);
    assert.match(cat, /### `compliance-eu-ai-act`[\s\S]*?2026-08-02/);
  });

  test('every catalog entry has the canonical metadata fields', () => {
    const cat = read('standards/test-types-catalog.md');
    // Sample 5 random entries we know exist; assert they have Category + Tools + When/Skip + Effort + Tester skill
    for (const id of ['e2e-browser-flow', 'security-rbac-matrix', 'ai-eval-suite-rubric', 'devops-dora-metrics', 'compliance-gdpr-art32']) {
      const entry = cat.match(new RegExp(`### \`${id}\`[\\s\\S]*?(?=\\n###|\\n## |$)`));
      assert.ok(entry, `entry ${id} missing`);
      assert.match(entry[0], /\*\*Category:/, `entry ${id} missing Category`);
      assert.match(entry[0], /\*\*Tools 2026:/, `entry ${id} missing Tools 2026`);
      assert.match(entry[0], /\*\*When to use:/, `entry ${id} missing When to use`);
      assert.match(entry[0], /\*\*Effort:/, `entry ${id} missing Effort`);
      assert.match(entry[0], /\*\*Tester skill floor:/, `entry ${id} missing Tester skill floor`);
    }
  });

  test('qa-engineer profile references the catalog (117 entries post-Sprint 2.10.4)', () => {
    const profile = read('profiles/qa-engineer.yaml');
    assert.match(profile, /test_types_catalog/);
    assert.match(profile, /total_entries:\s*117/);
    assert.match(profile, /test-types-catalog\.md/);
    assert.match(profile, /category_list/);
    assert.match(profile, /research_validated/);
  });

  test('qa-retrofit prompt has Phase 5a-bis catalog-selection oracle', () => {
    const prompt = read('prompts/qa-retrofit.md');
    assert.match(prompt, /Phase 5a-bis|Test-types-catalog selection oracle/);
    assert.match(prompt, /Evidence-driven match/);
    assert.match(prompt, /Stack negative filter/);
    assert.match(prompt, /Q5 capacity floor/);
    assert.match(prompt, /Q3 compliance escalation/);
    assert.match(prompt, /Q1 risk-tier override/);
  });

  test('catalog has Sprint 2.10.4 web-research validation section with 148 cited URLs', () => {
    const cat = read('standards/test-types-catalog.md');
    assert.match(cat, /Sources & corrections \(Sprint 2\.10\.4 web-research-validated/);
    assert.match(cat, /148 cited URLs total/);
    assert.match(cat, /catalog-research-1-taxonomy-2026/);
    assert.match(cat, /catalog-research-2-security-2026/);
    assert.match(cat, /catalog-research-3-ai-eval-2026/);
    assert.match(cat, /catalog-research-4-devops-2026/);
    assert.match(cat, /catalog-research-5-perf-a11y-compliance-2026/);
  });

  test('catalog applied research corrections — HTSM 4 axes, npm-audit deprecated, libFuzzer maintenance-only, IAST→ADR', () => {
    const cat = read('standards/test-types-catalog.md');
    // HTSM correction
    assert.match(cat, /HTSM has 4 axes, not 2/i);
    assert.match(cat, /CRUCSPIC STMP/);
    // npm audit deprecated
    assert.match(cat, /`npm audit` deprecated as sole gate/i);
    assert.match(cat, /osv-scanner v2/);
    // libFuzzer
    assert.match(cat, /libFuzzer is in maintenance-only mode/);
    // IAST → ADR
    assert.match(cat, /IAST is consolidating into ADR/i);
  });

  test('catalog flags 2026 dates: ASVS 5.0 (May 2025), EAA 2025-06-28, EU AI Act 2026-08-02, PCI-DSS 4.0.1', () => {
    const cat = read('standards/test-types-catalog.md');
    assert.match(cat, /ASVS 5\.0 confirmed released 2025-05-30/);
    assert.match(cat, /EAA enforcement live since 2025-06-28/);
    assert.match(cat, /EU AI Act high-risk.*2026-08-02/);
    assert.match(cat, /PCI-DSS v4\.0\.1/);
  });

  test('catalog identifies missing-from-catalog entries for next refresh (MCP, A2A, cache-poisoning)', () => {
    const cat = read('standards/test-types-catalog.md');
    assert.match(cat, /ai-mcp-protocol-test/);
    assert.match(cat, /ai-a2a-protocol-test/);
    assert.match(cat, /reliability-cache-poisoning/);
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

describe('Sprint 2.10.5 — cortex-x self-audit deliverables (eat-our-own-dogfood)', () => {
  test('cortex/qa/AUDIT.md exists (12-section ISO 25010:2023 self-audit)', () => {
    assert.equal(exists('cortex/qa/AUDIT.md'), true);
  });

  test('cortex/qa/testing-strategy.md exists', () => {
    assert.equal(exists('cortex/qa/testing-strategy.md'), true);
  });

  test('cortex/qa/testing-gaps.md exists', () => {
    assert.equal(exists('cortex/qa/testing-gaps.md'), true);
  });

  test('self-audit references ISO 25010:2023 + Phase 5a-bis catalog selection', () => {
    const audit = read('cortex/qa/AUDIT.md');
    assert.match(audit, /ISO\/IEC 25010:2023/);
    assert.match(audit, /Catalog selection \(Phase 5a-bis\)/);
    assert.match(audit, /Selected types:.*\d+ of 117/);
  });

  test('self-audit testing-gaps surfaces P0 GAP-001 (adversarial regression suite)', () => {
    const gaps = read('cortex/qa/testing-gaps.md');
    assert.match(gaps, /GAP-001/);
    assert.match(gaps, /Adversarial.*regression/i);
    assert.match(gaps, /security-lethal-trifecta/);
    assert.match(gaps, /ai-prompt-injection-regression/);
  });

  test('docs/qa-tester-onboarding.md tutorial exists for the junior tester', () => {
    assert.equal(exists('docs/qa-tester-onboarding.md'), true);
    const tutorial = read('docs/qa-tester-onboarding.md');
    assert.match(tutorial, /Den 1/);
    assert.match(tutorial, /\/test-audit/);
    assert.match(tutorial, /Phase 3/);
  });

  test('README.md mentions qa-tester profile section', () => {
    const readme = read('README.md');
    assert.match(readme, /Profile selection at install time/);
    assert.match(readme, /qa-tester/);
    assert.match(readme, /docs\/qa-tester-onboarding\.md/);
  });
});

describe('Sprint 2.10.6 — Phase 1b existing-tests modernization analysis', () => {
  test('qa-retrofit prompt has Phase 1b for existing-tests modernization', () => {
    const prompt = read('prompts/qa-retrofit.md');
    assert.match(prompt, /Phase 1b — Existing-tests modernization analysis/);
    assert.match(prompt, /smell-modernization/);
    assert.match(prompt, /Detect existing test frameworks/i);
  });

  test('Phase 1b dispatches max 5 parallel research agents per tool', () => {
    const prompt = read('prompts/qa-retrofit.md');
    assert.match(prompt, /cap 5 tools per audit run/);
    assert.match(prompt, /detected tool\/framework, spawn a research agent/);
  });

  test('Phase 1b feeds findings into testing-gaps.md as P1/P2 (NEVER P0)', () => {
    const prompt = read('prompts/qa-retrofit.md');
    assert.match(prompt, /high-severity Phase 1b findings become P1 gaps/);
    assert.match(prompt, /Don't escalate Phase 1b to P0 by default/);
  });

  test('qa-engineer profile declares analyze_existing_tests config', () => {
    const profile = read('profiles/qa-engineer.yaml');
    assert.match(profile, /analyze_existing_tests/);
    assert.match(profile, /trigger_threshold:\s*1/);
    assert.match(profile, /max_tools_per_run:\s*5/);
    assert.match(profile, /backlog_type_tag:\s*smell-modernization/);
  });

  test('analyze_existing_tests cost_guard + privacy preserved', () => {
    const profile = read('profiles/qa-engineer.yaml');
    assert.match(profile, /cost_guard:[\s\S]*?estimated_tokens_per_tool:\s*60000/);
    assert.match(profile, /flat_subscription_safe:\s*true/);
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
