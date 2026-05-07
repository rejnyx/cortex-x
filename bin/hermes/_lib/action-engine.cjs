// action-engine.cjs — pluggable interface for "apply this action's edits".
//
// v0.5b ships THREE engines (all share applyEditsToFilesystem):
//   - mock: env-driven (HERMES_MOCK_PLAN); writes the listed files. Sync.
//   - openrouter: real LLM via OpenRouter's OpenAI-compatible API. Async via
//                 built-in fetch() (Node ≥18). Zero-deps preserved.
//   - claude-sdk: NOT YET IMPLEMENTED (alternative to openrouter — would
//                 require @anthropic-ai/claude-agent-sdk dep).
//
// Engine contract:
//
//   await applyAction(plan, opts) -> {
//     ok: boolean,
//     touchedFiles: string[],   // relative paths to repo root
//     summary: string,          // 1-line human description
//     engine: string,           // engine name that produced the result
//     cost_usd?: number,        // present for paid engines
//     tokens_in?: number,
//     tokens_out?: number,
//     error?: string,           // present if ok=false
//     code?: string,            // machine-readable error code
//   }
//
// applyAction is async. Sync engines return a result; the wrapper awaits
// it (Promise.resolve passes through). The engine is responsible ONLY for
// file edits. Everything else (verify, commit, journal) is wired by
// execute.cjs.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
// Sprint 1.6.18: default model aligned with hermes-usage.md § Model selection
// recommendation. DeepSeek V4 Flash is the cost/quality sweet-spot for Hermes
// edit-plan generation (~$0.0008/run vs Sonnet 4.5's ~$0.04). Override via
// HERMES_MODEL env or opts.model.
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';
const OPENROUTER_TIMEOUT_MS = 120_000; // 2 min

// Sprint 1.6.17: Anthropic models on OpenRouter sometimes ignore
// response_format: json_object and wrap output in ```json ... ``` fences.
// Strip a leading/trailing markdown code fence (json or generic) before
// JSON.parse. No-op on bare JSON to avoid regressing DeepSeek/OpenAI.
function stripJsonFences(content) {
  if (typeof content !== 'string') return content;
  const trimmed = content.trim();
  const m = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : trimmed;
}

// Sprint 1.6.17: extract usage envelope shape so early-exit failure paths
// (empty response, plan-not-JSON, applyResult failure) can forward
// cost/tokens. The LLM call already cost spend regardless of parsing
// outcome — without this, status's cost ledger silently under-reports.
function extractUsage(data) {
  const u = (data && data.usage) || {};
  const out = {};
  if (typeof u.cost === 'number') out.cost_usd = u.cost;
  if (typeof u.prompt_tokens === 'number') out.tokens_in = u.prompt_tokens;
  if (typeof u.completion_tokens === 'number') out.tokens_out = u.completion_tokens;
  return out;
}

// ---------------------------------------------------------------------------
// Shared: applyEditsToFilesystem
// ---------------------------------------------------------------------------
//
// Both mock + openrouter engines reduce to "apply a list of {path, content}
// edits to the working tree". This helper is the shared implementation +
// path-safety guard. Returns a result object matching the engine contract.

