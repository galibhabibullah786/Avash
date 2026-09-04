from datetime import datetime, timezone
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score


DATASET_PATH = Path("ml/data/processed/dengue_processed.csv")
MODEL_PATH = Path("ml/models/final_dengue_risk_model.pkl")
METADATA_PATH = Path("ml/models/final_model_metadata.json")
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


def load_training_data():
    data = pd.read_csv(DATASET_PATH)
    required_columns = FEATURE_COLUMNS + [TARGET_COLUMN]
    missing_columns = [column for column in required_columns if column not in data]
    if missing_columns:
        raise ValueError(f"Dataset is missing required columns: {missing_columns}")

    training_data = data[required_columns]
    if training_data.isna().any().any():
        raise ValueError("Training data contains missing values in model columns")

    return training_data[FEATURE_COLUMNS], training_data[TARGET_COLUMN]


def train_model():
    features, target = load_training_data()
    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=12,
        random_state=42,
        class_weight="balanced",
    )
    model.fit(features, target)

    # These metrics describe the fitted model's performance on the full training data.
    predictions = model.predict(features)
    metadata = {
        "model_name": "RandomForestClassifier",
        "parameters": {
            "n_estimators": 300,
            "max_depth": 12,
            "random_state": 42,
            "class_weight": "balanced",
        },
        "accuracy": float(accuracy_score(target, predictions)),
        "precision": float(
            precision_score(target, predictions, average="macro", zero_division=0)
        ),
        "recall": float(
            recall_score(target, predictions, average="macro", zero_division=0)
        ),
        "macro_f1": float(
            f1_score(target, predictions, average="macro", zero_division=0)
        ),
        "high_risk_recall": float(
            recall_score(target, predictions, labels=[2], average="macro", zero_division=0)
        ),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    METADATA_PATH.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print("FINAL MODEL TRAINED")
    print(f"MODEL SAVED: {MODEL_PATH}")
    print(f"HIGH RISK RECALL: {metadata['high_risk_recall']:.6f}")

    return model, metadata


if __name__ == "__main__":
    train_model()
