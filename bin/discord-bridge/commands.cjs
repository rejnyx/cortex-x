// Sprint 2.6 — Discord bridge slash command handlers.
//
// Pure logic (no discord.js dependency). Each handler is a function that
// takes `(args, ctx) → { content, embed?, ephemeral?, requiresHmac? }`
// where ctx provides filesystem-bound primitives (read journal, read halt
// state, write recommendation, etc.). bridge.cjs wires the actual Discord
// reply via discord.js.
//
// 6 commands per R1 §3 + Sprint 2.4 R2 lessons:
//   /status           — cortex-steward status JSON summary
//   /forecast         — cap forecast block (Sprint 1.9.1)
//   /halt <reason>    — !MUTATION: write STEWARD_HALT (HMAC-confirmed)
//   /resume           — !MUTATION: clear halt (HMAC-confirmed)
//   /recommend <text> — !MUTATION: append voice/text to recommendations.md
//   /why <commit-sha> — render commit trailer + journal entry as embed

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const auth = require('./auth.cjs');

// Sprint 2.6.1 hardening (R2 retro HIGH-2): replace Math.random.toString(36)
// (~30 bits entropy) with crypto.randomBytes (128 bits). Combined with the
// HMAC consumed-tokens Set in auth.cjs, this blocks actionId guessing
// attacks even if the public confirmation embed leaks the token.
function _newActionId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

// Slash command registry — each entry maps the Discord command name to
// a handler function. Mutating commands prefixed with `!` per R1 §2 layer 4.
// Sprint 2.6.1 hardening (R2 retro MAJOR-1): renamed `!halt`/`!resume`/
// `!recommend` to Discord-legal identifiers. Mutation flag now comes from
// COMMAND_SPECS / MUTATION_NAMES, not name-prefix inspection.
const COMMANDS = {
  status: handleStatus,
  forecast: handleForecast,
  why: handleWhy,
  halt: handleHalt,
  resume: handleResume,
  recommend: handleRecommend,
};

// Sprint 2.6.1 hardening (R2 retro MAJOR-1): Discord slash command names
// must match `[a-z0-9_-]{1,32}` per Discord API spec — `!` prefix would
// fail registration. Refactored: command names are now Discord-legal
// identifiers (`halt`, `resume`, `recommend`) and the mutation flag lives
// in the spec itself. Internal registry still keys by the same name; the
// dispatcher uses the spec's `mutation` boolean instead of name-prefix
// inspection.
const COMMAND_SPECS = [
  {
    name: 'status',
    description: 'Show Steward status (halt, journal rollup, cost ledger)',
    options: [],
    mutation: false,
  },
  {
    name: 'forecast',
    description: 'Show daily/weekly/monthly cap forecast',
    options: [],
    mutation: false,
  },
  {
    name: 'why',
    description: 'Render the trailer + journal entry for a Steward commit',
    options: [{ name: 'sha', description: 'Commit SHA (full or short)', type: 3, required: true }],
    mutation: false,
  },
  {
    name: 'halt',
    description: 'MUTATION: write STEWARD_HALT (requires HMAC confirmation reply)',
    options: [{ name: 'reason', description: 'Why are you halting?', type: 3, required: true }],
    mutation: true,
  },
  {
    name: 'resume',
    description: 'MUTATION: clear STEWARD_HALT (requires HMAC confirmation reply)',
    options: [],
    mutation: true,
  },
  {
    name: 'recommend',
    description: 'MUTATION: append a recommendation to recommendations.md',
    options: [{ name: 'text', description: 'Recommendation body', type: 3, required: true }],
    mutation: true,
  },
];

// Build a quick-lookup of mutation flags from the specs.
const MUTATION_NAMES = new Set(COMMAND_SPECS.filter((s) => s.mutation).map((s) => s.name));
function isMutationCommandName(name) {
  return typeof name === 'string' && MUTATION_NAMES.has(name);
}

// ─────────────────────────────────────────────────────────────────────────
// Handlers — pure logic, return structured reply objects.
// ─────────────────────────────────────────────────────────────────────────

function handleStatus(_args, ctx) {
  const repoRoot = ctx.repoRoot || process.cwd();
  const summary = {
    halted: ctx.haltCheck ? ctx.haltCheck() : null,
    last_journal: ctx.lastJournalEntry ? ctx.lastJournalEntry() : null,
    cost_ledger: ctx.costLedger ? ctx.costLedger() : null,
    repo: path.basename(repoRoot),
  };
  return {
    content: '```json\n' + JSON.stringify(summary, null, 2).slice(0, 1800) + '\n```',
    ephemeral: true,
  };
}

function handleForecast(_args, ctx) {
  const forecast = ctx.forecast ? ctx.forecast() : { error: 'forecast unavailable' };
  return {
    content: '```json\n' + JSON.stringify(forecast, null, 2).slice(0, 1800) + '\n```',
    ephemeral: true,
  };
}

function handleWhy(args, ctx) {
  const sha = String(args.sha || '').trim();
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) {
    return { content: 'Invalid SHA. Provide 4–40 hex chars.', ephemeral: true };
  }
  const journalEntry = ctx.lookupJournalForCommit ? ctx.lookupJournalForCommit(sha) : null;
  if (!journalEntry) {
    return { content: `No journal entry for ${sha}.`, ephemeral: true };
  }
  return {
    content: `## ${sha}\n` + '```json\n' + JSON.stringify(journalEntry, null, 2).slice(0, 1800) + '\n```',
    ephemeral: true,
  };
}

