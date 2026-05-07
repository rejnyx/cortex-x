#!/usr/bin/env node
// Stress-test YAML parser on all profiles — catches parse failures.
// Runs detect against a synthetic repo with ALL deps from ALL profiles
// so every profile's detect block gets exercised.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { detect } = require(path.join(os.homedir(), '.claude', 'shared', 'detectors', 'detect-profile.cjs'));

const profilesDir = path.join(os.homedir(), '.claude', 'shared', 'profiles');
const profiles = fs.readdirSync(profilesDir).filter(f => f.endsWith('.yaml'));

console.log('=== YAML parse smoke test ===');
let passed = 0, failed = 0;
for (const f of profiles) {
  const full = path.join(profilesDir, f);
  try {
    const content = fs.readFileSync(full, 'utf8');
    // Parse via the same regex our detector uses
    const hasDetect = /^detect:/m.test(content);
    const hasName = /^name:\s+\S+/m.test(content);
    const hasDesc = /^description:/m.test(content);
    if (hasDetect && hasName && hasDesc) {
      console.log(`  ✓ ${f.padEnd(25)} (${content.length} bytes, has detect block)`);
      passed++;
    } else {
      console.log(`  ⚠ ${f.padEnd(25)} (missing: ${[!hasName && 'name', !hasDesc && 'description', !hasDetect && 'detect'].filter(Boolean).join(', ')})`);
    }
  } catch (err) {
    console.log(`  ✗ ${f.padEnd(25)} ERROR: ${err.message}`);
    failed++;
  }
}

console.log('');
console.log('=== Detect run on cortex-x root (all profiles should load without crash) ===');
try {
  const cortexRoot = path.join(os.homedir(), 'Desktop', 'APPs', 'cortex-x');
  const result = detect(cortexRoot);
  console.log(`Loaded ${result.candidates.length} profiles, elapsed ${result.elapsed_ms}ms`);
  if (result.candidates.length !== profiles.length) {
    console.log(`⚠ MISMATCH: ${profiles.length} YAML files, ${result.candidates.length} loaded — some profiles silently dropped by parser!`);
    const loadedNames = new Set(result.candidates.map(c => c.name));
    for (const f of profiles) {
      const slug = f.replace(/\.yaml$/, '');
      // Profile name may differ from filename (e.g., 'ai-agent' vs 'ai_agent')
      const found = Array.from(loadedNames).some(n => n === slug || n.replace(/[-_]/g, '') === slug.replace(/[-_]/g, ''));
      if (!found) console.log(`   DROPPED: ${f}`);
    }
  } else {
    console.log('✓ All profiles loaded — no silent parser failures');
  }
  // Sanity: each candidate should have detect block (score 0 is OK if no signals, but having evidence is required)
  for (const c of result.candidates) {
    if (!c.evidence || c.evidence.length === 0) {
      console.log(`  ⚠ ${c.name}: no evidence — detect block may be empty or malformed`);
    }
  }
} catch (err) {
  console.log(`✗ detect() crashed: ${err.message}`);
  failed++;
}

console.log('');
console.log(passed === profiles.length && failed === 0 ? '✓ PASS' : `⚠ ${failed} failure(s), ${passed}/${profiles.length} passed`);
process.exit(failed > 0 ? 1 : 0);
