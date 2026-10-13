"""Prewarmed public beach snapshots with the same lifecycle as Insights.

All list/individual beach payloads are built with bulk report and cleanup reads.
The detailed view preserves the active-band composition and recent-report archive
installed by standalone_cleanup, rather than the older app_core fields.
"""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Any

from flask import jsonify, request
from sqlalchemy import select

from standalone_cleanup import _active_quantities, _current_band_state


def _composition(impl: Any, active_rows: list[tuple[Any, dict[str, str]]]) -> list[dict[str, Any]]:
    """Match the reviewed active-composition algorithm, including each category's band."""
    aggregate = {
        category: impl.CATEGORY_WEIGHTS[category] * sum(
            impl.QUANTITY_WEIGHTS[quantities[category]]
            for _report, quantities in active_rows if category in quantities
        )
        for category in impl.FRONTEND_CATEGORIES
    }
    weighted = [(category, aggregate[category])
                for category in impl.FRONTEND_CATEGORIES if aggregate[category] > 0]
    total = sum(value for _category, value in weighted)
    if not total:
        return []
    exact = [(category, value * 100 / total) for category, value in weighted]
    whole = {category: impl.math.floor(value) for category, value in exact}
    remaining = 100 - sum(whole.values())
    for category, _ in sorted(
        exact, key=lambda item: item[1] - impl.math.floor(item[1]), reverse=True
    )[:remaining]:
        whole[category] += 1
    by_level = {weight: band for band, weight in impl.QUANTITY_WEIGHTS.items()}
    return [{
        "category": category, "percentage": whole[category],
        "band": by_level[max(
            impl.QUANTITY_WEIGHTS[quantities[category]]
            for _report, quantities in active_rows if category in quantities
        )],
    } for category, _ in weighted]


def build_beach_snapshots(engine: Any, impl: Any, now: datetime | None = None) -> dict[str, Any]:
    current = now or datetime.now(timezone.utc)
    beaches = impl.load_beaches(engine)
    # Use the same batch function as the live /beaches list endpoint.
    summaries = impl.beach_summaries_batch(engine, beaches, now=current)
    cutoff = current - timedelta(days=90)
    with engine.connect() as connection:
        reports = connection.execute(
            select(impl.reports_table)
            .where(impl.reports_table.c.status == "Counted")
        ).all()
        ids = [row.id for row in reports]
        actions = (connection.execute(
            select(impl.cleanup_actions_table)
            .where(impl.cleanup_actions_table.c.target_report_id.in_(ids))
            .order_by(impl.cleanup_actions_table.c.created_at)
        ).all() if ids else [])

    actions_by_report: dict[str, list[Any]] = defaultdict(list)
    reports_by_beach: dict[str, list[Any]] = defaultdict(list)
    for action in actions:
        actions_by_report[action.target_report_id].append(action)
    for row in reports:
        reports_by_beach[row.beach_id].append(row)

    details: dict[str, dict[str, Any]] = {}
    for beach, summary in zip(beaches, summaries):
        all_counted = [row for row in reports_by_beach[beach["id"]]
                       if row.id not in impl.LEGACY_SEED_REPORT_IDS]
        eligible = [row for row in all_counted
                    if impl.utc_datetime(row.created_at) >= cutoff
                    and getattr(row, "deleted_at", None) is None]
        active_rows: list[tuple[Any, dict[str, str]]] = []
        for row in eligible:
            current_bands = _active_quantities(
                _current_band_state(impl, row, actions_by_report[row.id]))
            if current_bands:
                active_rows.append((row, current_bands))

        score = (float(median(impl.report_score_for(bands)
                              for _row, bands in active_rows))
                 if len(active_rows) >= 3 else None)
        severity, band = impl.severity_from_score(score)
        newest = max(all_counted, key=lambda r: impl.utc_datetime(r.created_at), default=None)
        newest_active = max(
            (impl.utc_datetime(row.created_at) for row, _ in active_rows), default=None)
        age = current - newest_active if newest_active else None
        detail = {
            **summary,
            "severity": severity, "band": band, "insufficientData": severity is None,
            "validReports": len(active_rows),
            "attentionScore": round(score, 2) if score is not None else None,
            "eligibleReportCount": len(active_rows),
            "lastReportedAt": impl.contract_timestamp(newest.created_at) if newest else None,
            "newestCountedReportAt": impl.contract_timestamp(newest_active) if newest_active else None,
            "latestContributingReportAt": impl.contract_timestamp(newest_active) if newest_active else None,
            "freshnessKind": ("stale" if age is None else "ok" if age < timedelta(days=30)
                              else "aging" if age <= timedelta(days=90) else "stale"),
            "species": beach.get("species", []),
            "ecologicalNote": beach.get("ecologicalNote", ""),
        }
        if active_rows:
            detail["composition"] = _composition(impl, active_rows)
            detail["compositionSource"] = {
                "method": "active_report_estimate",
                "activeReportCount": len(active_rows),
                "windowDays": 90,
            }
        else:
            detail["composition"] = None
            detail["compositionSource"] = None

        # Up to four most recent non-deleted Counted reports, including those
        # resolved by cleanup; their submitted bands are historical evidence.
        newest_reports = sorted(
            (r for r in reports_by_beach[beach["id"]]
             if getattr(r, "deleted_at", None) is None),
            key=lambda r: (impl.utc_datetime(r.created_at), r.id),
            reverse=True,
        )[:4]
        detail["recentReportBands"] = [{
            "reportId": row.id,
            "reportedAt": impl.contract_timestamp(row.created_at),
            "bands": bands,
        } for row in newest_reports
          if (bands := _active_quantities(impl.quantities_from_row(row)))]

        details[beach["id"]] = detail
    return {"beaches": summaries, "details": details}


