"""Stage (and optionally publish) model + dataset artifacts to the Hugging Face Hub.

DEFAULT IS A LOCAL STAGING DRY-RUN — nothing leaves this machine.
* ``--dry-run`` (default behavior): copies the artifacts to a staging directory
  (default: <tmpdir>/hf-staging, outside the repo), writes the dataset/model card
  READMEs, and prints exactly what WOULD be uploaded. No network, no credentials.
* ``--push``: requires ``--yes`` AND env ``HUGGINGFACE_HUB_TOKEN`` with write access.
  huggingface_hub is imported lazily; if it is not installed, you get a clear error.

Publishing is BLOCKED on the data-redistribution question: the case data's license
and attribution (DGHS) are UNVERIFIED. Do not run --push until the user confirms
redistribution is permitted. This script will happily remain unrun.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

from ml.training import config

MODEL_CARD_TEMPLATE = """---
license: cc-by-4.0
tags: [dengue, bangladesh, lightgbm, early-warning]
---
# Avash Dengue Surge Models

Model family: two LightGBM binary classifiers (`model_h2`, `model_h4`), opset 17 ONNX.
Target: week-over-week case growth >= 30%. Gate: PROVISIONAL (see ml/ README) — H=4
promotion candidate; H=2 shadow. Probabilities are RAW (scale_pos_weight=2.5) unless a
calibrator is enabled in `MODEL_MANIFEST.json`.

## Attribution
Case data: Government of Bangladesh / DGHS (redistribution pending license confirmation).
Weather: NASA POWER + BMD. Population: 2022 Census.
"""

DATASET_CARD_TEMPLATE = """---
license: cc-by-4.0
tags: [dengue, bangladesh, epi, nasa-power]
---
# Avash Dengue Weekly Dataset

Weekly district-level dengue cases 2022-01 -> present + NASA POWER daily weather,
64 districts of Bangladesh. DGHS & BMD attribution. Redistribution UNVERIFIED —
do not publish until confirmed by the data owner.
"""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def stage(artifact_dir: Path, staging: Path, extra_dir: Path | None = None) -> dict:
    model_stage = staging / "avash-dengue-models"
    dataset_stage = staging / "avash-dengue-dataset"
    for d in (model_stage, model_stage / "checkpoints", dataset_stage):
        d.mkdir(parents=True, exist_ok=True)

    copied = []
    for name in ("model_h2.onnx", "model_h4.onnx"):
        src = artifact_dir / name
        if src.exists():
            shutil.copy2(src, model_stage / name); copied.append(str(model_stage / name))
    for name in ("lgbm_h2.joblib", "lgbm_h4.joblib"):
        src = artifact_dir / name
        if src.exists():
            shutil.copy2(src, model_stage / "checkpoints" / name); copied.append(str(model_stage / "checkpoints" / name))
    if config.MANIFEST_PATH.exists():
        shutil.copy2(config.MANIFEST_PATH, model_stage / "MODEL_MANIFEST.json")
        copied.append(str(model_stage / "MODEL_MANIFEST.json"))

    (model_stage / "README.md").write_text(MODEL_CARD_TEMPLATE, encoding="utf-8")
    (dataset_stage / "README.md").write_text(DATASET_CARD_TEMPLATE, encoding="utf-8")
    copied += [str(model_stage / "README.md"), str(dataset_stage / "README.md")]

    manifest = {"artifacts": []}
    for p in (model_stage / "model_h2.onnx", model_stage / "model_h4.onnx"):
        if p.exists():
            manifest["artifacts"].append({"path": p.name, "sha256": sha256_file(p), "size_bytes": p.stat().st_size})
    (model_stage / "STAGED_MANIFEST.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    copied.append(str(model_stage / "STAGED_MANIFEST.json"))

    if extra_dir and extra_dir.exists():  # opt-in: precomputed feature snapshot CSV (never commit)
        dest = dataset_stage / "benchmarks"
        dest.mkdir(exist_ok=True)
        for f in extra_dir.glob("*.csv"):
            shutil.copy2(f, dest / f.name); copied.append(str(dest / f.name))

    return {"staging": str(staging), "copied": copied,
            "would_push": {"model_repo": config.MODEL_HUB_REPO, "dataset_repo": config.DATASET_HUB_REPO}}


def push(staging: Path, yes: bool) -> None:
    if not yes:
        raise SystemExit("refusing to push without --yes (and license confirmation)")
    import os
    token = os.environ.get("HUGGINGFACE_HUB_TOKEN")
    if not token:
        raise SystemExit("HUGGINGFACE_HUB_TOKEN not set; refusing to push")
    try:
        from huggingface_hub import HfApi
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise SystemExit("huggingface_hub not installed; install requirements.txt to push") from exc
    api = HfApi(token=token)
    api.upload_folder(folder_path=str(staging / "avash-dengue-models"), repo_id=config.MODEL_HUB_REPO,
                      repo_type="model")
    api.upload_folder(folder_path=str(staging / "avash-dengue-dataset"), repo_id=config.DATASET_HUB_REPO,
                      repo_type="dataset")


def main(argv=None):
    default_staging = Path(tempfile.gettempdir()) / "hf-staging"
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--artifact-dir", default=str(config.ARTIFACT_DIR))
    ap.add_argument("--staging", default=str(default_staging))
    ap.add_argument("--extra-csv-dir", default=None, help="optional snapshot/benchmark CSVs to stage under dataset benchmarks/")
    ap.add_argument("--dry-run", action="store_true", default=True, help="stage locally and print (default)")
    ap.add_argument("--push", action="store_true", help="actually upload (requires --yes + HUGGINGFACE_HUB_TOKEN + license confirmation)")
    ap.add_argument("--yes", action="store_true", help="confirm the license/attribution question is resolved")
    args = ap.parse_args(argv)

    staging = Path(args.staging)
    result = stage(Path(args.artifact_dir), staging, Path(args.extra_csv_dir) if args.extra_csv_dir else None)
    print(json.dumps(result, indent=2))
    if args.push:
        push(staging, args.yes)
    else:
        print("\nDRY-RUN ONLY — nothing was uploaded. Staging tree at:", staging)
    return 0


if __name__ == "__main__":
    sys.exit(main())
