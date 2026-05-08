// routing-table.cjs — Sprint 2.0b action-kind-based model routing.
//
// Pure-function lookup: (actionKind, profile, override) -> resolved model
// (or null when the kind is deterministic and needs no LLM).
//
// SSOT for which model handles which action_kind under which profile. The
// table replaces the pre-2.0b "global STEWARD_MODEL or DEFAULT_MODEL"
// cascade in action-engine.cjs with role/task-type routing keyed on the
// 9 (+future) registered action_kinds.
//
// Research basis: docs/research/sprint-2.0b-action-kind-model-routing-2026-05-08.md
// (R1 memo, 2026-05-08). Convergent SOTA pattern across Augment Code,
// Anthropic multi-agent research, Claude Code, and Hermes Agent's
// auxiliary-task-slot model. RouteLLM-style learned classifier rejected as
// over-engineered for our 9-kind taxonomy.
//
// Default profile = `balanced` (NOT `cheap`). Today's only LLM kind
// (`recommendation`) runs DeepSeek V4 Flash at ~$0.0008/run — already at
// the price floor; `cheap` would only switch to a marginally cheaper model
// with thinner JSON-mode track record. Cost saving = rounding error;
// quality risk = real on a single-LLM-kind system.
//
// Override layers (low to high precedence):
//   1. Built-in default per action_kind under selected profile (this table).
//   2. STEWARD_ROUTING_PROFILE env (cheap | balanced | premium | ensemble).
//   3. STEWARD_MODEL env (legacy global override, pre-2.0b — kept working for
//      backward compat so existing workflow files / operator dotfiles don't
//      silently break when 2.0b lands).
//   4. STEWARD_ROUTING_<ACTION_KIND_UPPER> env (e.g.
//      STEWARD_ROUTING_RECOMMENDATION=anthropic/claude-sonnet-4.6).
//   5. CLI --model <slug> on cortex-steward execute (one-shot override).

'use strict';

const { readEnv } = require('./env.cjs');

const PROFILES = ['cheap', 'balanced', 'premium', 'ensemble'];
const DEFAULT_PROFILE = 'balanced';

// SSOT for the routing.source enum so callers (execute.cjs span tags, docs,
// status output) can reference canonical values instead of hand-typing
// strings — flagged by ssot-enforcer in 2.0b R2 review.
const ROUTING_SOURCES = Object.freeze({
  CLI: 'cli',
  ENV_KIND: 'env-kind',
  ENV_LEGACY: 'env-legacy',
  TABLE: 'table',
  TABLE_FALLBACK_BALANCED: 'table-fallback-balanced',
  DETERMINISTIC: 'deterministic',
});

// Ensemble entries return an array of N candidate models; downstream callers
// either materialize a 3-way fan-out (Sprint 2.0b ensemble profile, gated by
// STEWARD_ENSEMBLE=on flag) or fall back to the first entry when ensemble
// dispatch isn't wired (today's pre-2.2 single-process executor).
//
// Models pinned to 2026-05-08 R1 memo §6.1. Refresh on each new R1 cycle.
// SSOT: this table only — action-engine.cjs reads via selectModel().
const ROUTING_TABLE = {
  // ── Currently shipped LLM kinds ──────────────────────────────────────
  recommendation: {
    cheap: 'google/gemini-3.1-flash-lite-preview',
    balanced: 'deepseek/deepseek-v4-flash',
    premium: 'anthropic/claude-sonnet-4.6',
    ensemble: {
      workers: [
        'deepseek/deepseek-v4-flash',
        'qwen/qwen3-coder-flash',
        'mistralai/mistral-small-2603',
      ],
      judge: 'anthropic/claude-haiku-4.5',
    },
  },

  // ── Future LLM kinds (declared early so dispatcher contract is stable) ─
  architecture_review: {
    cheap: 'deepseek/deepseek-v4-flash',
    balanced: 'anthropic/claude-sonnet-4.6',
    // Premium opts for Opus 4.6 over 4.7 — 4.7's new tokenizer adds ~35%
    // input tokens per request despite unchanged rate card. Opus 4.6 same
    // quality, predictable billing. Revisit when Anthropic ships parity.
    premium: 'anthropic/claude-opus-4.6',
    ensemble: {
      workers: [
        'anthropic/claude-sonnet-4.6',
        'openai/gpt-5.4',
        'anthropic/claude-opus-4.6',
      ],
      judge: 'anthropic/claude-sonnet-4.6',
    },
  },

  release_notes_drafter: {
    cheap: 'google/gemini-3.1-flash-lite-preview',
    // Generation, not reasoning — Haiku correctly sized.
    balanced: 'anthropic/claude-haiku-4.5',
    premium: 'anthropic/claude-sonnet-4.6',
    // Ensemble overkill for pure generation; collapse to balanced.
    ensemble: {
      workers: ['anthropic/claude-haiku-4.5'],
      judge: null,
    },
  },

  security_review: {
    // Always cross-family — single-family review can miss family-specific
    // blind spots (DryRun Security March 2026 report).
    cheap: 'deepseek/deepseek-v4-flash',
    balanced: {
      workers: ['anthropic/claude-sonnet-4.6', 'openai/gpt-5.4'],
      judge: 'anthropic/claude-sonnet-4.6',
    },
    premium: {
      workers: ['anthropic/claude-opus-4.6', 'openai/gpt-5.5'],
      judge: 'anthropic/claude-opus-4.6',
    },
    ensemble: {
      workers: [
        'anthropic/claude-opus-4.6',
        'openai/gpt-5.5',
        'deepseek/deepseek-v4-flash',
      ],
      judge: 'anthropic/claude-sonnet-4.6',
    },
  },
};

