/**
 * Polyfill FinalizationRegistry for Cloudflare Workers (workerd).
 * Cloudflare Workers V8 isolates do not expose FinalizationRegistry due to
 * isolate security and GC determinism. Packages that reference it (such as
 * Inngest's OpenTelemetry span processor) require this stub on globalThis.
 */
if (typeof (globalThis as unknown as { FinalizationRegistry?: unknown }).FinalizationRegistry === 'undefined') {
  (globalThis as unknown as { FinalizationRegistry: unknown }).FinalizationRegistry = class {
    register(): void {}
    unregister(): void {}
  };
}
