import pandas as pd


DATASET_PATH = "ml/data/raw/Bangladesh_64_Districts_NASA_POWER_Weather_dengue_affected_22_26.csv"


def main():
    data = pd.read_csv(DATASET_PATH)

    print("Shape:")
    print(data.shape)

    print("\nColumn names:")
    print(data.columns.tolist())

    print("\nMissing values:")
    print(data.isna().sum())

    print("\nSummary statistics:")
    print(data.describe(include="all"))

    print("\nDengue affected count distribution:")
    print(data["Affected count"].value_counts(dropna=False).sort_index())


if __name__ == "__main__":
    main()