// Profile-allowlist per action_kind. Commodity kinds are not allowed to
// escalate to premium even via env override — defense in depth against
// ergonomic accidents (e.g. a config typo routing release_notes_drafter
// to Opus). When the kind is omitted from this map, all 4 profiles are
// allowed (default-permissive).
const PROFILE_ALLOWLIST = {
  // recommendation can use any profile.
  // architecture_review can use any profile.
  // security_review can use any profile (cross-family is desirable).
  release_notes_drafter: ['cheap', 'balanced', 'premium'],
  // Deterministic kinds: no LLM call, profile is moot. Listed here as
  // documentation; selectModel() returns null for unregistered kinds.
};

function listProfiles() {
  return PROFILES.slice();
}

function isValidProfile(profile) {
  return PROFILES.includes(profile);
}

function getDefaultProfile() {
  const env = readEnv('ROUTING_PROFILE');
  if (env && isValidProfile(env)) return env;
  return DEFAULT_PROFILE;
}

function isProfileAllowed(actionKind, profile) {
  if (!isValidProfile(profile)) return false;
  // 2.0b R2 hardening: hasOwnProperty guard so PROFILE_ALLOWLIST['__proto__']
  // doesn't surface Object.prototype methods (which would crash with
  // "allowed.includes is not a function" or otherwise behave nondeterministically).
  if (!Object.prototype.hasOwnProperty.call(PROFILE_ALLOWLIST, actionKind)) {
    return true; // default-permissive when kind omitted
  }
  const allowed = PROFILE_ALLOWLIST[actionKind];
  if (!Array.isArray(allowed)) return true;
  return allowed.includes(profile);
}