function applyEditsToFilesystem(edits, opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();

  if (!Array.isArray(edits) || edits.length === 0) {
    return {
      ok: false,
      code: opts.emptyCode || 'NO_EDITS',
      error: 'edits must be a non-empty array',
    };
  }

  const touched = [];
  for (const edit of edits) {
    if (!edit || !edit.path || typeof edit.content !== 'string') {
      return {
        ok: false,
        code: opts.invalidCode || 'EDIT_INVALID',
        error: `edit missing required fields: ${JSON.stringify(edit)}`,
        touchedFiles: touched,
      };
    }
    // Sprint 1.6.18: tightened path-traversal check.
    // Old: edit.path.includes('..') had false positives ('docs/v1.2/x') + false
    // negatives (NUL byte, leading-./, Windows reparse, leading-dash flag-injection).
    // New: NUL byte + leading-dash + isAbsolute reject up-front, then resolve under
    // repoRoot and assert containment via path.relative.
    if (edit.path.includes('\0')) {
      return {
        ok: false,
        code: opts.unsafeCode || 'EDIT_UNSAFE',
        error: `edit path contains NUL byte: ${JSON.stringify(edit.path)}`,
        touchedFiles: touched,
      };
    }
    if (path.isAbsolute(edit.path) || edit.path.startsWith('-')) {
      return {
        ok: false,
        code: opts.unsafeCode || 'EDIT_UNSAFE',
        error: `edit path must be relative + non-flag: ${edit.path}`,
        touchedFiles: touched,
      };
    }
    const fullPath = path.resolve(repoRoot, edit.path);
    const relCheck = path.relative(repoRoot, fullPath);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      return {
        ok: false,
        code: opts.unsafeCode || 'EDIT_UNSAFE',
        error: `edit path escapes repoRoot via traversal: ${edit.path}`,
        touchedFiles: touched,
      };
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, edit.content, 'utf8');
    touched.push(edit.path);
  }

  return {
    ok: true,
    touchedFiles: touched,
    summary: opts.summary || `applied ${touched.length} edit(s) to ${touched.join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// Mock engine (sync, env-driven)
// ---------------------------------------------------------------------------

function mockEngine(_plan, opts = {}) {
  const raw = process.env.HERMES_MOCK_PLAN;
  if (!raw) {
    return {
      ok: false,
      code: 'MOCK_NOT_SET',
      error: 'HERMES_MOCK_PLAN env var not set; mock engine has nothing to apply',
    };
  }

  let mock;
  try {
    mock = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      code: 'MOCK_PARSE_ERROR',
      error: `HERMES_MOCK_PLAN is not valid JSON: ${err.message}`,
    };
  }

  const result = applyEditsToFilesystem(mock.edits, {
    repoRoot: opts.repoRoot,
    emptyCode: 'MOCK_NO_EDITS',
    invalidCode: 'MOCK_EDIT_INVALID',
    unsafeCode: 'MOCK_EDIT_UNSAFE',
    summary: mock.edits && Array.isArray(mock.edits)
      ? `mock applied ${mock.edits.length} edit(s) to ${(mock.edits || []).map((e) => e.path).join(', ')}`
      : undefined,
  });

  // Forward optional usage envelope for cost-capture tests. Sprint 1.6.15:
  // failure paths in execute.cjs must persist cost_usd/tokens too.
  if (mock.usage) {
    if (typeof mock.usage.cost_usd === 'number') result.cost_usd = mock.usage.cost_usd;
    if (typeof mock.usage.tokens_in === 'number') result.tokens_in = mock.usage.tokens_in;
    if (typeof mock.usage.tokens_out === 'number') result.tokens_out = mock.usage.tokens_out;
  }
  return result;
}

// ---------------------------------------------------------------------------
// OpenRouter engine (async, fetch-based)
// ---------------------------------------------------------------------------

const HERMES_SYSTEM_PROMPT = [
  'You are Hermes, an autonomous code-editing agent for cortex-x projects.',
  '',
  'You receive a single action item from cortex/recommendations.md. Your job',
  'is to produce a JSON edit-plan in this EXACT shape:',
  '',
  '  {"edits": [{"path": "<relative-to-repo-root>", "content": "<full file content>"}, ...]}',
  '',
  'Rules:',
  '- Output ONLY the JSON object. No markdown fences, no commentary.',
  '- Each edit MUST replace the file completely. No partial diffs, no patch syntax.',
  '- Paths MUST be relative to repo root. No absolute paths, no ".." traversal.',
  '- Do NOT touch files under standards/, prompts/, profiles/, agents/, or top-level',
  '  CLAUDE.md / README.md / module.yaml — these are human_only per config/evolve.yaml.',
  '- Do NOT add npm dependencies. cortex-x is zero-deps (single dev-dep `c8`).',
  '- Make the smallest change that satisfies the action. If unsure, prefer fewer edits.',
  '- The action body is your primary spec. Read it carefully.',
].join('\n');

function buildUserPrompt(plan, opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const lines = [
    `# Action ${plan.action.num}: ${plan.action.title}`,
    '',
    plan.action.body || '',
    '',
  ];

  if (plan.action.citations) {
    lines.push('## Citations');
    if (plan.action.citations.audit) lines.push(`- audit: ${plan.action.citations.audit}`);
    if (plan.action.citations.src) lines.push(`- src: ${plan.action.citations.src}`);
    lines.push('');
  }

  // Best-effort: include CLAUDE.md if present (project context)
  try {
    const claudeMd = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
    lines.push('## Project context (CLAUDE.md)');
    lines.push('');
    // Cap to avoid blowing token budget — first ~2000 chars is usually enough
    lines.push(claudeMd.length > 4000 ? claudeMd.slice(0, 4000) + '\n…[truncated]' : claudeMd);
    lines.push('');
  } catch {
    // CLAUDE.md missing — proceed without
  }

  lines.push('Output the edit-plan JSON now.');
  return lines.join('\n');
}

