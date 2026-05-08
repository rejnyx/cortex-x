'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  isAllowed,
  flattenArgs,
  HERMES_DENY,
} = require('../../../bin/steward/_lib/policy-check.cjs');

describe('policy-check: kill-switch preservation', () => {
  test('rm of fleet HERMES_HALT blocked', () => {
    const r = isAllowed('Bash', { command: 'rm ~/.cortex/HERMES_HALT' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'HERMES_HALT_PRESERVE');
  });

  test('rm of project HERMES_HALT blocked', () => {
    const r = isAllowed('Bash', { command: 'rm /repo/.cortex/HERMES_HALT' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'HERMES_HALT_PRESERVE');
  });

  test('Remove-Item of HERMES_HALT (PowerShell) blocked', () => {
    const r = isAllowed('Bash', { command: 'Remove-Item C:\\repo\\.cortex\\HERMES_HALT' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'HERMES_HALT_PRESERVE');
  });
});

describe('policy-check: source-of-truth protection', () => {
  test('write to standards/ blocked', () => {
    const r = isAllowed('Edit', { file_path: 'standards/security.md', op: 'write content' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'HUMAN_ONLY_PATH');
  });

  test('write to prompts/ blocked', () => {
    const r = isAllowed('Edit', { file_path: 'prompts/new-project.md', op: 'edit it' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'HUMAN_ONLY_PATH');
  });

  test('write to CLAUDE.md blocked', () => {
    const r = isAllowed('Edit', { file_path: 'CLAUDE.md', op: 'write update' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'HUMAN_ONLY_TOPLEVEL');
  });

  test('write to README.md blocked', () => {
    const r = isAllowed('Edit', { file_path: 'README.md', op: 'edit anything' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'HUMAN_ONLY_TOPLEVEL');
  });

  test('write to insights/ allowed (auto_improves path)', () => {
    const r = isAllowed('Edit', { file_path: 'insights/proposals/2026-05-07.md', op: 'write proposal' });
    assert.equal(r.allowed, true);
  });

  test('write to journal/ allowed', () => {
    const r = isAllowed('Bash', { command: 'echo {} >> ~/.cortex/journal/x/y.jsonl' });
    assert.equal(r.allowed, true);
  });
});

describe('policy-check: auto-merge prevention', () => {
  test('gh pr merge blocked', () => {
    const r = isAllowed('Bash', { command: 'gh pr merge 42 --squash' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'NO_AUTO_MERGE');
  });

  test('git merge main blocked', () => {
    const r = isAllowed('Bash', { command: 'git merge main' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'NO_INTEGRATION_MERGE');
  });

  test('gh pr create allowed (Hermes opens PRs)', () => {
    const r = isAllowed('Bash', { command: 'gh pr create --draft --title "feat: x"' });
    assert.equal(r.allowed, true);
  });
});

describe('policy-check: production mutation prevention', () => {
  test('vercel deploy --prod blocked', () => {
    const r = isAllowed('Bash', { command: 'vercel deploy --prod' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'NO_PROD_DEPLOY');
  });

  test('supabase db push --linked blocked', () => {
    const r = isAllowed('Bash', { command: 'supabase db push --linked --include-roles' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'NO_PROD_MIGRATION');
  });

  test('kubectl apply prod blocked', () => {
    const r = isAllowed('Bash', { command: 'kubectl apply -f deployment.yaml -n prod' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'NO_PROD_KUBECTL');
  });

  test('vercel deploy --preview allowed', () => {
    const r = isAllowed('Bash', { command: 'vercel deploy --preview' });
    assert.equal(r.allowed, true);
  });
});

describe('policy-check: git destructive ops', () => {
  test('git push --force blocked at Ring 1', () => {
    const r = isAllowed('Bash', { command: 'git push --force origin main' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'NO_FORCE_PUSH');
  });

  test('git push --force-with-lease blocked', () => {
    const r = isAllowed('Bash', { command: 'git push --force-with-lease origin main' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'NO_FORCE_PUSH');
  });

  test('git push -f blocked', () => {
    const r = isAllowed('Bash', { command: 'git push -f origin feature' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'NO_FORCE_PUSH');
  });

  test('git reset --hard blocked', () => {
    const r = isAllowed('Bash', { command: 'git reset --hard HEAD~1' });
    assert.equal(r.allowed, false);
    assert.equal(r.code, 'NO_HARD_RESET');
  });

  test('git revert allowed (the canonical Hermes rollback method)', () => {
    const r = isAllowed('Bash', { command: 'git revert --no-edit abc123' });
    assert.equal(r.allowed, true);
  });

  test('regular git push allowed', () => {
    const r = isAllowed('Bash', { command: 'git push origin hermes/2026-05-07-bump-zod-a3f2' });
    assert.equal(r.allowed, true);
  });
});

describe('policy-check: utilities', () => {
  test('flattenArgs handles strings, arrays, nested objects', () => {
    assert.equal(flattenArgs('hello world'), 'hello world');
    assert.equal(flattenArgs({ command: 'git status' }), 'git status');
    assert.equal(flattenArgs({ paths: ['a', 'b'], flags: ['-x'] }), 'a b -x');
    const nested = flattenArgs({ outer: { inner: 'foo', list: ['bar'] } });
    assert.match(nested, /foo/);
    assert.match(nested, /bar/);
  });

  test('HERMES_DENY rules each have code + reason + RegExp pattern', () => {
    for (const rule of HERMES_DENY) {
      assert.ok(rule.code, 'rule must have code');
      assert.ok(rule.reason, 'rule must have reason');
      assert.ok(rule.p instanceof RegExp, 'rule.p must be RegExp');
    }
  });

  test('safe innocent command passes', () => {
    const r = isAllowed('Bash', { command: 'echo hello' });
    assert.equal(r.allowed, true);
  });
});
