/**
 * Block Destructive Commands — Global Hook
 * Blokuje nebezpecne prikazy v Bash tool ACROSS ALL PROJECTS.
 * Registrovany v ~/.claude/settings.json jako PreToolUse hook.
 */
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const command = (data.tool_input && data.tool_input.command) || '';
    const blocked = [
      // Filesystem destruction
      { p: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force|-[a-zA-Z]*f[a-zA-Z]*r)\b/, r: 'Recursive force delete blocked' },
      // Git — force/destructive operations
      { p: /git\s+push\s+.*--force\b/, r: 'Force push blocked' },
      { p: /git\s+push\s+.*-f\b/, r: 'Force push blocked' },
      { p: /git\s+reset\s+--hard\b/, r: 'Hard reset blocked' },
      { p: /git\s+clean\s+.*-f/, r: 'Git clean -f blocked' },
      { p: /git\s+branch\s+.*-D\b/, r: 'Force branch delete blocked' },
      { p: /git\s+checkout\s+\.\s*$/, r: 'Blanket checkout blocked — discard changes explicitly' },
      { p: /git\s+restore\s+\.\s*$/, r: 'Blanket restore blocked — restore files explicitly' },
      { p: /git\s+stash\s+(drop|clear)\b/, r: 'Stash destruction blocked' },
      // Database destruction
      { p: /DROP\s+TABLE/i, r: 'DROP TABLE blocked' },
      { p: /DROP\s+DATABASE/i, r: 'DROP DATABASE blocked' },
      { p: /TRUNCATE\s+/i, r: 'TRUNCATE blocked' },
      { p: /supabase\s+db\s+reset/i, r: 'Supabase DB reset blocked — use migrations' },
    ];
    for (const { p, r } of blocked) {
      if (p.test(command)) {
        console.log(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `BLOCKED: ${r}. Use a safer alternative.`
          }
        }));
        return;
      }
    }
    process.exit(0);
  } catch { process.exit(0); }
});
