#!/usr/bin/env node
// Comprehensive regression test — runs both detectors on all Dave's known projects.
const path = require('path');
const os = require('os');
const { detect: detectProfile } = require(path.join(os.homedir(), '.claude', 'shared', 'detectors', 'detect-profile.cjs'));
const { detect: detectStage } = require(path.join(os.homedir(), '.claude', 'shared', 'detectors', 'detect-stage.cjs'));

const projects = [
  ['RELO (back-office-bot)', path.join(os.homedir(), 'Desktop', 'APPs', 'back-office-bot')],
  ['custom-chatbot', path.join(os.homedir(), 'Desktop', 'APPs', 'custom-chatbot')],
  ['WaaS (hustle-masterbarbertemplate)', path.join(os.homedir(), 'Desktop', 'APPs', 'hustle-masterbarbertemplate')],
  ['kiosek-main', path.join(os.homedir(), 'Desktop', 'APPs', 'kiosek-main')],
  ['AMD ReplayAgent', path.join(os.homedir(), 'Desktop', 'APPs', 'amd-hackathon-2026')],
  ['cortex-x itself', path.join(os.homedir(), 'Desktop', 'APPs', 'cortex-x')],
  ['OrderMage admin-main', path.join(os.homedir(), 'Downloads', 'admin-main', 'admin-main')],
];

for (const [name, dir] of projects) {
  console.log(`\n=== ${name} ===`);
  const pr = detectProfile(dir);
  const st = detectStage(dir);
  const top = pr.top;
  if (top) {
    console.log(`  profile:    ${top.name.padEnd(20)} ${top.score.toFixed(2)} [${top.confidence}]`);
    if (top.matched.length > 0) console.log(`  matched:    ${top.matched.join('; ')}`);
  } else {
    console.log(`  profile:    none`);
  }
  if (pr.monorepo) console.log(`  monorepo:   ${pr.monorepo} (${pr.workspaceCount} sub-packages)`);
  if (pr.language) {
    const L = pr.language;
    console.log(`  language:   js_primary=${L.is_js_primary} mixed=${L.is_mixed_stack} non_js=${L.non_js_languages.join(',') || '-'}`);
  }
  console.log(`  stage:      ${st.stage} (confidence ${(st.confidence || 0).toFixed(2)})`);
  console.log(`  evidence:   ${(st.evidence || []).join(', ')}`);
  if (st.error) console.log(`  error:      ${st.error}`);
}
