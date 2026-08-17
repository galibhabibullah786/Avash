# ADR-015: Signed direct-to-Cloudinary uploads; the Worker never sees the bytes

**Date:** 2026-08-17
**Status:** Accepted.

## Context

The platform foundation slice needs an image-upload primitive for two
future consumers (avatar upload, report-photo upload — neither has a
caller in this slice). `apps/api` runs on Cloudflare Workers, which have a
hard CPU-time and memory ceiling per request. Proxying a file through the
Worker — receiving the multipart body, buffering it, then forwarding it to
Cloudinary — spends that budget on work Cloudinary already does for free,
and holds a file buffer in a runtime not built to hold one.

Cloudinary supports signed uploads: the client uploads directly to
Cloudinary's API with a short-lived signature the server mints. The
server never receives the file.

## Decision

**`POST /api/uploads/signature`** mints a signature; the browser then
`POST`s the file straight to Cloudinary's upload endpoint. Two narrower
decisions shape the contract:

- **The client names a purpose, not a path** (`packages/types/uploads.ts`
  `uploadPurposeSchema`: `'avatar' | 'report-photo'`). The server derives
  the Cloudinary folder from it (`avash/avatars/<userId>` or
  `avash/reports`) and generates the `public_id` itself. A client-supplied
  folder is a write-anywhere primitive against the asset store — the
  purpose enum is the only client input that reaches folder selection.
- **Every signed-in role may mint a signature.** `auth()` carries no
  `capability` requirement; the abuse control is the per-user rate limit
  (`UPLOAD_SIGNATURE_RATE_LIMIT`, §14 — 10/min per user), not role
  gating.

### Signed parameter set

Verified against Cloudinary's Upload API reference and authentication-
signatures documentation, 2026-08-17
(<https://cloudinary.com/documentation/authentication_signatures>,
<https://cloudinary.com/documentation/image_upload_api_reference>).
Cloudinary's signing rule: every parameter actually sent in the upload
POST is included in the signature **except** `file`, `cloud_name`,
`resource_type`, `api_key`, and `signature` itself. `timestamp` is always
required. Included parameters are sorted alphabetically by name, joined
as `name=value` pairs with `&`, the API secret is appended with no
delimiter, and the result is hashed (SHA-1 by default; SHA-256 is
selectable but not used here).

This route sends exactly four upload parameters, so exactly four are
signed:

| Parameter | Source | Signed |
|---|---|---|
| `allowed_formats` | server-controlled, `UPLOAD_ALLOWED_FORMATS` | yes |
| `folder` | server-derived from `purpose` (decision above) | yes |
| `public_id` | server-generated | yes |
| `timestamp` | server clock at signing time | yes |

`apps/api/src/lib/cloudinarySignature.ts`'s `signUpload()` builds the
string over exactly this set, in this order (alphabetical), using
`crypto.subtle.digest('SHA-1', …)` — Web Crypto, present in both workerd
and Node 20, so the same code signs identically in a deployed Worker and
the container image (`AGENTS.md` two-runtimes rule). A signature computed
over the wrong parameter set fails closed: Cloudinary rejects the upload
rather than accepting one it can't verify. That failure is silent and
confusing rather than dangerous, which is exactly why this list is
recorded here instead of trusted to memory.

## Consequences

- The server never sees the uploaded bytes, so it cannot validate file
  content directly. Mitigated by: `allowed_formats` and `folder` being
  server-controlled inputs to the signature (a client cannot request a
  signature that would authorize a disallowed format or an arbitrary
  folder), a per-user rate limit on signature minting, and the
  signature endpoint requiring authentication.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
  `CLOUDINARY_API_SECRET` are server-only (R2) — `apps/web` learns the
  cloud name from the signature response, never from a `VITE_PUBLIC_*`
  variable. See `docs/security/secrets-matrix.md`.
- The signature is valid for `UPLOAD_SIGNATURE_TTL_S` (§14, 600s) —
  comfortably inside Cloudinary's own upper bound, and short enough that a
  leaked signature (e.g. via a proxy log) is worthless soon after.
- This route has no caller in this slice. `apps/web/src/features/uploads/useSignedUpload.ts`
  exists (also with no caller) as the client half of the contract; the
  avatar and report-photo slices consume both.

## Rejected alternative

**Worker-proxied upload** (client → Worker → Cloudinary, bytes passing
through `apps/api`). Rejected: spends CPU time and the Worker's request
body budget on a byte-shuffling task Cloudinary already performs, and
requires buffering a file in a runtime with a hard memory ceiling per
request — for a benefit (server-side content validation) already
undermined by the fact that format/size are enforced by Cloudinary via
the signed parameters regardless of who sends the bytes.
