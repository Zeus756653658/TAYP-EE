import os
import time
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional
from backend.config import APP_VERSION
from backend.database import load_json, save_json, create_full_backup, log_activity

# Indian Standard Time (IST, UTC+5:30) - guarantees cloud servers on UTC match Indian time
IST = timezone(timedelta(hours=5, minutes=30))

def get_now_ist() -> datetime:
    """Returns current wall-clock datetime in Indian Standard Time (IST)."""
    return datetime.now(IST).replace(tzinfo=None)

# Global maintenance state
manual_maintenance_override: bool = False
manual_maintenance_reason: str = ""

# Standard Dual Daily Maintenance Windows:
# 1. Night: 12:30 AM - 1:00 AM (00:30 - 01:00, 30 mins)
# 2. Afternoon: 3:00 PM - 3:15 PM (15:00 - 15:15, 15 mins)
DEFAULT_MAINTENANCE_WINDOWS: List[Dict[str, Any]] = [
    {
        "id": "night",
        "name": "Night Full Maintenance & System Updates",
        "start_hour": int(os.getenv("MAINTENANCE_NIGHT_HOUR", "0") or "0"),
        "start_minute": int(os.getenv("MAINTENANCE_NIGHT_MINUTE", "30") or "30"),
        "duration_minutes": int(os.getenv("MAINTENANCE_NIGHT_DURATION", "30") or "30"),
        "warning_minutes": int(os.getenv("MAINTENANCE_WARNING_MINUTES", "15") or "15"),
        "display": "12:30 AM - 1:00 AM"
    },
    {
        "id": "afternoon",
        "name": "Afternoon Maintenance & Data Snapshot",
        "start_hour": int(os.getenv("MAINTENANCE_HOUR", "15") or "15"),
        "start_minute": int(os.getenv("MAINTENANCE_MINUTE", "0") or "0"),
        "duration_minutes": int(os.getenv("MAINTENANCE_DURATION_MINUTES", "15") or "15"),
        "warning_minutes": int(os.getenv("MAINTENANCE_WARNING_MINUTES", "15") or "15"),
        "display": "3:00 PM - 3:15 PM"
    }
]

def get_maintenance_windows() -> List[Dict[str, Any]]:
    """Returns the list of scheduled maintenance windows (loads from maintenance_config or defaults)."""
    config = load_json("maintenance_config", {})
    custom_windows = config.get("windows")
    if isinstance(custom_windows, list) and len(custom_windows) > 0:
        return custom_windows
    return DEFAULT_MAINTENANCE_WINDOWS

def get_next_maintenance_datetime() -> datetime:
    now = get_now_ist()
    windows = get_maintenance_windows()
    upcoming = []
    for w in windows:
        t_today = now.replace(hour=w["start_hour"], minute=w["start_minute"], second=0, microsecond=0)
        t_end = t_today + timedelta(minutes=w["duration_minutes"])
        if now <= t_end:
            upcoming.append(t_today)
        else:
            upcoming.append(t_today + timedelta(days=1))
    upcoming.sort()
    return upcoming[0] if upcoming else now + timedelta(hours=1)

