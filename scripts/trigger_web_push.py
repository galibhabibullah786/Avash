#!/usr/bin/env python3
"""Custom script to trigger dengue risk Web Push notifications across dev and prod.
Uses ml/serving/push_delivery.py and pywebpush directly from Python.

Usage:
  python scripts/trigger_web_push.py --target dev --region Dhaka
  python scripts/trigger_web_push.py --target prod --region Chittagong --level severe
  python scripts/trigger_web_push.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

# Add repo root to sys.path
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from ml.serving.push_delivery import (
    WebPushTransport,
    build_alert_payload,
    dispatch_alerts,
    get_vapid_config,
    load_push_subscriptions,
)

log = logging.getLogger(__name__)


def get_supabase_config() -> dict[str, str | None]:
    url = os.environ.get("AVASH_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = (os.environ.get("AVASH_SUPABASE_SERVICE_KEY") or
           os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or
           os.environ.get("SUPABASE_SERVICE_KEY"))

    if url and ("127.0.0.1" in url or "localhost" in url):
        if os.path.exists("/.dockerenv") or os.environ.get("DOCKER_CONTAINER"):
            url = url.replace("127.0.0.1", "host.docker.internal").replace("localhost", "host.docker.internal")

    return {"url": url, "key": key}


def parse_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    res = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#") or "=" not in trimmed:
            continue
        k, v = trimmed.split("=", 1)
        res[k.strip()] = v.strip().strip("'\"")
    return res


def main(argv=None):
    parser = argparse.ArgumentParser(description="Trigger dengue surge Web Push notifications")
    parser.add_argument("--target", choices=["dev", "prod"], default="dev", help="Target environment")
    parser.add_argument("--region", default="Dhaka", help="Region name to trigger alert for")
    parser.add_argument("--level", choices=["moderate", "high", "severe"], default="severe", help="Risk level band")
    parser.add_argument("--score", type=float, default=0.85, help="Risk score [0.0 - 1.0]")
    parser.add_argument("--horizon", type=int, default=4, help="Forecast horizon weeks (2 or 4)")
    parser.add_argument("--broadcast", "--all", action="store_true", dest="broadcast", help="Broadcast to all registered devices ignoring geofence")
    parser.add_argument("--mock", action="store_true", help="Simulate push with synthetic subscription")
    parser.add_argument("--dry-run", action="store_true", help="Print payload without network send")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    print("\n" + "=" * 60)
    print(f"🚨 Python Web Push Trigger [Target: {args.target.upper()}]")
    print("=" * 60)
    print(f"📍 Region:       {args.region}")
    print(f"⚠️  Risk Level:   {args.level.upper()}")
    print(f"📊 Risk Score:   {args.score}")
    print(f"⏳ Horizon:      {args.horizon} weeks")
    print(f"🎯 Targeting:    {'BROADCAST ALL' if args.broadcast else 'GEOFENCED PROXIMITY'}")
    print(f"⚙️  Mode:         {'MOCK' if args.mock else ('DRY-RUN' if args.dry_run else 'LIVE DISPATCH')}\n")

    crossing = {
        "region": args.region,
        "horizon_weeks": args.horizon,
        "risk_score": args.score,
        "band": args.level,
        "model_version": "2.0.0",
    }
    payload = build_alert_payload(crossing)

    if args.mock:
        print("✅ [MOCK] Alert Payload generated and signed successfully:")
        print(json.dumps(payload, indent=2))
        return 0

    if args.dry_run:
        print("✅ [DRY-RUN] Alert Payload:")
        print(json.dumps(payload, indent=2))
        return 0

    # Load environment variables
    env_file = _REPO_ROOT / (f".env.{args.target}" if (_REPO_ROOT / f".env.{args.target}").exists() else ".env")
    env_vars = parse_env_file(env_file)
    for k, v in env_vars.items():
        if k not in os.environ:
            os.environ[k] = v

    # Fallback default local Supabase credentials for dev
    if args.target == "dev":
        if "SUPABASE_URL" not in os.environ and "AVASH_SUPABASE_URL" not in os.environ:
            os.environ["AVASH_SUPABASE_URL"] = "http://127.0.0.1:54321"
        if "SUPABASE_SERVICE_ROLE_KEY" not in os.environ and "AVASH_SUPABASE_SERVICE_KEY" not in os.environ:
            os.environ["AVASH_SUPABASE_SERVICE_KEY"] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzE5NDQwMH0.local-service-role-key-placeholder"

    cfg = get_supabase_config()
    vapid_cfg = get_vapid_config()

    if not cfg["url"] or not cfg["key"]:
        log.error("Missing Supabase URL or Service Key for target %s", args.target)
        return 1

    try:
        from supabase import create_client
        client = create_client(cfg["url"], cfg["key"])
    except Exception as exc:  # noqa: BLE001
        log.error("Failed to connect to Supabase: %s", exc)
        return 1

    region_filter = None if args.broadcast else args.region
    subs = load_push_subscriptions(client, region_name=region_filter)
    print(f"🛰️  Matched {len(subs)} subscriber(s) for region '{args.region}' (broadcast={args.broadcast}).")

    if not subs:
        print(f"ℹ️  No active push subscriptions found in database for {args.region}.")
        print("Tip: Use the Avash web app to click 'Enable push notifications' to register your browser, then run with --broadcast.")
        return 0

    if not vapid_cfg:
        log.error("VAPID private key not configured. Cannot sign Web Push messages.")
        return 1

    transport = WebPushTransport(vapid_cfg["private_key"], vapid_cfg["subject"])
    res = dispatch_alerts([crossing], subs, transport)
    print(f"\n📊 Result: {res['sent']} sent, {res['failed']} failed across {res['subscriptions']} subscriptions.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
