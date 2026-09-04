# Dengue Risk Class Distribution Report

## Dataset

- **Source:** `ml/data/processed/dengue_processed.csv`
- **Total rows:** 106,304
- **Target column:** `risk_class`

## Distribution

| Risk class | Meaning | Count | Percentage |
|---:|---|---:|---:|
| 0 | Low Risk | 73,043 | 68.71% |
| 1 | Medium Risk | 18,568 | 17.47% |
| 2 | High Risk | 14,693 | 13.82% |
| **Total** |  | **106,304** | **100.00%** |

## Imbalance Severity

The dataset has **substantial class imbalance**:

- The Low Risk class contains 68.71% of all observations.
- The High Risk class contains 13.82% of observations.
- The majority-to-minority class ratio is approximately **4.97:1**.
- The two less common classes together still represent 31.29% of the data, so this is not a binary majority-versus-rare-event problem. However, a model can still achieve a strong overall accuracy while underperforming on Medium Risk and High Risk cases.

## Is Accuracy Misleading?

Yes, accuracy can be misleading for this dataset. A classifier that always predicts Low Risk would already achieve approximately **68.71% accuracy** without identifying any Medium Risk or High Risk cases. Accuracy therefore gives the majority class considerable influence and may hide poor performance on the classes that are important for risk detection.

The benchmarked Random Forest achieved **82.26% accuracy**, but its **macro F1 was 0.7225**. The difference shows why accuracy should not be interpreted alone: overall correctness is higher than the equally weighted performance across the three risk classes.

Accuracy is still useful as a secondary metric, especially when the cost of all classification errors is similar. It should be reported alongside class-specific precision, recall, confusion matrices, and balanced metrics.

## Recommended Primary Metric

**Macro F1 should be the primary model-comparison metric.** Macro F1 calculates F1 independently for each class and then gives every class equal weight. This prevents the Low Risk class from dominating the evaluation and makes poor performance on Medium Risk or High Risk visible.

Recommended reporting order:

1. **Macro F1** for model selection.
2. **Per-class recall**, especially for High Risk cases where missed risk may be costly.
3. **Per-class precision** to monitor unnecessary risk alerts.
4. **Macro precision and macro recall** for additional balanced views.
5. **Accuracy** as a secondary overall measure.

The primary metric should ultimately reflect operational costs. If missing a High Risk case is substantially worse than issuing a false alert, High Risk recall or a cost-sensitive metric may need to supplement macro F1.