// Returns the env-override slug for a given action_kind, or undefined when
// no override is set. Env name is STEWARD_ROUTING_<ACTION_KIND_UPPER> with
// dashes/dots normalized to underscores so action kinds with non-alpha
// characters can still register an override.
//
// 2.0b R2 hardening: trim whitespace before length-check so env values like
// `STEWARD_ROUTING_RECOMMENDATION='   '` (common shell quoting accident)
// fall through cleanly instead of shipping `'   '` as a model slug to
// OpenRouter (which 400s with a confusing message).
function readKindOverride(actionKind) {
  const normalized = String(actionKind || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_');
  if (!normalized) return undefined;
  const raw = readEnv(`ROUTING_${normalized}`);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Returns true when an action_kind has a routing-table entry (i.e. it's an
// LLM-backed kind). 2.0b R2 ssot-enforcer + edge-hunter flagged a duplicated
// hardcoded `llmKinds` set in execute.cjs that would silently drift when
// a future LLM kind lands. Single SSOT here.
function isLLMKind(actionKind) {
  return Object.prototype.hasOwnProperty.call(ROUTING_TABLE, actionKind);
}

// Sprint 2.1 R2 ssot-enforcer MAJOR: the autoresearch dispatch in execute.cjs
// previously hardcoded `plan.action_kind === 'recommendation'` — same SSOT
// pattern flagged in Sprint 2.0b. The set of autoresearch-eligible kinds lives
// here so adding (e.g.) `architecture_review` to autoresearch in 2.1.x is a
// single-file change.
const AUTORESEARCH_ELIGIBLE_KINDS = new Set(['recommendation']);

function isAutoresearchEligible(actionKind) {
  return AUTORESEARCH_ELIGIBLE_KINDS.has(actionKind);
}

// Sprint 2.1 R2 security BLOCKER: judge model (STEWARD_AUTORESEARCH_JUDGE_MODEL)
// previously bypassed Sprint 2.0b routing-policy allowlist — operator-controllable
// env could pin judge to any frontier model and burn through caps. Validator below
// matches the same regex used elsewhere (clampSlug) AND requires a known vendor
// prefix to defend against operator typos pivoting egress.
const ALLOWED_JUDGE_VENDOR_PREFIXES = ['anthropic/', 'openai/', 'deepseek/', 'google/', 'qwen/', 'mistralai/', 'meta-llama/', 'x-ai/', 'zai/', 'moonshotai/'];
const JUDGE_SLUG_REGEX = /^[a-zA-Z0-9._:/-]{1,128}$/;

function isAllowedJudgeModel(slug) {
  if (typeof slug !== 'string') return false;
  if (!JUDGE_SLUG_REGEX.test(slug)) return false;
  return ALLOWED_JUDGE_VENDOR_PREFIXES.some((p) => slug.startsWith(p));
}

// Pure-function model lookup.
//
// Inputs:
//   actionKind  - registered action_kind name (e.g. 'recommendation')
//   profile     - 'cheap' | 'balanced' | 'premium' | 'ensemble'
//   override    - optional explicit slug (CLI --model flag); wins over env + table
//
// Returns:
//   { ok: true, model: <slug>, source: 'cli' | 'env' | 'table', profile }
//   { ok: true, ensemble: { workers: [...], judge: <slug> }, source, profile }
//   { ok: false, code: <error>, error: <message> }
//
// Returns ok:true with model:null when the action_kind is deterministic
// (no LLM needed) — caller skips the LLM call entirely.
function selectModel({ actionKind, profile, override } = {}) {
  // Validate profile early so callers get a clean error on typos.
  const resolvedProfile = profile || getDefaultProfile();
  if (!isValidProfile(resolvedProfile)) {
    return {
      ok: false,
      code: 'ROUTING_PROFILE_INVALID',
      error: `unknown routing profile '${resolvedProfile}'. Supported: ${PROFILES.join(', ')}`,
    };
  }

  // 2.0b R2 hardening: clamp slug length on the way through every override
  // path. CWE-117 (log injection via OTEL span attribute) — the resolved
  // model lands in agentSpan.setAttribute('steward.routing.model', ...) and
  // potentially in journal entries. Bounding length defends against
  // operator-only env injection without breaking legitimate slugs (longest
  // real OpenRouter slug today is ~50 chars; 128 is generous headroom).
  const MAX_SLUG_LEN = 128;
  function clampSlug(slug) {
    if (typeof slug !== 'string') return slug;
    return slug.length > MAX_SLUG_LEN ? slug.slice(0, MAX_SLUG_LEN) : slug;
  }

  // CLI --model wins over everything else. Profile + table are not consulted.
  // 2.0b R2 hardening: reject values that look like CLI flags (start with --)
  // because the upstream `flagValue` parser greedily consumes the next argv
  // when --model has no value, silently treating `--skip-verify` as a model
  // slug (edge-hunter MAJOR finding).
  if (override && typeof override === 'string' && override.length > 0) {
    const trimmed = override.trim();
    if (trimmed.length > 0 && !trimmed.startsWith('--')) {
      return {
        ok: true,
        model: clampSlug(trimmed),
        source: ROUTING_SOURCES.CLI,
        profile: resolvedProfile,
      };
    }
  }

  // Env override per action_kind. readKindOverride trims + length-checks.
  const envOverride = readKindOverride(actionKind);
  if (envOverride) {
    return {
      ok: true,
      model: clampSlug(envOverride),
      source: ROUTING_SOURCES.ENV_KIND,
      profile: resolvedProfile,
    };
  }

  // Profile-allowlist gate. Run BEFORE legacy STEWARD_MODEL fallback +
  // table lookup so the operator sees a clear error instead of a silent
  // profile demotion or surprising legacy-pin acceptance.
  if (!isProfileAllowed(actionKind, resolvedProfile)) {
    return {
      ok: false,
      code: 'ROUTING_PROFILE_NOT_ALLOWED',
      error: `action_kind '${String(actionKind).slice(0, 64)}' is not allowed under profile '${resolvedProfile}'. Allowed: ${(PROFILE_ALLOWLIST[actionKind] || []).join(', ') || '(any)'}`,
    };
  }

  // hasOwnProperty guard — prototype pollution defense (edge-hunter
  // MAJOR). Bare bracket access on `ROUTING_TABLE['__proto__']` returns
  // Object.prototype which is truthy and has properties; the legacy code
  // path then misclassified those as "registered LLM kinds." Strict
  // ownership check prevents that.
  const isRegisteredKind = isLLMKind(actionKind);

  // Legacy STEWARD_MODEL global env (pre-2.0b). Backward compat — kept so
  // existing workflow files / operator dotfiles don't silently break.
  // 2.0b R2 hardening: only honored for LLM-backed (registered) kinds.
  // Pre-fix, an operator with `STEWARD_MODEL=foo` would see deterministic
  // kinds (recommendation_harvest, dep_update_patch...) suddenly return
  // a model slug, breaking the "no LLM call" contract. Now skipped for
  // unregistered/deterministic kinds.
  if (isRegisteredKind) {
    const legacyRaw = readEnv('MODEL');
    if (typeof legacyRaw === 'string') {
      const legacyTrimmed = legacyRaw.trim();
      if (legacyTrimmed.length > 0) {
        return {
          ok: true,
          model: clampSlug(legacyTrimmed),
          source: ROUTING_SOURCES.ENV_LEGACY,
          profile: resolvedProfile,
        };
      }
    }
  }

  if (!isRegisteredKind) {
    // Action_kind not registered in routing table = deterministic, no LLM.
    return {
      ok: true,
      model: null,
      source: ROUTING_SOURCES.DETERMINISTIC,
      profile: resolvedProfile,
    };
  }

  // Table lookup.
  const entry = ROUTING_TABLE[actionKind];
  const slot = entry[resolvedProfile];
  // Helper that resolves a slot value (string or ensemble object) into the
  // shipped result shape. Used both for the primary slot and the
  // balanced-fallback path so they emit consistent shapes (blind-hunter
  // MAJOR — pre-fix the fallback path could emit `model: null` with a
  // table-fallback-balanced source, masking misconfig).
  function resolveSlot(slotValue, profileLabel, sourceLabel) {
    if (typeof slotValue === 'string' && slotValue.length > 0) {
      return {
        ok: true,
        model: clampSlug(slotValue),
        source: sourceLabel,
        profile: profileLabel,
      };
    }
    if (typeof slotValue === 'object' && slotValue !== null && Array.isArray(slotValue.workers) && slotValue.workers.length > 0) {
      const workersCopy = slotValue.workers.map(clampSlug);
      return {
        ok: true,
        model: workersCopy[0],
        ensemble: { workers: workersCopy, judge: slotValue.judge != null ? clampSlug(slotValue.judge) : null },
        source: sourceLabel,
        profile: profileLabel,
      };
    }
    return null;
  }

  if (slot !== undefined) {
    const resolved = resolveSlot(slot, resolvedProfile, ROUTING_SOURCES.TABLE);
    if (resolved) return resolved;
    return {
      ok: false,
      code: 'ROUTING_TABLE_MALFORMED',
      error: `action_kind '${actionKind}' profile '${resolvedProfile}' has malformed entry (expected non-empty string or {workers:[...], judge})`,
    };
  }

  // Profile slot missing for this kind — fall back to balanced. Same shape
  // resolution so we never emit `model: null, source: 'table-fallback-balanced'`.
  const fallback = entry.balanced;
  if (fallback === undefined) {
    return {
      ok: false,
      code: 'ROUTING_TABLE_INCOMPLETE',
      error: `action_kind '${actionKind}' missing balanced fallback in routing-table.cjs`,
    };
  }
  const fallbackResolved = resolveSlot(fallback, 'balanced', ROUTING_SOURCES.TABLE_FALLBACK_BALANCED);
  if (fallbackResolved) return fallbackResolved;
  return {
    ok: false,
    code: 'ROUTING_TABLE_MALFORMED',
    error: `action_kind '${actionKind}' balanced fallback is malformed`,
  };
}

// Snapshot view of the table for CLI status output + tests. Returns a
// structured-clone of ROUTING_TABLE so callers can't mutate the SSOT.
function snapshotTable() {
  return JSON.parse(JSON.stringify(ROUTING_TABLE));
}

module.exports = {
  PROFILES,
  DEFAULT_PROFILE,
  ROUTING_SOURCES,
  ROUTING_TABLE,
  PROFILE_ALLOWLIST,
  AUTORESEARCH_ELIGIBLE_KINDS,
  ALLOWED_JUDGE_VENDOR_PREFIXES,
  listProfiles,
  isValidProfile,
  getDefaultProfile,
  isProfileAllowed,
  readKindOverride,
  isLLMKind,
  isAutoresearchEligible,
  isAllowedJudgeModel,
  selectModel,
  snapshotTable,
};
