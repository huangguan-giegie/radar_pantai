"""Prewarmed public beach snapshots with the same lifecycle as Insights.

Build list and 179 detail payloads in a handful of batch queries. Read requests
only serialize in-memory data; expired snapshots are served while one background
refresh runs. A successful mutation invalidates the timestamp, matching the
Insights stale-while-revalidate contract.
"""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone
from typing import Any

from flask import jsonify, request
from sqlalchemy import select


def build_beach_snapshots(engine: Any, impl: Any, now: datetime | None = None) -> dict[str, Any]:
    current = now or datetime.now(timezone.utc)
    beaches = impl.load_beaches(engine)
    summaries = impl.beach_summaries_batch(engine, beaches, now=current)
    # The original detail endpoint uses the latest Counted report for the
    # composition chart, independently of the active 90-day attention window.
    with engine.connect() as connection:
        reports = connection.execute(
            select(impl.reports_table)
            .where(impl.reports_table.c.status == "Counted")
            .order_by(impl.reports_table.c.created_at.desc())
        ).all()
        latest: dict[str, Any] = {}
        for row in reports:
            latest.setdefault(row.beach_id, row)
        count_backed_ids = [row.id for row in latest.values()
                            if getattr(row, "item_counts", None)]
        actions = (connection.execute(
            select(impl.cleanup_actions_table)
            .where(impl.cleanup_actions_table.c.target_report_id.in_(count_backed_ids))
        ).all() if count_backed_ids else [])

    by_report: dict[str, list[Any]] = {}
    for action in actions:
        by_report.setdefault(action.target_report_id, []).append(action)

    details: dict[str, dict[str, Any]] = {}
    for beach, summary in zip(beaches, summaries):
        detail = {**summary, "species": beach.get("species", []),
                  "ecologicalNote": beach.get("ecologicalNote", "")}
        report = latest.get(beach["id"])
        if report is None:
            detail.update({"composition": None, "compositionSource": None})
        else:
            quantities = impl.quantities_from_row(report)
            if getattr(report, "item_counts", None):
                quantities = impl.quantity_bands_for_counts(
                    impl.remaining_counts_for(report, by_report.get(report.id, [])))
            detail.update({
                "composition": impl.composition_percentages(quantities),
                "compositionSource": {
                    "reportId": report.id,
                    "createdAt": impl.contract_timestamp(report.created_at),
                    "method": "reported_quantity_estimate",
                },
            })
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

    def publish(built: dict[str, Any], started_generation: int) -> None:
        nonlocal cached
        with lock:
            # A write that occurs during construction must not be marked fresh.
            stamp = time.monotonic() if started_generation == generation else 0.0
            cached = (stamp, built)

    def refresh_sync() -> dict[str, Any]:
        with refresh_lock:
            with lock:
                started_generation = generation
            built = build_beach_snapshots(engine, impl)
            publish(built, started_generation)
            return built

    def refresh_async() -> None:
        if not cache_enabled or not refresh_lock.acquire(blocking=False):
            return

        def work() -> None:
            try:
                with lock:
                    started_generation = generation
                built = build_beach_snapshots(engine, impl)
                publish(built, started_generation)
            except Exception:  # pragma: no cover - production-only refresh
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
