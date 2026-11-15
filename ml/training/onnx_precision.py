"""Double-precision TreeEnsemble threshold patch (spec §3.4).

onnxmltools 1.16 emits TreeEnsembleClassifier (ai.onnx.ml opset 1) with SPLIT
THRESHOLDS as float32 attributes. LightGBM trains on float64 split points, so
float32 rounding can flip routing on exact boundary comparisons.

Ordering fidelity (important): the converter (a) numbers nodes with
smallest-free-id creation order — both children are created at parent processing
time (left, then right), depth-first left subtree first — and (b) then SORTS all
nodes_* attributes by (treeid asc, nodeid asc) before emitting the graph. This
module reproduces exactly that order from ``booster.dump_model()``; a mismatch is
a hard error and the caller falls back to the float32 export.

Patch (surgical, in place):
  1. Verify rebuilt float64 thresholds cast to float32 match the converter's
     ``nodes_values`` at every branch position (abs tol 1e-6); leaves must be 0.0.
  2. Replace float32 attribute ``nodes_values`` with tensor attribute
     ``nodes_values_as_tensor`` (DOUBLE) — ai.onnx.ml opset 3 semantics.
  3. Bump opset imports: ai.onnx.ml -> 3, ai.onnx -> 17.
  4. Fix the ``label`` output shape ({1} -> N).
"""
from __future__ import annotations

import copy

import numpy as np
import onnx
from onnx import TensorProto, helper


class PrecisionPatchError(RuntimeError):
    pass


def _assign_ids(node: dict, my_id: int, counter: list[int], values: list):
    """Mirror the converter's numbering: parent id fixed at creation; children ids
    allocated (left then right) at parent processing time before recursion."""
    if "leaf_value" in node:
        values[my_id] = 0.0
        return
    left_id = counter[0]; counter[0] += 1
    right_id = counter[0]; counter[0] += 1
    values[my_id] = float(node["threshold"])
    _assign_ids(node["left_child"], left_id, counter, values)
    _assign_ids(node["right_child"], right_id, counter, values)


def rebuild_double_thresholds(booster) -> list[float]:
    dump = booster.dump_model()
    values: list[float] = []
    for tree in dump.get("tree_info", []):
        ts = tree["tree_structure"]
        # count nodes to size the array
        n_nodes = sum(1 for _ in _walk(ts))
        vals = [0.0] * n_nodes
        # root id is always 0 within a tree; converter sorts (treeid, nodeid)
        _assign_ids(ts, 0, [1], vals)
        # NOTE: root consumed id 0; counter starts at 1 (left id)
        values.extend(vals)
    return values


def _walk(node):
    yield node
    if "leaf_value" in node:
        return
    yield from _walk(node["left_child"])
    yield from _walk(node["right_child"])


def patch_tree_ensemble_double_precision(onnx_model: onnx.ModelProto, booster) -> onnx.ModelProto:
    patched = copy.deepcopy(onnx_model)
    tree_nodes = [n for n in patched.graph.node if n.op_type == "TreeEnsembleClassifier"]
    if not tree_nodes:
        raise PrecisionPatchError("no TreeEnsembleClassifier node found")

    double_values = rebuild_double_thresholds(booster)
    for node in tree_nodes:
        attrs = {a.name: a for a in node.attribute}
        if "nodes_values" not in attrs:
            raise PrecisionPatchError("converter emitted no 'nodes_values' attribute to patch")
        f32_values = list(attrs["nodes_values"].floats)
        if len(double_values) != len(f32_values):
            raise PrecisionPatchError(f"node count mismatch: dump={len(double_values)} onnx={len(f32_values)}")
        diffs = [abs(np.float32(d) - o) for d, o in zip(double_values, f32_values)]
        if max(diffs, default=0.0) > 1e-6:
            raise PrecisionPatchError("rebuilt thresholds disagree with converter order; aborting patch")

        del attrs["nodes_values"]
        tensor = TensorProto()
        tensor.dims.extend([len(double_values)])
        tensor.data_type = TensorProto.DOUBLE
        tensor.raw_data = np.asarray(double_values, dtype=np.float64).tobytes()
        attrs["nodes_values_as_tensor"] = helper.make_attribute("nodes_values_as_tensor", tensor)
        node.attribute.clear()
        node.attribute.extend(attrs.values())

    keep = [op for op in patched.opset_import if op.domain not in ("", "ai.onnx.ml")]
    patched.opset_import.clear()
    for dom, ver in (("", 17), ("ai.onnx.ml", 3)):
        op = onnx.OperatorSetIdProto(); op.domain, op.version = dom, ver
        patched.opset_import.append(op)
    for op in keep:
        patched.opset_import.append(op)

    for out in patched.graph.output:
        if out.name == "label":
            shape = out.type.tensor_type.shape
            if len(shape.dim) == 1 and shape.dim[0].dim_value == 1:
                shape.dim[0].ClearField("dim_value")
                shape.dim[0].dim_param = "N"
    return patched
