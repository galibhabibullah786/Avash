from pathlib import Path

import pandas as pd


DATASET_PATH = Path(
    "ml/data/raw/Bangladesh_64_Districts_NASA_POWER_Weather_dengue_affected_22_26.csv"
)
OUTPUT_PATH = Path("ml/data/processed/dengue_processed.csv")


def engineer_features(data):
    data = data.copy()
    data["Date"] = pd.to_datetime(data["Date"], errors="coerce")
    data = data.dropna(subset=["Date", "Affected count"])
    data = data.drop_duplicates()

    numeric_columns = data.select_dtypes(include="number").columns
    for column in numeric_columns:
        data[column] = data[column].fillna(data[column].median())

    categorical_columns = data.select_dtypes(exclude="number").columns
    for column in categorical_columns:
        if data[column].isna().any():
            mode = data[column].mode()
            if not mode.empty:
                data[column] = data[column].fillna(mode.iloc[0])

    data["month"] = data["Date"].dt.month
    data["year"] = data["Date"].dt.year
    data["day_of_year"] = data["Date"].dt.dayofyear
    data["risk_class"] = pd.cut(
        data["Affected count"],
        bins=[-float("inf"), 0, 5, float("inf")],
        labels=[0, 1, 2],
    ).astype("int64")

    return data


def main():
    data = pd.read_csv(DATASET_PATH)
    processed_data = engineer_features(data)

    print("Shape:")
    print(processed_data.shape)

    print("\nClass distribution:")
    print(processed_data["risk_class"].value_counts().sort_index())

    print("\nNull counts:")
    print(processed_data.isna().sum())

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    processed_data.to_csv(OUTPUT_PATH, index=False)
    print(f"\nSaved processed dataset to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
