// Sprint 2.6 — Discord bridge authentication helpers.
//
// 4-layer security model per R1 memo §2:
//   1. Whitelist user_id (via STEWARD_DISCORD_ALLOWED_USER_IDS env)
//   2. HMAC-signed action confirmations for /! mutation commands
//   3. Bot token rotation (90-day cadence — operator runbook)
//   4. Read-only by default; mutations require `/!` prefix + HMAC reply
//
// Pure zero-deps (node:crypto only) — testable without discord.js runtime.
// Bridge process imports these and wires them into the gateway message
// handler.

'use strict';

const crypto = require('node:crypto');

// Sprint 2.6 R2 fix anticipation: trim env-var values to avoid CI secret
// trailing-newline class (seen in Sprint 1.8.12b for OPENROUTER_API_KEY).
function _readTrimmedEnv(name) {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

// Parse the comma-separated allowlist from env. Empty list = nobody allowed
// (fail-closed). Operator must explicitly set the env var.
function loadAllowedUserIds() {
  const raw = _readTrimmedEnv('STEWARD_DISCORD_ALLOWED_USER_IDS');
  if (!raw) return new Set();
  return new Set(
    raw.split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{10,32}$/.test(s)) // Discord snowflake IDs
  );
}

// Whitelist check — silent drop for non-allowed (per R1 §2 layer 1).
function isUserAllowed(userId, allowedSet = loadAllowedUserIds()) {
  if (!userId || typeof userId !== 'string') return false;
  return allowedSet.has(userId);
}

// HMAC token — derived from action_id + per-process secret + timestamp
// rounded to nearest 90s window (replay protection). 8-hex-char display
// truncation gives 32 bits of entropy in the UI but full 256-bit secret
// stays server-side. Operator types the 8-char token back; we recompute
// over current+previous window and compare.
const HMAC_WINDOW_MS = 90_000;
const HMAC_DISPLAY_LENGTH = 8;

function _readHmacSecret() {
  const s = _readTrimmedEnv('STEWARD_DISCORD_SECRET');
  if (!s || s.length < 16) {
    throw Object.assign(new Error('STEWARD_DISCORD_SECRET must be set and ≥16 chars (32+ bytes recommended)'), {
      code: 'STEWARD_DISCORD_SECRET_MISSING',
    });
  }
  return s;
}

function _windowToken(actionId, secret, windowIndex) {
  return crypto.createHmac('sha256', secret)
    .update(`${actionId}:${windowIndex}`)
    .digest('hex')
    .slice(0, HMAC_DISPLAY_LENGTH);
}

// Generate the displayable token for a fresh action.
function generateActionToken(actionId, opts = {}) {
  if (!actionId || typeof actionId !== 'string') {
    throw new Error('actionId required');
  }
  const secret = opts.secret || _readHmacSecret();
  const now = (opts.now instanceof Date && !isNaN(opts.now.getTime())) ? opts.now.getTime() : Date.now();
  const windowIndex = Math.floor(now / HMAC_WINDOW_MS);
  return _windowToken(actionId, secret, windowIndex);
}

// Verify the operator-supplied token against current + previous window.
// Returns true iff token matches either.
function verifyActionToken(actionId, suppliedToken, opts = {}) {
  if (!actionId || !suppliedToken || typeof suppliedToken !== 'string') return false;
  const supplied = suppliedToken.trim().toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(supplied)) return false;
  let secret;
  try { secret = opts.secret || _readHmacSecret(); }
  catch { return false; }
  const now = (opts.now instanceof Date && !isNaN(opts.now.getTime())) ? opts.now.getTime() : Date.now();
  const windowIndex = Math.floor(now / HMAC_WINDOW_MS);
  // Constant-time compare against current + previous (90s replay window).
  const candidates = [
    _windowToken(actionId, secret, windowIndex),
    _windowToken(actionId, secret, windowIndex - 1),
  ];
  for (const c of candidates) {
    // Both same length; safe to use timingSafeEqual.
    try {
      const ok = crypto.timingSafeEqual(Buffer.from(c, 'utf8'), Buffer.from(supplied, 'utf8'));
      if (ok) return true;
    } catch { /* length mismatch — should be impossible */ }
  }
  return false;
}

// Read-only command predicate — `/!` prefix marks a mutation that requires
// HMAC confirmation flow. Every other command is read-only.
function isMutationCommand(commandName) {
  return typeof commandName === 'string' && commandName.startsWith('!');
}

module.exports = {
  loadAllowedUserIds,
  isUserAllowed,
  generateActionToken,
  verifyActionToken,
  isMutationCommand,
  HMAC_WINDOW_MS,
  HMAC_DISPLAY_LENGTH,
};
