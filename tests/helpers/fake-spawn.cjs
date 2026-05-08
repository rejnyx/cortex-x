'use strict';

// Fake `child_process.spawn` for deterministic subprocess tests.
// Returns an EventEmitter whose .stdout/.stderr emit configured chunks
// and which emits 'close' on process.nextTick with a configured exit code.
//
// Usage:
//   const fake = makeFakeSpawn({ stdout: '...', stderr: '', code: 0 });
//   const result = await engine.applyAction({...}, { spawnImpl: fake.spawn });
//   assert(fake.calls.length === 1);
//   assert(fake.calls[0].argv.includes('-p'));
//
// Capture-only: each invocation pushes a record to fake.calls with
// { cmd, argv, options, stdinChunks } so tests can assert on them.

const { EventEmitter } = require('node:events');
const { Readable, Writable } = require('node:stream');

function makeFakeSpawn(scenario = {}) {
  const calls = [];

  function spawn(cmd, argv, options) {
    const call = {
      cmd,
      argv: Array.from(argv || []),
      options: options || {},
      stdinChunks: [],
    };
    calls.push(call);

    const child = new EventEmitter();

    // stdout: emit one chunk if scenario.stdout is non-empty.
    child.stdout = new Readable({
      read() {
        if (scenario.stdout) {
          this.push(Buffer.from(scenario.stdout, 'utf8'));
        }
        this.push(null);
      },
    });

    // stderr: emit one chunk if scenario.stderr is non-empty.
    child.stderr = new Readable({
      read() {
        if (scenario.stderr) {
          this.push(Buffer.from(scenario.stderr, 'utf8'));
        }
        this.push(null);
      },
    });

    // stdin: capture writes for assertion.
    child.stdin = new Writable({
      write(chunk, _enc, cb) {
        call.stdinChunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
        cb();
      },
    });

    // Hold the child alive briefly so stdout/stderr listeners attach,
    // then emit 'close'. If scenario.never is true, never emit (timeout test).
    if (!scenario.never) {
      // Use setImmediate to let consumer wire `.on('data', ...)` + `.on('close')`
      // before we fire close. nextTick fires too early on some Node versions.
      setImmediate(() => {
        if (scenario.spawnError) {
          child.emit('error', scenario.spawnError);
          return;
        }
        const code = typeof scenario.code === 'number' ? scenario.code : 0;
        const signal = scenario.signal || null;
        child.emit('close', code, signal);
        child.emit('exit', code, signal);
      });
    }

    // kill is a no-op for the fake (we already control 'close').
    child.kill = () => true;

    return child;
  }

  return { spawn, calls };
}

module.exports = { makeFakeSpawn };