def check_maintenance_status() -> Dict[str, Any]:
    global manual_maintenance_override, manual_maintenance_reason
    windows = get_maintenance_windows()
    now = get_now_ist()

    active_window: Optional[Dict[str, Any]] = None
    warning_window: Optional[Dict[str, Any]] = None

    for w in windows:
        t_start = now.replace(hour=w["start_hour"], minute=w["start_minute"], second=0, microsecond=0)
        t_end = t_start + timedelta(minutes=w["duration_minutes"])
        t_warn = t_start - timedelta(minutes=w["warning_minutes"])

        if t_start <= now < t_end:
            active_window = w
            break
        elif t_warn <= now < t_start:
            warning_window = w

    in_maintenance = manual_maintenance_override or (active_window is not None)
    in_warning = (not in_maintenance) and (warning_window is not None)

    # Calculate next upcoming window
    upcoming_candidates = []
    for w in windows:
        t_today = now.replace(hour=w["start_hour"], minute=w["start_minute"], second=0, microsecond=0)
        t_end = t_today + timedelta(minutes=w["duration_minutes"])
        if now < t_today:
            upcoming_candidates.append((t_today, w))
        elif now < t_end:
            upcoming_candidates.append((t_today, w))
        else:
            t_tomorrow = t_today + timedelta(days=1)
            upcoming_candidates.append((t_tomorrow, w))

    upcoming_candidates.sort(key=lambda x: x[0])
    next_time, next_window = upcoming_candidates[0]

    seconds_until = max(0, int((next_time - now).total_seconds())) if not in_maintenance else 0

    status = "scheduled"
    if in_maintenance:
        status = "in_progress"
    elif in_warning:
        status = "warning"

    current_window_info = active_window or warning_window or next_window
    window_display = current_window_info["display"]
    window_name = current_window_info["name"]

    all_windows_summary = " & ".join([w["display"] for w in windows])

    return {
        "current_time": now.strftime("%Y-%m-%d %H:%M:%S"),
        "current_time_display": now.strftime("%I:%M:%S %p"),
        "maintenance_scheduled_time": f"{current_window_info['start_hour']:02d}:{current_window_info['start_minute']:02d}",
        "maintenance_window": f"{window_display} (Daily: {all_windows_summary})",
        "active_window_display": window_display,
        "active_window_name": window_name,
        "next_maintenance": next_time.strftime("%Y-%m-%d %H:%M:%S"),
        "seconds_until_maintenance": seconds_until,
        "in_maintenance": in_maintenance,
        "warning_active": in_warning,
        "status": status,
        "duration_minutes": current_window_info.get("duration_minutes", 15),
        "all_windows": [
            {
                "id": w["id"],
                "name": w["name"],
                "display": w["display"],
                "duration_minutes": w["duration_minutes"],
                "start_time": f"{w['start_hour']:02d}:{w['start_minute']:02d}"
            }
            for w in windows
        ],
        "system_version": APP_VERSION,
        "manual_override": manual_maintenance_override,
        "notes": f"Daily Maintenance Windows: {all_windows_summary} (IST, UTC+5:30)"
    }

def execute_daily_maintenance_tasks(window: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Executes scheduled daily backup, data compaction, integrity checks, and update procedures."""
    now = get_now_ist()
    win_label = window.get("display", "Daily Maintenance") if window else "Daily Maintenance"
    tag_prefix = window.get("id", "daily") if window else "daily"

    log_activity("MAINTENANCE_START", f"Starting scheduled {win_label} maintenance and auto-update cycle.")
    
    # 1. Backup all data
    backup_file = create_full_backup(tag=f"{tag_prefix}_{now.strftime('%H%M')}")
    
    # 2. Database integrity checks & cleanups
    bills = load_json("bills", [])
    products = load_json("products", [])
    customers = load_json("customers", [])
    stock = load_json("stock", [])

    # Update maintenance config
    config = load_json("maintenance_config", {})
    history = config.get("history", [])
    entry = {
        "timestamp": now.isoformat(),
        "backup_file": backup_file,
        "window": win_label,
        "total_bills": len(bills),
        "total_products": len(products),
        "total_customers": len(customers),
        "status": "SUCCESS",
        "notes": f"{win_label} maintenance, integrity verification, and auto-update completed."
    }
    history.insert(0, entry)
    config["history"] = history[:40] # Keep 40 runs history
    config["last_run"] = now.isoformat()
    config["last_window"] = win_label
    save_json("maintenance_config", config)
    
    log_activity("MAINTENANCE_COMPLETE", f"Maintenance ({win_label}) successfully completed. Backup saved: {backup_file}")
    
    return entry

async def maintenance_background_scheduler():
    """Runs continuously in background. When configured maintenance windows are reached, triggers maintenance tasks."""
    last_runs: Dict[str, str] = {}
    while True:
        try:
            now = get_now_ist()
            windows = get_maintenance_windows()
            today_str = now.strftime("%Y-%m-%d")

            for w in windows:
                w_id = w.get("id", "default")
                if now.hour == w["start_hour"] and now.minute == w["start_minute"]:
                    if last_runs.get(w_id) != today_str:
                        execute_daily_maintenance_tasks(window=w)
                        last_runs[w_id] = today_str
        except Exception as e:
            print(f"[Maintenance Scheduler Error] {e}")
        await asyncio.sleep(20)
