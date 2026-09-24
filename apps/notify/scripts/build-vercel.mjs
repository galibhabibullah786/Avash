/**
 * Builds apps/notify into Vercel's Build Output API v3 layout
 * (`.vercel/output/`), which `vercel deploy --prebuilt` uploads verbatim.
 *
 * WHY THIS EXISTS INSTEAD OF `vercel build`.
 *
 * Vercel's zero-config `api/` detection transpiles each `api/*.ts` to
 * `api/*.js` and then relies on its own node_modules tracing to decide
 * which packages to ship alongside it. That tracing does not follow this
 * repo's pnpm layout: our first-party deps are `workspace:*` symlinks
 * into `packages/`, and third-party ones live in the root
 * `.pnpm/`-hoisted store rather than under `apps/notify/node_modules/`.
 * Two separate, independently fatal failures came out of that:
 *
 *   1. `vercel deploy --prebuilt` in CI refused to upload at all —
 *      `Error: Please ensure project dependencies have been installed:
 *      File does not exist: "apps/notify/node_modules/@avash/types"`.
 *   2. When it did upload, the deployed function crashed on first
 *      invocation with `ERR_MODULE_NOT_FOUND: Cannot find package
 *      'inngest' imported from /var/task/api/inngest.js` — nothing had
 *      been traced into the bundle, so /api/inngest returned
 *      FUNCTION_INVOCATION_FAILED and Inngest could neither register nor
 *      invoke anything.
 *
 * Bundling with esbuild removes the question. Each function ships as one
 * self-contained file with every dependency — workspace and third-party
 * alike — already inlined, so there is no resolution left for Vercel to
 * get wrong. It is the same technique `apps/notify/Dockerfile` already
 * uses for the container's `server.cjs`, applied to the deploy path.
 *
 * CJS, NOT ESM — the same finding the Dockerfile records: inngest pulls
 * in `debug`, which dynamic-`require()`s Node builtins in a way esbuild's
 * ESM output cannot shim ("Dynamic require ... is not supported" at
 * startup). esbuild's CJS output uses a real `require`, so it loads.
 */
import { rm, mkdir, writeFile, cp, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(appDir, '.vercel', 'output');
const functionsDir = join(outputDir, 'functions', 'api');
const staticDir = join(outputDir, 'static');

/**
 * Node major version for the Lambda runtime. Kept in step with the
 * project's `nodeVersion` setting on Vercel and with the `node:24` app
 * images (ADR-012) — a mismatch here is silent until something uses a
 * runtime feature the older major lacks.
 */
const NODE_RUNTIME = 'nodejs24.x';

/**
 * Vercel's Hobby ceiling, and a deliberate choice rather than the
 * default. One Inngest `step.run` is one HTTP invocation of this
 * function, and the `deliver-announcement` step wraps the ENTIRE
 * `deliverAnnouncement()` fan-out (see the step-granularity comment in
 * src/inngest/deliverAnnouncement.ts) — every subscriber the RPC matched,
 * in one invocation. At the default timeout a wide announcement gets cut
 * off mid-fan-out, which the claim/lease then has to clean up as a
 * crashed attempt.
 */
const MAX_DURATION_SECONDS = 60;

/**
 * One entry per deployed route. The key is the path under `/api/`, which
 * is also the `.func` directory name — Build Output API v3 routes
 * `functions/api/foo.func` to `/api/foo` through the `filesystem`
 * handler, so these names are the public URL contract that
 * `deploy-notify.yml` and the Supabase Database Webhook both depend on.
 */
const ENTRIES = {
  inngest: 'api/inngest.ts',
  'announcement-published': 'api/announcement-published.ts',
};

async function buildFunction(name, entryPoint) {
  const funcDir = join(functionsDir, `${name}.func`);
  await mkdir(funcDir, { recursive: true });

  await build({
    entryPoints: [join(appDir, entryPoint)],
    outfile: join(funcDir, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    // Vercel surfaces thrown errors by stack trace in the runtime log;
    // without this every frame points into the bundled megafile.
    sourcemap: 'inline',
    // Not 'production' — bundling on that condition can select a
    // browser-shaped export from a package that ships conditional
    // exports, and everything here is server-only.
    conditions: ['node'],
    logLevel: 'info',
  });

  // The .func directory is its own module scope once it lands in
  // /var/task. apps/notify's package.json says `"type": "module"`, and
  // if anything similar ends up adjacent to the bundle, Node would read
  // `index.js` as ESM and fail on the CJS `require` calls above. Stating
  // commonjs here makes the bundle's format explicit rather than
  // inherited.
  await writeFile(join(funcDir, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);

  await writeFile(
    join(funcDir, '.vc-config.json'),
    `${JSON.stringify(
      {
        runtime: NODE_RUNTIME,
        handler: 'index.js',
        launcherType: 'Nodejs',
        // Both handlers are Node-style `(req, res)` — `serve()` from
        // inngest/node already is one, and the webhook is wrapped by
        // `serveEndpoint()` in api/announcement-published.ts for exactly
        // this reason. The launcher's req/res helpers are therefore the
        // right shape, and no Web-signature detection is involved.
        shouldAddHelpers: true,
        maxDuration: MAX_DURATION_SECONDS,
      },
      null,
      2,
    )}\n`,
  );
}

async function main() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(functionsDir, { recursive: true });
  await mkdir(staticDir, { recursive: true });

  for (const [name, entryPoint] of Object.entries(ENTRIES)) {
    await buildFunction(name, entryPoint);
  }

  // apps/notify serves no pages — `public/` holds only a .gitkeep. The
  // directory still has to exist in the output or the deployment has no
  // static filesystem for the `filesystem` route handler to consult.
  const publicDir = join(appDir, 'public');
  const hasPublic = await access(publicDir).then(
    () => true,
    () => false,
  );
  if (hasPublic) {
    await cp(publicDir, staticDir, { recursive: true });
  }

  await writeFile(
    join(outputDir, 'config.json'),
    `${JSON.stringify(
      {
        version: 3,
        routes: [
          // Resolves `/api/inngest` and `/api/announcement-published`
          // against the built functions above before any fallback runs.
          { handle: 'filesystem' },
          // Anything else under /api/ is a 404 rather than a fall-through
          // to the static 404 page — a caller hitting a mistyped webhook
          // path should get a machine-readable status, not HTML.
          { src: '^/api(?:/.*)?$', status: 404 },
        ],
      },
      null,
      2,
    )}\n`,
  );

  console.log(`apps/notify: Build Output API bundle written to ${outputDir}`);
}

await main();