def install_beach_snapshots(application: Any, engine: Any, impl: Any) -> None:
    original_list = application.view_functions["get_beaches"]
    original_detail = application.view_functions["get_beach"]
    cache_enabled = not application.testing
    try:
        ttl = max(5.0, float(os.getenv("INSIGHTS_CACHE_TTL_SECONDS", "60")))
    except ValueError:
        ttl = 60.0
    lock = threading.Lock()
    refresh_lock = threading.Lock()
    cached: tuple[float, dict[str, Any]] | None = None
    generation = 0

    def invalidate() -> None:
        nonlocal cached, generation
        with lock:
            generation += 1
            if cached is not None:
                cached = (0.0, cached[1])

    def publish(built: dict[str, Any], started: int) -> None:
        nonlocal cached
        with lock:
            cached = ((time.monotonic() if started == generation else 0.0), built)

    def refresh_sync() -> dict[str, Any]:
        with refresh_lock:
            with lock:
                started = generation
            built = build_beach_snapshots(engine, impl)
            publish(built, started)
            return built

    def refresh_async() -> None:
        if not cache_enabled or not refresh_lock.acquire(blocking=False):
            return

        def work() -> None:
            try:
                with lock:
                    started = generation
                built = build_beach_snapshots(engine, impl)
                publish(built, started)
            except Exception:  # pragma: no cover - deployment-only refresh
                application.logger.exception("Public beach snapshot refresh failed")
            finally:
                refresh_lock.release()

        threading.Thread(target=work, name="radar-beach-refresh", daemon=True).start()

    def read() -> dict[str, Any]:
        if not cache_enabled:
            return build_beach_snapshots(engine, impl)
        with lock:
            snapshot = cached
        if snapshot is None:
            return refresh_sync()
        if time.monotonic() - snapshot[0] >= ttl:
            refresh_async()
        return snapshot[1]

    def list_beaches():
        if not cache_enabled:
            return original_list()
        response = jsonify(read()["beaches"])
        response.headers["Cache-Control"] = "no-store"
        return response

    def get_beach(beach_id: str):
        if not cache_enabled:
            return original_detail(beach_id)
        details = read()["details"]
        if beach_id not in details:
            return impl.error_response(404, "NOT_FOUND", "Beach not found.")
        response = jsonify(details[beach_id])
        response.headers["Cache-Control"] = "no-store"
        return response

    application.view_functions["get_beaches"] = list_beaches
    application.view_functions["get_beach"] = get_beach
    application.extensions["prewarm_beach_snapshots"] = refresh_sync
    application.extensions["refresh_beach_snapshots_async"] = refresh_async
    application.extensions["invalidate_beach_snapshots"] = invalidate

    @application.after_request
    def invalidate_beaches_after_write(response: Any):
        if request.method not in {"GET", "HEAD", "OPTIONS"} and response.status_code < 400:
            invalidate()
            if request.method == "POST" and request.path == "/reports" and response.status_code == 201:
                refresh_async()
        return response
