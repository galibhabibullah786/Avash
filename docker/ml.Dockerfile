# syntax=docker/dockerfile:1
#
# Avash offline ML pipeline (ADR-002, ADR-011).
#
# Reproducible runtime for `ml/` — training, evaluation, ONNX export, and
# the batch inference pass that `cron-batch-predict.yml` runs on a
# schedule. Nothing here is ever deployed as a live service: there is no
# server, no exposed port, and no long-running process. The container runs
# one Python command and exits.
#
# Python 3.11 matches the version pinned in the Actions cron workflows, so
# a local run and a scheduled run resolve the same dependency tree.
#
#   docker compose --profile ml build ml
#   docker compose --profile ml run --rm ml python ml/training/train.py

FROM python:3.14-slim-bookworm

# ML_PYTHON_IMAGE, docs/PROJECT_PLAN.md §14. Bump in lockstep with the
# `python-version` of the cron workflows.

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# libgomp1 is LightGBM's OpenMP runtime — the slim base omits it and
# `import lightgbm` fails without it. Left unpinned so it tracks Debian's
# security patches rather than freezing a version (hadolint DL3008).
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install --no-install-recommends -y libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# pip's own bundled setuptools/wheel/jaraco.context ship with known CVEs
# in the base image; upgrade the toolchain itself before it builds
# anything from requirements.txt. Left unpinned, same rationale as
# libgomp1 above (hadolint DL3013).
# hadolint ignore=DL3013
RUN python -m pip install --upgrade pip setuptools wheel

# Dependencies first: this layer is cached until requirements.txt changes.
COPY ml/requirements.txt ./ml/requirements.txt
RUN python -m pip install --requirement ./ml/requirements.txt

# Non-root by default. UID 1000 matches the typical host user, so files
# written into the bind-mounted ./ml and ./packages/ml-inference are owned
# by the developer rather than by root.
RUN useradd --create-home --uid 1000 avash \
    && chown -R avash:avash /app
USER 1000

# Baked for the CI/standalone case (`docker run avash-ml:local`). In local
# development compose bind-mounts ./ml over this, so edits need no rebuild.
COPY --chown=avash:avash ml/ ./ml/

CMD ["python", "-c", "print('avash-ml ready. Pass a command, e.g. python ml/training/train.py')"]
