# Agent tooling: treehouse + no-mistakes

Two optional CLIs that make multi-agent work on this repo faster and safer. Both are
Go binaries built from source (require Go 1.25+) from https://github.com/kunchenguid.
Neither is required to develop the app — they support the agent workflow.

## treehouse — pre-warmed worktree pool

Maintains a pool of reusable git worktrees so an agent can grab an isolated, ready-to-run
checkout in ~2s instead of creating a worktree and reinstalling deps.

**Repo config:** [`treehouse.toml`](../treehouse.toml) — `max_trees` caps the pool size.
Executable hooks are intentionally *not* allowed in repo config; they live per-machine in
`~/.config/treehouse/config.toml`.

**Per-machine setup (once):** add a `post_create` hook that links the heavy gitignored
dirs from your main checkout into each pool worktree, so trees are usable with no install:

```toml
# ~/.config/treehouse/config.toml
[hooks]
post_create = ["sh \"$HOME/.config/treehouse/hooks/link-deps.sh\""]
```

```sh
# ~/.config/treehouse/hooks/link-deps.sh — symlinks node_modules + .env from the
# main checkout. Deliberately does NOT link .next: each worktree keeps its own build
# cache to avoid Turbopack serving stale RSC/CSS across branches.
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
for item in node_modules .env .env.local; do
  [ -e "$main/$item" ] && [ ! -e "./$item" ] && ln -sfn "$main/$item" "./$item"
done
```

**Usage:**

```sh
treehouse get                 # acquire a warm worktree, drops you into a subshell
git switch -c feat/my-change  # trees come up on detached HEAD (reset to main); branch first
# ...work...
exit                          # returns the worktree to the pool for reuse
treehouse status              # show the pool
```

## no-mistakes — local pre-push gate

A local git proxy: instead of `git push origin`, you push to a `no-mistakes` remote (or run
`no-mistakes axi run`). It validates the diff in a disposable worktree (review → test →
document → lint), then forwards to `origin` and opens a PR only once checks pass.

**Repo config:** [`.no-mistakes.yaml`](../.no-mistakes.yaml). Key choices for this repo:

- The gate worktree has **no `node_modules`** (it's gitignored), so `commands.test` runs
  `pnpm install --frozen-lockfile --prefer-offline` before `pnpm typecheck`. Install is fast
  because pnpm hard-links from its global store.
- `auto_fix.*: 0` — the gate never rewrites our code automatically; findings pause for human
  approval.
- `intent.enabled: false` — no scanning of local agent transcripts.

**Per-machine setup:**

```sh
no-mistakes init                 # adds the no-mistakes remote + gate, installs the agent skill
export NO_MISTAKES_TELEMETRY=0   # opt out of the tool's (self-hostable Umami) analytics
```

**Usage:**

```sh
git push no-mistakes my-branch   # runs the gate, then pushes to origin + opens a PR
no-mistakes axi run --intent "…" # same, driven non-interactively (for agents/automation)
```

**Notes:**

- The review and document steps are agent-driven (they invoke `claude`), so every gated push
  spends some tokens. There is no fully-deterministic mode.
- No native Slack/webhook integration. The team-visible artifact is the GitHub PR it opens;
  notifications would be a separate layer (e.g. a GitHub Action on PR-opened).
