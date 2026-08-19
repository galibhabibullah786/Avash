import { describe, test, expect } from 'vitest';

/**
 * This project's `tsconfig`s don't include `vite/client`'s ambient types
 * (out of this task's fence to add), so `import.meta.glob` — real at
 * runtime, since Vitest's transform step is Vite's — needs a minimal local
 * shim to typecheck. Narrowed to exactly the call shape used below.
 */
declare global {
  interface ImportMeta {
    glob(pattern: string, options: { query: string; import: string; eager: true }): Record<string, string>;
  }
}

/**
 * Every mutating route handler (`.post(`, `.patch(`, `.put(`, `.delete(`)
 * must reference `writeAuditEntry` or `recordAudit` somewhere in its
 * file — the two sanctioned paths to `audit_log` (`uploads.ts`,
 * `admin-users.ts`, `reports.ts`, `resources.ts` open-code the former;
 * `alerts.ts`/`announcements.ts` use the latter, factored helper). This
 * is a coarse, file-level check (a route file with a genuine mix of
 * audited and unaudited mutations would still pass), not a full AST
 * walk — cheap enough to run every time, and it is proven to fail loudly
 * rather than rubber-stamp silently (see the workflow in this file's
 * header comment history / the PR description for the before/after run).
 *
 * Route source is pulled in via `import.meta.glob` with `query: '?raw'`
 * rather than `node:fs` — this suite runs inside workerd (Miniflare), not
 * Node (`docs/standards/testing.md`), and workerd's virtualized
 * `nodejs_compat` filesystem does not resolve this repo's real Windows
 * paths reliably. `import.meta.glob` resolves and inlines file contents
 * at Vite's transform step, before the workerd sandbox is involved, which
 * sidesteps that entirely.
 */

const routeModules = import.meta.glob('../src/routes/*.ts', { query: '?raw', import: 'default', eager: true });

const AUDIT_CALL_PATTERN = /\bwriteAuditEntry\b|\brecordAudit\b/;
const MUTATING_HANDLER_PATTERN = /\.(post|patch|put|delete)\(/;

/**
 * Explicit allow-list for route files that register a mutating-verb
 * handler but genuinely never write to `audit_log` — kept as a seam for
 * a legitimate future case, not because one exists carelessly today.
 * Each entry must name the reason so a future addition can't slip in
 * silently.
 */
const ALLOWED_UNAUDITED_ROUTES: Record<string, string> = {
  'symptom-check.ts':
    'POST /api/symptom-check only classifies free text via Gemini into a checklist and returns a triage ' +
    'outcome — it writes nothing to any table, so there is no state change to audit.',
};

function routeFileName(modulePath: string): string {
  return modulePath.split('/').at(-1) ?? modulePath;
}

describe('every mutating route handler is audited', () => {
  const entries = Object.entries(routeModules);

  test('the routes glob actually matched files (sanity check the scan ran)', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  test.each(entries)('%s', (modulePath, source) => {
    const fileName = routeFileName(modulePath);
    const hasMutatingHandler = MUTATING_HANDLER_PATTERN.test(source);
    if (!hasMutatingHandler) {
      // A read-only route (GET-only, or no route registration at all) has
      // nothing to audit.
      return;
    }

    const isAudited = AUDIT_CALL_PATTERN.test(source);
    if (isAudited) {
      expect(isAudited).toBe(true);
      return;
    }

    const allowReason = ALLOWED_UNAUDITED_ROUTES[fileName];
    expect(
      allowReason,
      `${fileName} registers a mutating handler (.post/.patch/.put/.delete) but never calls ` +
        `writeAuditEntry or recordAudit, and is not on the ALLOWED_UNAUDITED_ROUTES allow-list. ` +
        `Either add an audit write or, if this route genuinely writes no state, add it to the ` +
        `allow-list with a reason.`
    ).toBeDefined();
  });
});
