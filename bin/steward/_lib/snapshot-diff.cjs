// Sprint 2.5 — zero-deps JSON snapshot diff helper.
//
// Compares two flat metrics objects (key → number) and produces a list of
// drift events with absolute + percentage delta. Designed for the
// tech_debt_audit kind's drift-detection logic but kept generic enough to
// reuse for any week-over-week metrics comparison.
//
// Why hand-rolled (not lodash deepDiff or jsondiffpatch): zero-deps is
// invariant. The metrics surface is intentionally flat (no nested objects
// beyond top_offenders array) — full deep-diff is overkill.

'use strict';

// Compute drift between two metrics objects. Returns:
//   {
//     metrics: { metricName: { prev, current, delta_abs, delta_pct } },
//     triggered: [{ metric, kind, message, threshold, current, prev }],
//   }
//
// `triggers` is a list of threshold rules:
//   { metric: 'duplication_pct', kind: 'increase_pp', threshold: 2 }
//     → fire when current - prev > threshold (in percentage points)
//   { metric: 'max_function_complexity', kind: 'absolute', threshold: 15 }
//     → fire when current > threshold (regardless of prev)
//   { metric: 'test_source_ratio', kind: 'pct_drop', threshold: 20 }
//     → fire when (prev - current) / prev * 100 > threshold (% drop)
//   { metric: 'knip_unused_exports', kind: 'increase_count', threshold: 3 }
//     → fire when current - prev > threshold (absolute count)
function computeSnapshotDrift(prev, current, triggers = []) {
  const metrics = {};
  const triggered = [];

  // Sprint 2.5 R2 fix (edge MAJOR): guard null/undefined current root + non-
  // object metrics shape. Returns empty result rather than throwing.
  if (!current || typeof current !== 'object' || !current.metrics || typeof current.metrics !== 'object' || Array.isArray(current.metrics)) {
    return { metrics, triggered };
  }

  // Compute per-metric deltas (only for keys present in current).
  for (const key of Object.keys(current.metrics)) {
    const c = current.metrics[key];
    const p = (prev && prev.metrics && typeof prev.metrics[key] === 'number') ? prev.metrics[key] : null;
    if (typeof c !== 'number' || !Number.isFinite(c)) continue;
    const entry = { current: c };
    if (p !== null && Number.isFinite(p)) {
      entry.prev = p;
      entry.delta_abs = c - p;
      entry.delta_pct = p === 0 ? null : ((c - p) / p) * 100;
    }
    metrics[key] = entry;
  }

  // Evaluate triggers.
  for (const trig of triggers) {
    const m = metrics[trig.metric];
    if (!m) continue;
    const cur = m.current;
    const prv = m.prev;
    const thr = trig.threshold;
    let fire = false;
    let message = '';

    switch (trig.kind) {
      case 'increase_pp':
        if (prv !== undefined && (cur - prv) > thr) {
          fire = true;
          message = `${trig.metric} ↑ ${prv.toFixed(2)} → ${cur.toFixed(2)} (+${(cur - prv).toFixed(2)}pp, threshold +${thr}pp)`;
        }
        break;
      case 'absolute':
        if (cur > thr) {
          fire = true;
          message = `${trig.metric} = ${cur} (threshold ≤ ${thr})`;
        }
        break;
      case 'pct_drop':
        if (prv !== undefined && prv > 0) {
          const dropPct = ((prv - cur) / prv) * 100;
          if (dropPct > thr) {
            fire = true;
            message = `${trig.metric} ↓ ${prv.toFixed(2)} → ${cur.toFixed(2)} (-${dropPct.toFixed(1)}%, threshold -${thr}%)`;
          }
        }
        break;
      case 'increase_count':
        if (prv !== undefined && (cur - prv) > thr) {
          fire = true;
          message = `${trig.metric} ↑ ${prv} → ${cur} (+${cur - prv}, threshold +${thr})`;
        }
        break;
      default:
        // Unknown trigger kind — skip silently (forward-compat).
        break;
    }

    if (fire) {
      triggered.push({
        metric: trig.metric,
        kind: trig.kind,
        threshold: thr,
        current: cur,
        prev: prv,
        message,
      });
    }
  }

  return { metrics, triggered };
}

// Default trigger set per Sprint 2.5 R1 §2.2.
// Sprint 2.5c — added test_count regression trigger: any month-over-month
// drop > 5% in distinct test-file count is suspicious (mass deletion or
// .skip-bombing without operator awareness).
const DEFAULT_TRIGGERS = Object.freeze([
  { metric: 'duplication_pct', kind: 'increase_pp', threshold: 2 },
  { metric: 'max_function_complexity', kind: 'absolute', threshold: 15 },
  { metric: 'knip_unused_exports', kind: 'increase_count', threshold: 3 },
  { metric: 'test_source_ratio', kind: 'pct_drop', threshold: 20 },
  { metric: 'test_count', kind: 'pct_drop', threshold: 5 },
]);

module.exports = { computeSnapshotDrift, DEFAULT_TRIGGERS };