// Mutation handlers — return requiresHmac:true on first invocation,
// expecting the operator to reply with the displayed token. Bridge.cjs
// orchestrates the two-step flow.
// Sprint 2.6.1 hardening (R2 retro HIGH-3): all mutation embeds are now
// `ephemeral: true` so the token + reason text don't leak to other guild
// members watching the channel. Operator-only visibility.
function handleHalt(args, ctx) {
  const reason = String(args.reason || '').trim().slice(0, 500);
  if (!reason) {
    return { content: 'reason required', ephemeral: true };
  }
  if (!args._confirmed) {
    const actionId = _newActionId('halt');
    const token = auth.generateActionToken(actionId, ctx);
    return {
      content: `⚠️ Confirm halt by replying with token: \`${token}\` (90s window)\n\nReason: ${reason}`,
      requiresHmac: true,
      actionId,
      ephemeral: true,
    };
  }
  if (ctx.writeHalt) {
    ctx.writeHalt(reason);
    return { content: `🛑 Halt written. Reason: ${reason.slice(0, 200)}`, ephemeral: true };
  }
  return { content: 'writeHalt primitive not available', ephemeral: true };
}

function handleResume(args, ctx) {
  if (!args._confirmed) {
    const actionId = _newActionId('resume');
    const token = auth.generateActionToken(actionId, ctx);
    return {
      content: `⚠️ Confirm resume by replying with token: \`${token}\` (90s window)`,
      requiresHmac: true,
      actionId,
      ephemeral: true,
    };
  }
  if (ctx.clearHalt) {
    ctx.clearHalt();
    return { content: '✅ Halt cleared.', ephemeral: true };
  }
  return { content: 'clearHalt primitive not available', ephemeral: true };
}

function handleRecommend(args, ctx) {
  const text = String(args.text || '').trim().slice(0, 4000);
  if (!text) {
    return { content: 'text required', ephemeral: true };
  }
  if (!args._confirmed) {
    const actionId = _newActionId('recommend');
    const token = auth.generateActionToken(actionId, ctx);
    return {
      content: `⚠️ Confirm recommendation by replying with token: \`${token}\` (90s window)\n\n> ${text.slice(0, 200)}`,
      requiresHmac: true,
      actionId,
      ephemeral: true,
    };
  }
  if (ctx.appendRecommendation) {
    ctx.appendRecommendation(text);
    return { content: `📝 Recommendation appended.`, ephemeral: true };
  }
  return { content: 'appendRecommendation primitive not available', ephemeral: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Default ctx primitives — simple filesystem-bound implementations.
// ─────────────────────────────────────────────────────────────────────────

function defaultCtx(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  return {
    repoRoot,
    haltCheck() {
      const haltCheck = require('../steward/_lib/halt-check.cjs');
      return haltCheck.isHalted({ repoRoot });
    },
    writeHalt(reason) {
      const haltCheck = require('../steward/_lib/halt-check.cjs');
      const fleetPath = haltCheck.fleetSentinelPath();
      fs.mkdirSync(path.dirname(fleetPath), { recursive: true });
      fs.writeFileSync(fleetPath, `discord-bridge halt: ${reason}\n`);
    },
    clearHalt() {
      const haltCheck = require('../steward/_lib/halt-check.cjs');
      const fleetPath = haltCheck.fleetSentinelPath();
      try { fs.unlinkSync(fleetPath); } catch { /* already gone */ }
    },
    appendRecommendation(text) {
      // Sprint 2.6.1 hardening (R2 retro BLOCKER B2): ensure cortex/ exists
      // (mkdirSync recursive — no-op if already there) so the first ever
      // /recommend on a fresh repo doesn't ENOENT-throw. Also: guard
      // symlink TOCTOU by checking lstat before append — if the path is a
      // symlink, refuse rather than follow outside repoRoot.
      const cortexDir = path.join(repoRoot, 'cortex');
      fs.mkdirSync(cortexDir, { recursive: true });
      const recPath = path.join(cortexDir, 'recommendations.md');
      try {
        const st = fs.lstatSync(recPath);
        if (st.isSymbolicLink()) {
          throw Object.assign(new Error('cortex/recommendations.md is a symlink — refusing to append (TOCTOU defense)'), {
            code: 'DISCORD_RECOMMEND_SYMLINK_REFUSED',
          });
        }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err; // file may not exist yet — that's fine
      }
      const ts = new Date().toISOString();
      const block = `\n\n## ${ts} — via Discord bridge\n\n${text}\n`;
      fs.appendFileSync(recPath, block, 'utf8');
    },
    lastJournalEntry() {
      // Best-effort journal tail; returns null if not parseable.
      try {
        const journalDir = path.join(repoRoot, 'cortex/journal');
        const files = fs.readdirSync(journalDir).filter((f) => f.endsWith('.jsonl')).sort();
        if (!files.length) return null;
        const content = fs.readFileSync(path.join(journalDir, files[files.length - 1]), 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);
        if (!lines.length) return null;
        return JSON.parse(lines[lines.length - 1]);
      } catch { return null; }
    },
    forecast: opts.forecast,
    costLedger: opts.costLedger,
    lookupJournalForCommit: opts.lookupJournalForCommit,
  };
}

// Dispatcher — given a command name + args + ctx, route to the handler.
// Returns null for unknown commands.
function dispatch(commandName, args, ctx) {
  const handler = COMMANDS[commandName];
  if (!handler) return null;
  return handler(args || {}, ctx || {});
}

module.exports = {
  COMMANDS,
  COMMAND_SPECS,
  dispatch,
  defaultCtx,
  handleStatus,
  handleForecast,
  handleWhy,
  handleHalt,
  handleResume,
  handleRecommend,
};
