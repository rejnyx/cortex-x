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

const auth = require('./auth.cjs');

// Slash command registry — each entry maps the Discord command name to
// a handler function. Mutating commands prefixed with `!` per R1 §2 layer 4.
const COMMANDS = {
  status: handleStatus,
  forecast: handleForecast,
  why: handleWhy,
  '!halt': handleHalt,
  '!resume': handleResume,
  '!recommend': handleRecommend,
};

// Slash command metadata for Discord's /commands registration step.
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
    name: '!halt',
    description: 'MUTATION: write STEWARD_HALT (requires HMAC confirmation reply)',
    options: [{ name: 'reason', description: 'Why are you halting?', type: 3, required: true }],
    mutation: true,
  },
  {
    name: '!resume',
    description: 'MUTATION: clear STEWARD_HALT (requires HMAC confirmation reply)',
    options: [],
    mutation: true,
  },
  {
    name: '!recommend',
    description: 'MUTATION: append a recommendation to recommendations.md',
    options: [{ name: 'text', description: 'Recommendation body', type: 3, required: true }],
    mutation: true,
  },
];

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
function handleHalt(args, ctx) {
  const reason = String(args.reason || '').trim().slice(0, 500);
  if (!reason) {
    return { content: 'reason required', ephemeral: true };
  }
  // Step 1: generate action_id + token, ask operator to confirm.
  if (!args._confirmed) {
    const actionId = `halt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const token = auth.generateActionToken(actionId, ctx);
    return {
      content: `⚠️ Confirm halt by replying with token: \`${token}\` (90s window)\n\nReason: ${reason}`,
      requiresHmac: true,
      actionId,
      ephemeral: false,
    };
  }
  // Step 2: write halt file via injected primitive.
  if (ctx.writeHalt) {
    ctx.writeHalt(reason);
    return { content: `🛑 Halt written. Reason: ${reason.slice(0, 200)}`, ephemeral: false };
  }
  return { content: 'writeHalt primitive not available', ephemeral: true };
}

function handleResume(args, ctx) {
  if (!args._confirmed) {
    const actionId = `resume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const token = auth.generateActionToken(actionId, ctx);
    return {
      content: `⚠️ Confirm resume by replying with token: \`${token}\` (90s window)`,
      requiresHmac: true,
      actionId,
      ephemeral: false,
    };
  }
  if (ctx.clearHalt) {
    ctx.clearHalt();
    return { content: '✅ Halt cleared.', ephemeral: false };
  }
  return { content: 'clearHalt primitive not available', ephemeral: true };
}

function handleRecommend(args, ctx) {
  const text = String(args.text || '').trim().slice(0, 4000);
  if (!text) {
    return { content: 'text required', ephemeral: true };
  }
  if (!args._confirmed) {
    const actionId = `recommend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const token = auth.generateActionToken(actionId, ctx);
    return {
      content: `⚠️ Confirm recommendation by replying with token: \`${token}\` (90s window)\n\n> ${text.slice(0, 200)}`,
      requiresHmac: true,
      actionId,
      ephemeral: false,
    };
  }
  if (ctx.appendRecommendation) {
    ctx.appendRecommendation(text);
    return { content: `📝 Recommendation appended.`, ephemeral: false };
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
      const recPath = path.join(repoRoot, 'cortex/recommendations.md');
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
