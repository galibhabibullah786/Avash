"""Generate a model card (Markdown) from the training manifest + backtest results.

Writes to --out (default: <artifact-dir>/MODEL_CARD.md). That file is NOT committed —
evaluation logs ship to the Hugging Face Hub instead (spec §1.3 / §4).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from ml.training import config

TEMPLATE = """# Avash Dengue Surge Model Card
Generated: {generated} · Model version: {version}

## Model
- Two LightGBM binary classifiers: `model_h2` (2-week), `model_h4` (4-week). 120 trees, lr 0.03,
  num_leaves 20, max_depth 5, scale_pos_weight 2.5, seed 42 (spec §3.2).
- Target: `surge_flag = 1[(cases_t+H - cases_t) / max(cases_t, 1) >= 0.30]` (label (a), Phase 1 decision).
- Features ({nfeat}): {features}
- ONNX opset 17, pure ai.onnx `arithmetic double` export (tensor(double) end to end) — see ml/README.md
  'ONNX parity' for why the TreeEnsemble/double-threshold path is not usable. Parity ~2e-16 vs Python (gate: < 1e-4).

## PROVISIONAL STATUS
- Promotion gate is PROVISIONAL (G2-style, set after seeing walk-forward results):
  H=4 pooled recall >= 0.70 and precision >= 0.60, beating the persistence baseline on
  recall/precision/PR-AUC in EVERY fold; worst fold always reported.
- H=2 is SHADOW (stored, never alerted) until Option B / retraining / new data improves it.
- Push alerts require a frozen-model check on the next 8-12 weeks of new data.
- Spec's 0.85 recall is an aspiration, not the enforced gate.
- `temp_min_roll_14` and `favorable_breeding_flag` are PROVISIONAL: temp_min is min of daily
  MEAN temps; production `weather_observations.temp_min_c` coverage unconfirmed.
- `population_density` = log10(population_2022) placeholder — no land-area data supplied.
- Calibration: {calibration}

## Walk-forward folds (spec §3.3)
{folds}

## Backtest summary
{backtest}

## Data & attribution
Case data: DGHS (Government of Bangladesh). Weather: NASA POWER. Population: 2022 Census.
Redistribution license/attribution UNVERIFIED — models/datasets not yet published; see README.

## Intended use
Early-warning aid for public-health officials. NOT a clinical tool. Low-resource districts with
near-zero baseline counts have noisy surge labels (see Phase 1/1b reports).
"""


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--artifact-dir", default=str(config.ARTIFACT_DIR))
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)

    artifact_dir = Path(args.artifact_dir)
    manifest = json.loads(config.MANIFEST_PATH.read_text()) if config.MANIFEST_PATH.exists() else {}
    backtest = {}
    bt_path = artifact_dir / "backtest_results.json"
    if bt_path.exists():
        backtest = json.loads(bt_path.read_text())

    folds_txt = json.dumps(manifest.get("folds", [list(f) for f in config.FOLDS]), indent=2)
    bt_txt = json.dumps(backtest.get("results", backtest), indent=2, default=str)[:6000]
    cal = manifest.get("calibration", {})
    cal_txt = f"enabled={cal.get('enabled')} method={cal.get('method')} (not applied unless enabled)"

    card = TEMPLATE.format(
        generated=datetime.now(timezone.utc).isoformat(),
        version=manifest.get("model_version", config.MODEL_VERSION),
        nfeat=len(manifest.get("features", list(config.FEATURES))),
        features=", ".join(manifest.get("features", list(config.FEATURES))),
        calibration=cal_txt,
        folds=folds_txt,
        backtest=bt_txt,
    )
    out = Path(args.out) if args.out else artifact_dir / "MODEL_CARD.md"
    out.write_text(card, encoding="utf-8")
    print(f"model card written to {out} (not committed; ship to HF Hub)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
