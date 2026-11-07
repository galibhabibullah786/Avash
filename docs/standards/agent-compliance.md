# Agent Compliance — Making the Rules Hold Without Being Asked

**Read when:** configuring an AI agent for this repo, editing any agent config, or wondering why a hook refused something.

**Decides:** How rules are enforced across four layers, and what belongs in eager vs lazy context.

Every AI coding agent working in this repository must follow
`AGENTS.md`, `docs/standards/git-workflow.md`, and the rest of
`docs/standards/` **whether or not the person prompting it mentions them.**
A teammate who says only "add a rate limit to the report endpoint" has not
waived the promotion path, the testing requirement, or the secrets rule.

This document is how that is made true in practice. It is deliberately
structured worst-to-best: the layers at the top are the ones most people
build, and they are the ones that fail.

## The premise: documentation is not enforcement

An instruction file is a *request*. It is read probabilistically, competes
with everything else in the context window, and degrades as a session gets
longer — precisely when an agent is most likely to be doing something
consequential. Any compliance design that ends at "we wrote it in
`AGENTS.md`" is a design that works until the first long session.

Two failure modes follow, and they pull in opposite directions:

- **A rule that isn't auto-loaded is never read.** Nothing loads
  `docs/standards/*`. A rule that lives only there has approximately zero
  effect on behavior.
- **A rule buried in a large auto-loaded file is barely read either.**
  Attention dilutes. A 150-line `AGENTS.md` does not enforce ten rules ten
  times better than a 15-line one enforces one — it enforces each of them
  worse, and it spends context on every turn to do it.

So the answer is not "write more into `AGENTS.md`." It is a three-tier
split where each tier does one job:

| Tier | Content | Where | Budget |
|---|---|---|---|
| **Steer** | The non-negotiables + a routing table | `AGENTS.md`, `CLAUDE.md` | **AGENTS.md: 200–250 lines (≤ 320 combined)** |
| **Route** | Trigger → document, one line each | the table inside the above | ≤ 20 rows |
| **Reference** | Everything else, in full | `docs/**`, `.claude/skills/**` | unbounded |

The budget is a real constraint, not an aspiration. Adding a rule to Tier
1 means removing one or moving it to Tier 3 — otherwise the tier stops
working and every rule in it gets weaker.

So the rules are enforced in **four layers**, and each layer assumes the
one above it failed:

| Layer | Mechanism | Catches | Reliability |
|---|---|---|---|
| 1. Context | Instruction files every tool auto-loads | Nothing, on its own — it *informs* | Probabilistic |
| 2. Interception | Tool-level hooks that block an action before it runs | The action, at the moment it is attempted | Deterministic, per-tool |
| 3. Local gates | Git hooks (`core.hooksPath`) | Anything reaching git, from any tool or human | Deterministic, bypassable with `--no-verify` |
| 4. Remote gates | CI jobs and branch protection | Everything that reached the remote | Deterministic, not bypassable |

**Layer 4 is the only one that cannot be talked out of.** Layers 1–3 exist
to turn a layer-4 failure from a rejected PR into a thing that never
happened.

---

## Layer 1 — One canon, one routing table, lazy everything else

Different tools read different files. There is exactly one **canonical**
rule set; every other file points at it rather than restating it.

| File | Read by | Loaded | Role |
|---|---|---|---|
| `AGENTS.md` | Codex, Copilot, Cursor, Claude Code, most agent tooling | **eager** | **Canon.** Non-negotiables + the routing table. Nothing else |
| `CLAUDE.md` | Claude Code | **eager** | Commands + where-things-are. Restates no rules |
| `.claude/settings.json` | Claude Code | eager (small) | Skills list, hooks (Layer 2) |
| `.codex/config.yaml` | Codex CLI | eager | Non-negotiables + routing table |
| `.cursor/settings.json` | Cursor | eager | Non-negotiables + routing table |
| `.github/copilot-instructions.md` | Copilot / Copilot Workspace | eager | Non-negotiables + routing table |
| `.claude/skills/*/SKILL.md` | Claude Code | **lazy** — only the `description` is eager | Domain guidance, pulled in when the description matches the task |
| `.claude/commands/*.md` | Claude Code | **lazy** — on invocation | Slash commands |
| `docs/**` | any agent, via the routing table | **lazy** — on demand | Full detail, human-readable |
| `.agents/task-contracts.json` | any agent, role-scoped | **lazy** | Per-role scope, forbidden actions, definition of done |

