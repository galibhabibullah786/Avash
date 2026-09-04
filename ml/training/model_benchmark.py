from datetime import datetime, timezone
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import ExtraTreesClassifier, GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import recall_score
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


DATASET_PATH = Path("ml/data/processed/dengue_processed.csv")
RESULTS_PATH = Path("ml/evaluation/model_comparison_balanced.csv")
MODEL_PATH = Path("ml/models/best_dengue_risk_model.pkl")
METADATA_PATH = Path("ml/models/model_metadata.json")
TARGET_COLUMN = "risk_class"
FEATURE_COLUMNS = [
    "Temperature_C",
    "Humidity_percent",
    "Precipitation_mm",
    "Surface_Pressure_kPa",
    "Wind_Speed_ms",
    "Latitude",
    "Longitude",
    "month",
    "year",
    "day_of_year",
]
RANDOM_STATE = 42


def load_dataset():
    data = pd.read_csv(DATASET_PATH)
    required_columns = FEATURE_COLUMNS + [TARGET_COLUMN]
    missing_columns = [column for column in required_columns if column not in data.columns]
    if missing_columns:
        raise ValueError(f"Dataset is missing required columns: {missing_columns}")

    missing_values = data[required_columns].isna().sum()
    columns_with_missing_values = missing_values[missing_values > 0]
    if not columns_with_missing_values.empty:
        raise ValueError(
            "Dataset contains missing values in model columns: "
            f"{columns_with_missing_values.to_dict()}"
        )

    return data


def build_models():
    models = {
        "LogisticRegression": Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "classifier",
                    LogisticRegression(max_iter=1000, random_state=RANDOM_STATE),
                ),
            ]
        ),
        "RandomForestClassifier": RandomForestClassifier(
            n_estimators=200,
            random_state=RANDOM_STATE,
            n_jobs=-1,
        ),
        "RandomForestClassifier_balanced": RandomForestClassifier(
            n_estimators=200,
            class_weight="balanced",
            random_state=RANDOM_STATE,
            n_jobs=-1,
        ),
        "ExtraTreesClassifier": ExtraTreesClassifier(
            n_estimators=200,
            random_state=RANDOM_STATE,
            n_jobs=-1,
        ),
        "ExtraTreesClassifier_balanced": ExtraTreesClassifier(
            n_estimators=200,
            class_weight="balanced",
            random_state=RANDOM_STATE,
            n_jobs=-1,
        ),
        "GradientBoostingClassifier": GradientBoostingClassifier(
            random_state=RANDOM_STATE,
        ),
    }

    try:
        from xgboost import XGBClassifier
    except ImportError:
        print("XGBoost is not installed; skipping XGBClassifier.")
    else:
        models["XGBClassifier"] = XGBClassifier(
            n_estimators=200,
            learning_rate=0.1,
            max_depth=6,
            subsample=0.8,
            colsample_bytree=0.8,
            objective="multi:softprob",
            eval_metric="mlogloss",
            random_state=RANDOM_STATE,
            n_jobs=-1,
        )

    return models


def evaluate_model(model, features, target, cross_validator):
    def high_risk_recall(estimator, fold_features, fold_target):
        predictions = estimator.predict(fold_features)
        return recall_score(
            fold_target,
            predictions,
            labels=[2],
            average="macro",
            zero_division=0,
        )

    scoring = {
        "accuracy": "accuracy",
        "precision_macro": "precision_macro",
        "recall_macro": "recall_macro",
        "f1_macro": "f1_macro",
        "high_risk_recall": high_risk_recall,
    }
    scores = cross_validate(
        model,
        features,
        target,
        cv=cross_validator,
        scoring=scoring,
        n_jobs=1,
    )
    return {
        "Accuracy": scores["test_accuracy"].mean(),
        "Precision_macro": scores["test_precision_macro"].mean(),
        "Recall_macro": scores["test_recall_macro"].mean(),
        "F1_macro": scores["test_f1_macro"].mean(),
        "High_Risk_Recall": scores["test_high_risk_recall"].mean(),
        "Std": scores["test_f1_macro"].std(),
    }


def main():
    data = load_dataset()
    features = data[FEATURE_COLUMNS]
    target = data[TARGET_COLUMN]
    cross_validator = StratifiedKFold(
        n_splits=5,
        shuffle=True,
        random_state=RANDOM_STATE,
    )

    results = []
    models = build_models()
    for model_name, model in models.items():
        print(f"Evaluating {model_name}...")
        metrics = evaluate_model(model, features, target, cross_validator)
        results.append({"Model": model_name, **metrics})

    leaderboard = pd.DataFrame(results).sort_values(
        by="F1_macro", ascending=False
    ).reset_index(drop=True)
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    leaderboard.to_csv(RESULTS_PATH, index=False)

    best_row = leaderboard.iloc[0]
    best_model_name = best_row["Model"]
    best_model = models[best_model_name]
    best_model.fit(features, target)

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(best_model, MODEL_PATH)
    metadata = {
        "best_model_name": best_model_name,
        "metrics": {
            key: float(best_row[key])
            for key in [
                "Accuracy",
                "Precision_macro",
                "Recall_macro",
                "F1_macro",
                "High_Risk_Recall",
                "Std",
            ]
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "feature_list": FEATURE_COLUMNS,
    }
    METADATA_PATH.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print("\nRanked leaderboard:")
    print(leaderboard.to_string(index=False))
    print(f"\nBEST MODEL:\n{best_model_name}")
    print(f"\nBEST F1:\n{best_row['F1_macro']:.6f}")
    print(f"\nMODEL SAVED:\n{MODEL_PATH}")

    print("\nHigh Risk recall comparison:")
    high_risk_models = leaderboard[
        leaderboard["Model"].isin(
            [
                "RandomForestClassifier",
                "RandomForestClassifier_balanced",
                "ExtraTreesClassifier",
                "ExtraTreesClassifier_balanced",
            ]
        )
    ][["Model", "High_Risk_Recall"]]
    print(high_risk_models.to_string(index=False))

    for model_name in ["RandomForestClassifier", "ExtraTreesClassifier"]:
        baseline_recall = leaderboard.loc[
            leaderboard["Model"] == model_name, "High_Risk_Recall"
        ].iloc[0]
        balanced_recall = leaderboard.loc[
            leaderboard["Model"] == f"{model_name}_balanced", "High_Risk_Recall"
        ].iloc[0]
        change = balanced_recall - baseline_recall
        print(
            f"{model_name}: balanced High Risk recall change = "
            f"{change:+.6f} ({change * 100:+.2f} percentage points)"
        )


if __name__ == "__main__":
    main()
