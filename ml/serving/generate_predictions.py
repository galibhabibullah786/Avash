import json
import math
from pathlib import Path

import joblib
import pandas as pd


MODEL_PATH = Path("ml/models/final_dengue_risk_model.pkl")
DATASET_PATH = Path("ml/data/processed/dengue_processed.csv")
OUTPUT_PATH = Path("apps/api/data/risk_summary.json")
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
OUTPUT_COLUMNS = [
    "district",
    "latitude",
    "longitude",
    "risk",
    "risk_score",
    "low_risk_probability",
    "medium_risk_probability",
    "high_risk_probability",
    "prediction_date",
]
RISK_LABELS = {0: "Low", 1: "Medium", 2: "High"}


def load_inputs():
    data = pd.read_csv(DATASET_PATH)
    required_columns = FEATURE_COLUMNS + ["Date", "District"]
    missing_columns = [column for column in required_columns if column not in data]
    if missing_columns:
        raise ValueError(f"Input data is missing required columns: {missing_columns}")

    data["Date"] = pd.to_datetime(data["Date"], errors="coerce")
    if data["Date"].isna().any():
        raise ValueError("Input data contains invalid dates")
    if data[FEATURE_COLUMNS].isna().any().any():
        raise ValueError("Input data contains missing model features")

    return data


def generate_summary(data, model):
    feature_data = data[FEATURE_COLUMNS]
    predictions = model.predict(feature_data)
    probabilities = model.predict_proba(feature_data)
    probability_columns = {
        0: "low_risk_probability",
        1: "medium_risk_probability",
        2: "high_risk_probability",
    }
    class_indexes = {int(class_value): index for index, class_value in enumerate(model.classes_)}
    missing_classes = [risk_class for risk_class in probability_columns if risk_class not in class_indexes]
    if missing_classes:
        raise ValueError(f"Model is missing required risk classes: {missing_classes}")

    prediction_data = data[["Date", "District", "Latitude", "Longitude"]].copy()
    prediction_data["risk_class"] = predictions.astype(int)
    for risk_class, column in probability_columns.items():
        prediction_data[column] = probabilities[:, class_indexes[risk_class]]
    prediction_data["risk_score"] = probabilities.max(axis=1)
    prediction_data["risk"] = prediction_data["risk_class"].map(RISK_LABELS)
    if prediction_data["risk"].isna().any():
        raise ValueError("Model produced an unsupported risk class")

    # Sorting before deduplication ensures each district keeps its newest observation.
    latest_by_district = (
        prediction_data.sort_values("Date", ascending=False)
        .drop_duplicates(subset=["District"], keep="first")
        .sort_values("District")
    )
    summary = latest_by_district.rename(
        columns={
            "District": "district",
            "Latitude": "latitude",
            "Longitude": "longitude",
            "Date": "prediction_date",
        }
    )[OUTPUT_COLUMNS]
    summary["prediction_date"] = summary["prediction_date"].dt.strftime("%Y-%m-%d")
    return summary


def validate_json(path):
    with path.open("r", encoding="utf-8") as file:
        records = json.load(file)

    if not isinstance(records, list):
        raise ValueError("Risk summary JSON must contain a list")
    for record in records:
        if set(record) != set(OUTPUT_COLUMNS):
            raise ValueError(f"Unexpected risk summary fields: {set(record)}")
        if record["risk"] not in RISK_LABELS.values():
            raise ValueError(f"Unexpected risk label: {record['risk']}")
        if not isinstance(record["risk_score"], (int, float)):
            raise ValueError("risk_score must be numeric")
        if not 0 <= record["risk_score"] <= 1:
            raise ValueError("risk_score must be between 0 and 1")
        probabilities = [
            record["low_risk_probability"],
            record["medium_risk_probability"],
            record["high_risk_probability"],
        ]
        if not all(isinstance(probability, (int, float)) for probability in probabilities):
            raise ValueError("Risk probabilities must be numeric")
        if not all(0 <= probability <= 1 for probability in probabilities):
            raise ValueError("Risk probabilities must be between 0 and 1")
        if not math.isclose(sum(probabilities), 1.0, rel_tol=0, abs_tol=1e-6):
            raise ValueError("Risk probabilities must sum to 1")
        if not isinstance(record["prediction_date"], str):
            raise ValueError("prediction_date must be an ISO date string")
        if pd.isna(pd.to_datetime(record["prediction_date"], errors="coerce")):
            raise ValueError("prediction_date must be a valid date")

    return records


def main():
    model = joblib.load(MODEL_PATH)
    data = load_inputs()
    summary = generate_summary(data, model)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    summary.to_json(OUTPUT_PATH, orient="records", indent=2)
    records = validate_json(OUTPUT_PATH)

    risk_distribution = pd.Series(record["risk"] for record in records).value_counts()
    print(f"DISTRICT COUNT: {len(records)}")
    print("RISK DISTRIBUTION:")
    print(risk_distribution.to_string())
    print(f"FILE LOCATION: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