### Lazy loading, two routes to the same document

**Claude Code — skills.** Only each skill's `name` and `description` sit
in context (a line or two apiece). The body loads when the description
matches what the agent is doing. So a `description` is not a summary — it
is a **trigger**, and it must enumerate the actions that should pull the
skill in ("before creating a `*.test.ts` file", "when a hook refuses a
command"), not describe the topic ("about testing"). A vague description
is a skill that never fires.

**Every other tool — the routing table.** No other tool has a skill
system, so the portable equivalent is a ~15-row `about to… → read` table
inside the eager file. It costs a few hundred tokens once, and it converts
"the agent might think to look" into "the agent knows exactly which one
file to open." Both routes are maintained and both point at the same
document; the skill body carries the decision inline, the doc carries the
full detail.

**The rule for authors:** a rule belongs in Tier 1 only if violating it is
irreversible or expensive *and* it applies to nearly every task. Everything
conditional — "when writing a test", "when touching a workflow" — is a
routing-table row, because that is exactly the shape lazy loading handles.

**The duplication rule.** A rule is written in full in exactly one place.
Every other file carries a short digest and a pointer. Restating a rule in
five files guarantees five versions of it within a month, and an agent that
finds two versions will follow whichever it read last.

**The sync gate.** `scripts/agent-sync.mjs` runs in CI and fails the
build when:

- a pointer file's embedded `AGENTS.md` content hash does not match the
  current `AGENTS.md`;
- `.claude/settings.json` lists a skill with no directory on disk, or a
  skill directory exists that it does not list;
- a skill's frontmatter is missing `name`/`description`, or its
  `description` does not name a triggering **action** (the check greps for
  an imperative — "use when", "invoke before" — because a topic-shaped
  description never fires);
- `.agents/task-contracts.json` references an `R<n>` rule or a doc path
  that does not exist;
- a routing-table row points at a file that does not exist, or a
  `docs/standards/*.md` file has no row pointing at it;
- a tool config file exists that the table above does not list;
- **the eager-tier budget is exceeded** — `AGENTS.md` outside 200–250 lines
  or `AGENTS.md` + `CLAUDE.md` over 320 lines combined, or any routing table over 20 rows. This is the check
  that keeps Tier 1 from silently growing back into the thing it replaced.

This is what stops the quiet drift where `AGENTS.md` gains a rule and the
Cursor config keeps teaching the old one. Any change to `AGENTS.md` fails
CI until every pointer file is re-synced — which is the intended cost.

### What each pointer file must contain

At minimum, and as its first content:

1. "The canonical rule set is `AGENTS.md`. Read it before acting. If this
   file and `AGENTS.md` disagree, `AGENTS.md` wins."
2. The current `AGENTS.md` content hash, in the field
   `agentsMdSha256` (JSON/YAML) or an HTML comment (Markdown).
3. The non-negotiables — worth the redundancy because violating them is
   expensive and irreversible.
4. The routing table, so the tool has a lazy-loading path even without a
   skill system.

And must **not** contain: prose explaining *why* a rule exists, worked
examples, tables of thresholds, or anything conditional on the kind of
task. All of that is Tier 3. The pointer file's job is to make an agent
open the right document, not to be the document.

### Writing for the eager tier

Same content, very different token cost:

- **Tables over prose.** A rule per row, no connective tissue.
- **Imperatives over rationale.** "Never push a feature branch" belongs in
  Tier 1; *why* belongs in `docs/standards/git-workflow.md`. An agent
  needs the constraint; a human reviewing the constraint needs the reason.
- **One canonical statement.** The same rule restated in six files becomes
  six divergent rules within a month, and an agent that meets two versions
  follows whichever it read last.
- **Name the file, not the section.** Deep `§` references go stale;
  filenames rarely do.

---

## Layer 2 — Tool hooks: refuse the action, don't warn about it

Where a tool supports hooks, the rules that matter are enforced as hooks,
because a hook runs regardless of what the agent believes it is allowed to
do.

### Claude Code (`.claude/settings.json`)

Three hooks carry the load:

**`SessionStart` — inject the canon, every session, unprompted.** Emits the
promotion path, the current branch, and the testing rule into context at
session start. This is the layer that answers "my teammate forgot to
mention the workflow": nobody has to mention it, because it is in the
context before the first prompt is read.

**`PreToolUse` on `Bash` — block the irreversible commands.** Pattern-match
the command string and deny outright:

| Denied | Why |
|---|---|
| `git push` where the current branch is not `dev` or `main` | Feature branches are local-only (`docs/standards/git-workflow.md`) |
| `git push` with any `upstream` remote from a non-`dev` ref | The promotion path is `origin/dev` → `upstream/dev` |
| `gh pr create` with `--base main` from anything but `dev` | Never PR straight into `main` |
| `git commit --no-verify`, `git push --no-verify` | Bypasses Layer 3 |
| `wrangler secret put`, `wrangler deploy` without an explicit human request | Deploys are not a side effect of a coding task |
| `git push --force` / `-f` on `dev` or `main` | Destroys shared history |

A denial returns a message naming the rule and the document, so the agent
redirects rather than retries a variant. Denials are the point: a hook that
only warns is Layer 1 with extra steps.

**`PostToolUse` on `Edit`/`Write` — cheap deterministic checks on the
touched files.** Not an agent review (see below), just the fast things:
`scripts/check-internal-refs.mjs`, and `scripts/scan-client-env.mjs` when
the edit was under `apps/web/src`. Milliseconds, no false positives, no
model call.

**What is deliberately *not* a hook: a per-edit review agent.** Spawning a
QA or security agent after every file write is the most common
agent-workflow mistake in this space and it is worth naming so nobody adds
it later:

- It sees a half-finished change — the caller updated, the callee not yet —
  and reports defects that are artifacts of the moment it looked. Two weeks
  of that and the team ignores the reviewer, which is how a gate dies.
- It duplicates work that `eslint`, `tsc`, and CodeQL already do
  deterministically, faster, and without false positives.
- N agents over N files each see too little context to judge anything.

Review happens once per **diff checkpoint**, not per file, with one agent
per *concern* (correctness, security, performance) over the whole change.
Every finding must carry a concrete `failure_scenario` — inputs → wrong
output. A finding that cannot state one is an opinion, and opinions do not
block merges. When a finding recurs across reviews, promote it to a lint or
`semgrep` rule: that is the ratchet, and it converts a probabilistic check
into a deterministic one permanently.

### Other tools

Cursor, Copilot, and Codex expose less hook surface. They get the Layer 1
pointer and rely on Layers 3 and 4 — which is exactly why Layers 3 and 4
are not optional. **Assume every rule that only exists in Layer 1 or 2 will
be violated by whichever tool has the weakest hook support.**

---

## Layer 3 — Git hooks: tool-independent, human-independent

Git hooks catch everything that reaches git, from any tool, including a
human in a hurry. They live in a tracked `.githooks/` directory (not
`.git/hooks/`, which is not tracked and not shared) and are activated by:

```bash
git config core.hooksPath .githooks
```

`package.json`'s `prepare` script runs this on `pnpm install`, so a fresh
clone is protected after the first install with no extra step.

| Hook | Enforces |
|---|---|
| `pre-commit` | `scripts/check-internal-refs.mjs`; `scripts/scan-client-env.mjs` when `apps/web/src` is staged; `eslint --max-warnings=0` on staged files |
| `commit-msg` | Conventional Commits type from `docs/standards/git-workflow.md`; rejects internal planning labels in the subject or body |
| `pre-push` | **Refuses to push any branch but `dev` or `main`**; refuses a force-push to either; refuses a push to `upstream` from a ref other than `dev` |

`pre-push` is the single highest-value hook in the repository, because the
promotion-path rule is the one whose violation is most annoying to undo —
a feature branch on a remote has to be deleted, and any PR opened from it
closed, before work can continue.

**On `--no-verify`.** It exists and cannot be disabled. That is fine and
expected: Layer 3's job is to make the wrong thing require a deliberate,
visible act, not to make it impossible. Layer 4 catches what Layer 3 did
not, and a `--no-verify` in a shell transcript is a reviewable event.

---

## Layer 4 — CI and branch protection: the layer that cannot be argued with

Two scripts run in `ci.yml`'s `static-analysis` job:

**`scripts/check-promotion-path.mjs`** — fails the run when:

- a pull request's head ref is neither `dev` nor a `hotfix/*` branch
  (feature branches must never reach a remote at all, so a PR from one is
  proof the earlier layers were bypassed);
- a pull request's base ref is `main` and its head ref is not `dev`;
- the pushed ref is `main` and the commit is not a merge from `dev`.

**`scripts/agent-sync.mjs`** — the Layer 1 sync gate described above.

Alongside them, on the GitHub side:

- **Branch protection on `main` and `dev`**: required status checks (the
  `pipeline / …` job names — see `docs/ci-cd.md`), no force-push, no
  deletion, linear history on `main`.
- **Required reviewers on the `production` environment**
  (`docs/security/github-environments.md`) — so even a green pipeline
  cannot reach production unattended.

An agent cannot hook, prompt, or reason its way past any of this, which is
the property the other three layers do not have.

---

## The rules that must survive all four layers

If everything else in this document is forgotten, these are the ones the
enforcement exists for:

1. **The promotion path.** Feature branches are local-only. Local feature
   branch → local `dev` → local gates green → push `dev` → Actions green
   on `origin` → PR `origin/dev` → `upstream/dev`. Never a remote feature
   branch, never a PR into `main` from anything but `dev`.
   (`docs/standards/git-workflow.md`)
2. **Secrets never reach `apps/web`.** No non-`VITE_PUBLIC_` reference
   under `apps/web/src`, ever. (`docs/security/secrets-matrix.md`)
3. **No gate is ever weakened to go green.** Not a test, not an assertion,
   not a lint rule, not a manual-test description, not a coverage
   threshold. A failing gate is reported as failing.
4. **Both automated layers plus the manual protocol.** Vitest and
   Playwright and the three-pass passes — none substitutes for another.
   (`docs/standards/testing.md`)
5. **Docs change in the same commit as the code.**
   (`docs/PROJECT_PLAN.md` §12)
6. **No internal planning label in anything that ships.**
   (`CONTRIBUTING.md` § Terminology, `scripts/check-internal-refs.mjs`)
7. **Conflict with `docs/PROJECT_PLAN.md` stops work.** Flag it; do not
   resolve it unilaterally, and do not proceed on the assumption that the
   plan is stale.

## Onboarding a new agent tool

When adding a tool not in the Layer 1 table:

1. Create its instruction file with the three required contents listed
   under § What each pointer file must contain.
2. Add it to the table in this document **and** to the allow-list in
   `scripts/agent-sync.mjs` — an unlisted config file fails the gate
   by design, so that a config nobody reviewed cannot appear silently.
3. Map its hook surface to Layer 2. If it has none, say so explicitly in
   the table rather than leaving it blank; a blank reads as unexamined.
4. Verify by asking it to do something the rules forbid — push a feature
   branch is the standard probe — and confirm the refusal comes from a
   layer, not from politeness.

## Current status

All four layers are implemented and verified running:

- **Layer 1** — every pointer file exists, hash-stamped to `AGENTS.md`,
  and `pnpm agent:sync` passes.
- **Layer 2** — `.claude/settings.json` wires `SessionStart`
  (`scripts/hooks/session-start.mjs`), `PreToolUse` on `Bash`
  (`scripts/hooks/bash-guard.mjs`, denying the table above), and
  `PostToolUse` on `Edit`/`Write`/`NotebookEdit`
  (`scripts/hooks/agent-file-edited.mjs`).
- **Layer 3** — `.githooks/pre-commit`, `.githooks/commit-msg`, and
  `.githooks/pre-push` all exist; `core.hooksPath` is wired via
  `package.json`'s `prepare` script.
- **Layer 4** — `scripts/agent-sync.mjs` and
  `scripts/check-promotion-path.mjs` both run in `ci.yml`'s
  `static-analysis` job. Branch protection and the `production`
  environment's required reviewers are GitHub-side configuration this
  repository's files cannot set on their own — see the project's
  handoff notes for the exact steps.
