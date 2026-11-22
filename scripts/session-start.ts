/**
 * Claude Code's SessionStart and SubagentStart hook: install when node_modules was not
 * installed from this lockfile.
 *
 * A worktree under .claude/worktrees is a fresh checkout with no node_modules, so a session
 * started in one would otherwise meet its first `pnpm gate` as "command not found". It also
 * catches the main checkout after a pull that moved the lockfile. Both events, because a
 * subagent given `isolation: "worktree"` gets no SessionStart — measured on Claude Code 2.1.280,
 * 24 Sep 2026: it started in .claude/worktrees/agent-<id> with no node_modules and no hook
 * output. SubagentStart fires for it, with the subagent's worktree as `cwd`.
 *
 * Not the WorktreeCreate hook: that replaces worktree creation wholesale and switches
 * .worktreeinclude off, so the env files would stop being copied. This runs on every session
 * start instead, and when nothing changed it costs one file compare — pnpm keeps a copy of the
 * lockfile it installed from at node_modules/.pnpm/lock.yaml, byte-identical to
 * pnpm-lock.yaml (measured 24 Sep 2026). A fresh worktree installed in 1.1 s from a warm
 * store; an install with nothing to do took 0.36 s, which is why this compares first.
 *
 * What it says lands in the session's (or the subagent's) context, as `additionalContext`, so
 * it says something only when it acted or could not.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Input = { readonly cwd: string; readonly event: string | null };

/**
 * The directory comes from the hook's input, not the environment: CLAUDE_PROJECT_DIR names the
 * main checkout even in a worktree. Run by hand, there is no input and no event.
 */
function readInput(): Input {
  const byHand = { cwd: process.cwd(), event: null };
  if (process.stdin.isTTY) return byHand;
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return byHand;
  }
  if (typeof input !== 'object' || input === null) return byHand;
  const cwd = 'cwd' in input && typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const event =
    'hook_event_name' in input && typeof input.hook_event_name === 'string'
      ? input.hook_event_name
      : null;
  return { cwd, event };
}

const { cwd: dir, event } = readInput();

function say(message: string): void {
  if (event === null) console.log(message);
  else {
    const hookSpecificOutput = { hookEventName: event, additionalContext: message };
    console.log(JSON.stringify({ hookSpecificOutput }));
  }
}

let root: string;
try {
  root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  say(`session-start: ${dir} is not inside a git checkout; dependencies not checked.`);
  process.exit(0);
}

const lock = join(root, 'pnpm-lock.yaml');
if (!existsSync(lock)) {
  say(`session-start: no pnpm-lock.yaml in ${root}; run \`pnpm install\` before the gate.`);
  process.exit(0);
}
const installedFrom = join(root, 'node_modules', '.pnpm', 'lock.yaml');
if (existsSync(installedFrom) && readFileSync(installedFrom).equals(readFileSync(lock))) {
  process.exit(0);
}

const why = existsSync(installedFrom)
  ? 'the lockfile changed since the last install'
  : 'nothing was installed in this checkout';
const started = Date.now();
const result = spawnSync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], {
  cwd: root,
  encoding: 'utf8',
});
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (result.status === 0) {
  say(`session-start: installed dependencies in ${root} (${why}), ${seconds} s.`);
} else {
  const output = `${result.stdout}${result.stderr}`.trim().split('\n').slice(-15).join('\n');
  say(
    `session-start: \`pnpm install --frozen-lockfile\` FAILED in ${root} (${why}). ` +
      `Nothing in this checkout will run until it succeeds:\n${output}`,
  );
}
