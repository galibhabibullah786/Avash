/**
 * Signs a direct-to-Cloudinary upload (decision G — bytes never enter the
 * Worker). Uses `crypto.subtle` (Web Crypto), present in both workerd and
 * Node 20 — no Cloudflare-only API (two-runtimes rule, §0.3).
 *
 * Signed parameter set verified against Cloudinary's upload API reference
 * 2026-08-17 (docs/adr/ADR-015-signed-direct-uploads.md): every field sent
 * in the upload POST except `file`, `cloud_name`, `resource_type`,
 * `api_key`, and `signature` itself is included, sorted alphabetically by
 * name, joined with `&`, with the API secret appended (no delimiter) before
 * hashing. This route sends exactly `allowed_formats`, `folder`,
 * `public_id`, and `timestamp` — all four are signed.
 */
export interface CloudinarySignatureParams {
  folder: string;
  publicId: string;
  timestamp: number;
  allowedFormats: readonly string[];
}

function toSignatureString(params: CloudinarySignatureParams): string {
  const pairs: Array<[string, string]> = [
    ['allowed_formats', params.allowedFormats.join(',')],
    ['folder', params.folder],
    ['public_id', params.publicId],
    ['timestamp', String(params.timestamp)],
  ];
  return pairs.map(([key, value]) => `${key}=${value}`).join('&');
}

async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function signUpload(params: CloudinarySignatureParams, apiSecret: string): Promise<string> {
  return sha1Hex(`${toSignatureString(params)}${apiSecret}`);
}
