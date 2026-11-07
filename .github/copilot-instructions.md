<!-- agentsMdSha256: d504c51a5f0bb33ea98c76d668cfa0127edf26a677701dd08bdc983de8f2394d -->

# Copilot Instructions — Avash

**Canon is [`AGENTS.md`](../AGENTS.md).** Read it before acting; if this
file disagrees with it, `AGENTS.md` wins. Rules apply unprompted — "just
add the endpoint" waives nothing.

Stack: `apps/web` = React 18 + Vite static SPA, no SSR, no server.
`apps/api` = Hono on Cloudflare Workers, holds everything privileged.
Jobs = scheduled GitHub Actions → Supabase directly. Shared types live
only in `packages/types`.

## Non-negotiable

1. **Promotion path.** Feature branches are local-only. Local branch →
   local `dev` → gates green → push `dev` → PR `origin/dev` →
   `upstream/dev`. Never PR into `main` from anything but `dev`.
2. **No non-`VITE_PUBLIC_` reference under `apps/web/src`**, ever.
3. **Never weaken a gate to go green.** Report red as red.
4. **Both test layers + the three-pass manual protocol.** None
   substitutes for another.
5. **Docs change in the same commit as the code.**
6. **No internal planning label** (milestone/phase numbers, task IDs) in
   anything that ships.

## Read before you act

Load the row that matches the task — not the whole list.

| About to… | Read |
|---|---|
| write or move a test | `docs/standards/testing.md` |
| push, branch, or open a PR | `docs/standards/git-workflow.md` |
| work alongside another agent/dev | `docs/standards/parallel-work.md` |
| add an `apps/api` route | `docs/standards/backend.md` |
| write React in `apps/web` | `docs/standards/frontend.md` |
| add an env var or secret | `docs/security/secrets-matrix.md` |
| edit a workflow | `docs/ci-cd.md` |
| deploy by hand | `docs/manual-deploy.md` |
| write a migration or spatial SQL | `docs/data-schema/schema.md` |
| add a threshold or magic number | `docs/constants-registry.md` |
| write an implementation plan for a feature | `docs/standards/implementation-plans.md` |
| touch a Dockerfile or `compose.yaml` | `docs/docker.md` |
| secure a feature / fill in STRIDE | `docs/security/threat-model.md` |
| gate anything on a user's role or permission | `docs/features/rbac.md` |
| edit an agent config | `docs/standards/agent-compliance.md` |
| pick up a defined role's scope + DoD | `.agents/task-contracts.json` |

Testing in one line: **does the test drive a running process from the
outside?** No → Vitest (`*.test.ts`). Yes → Playwright (`*.spec.ts`).
