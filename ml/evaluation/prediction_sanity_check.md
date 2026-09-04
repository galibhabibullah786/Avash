# Prediction Sanity Check

## Scope

- **Input:** `ml/data/processed/dengue_processed.csv`
- **Model:** `ml/models/final_dengue_risk_model.pkl`
- **Output:** `apps/api/data/risk_summary.json`
- **Processed input rows:** 106,304
- **District summary rows:** 64

## Finding

All 64 districts are classified as Low Risk because the prediction pipeline keeps only the latest row for each district. Every district's latest row has the same date, **2026-07-19**, and all 64 rows have an observed `risk_class` of `0`.

This is a time-slice and aggregation effect. The model is not collapsing globally to the majority class.

## 1. Probability Distributions

### All processed rows

| Probability | Mean | Minimum | Maximum |
|---|---:|---:|---:|
| Low (`p0`) | 0.554668 | 0.004973 | 1.000000 |
| Medium (`p1`) | 0.273978 | 0.000000 | 0.885489 |
| High (`p2`) | 0.171354 | 0.000000 | 0.964509 |

The maximum predicted probability across all rows has:

- Mean: `0.769433`
- Median: `0.782220`
- Minimum: `0.339950`
- Maximum: `1.000000`

### Latest row for each district

| Probability | Mean | Minimum | Maximum |
|---|---:|---:|---:|
| Low (`p0`) | 0.635042 | 0.480656 | 0.818608 |
| Medium (`p1`) | 0.225457 | 0.107281 | 0.296953 |
| High (`p2`) | 0.139502 | 0.010155 | 0.399505 |

The latest district-level risk scores range from `0.480656` to `0.818608`. They are not uniformly or extremely confident Low predictions; several districts have substantial non-Low probability, but Low remains the largest class probability for each row.

Risk-score bands for the 64 district records:

| Risk score range | Districts |
|---|---:|
| 0.00-0.50 | 2 |
| 0.50-0.60 | 24 |
| 0.60-0.70 | 27 |
| 0.70-0.80 | 9 |
| 0.80-1.00 | 2 |

## 2. Top 10 Highest `risk_score` Districts

All ten are still classified Low because `risk_score` is the highest class probability, not a probability that the risk label is High.

| Rank | District | Risk | Risk score |
|---:|---|---|---:|
| 1 | Sunamganj | Low | 0.818608 |
| 2 | Thakurgaon | Low | 0.801660 |
| 3 | Joypurhat | Low | 0.789740 |
| 4 | Sylhet | Low | 0.784914 |
| 5 | Lalmonirhat | Low | 0.779009 |
| 6 | Kurigram | Low | 0.776642 |
| 7 | Rangpur | Low | 0.763222 |
| 8 | Nilphamari | Low | 0.761253 |
| 9 | Panchagarh | Low | 0.743045 |
| 10 | Dinajpur | Low | 0.730861 |

For an operational High Risk ranking, `risk_score` should instead mean `p2`, the probability of class 2. The current field means model confidence in the selected class, regardless of which class was selected.

## 3. Predicted Class Counts Before District Aggregation

Predictions across all 106,304 processed rows are:

| Predicted class | Meaning | Count | Percentage |
|---:|---|---:|---:|
| 0 | Low | 58,256 | 54.80% |
| 1 | Medium | 29,917 | 28.14% |
| 2 | High | 18,131 | 17.06% |

For comparison, the actual processed target distribution is:

| Target class | Count | Percentage |
|---:|---:|---:|
| 0 | 73,043 | 68.71% |
| 1 | 18,568 | 17.47% |
| 2 | 14,693 | 13.82% |

The model predicts all three classes in meaningful quantities. Its full-row High Risk prediction rate is 17.06%, compared with an actual High Risk rate of 13.82%.

## 4. Are the Latest Records a Low-Risk Period?

Yes, based on the available labels and seasonal history:

- The dataset covers 2022-01-01 through 2026-07-19.
- The latest 64 district records are all dated 2026-07-19.
- All 64 latest records have observed `risk_class=0`.
- The latest records are in July (`month=7`).
- Historical mean risk class by month is approximately `0.498` in July, compared with `0.808` in August and `0.988` in September. October and November are also higher.

The latest data therefore ends before the historically higher-risk August-November period. The all-Low output is consistent with both the observed labels and the seasonal pattern in this dataset.

## 5. Is the Model Collapsing to the Majority Class?

No. The model is not globally collapsing to Low Risk:

- It predicts Low for 54.80% of all rows, below the 68.71% Low Risk target share.
- It predicts Medium for 28.14% of rows.
- It predicts High for 17.06% of rows.
- The final 64-row output becomes all Low only after selecting one synchronized latest date per district.

The production output is therefore losing temporal variation through the latest-row aggregation, rather than exposing a majority-class failure.

## Recommendations

1. **Expose High Risk probability separately.** Keep `risk_score` as confidence if desired, but add `high_risk_probability: p2` so users can rank districts by the probability of High Risk directly.
2. **Include the prediction date.** Add `prediction_date` to the JSON so consumers can see that all 64 records represent 2026-07-19.
3. **Use a recent rolling window.** Consider aggregating the last 7 or 14 days per district, using the maximum or mean `p2`, rather than retaining only one row.
4. **Preserve temporal monitoring.** Store daily predictions so a seasonal transition from July into August-November is visible instead of replacing history with one snapshot.
5. **Evaluate with time-based validation.** The current final-model metrics are full-training metrics. Use a chronological holdout or rolling-origin evaluation for deployment readiness and seasonal generalization.
6. **Check future data freshness.** If the system is expected to provide current risk, the processed input must contain observations newer than 2026-07-19.
7. **Keep macro F1 and High Risk recall.** Continue monitoring macro F1 for balanced class performance and High Risk recall for missed high-risk districts; do not use accuracy alone.
