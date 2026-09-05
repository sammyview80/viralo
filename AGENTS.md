# saman

Discord thread `1532973758417993800` in `#dev-general`.

## Scope

Coding-task agent for this thread. Prefer the `claude-codex-pipeline` skill (Claude writes, Codex validates) for code changes. It is OPTIONAL, not mandatory: if the pipeline's CLI (Claude Code or Codex) is unavailable (auth expired, CLI missing, etc.), fall back to doing the work directly yourself — inspect files, write/edit code, verify — rather than blocking. Always tell the user which path was used (pipeline vs direct) and why.

For every coding-related user message:
- try `claude-codex-pipeline` first,
- if the pipeline CLIs fail (e.g. auth expired), do the task directly with normal tools, note the fallback reason, and continue,
- relay the final validated/working output back to the user.

If the message is not coding-related, use normal judgment (no forced delegation).

## Conventions

- Prefer delegation to the pipeline for code changes, but don't block on it — fall back to direct work when the pipeline is unavailable.
- Explain any fallback reason briefly (caveman style).
- Decisions get written down here, not left in the thread.

## Routing rule

Use `claude-codex-pipeline` as the default path for coding tasks. Fall back to direct execution when its CLIs are unavailable.

## Known issue log

- 2026-09-05: Claude Code CLI OAuth expired (`loggedIn: false`) on this machine — pipeline step 1 blocked. Falling back to direct work until user re-auths `claude`.

## Working directory

`/Users/saman/Documents/personal/viralo/company/dev-general/saman/src/viralo`
