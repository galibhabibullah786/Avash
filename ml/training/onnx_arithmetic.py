"""Double-precision ONNX export via arithmetic expansion (NOT the TreeEnsemble op).

WHY THIS EXISTS
---------------
The spec's parity gate (ONNX vs Python, max abs diff < 1e-4 on >=1000 rows) is
NOT ACHIEVABLE with the ``ai.onnx.ml.TreeEnsembleClassifier`` operator on
onnxruntime 1.31:

* onnxruntime's TreeEnsemble kernel reads ``nodes_values_as_tensor`` as
  ``tensor(float)`` regardless of the declared dtype (the spec's float64
  threshold patch loads but aborts session creation).
* Features are float32 on input; split thresholds are float32; near-tied rows
  flip routing. On this dataset 99.7% of eligible rows sit within 1e-6 of a
  split threshold (case-lag features are small integers / ratios of small
  integers and thresholds are quantiles of the same distribution), so float32
  routing flips are the dominant error: max |diff| = 1.3e-01 (h2) / 2.0e-01
  (h4) vs the Python double path.
* Python float32-vs-float64 itself diverges by 8.9e-02 (h2) / 1.5e-01 (h4) on
  this data — there is no float32 anywhere in the pipeline that can meet 1e-4.

The only way to honour the 1e-4 gate is an ONNX graph whose arithmetic IS the
Python arithmetic: comparisons and selects in float64 on float64 inputs. That
is what this module builds. It is an arithmetic re-implementation of
LightGBM's binary-sigmoid objective for this specific model family:

    margin = sum over trees of leaf_value(routed leaf)   # raw_score, base value 0
    p      = sigmoid(margin)                              # objective "binary"

Graph layout (opset 17, default domain only):
    input (tensor(double), [N, F])
      -> Split(axis=1, sizes=[1]*F)            -> col_j  [N, 1]  (13 tensors)
      -> per internal node (post-order):
           LessOrEqual(col_<split_feature>, th_<i>) -> cmp_...  [N, 1] bool
           Where(cmp_..., left_val, right_val)      -> v_...
         For decision_type '<=', missing_type 'None', default_left=True the
         plain LessOrEqual exactly matches LightGBM for non-NaN inputs; NaN
         routes to the RIGHT child (IEEE false), which equals LightGBM's
         behaviour for missing_type='None' (no missing branch). For any node
         with a non-None missing_type and default_left=True we emit
         Or(LessOrEqual(...), IsNaN(x)) so NaN routes LEFT.
      -> leaf value initializers                       -> lf_...  (scalar double)
      -> margin = t0_root + t1_root + ... (119 Adds)
      -> p = Sigmoid(margin)
      -> outputs: probabilities = Concat(1 - p, p, axis=1)  tensor(double) [N, 2]
                  label          = ArgMax(probabilities, axis=1)  tensor(int64) [N]

Column 1 of ``probabilities`` is P(surge) — same contract as the onnxmltools
``zipmap=False`` export, but tensor(double) end to end.

SIZE TRADEOFF: ~2,280 LessOrEqual + ~2,280 Where + ~2,400 leaf initializers
per model. Files land around ~1 MB — inside the 2 MB budget, above the
300 KB target (TreeEnsemble is ~100x denser). Documented in MODEL_MANIFEST.json.

VERIFIED SEMANTICS (see tests and MODEL_MANIFEST.json): rows mismatch vs
``booster.predict(X, raw_score=True)`` is 0.0 by construction; end-to-end
``probabilities`` match ``predict_proba`` to < 1e-12 on the full eligible
dataset (14k+ rows per horizon), not just the >=1000-row gate.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def _initializer(name: str, value: np.ndarray) -> onnx.TensorProto:
    return numpy_helper.from_array(np.ascontiguousarray(value), name=name)


def build_double_arithmetic_model(booster, feature_names: list[str]) -> onnx.ModelProto:
    dump = booster.dump_model()
    if dump.get("objective") != "binary sigmoid:1":
        raise ValueError(f"unsupported objective {dump.get('objective')!r}; this exporter assumes 'binary sigmoid:1'")
    trees = dump["tree_info"]
    n_features = len(feature_names)

    initializers: dict[str, onnx.TensorProto] = {}
    shared = _Dups()          # ONE namespace for thresholds AND leaf values (dedup by value)
    thresholds = leaves = shared

    graph_nodes: list[onnx.NodeProto] = []
    naming = _ShortNames()

    def const(name: str, value: np.float64) -> None:
        initializers[name] = _initializer(name, np.array(value, dtype=np.float64))

    # --- column splits (opset 17: `split` sizes are an input tensor, not an attribute) ---
    col_names = [f"col_{j}" for j in range(n_features)]
    initializers["split_sizes"] = _initializer("split_sizes", np.array([1] * n_features, dtype=np.int64))
    graph_nodes.append(helper.make_node(
        "Split", inputs=["input", "split_sizes"], outputs=col_names,
        axis=1,
    ))

    # --- trees, post-order emission ---
    root_values: list[str] = []
    for tree_idx, tree_info in enumerate(trees):
        root = _emit_node(
            tree_info["tree_structure"], col_names, naming, thresholds, leaves, const, graph_nodes,
        )
        root_values.append(root)

    # --- margin = sum of tree roots ---
    margin = root_values[0]
    for i, name in enumerate(root_values[1:], start=1):
        out = naming.next()
        graph_nodes.append(helper.make_node("Add", inputs=[margin, name], outputs=[out]))
        margin = out

    # --- p = sigmoid(margin); probabilities = concat(1-p, p) ---
    graph_nodes.append(helper.make_node("Sigmoid", inputs=[margin], outputs=["p_surge"]))
    const("one_f64", 1.0)
    graph_nodes.append(helper.make_node("Sub", inputs=["one_f64", "p_surge"], outputs=["p_low"]))
    graph_nodes.append(helper.make_node("Concat", inputs=["p_low", "p_surge"], outputs=["probabilities"], axis=1))
    graph_nodes.append(helper.make_node("ArgMax", inputs=["probabilities"], outputs=["label"], axis=1, keepdims=0))

    # dedupe identical threshold/leaf initializer values (cuts file size)
    for key, value in thresholds.items():
        const(key, value)
    for key, value in leaves.items():
        const(key, value)

    graph = helper.make_graph(
        graph_nodes,
        name="avash_dengue_surge_double",
        inputs=[helper.make_tensor_value_info("input", TensorProto.DOUBLE, ["N", n_features])],
        outputs=[
            helper.make_tensor_value_info("probabilities", TensorProto.DOUBLE, ["N", 2]),
            helper.make_tensor_value_info("label", TensorProto.INT64, ["N"]),
        ],
        initializer=list(initializers.values()),
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 9  # opset 17 compatible; avoids default latest IR that stale runtimes reject
    onnx.checker.check_model(model)
    return model


class _Dups:
    """Deduplicating name allocator for initializer values."""

    def __init__(self) -> None:
        self._by_value: dict[bytes, str] = {}
        self._items: dict[str, np.float64] = {}
        self._counter = 0

    def get(self, value: float) -> str:
        key = np.float64(value).tobytes()
        if key not in self._by_value:
            name = f"c_{self._counter}"
            self._counter += 1
            self._by_value[key] = name
            self._items[name] = np.float64(value)
        return self._by_value[key]

    def items(self):
        return self._items.items()


def _emit_node(node: dict, col_names, naming, thresholds, leaves, const, graph_nodes) -> str:
    """Emit post-order nodes for one tree node; return the output tensor name."""
    if "split_index" not in node:  # leaf
        return leaves.get(float(node["leaf_value"]))

    left = _emit_node(node["left_child"], col_names, naming, thresholds, leaves, const, graph_nodes)
    right = _emit_node(node["right_child"], col_names, naming, thresholds, leaves, const, graph_nodes)

    col = col_names[int(node["split_feature"])]
    thr = thresholds.get(float(node["threshold"]))
    decision = node.get("decision_type", "<=")
    default_left = bool(node.get("default_left", True))
    missing_type = node.get("missing_type", "None")

    if decision != "<=":
        raise ValueError(f"unsupported decision_type {decision!r} (expected '<=')")
    if missing_type == "None" or not default_left:
        # Plain IEEE compare; NaN -> False -> right child (missing_type None has no branch).
        cmp_out = naming.next()
        graph_nodes.append(helper.make_node("LessOrEqual", inputs=[col, thr], outputs=[cmp_out]))
    else:
        # default_left with possible missing values: NaN must route LEFT.
        le, isnan = naming.next(), naming.next()
        graph_nodes.append(helper.make_node("LessOrEqual", inputs=[col, thr], outputs=[le]))
        graph_nodes.append(helper.make_node("IsNaN", inputs=[col], outputs=[isnan]))
        cmp_out = naming.next()
        graph_nodes.append(helper.make_node("Or", inputs=[le, isnan], outputs=[cmp_out]))

    val = naming.next()
    graph_nodes.append(helper.make_node("Where", inputs=[cmp_out, left, right], outputs=[val]))
    return val


class _ShortNames:
    def __init__(self) -> None:
        self._n = 0

    def next(self) -> str:
        name = f"n{self._n}"
        self._n += 1
        return name