async function openrouterEngine(plan, opts = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      code: 'OPENROUTER_KEY_MISSING',
      error: 'OPENROUTER_API_KEY env var is required for the openrouter engine',
    };
  }

  // Allow tests to inject a fetch fake; default is global fetch (Node ≥18)
  const fetchImpl = opts.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      code: 'NO_FETCH',
      error: 'fetch() is not available; Node ≥18 required',
    };
  }

  const model = opts.model || process.env.HERMES_MODEL || DEFAULT_MODEL;
  const endpoint = opts.endpoint || OPENROUTER_ENDPOINT;
  const timeoutMs = opts.timeoutMs || OPENROUTER_TIMEOUT_MS;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let resp;
  try {
    resp = await fetchImpl(endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/Rejnyx/cortex-x',
        'X-Title': 'cortex-x Hermes',
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        max_tokens: opts.maxTokens || parseInt(process.env.HERMES_MAX_TOKENS, 10) || 4096,
        messages: [
          { role: 'system', content: HERMES_SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(plan, opts) },
        ],
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return { ok: false, code: 'OPENROUTER_TIMEOUT', error: `OpenRouter request timed out after ${timeoutMs}ms` };
    }
    return { ok: false, code: 'OPENROUTER_NETWORK_ERROR', error: err.message };
  }
  clearTimeout(timer);

  if (!resp.ok) {
    let body = '';
    try { body = await resp.text(); } catch { /* ignore */ }
    return {
      ok: false,
      code: 'OPENROUTER_HTTP_ERROR',
      error: `OpenRouter returned ${resp.status}: ${body.slice(0, 500)}`,
      httpStatus: resp.status,
    };
  }

  let data;
  try {
    data = await resp.json();
  } catch (err) {
    return { ok: false, code: 'OPENROUTER_RESPONSE_NOT_JSON', error: err.message };
  }

  const usageFields = extractUsage(data);

  // Sprint 1.6.18: B5 null guard — OpenRouter has been observed returning HTTP
  // 200 with body `null` or empty object on flaky upstream routes.
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    return { ok: false, code: 'OPENROUTER_EMPTY_RESPONSE', error: 'OpenRouter response did not contain message content', model, ...usageFields };
  }

  let editPlan;
  try {
    editPlan = JSON.parse(stripJsonFences(content));
  } catch (err) {
    return {
      ok: false,
      code: 'OPENROUTER_PLAN_NOT_JSON',
      error: `LLM did not return valid JSON: ${err.message}`,
      raw_preview: content.slice(0, 200),
      model,
      ...usageFields,
    };
  }

  // Sprint 1.6.18: B2 editPlan shape gate — JSON.parse can return primitives
  // (`42`, `"text"`, `null`) or objects without `edits` array. Without this
  // guard, applyEditsToFilesystem(undefined, ...) returns NO_EDITS but the
  // failure mode is distant from the cause. Explicit shape error helps
  // diagnose prompt-failure vs LLM-format-failure.
  if (!editPlan || typeof editPlan !== 'object' || Array.isArray(editPlan) || !Array.isArray(editPlan.edits)) {
    return {
      ok: false,
      code: 'OPENROUTER_PLAN_SHAPE_INVALID',
      error: 'edit-plan missing edits[] array or wrong root type',
      raw_preview: content.slice(0, 200),
      model,
      ...usageFields,
    };
  }

  const applyResult = applyEditsToFilesystem(editPlan.edits, {
    repoRoot: opts.repoRoot,
    emptyCode: 'OPENROUTER_NO_EDITS',
    invalidCode: 'OPENROUTER_EDIT_INVALID',
    unsafeCode: 'OPENROUTER_EDIT_UNSAFE',
    summary: `openrouter (${model}) applied ${(editPlan.edits || []).length} edit(s)`,
  });

  if (!applyResult.ok) return { ...applyResult, model, ...usageFields };

  return {
    ...applyResult,
    model,
    ...usageFields,
  };
}

// ---------------------------------------------------------------------------
// Claude SDK engine (alternative to openrouter — NOT YET IMPLEMENTED)
// ---------------------------------------------------------------------------

function claudeSdkEngine(_plan, _opts = {}) {
  return {
    ok: false,
    code: 'CLAUDE_SDK_NOT_IMPLEMENTED',
    error: 'Direct Claude Agent SDK is an alternative path; OpenRouter is the preferred v0.5b engine. See docs/hermes-runtime.md § 4.5.',
    next_steps: [
      'For Claude SDK path: npm install @anthropic-ai/claude-agent-sdk + replace this stub',
      'For OpenRouter path: set OPENROUTER_API_KEY + use --engine=openrouter',
    ],
  };
}

// ---------------------------------------------------------------------------
// Engine selection + applyAction (async)
// ---------------------------------------------------------------------------

const ENGINES = {
  mock: mockEngine,
  openrouter: openrouterEngine,
  'claude-sdk': claudeSdkEngine,
};

function selectEngine(opts = {}) {
  const name = opts.engine || process.env.HERMES_ENGINE || 'openrouter';
  const engine = ENGINES[name];
  if (!engine) {
    return {
      name,
      apply: async () => ({
        ok: false,
        code: 'UNKNOWN_ENGINE',
        error: `unknown action engine: ${name}; available: ${Object.keys(ENGINES).join(', ')}`,
      }),
    };
  }
  return { name, apply: engine };
}

async function applyAction(plan, opts = {}) {
  const { name, apply } = selectEngine(opts);
  const result = await Promise.resolve(apply(plan, opts));
  return { ...result, engine: name };
}

module.exports = {
  applyAction,
  selectEngine,
  applyEditsToFilesystem,
  mockEngine,
  openrouterEngine,
  claudeSdkEngine,
  buildUserPrompt,
  HERMES_SYSTEM_PROMPT,
  OPENROUTER_ENDPOINT,
  DEFAULT_MODEL,
  ENGINES,
};
