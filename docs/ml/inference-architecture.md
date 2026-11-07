# Inference Architecture

Avash's model inference happens in **two distinct paths**, serving two
distinct purposes. They are not two implementations of the same thing —
conflating them is the mistake ADR-002 exists to prevent.

## The two paths

| Path | Where it runs | Cadence | Purpose |
|---|---|---|---|
| **Batch (source of truth)** | `ml/serving/predict.py`, plain Python + `onnxruntime`, executed inside a GitHub Actions runner | Every 24h via GH Actions `schedule` (`BATCH_PREDICT_CADENCE`, §14) | Populates `risk_predictions` for every region → powers the map, dashboards, alerts. This is what "2–4 week early warning" means operationally. No Cloudflare CPU-time constraint applies here at all. |
| **On-device (bonus UX)** | Browser, `onnxruntime-web` (WASM), inside the installed `apps/web` PWA | On-demand, fully offline | Lets a user re-score their own last-synced local feature snapshot instantly with zero network round-trip. This is where "0ms cold start / edge AI" is honestly true, because compute happens on the user's device, not a shared Worker with a CPU-time ceiling. |

Both paths load the **same** checksum-pinned `.onnx` artifact —
`ml/serving/predict.py` via the Python `onnxruntime` package (downloaded
at scheduled runtime from the Hugging Face Model Hub repo
`avash-health/avash-dengue-models` via `huggingface_hub`), `apps/web`
via `packages/ml-inference`'s `onnxruntime-web` wrapper. There is exactly
one model file, versioned once (`model_v{semver}.onnx`), consumed twice.
Both paths verify the artifact's SHA256 against
`ml/training/MODEL_MANIFEST.json` before running it. Zero model binaries
are stored in the GitHub repository.

## Why per-request Worker inference is ruled out

The honest constraint: Cloudflare Workers' free-tier CPU-time cap (~10ms)
applies to actual **compute**, not I/O-wait. That distinction matters —
a Worker can comfortably wait on a slow database query or an external API
call within its time budget, because waiting doesn't consume CPU time. But
running ONNX tensor math (WASM) to score even a modest LightGBM-derived
model across many regions per request **is** compute-bound, and will blow
the CPU-time cap unpredictably depending on region count and the Worker's
cold/warm state. This isn't a "maybe it'll be slow" concern — it's a hard
resource ceiling that a health-safety-relevant prediction path cannot
depend on staying under.

This is why batch inference runs in a GitHub Actions runner instead: a
standard Actions runner has no comparable CPU-time ceiling, can run native
Python + `onnxruntime` (faster and more mature than the WASM build used in
the browser), and produces predictions for every region in one scheduled
pass rather than recomputing the same result on every map request.

## The ADR-002-followup escape hatch

If a future paid Cloudflare plan removes or substantially raises the
CPU-time constraint, per-request Worker inference can be revisited — but
not silently. That change is tracked as its own decision record,
`docs/adr/ADR-002-followup.md`, created only when that plan change is
actually adopted. Until then, `apps/api` never performs ONNX inference
inline in a request handler, and no code should be written as if it might
someday just "flip on" — the batch/on-device split is the architecture,
not a placeholder for one.
