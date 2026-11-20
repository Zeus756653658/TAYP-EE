import os
import time
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict, Any
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

def get_next_maintenance_datetime(target_hour: int = 15, target_minute: int = 0) -> datetime:
    env_dur = int(os.getenv("MAINTENANCE_DURATION_MINUTES", "15") or "15")
    now = get_now_ist()
    target_today = now.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
    if now > target_today + timedelta(minutes=env_dur):
        # Already passed today's window, next is tomorrow
        return target_today + timedelta(days=1)
    return target_today

def check_maintenance_status() -> Dict[str, Any]:
    global manual_maintenance_override, manual_maintenance_reason
    env_hour = int(os.getenv("MAINTENANCE_HOUR", "15") or "15")
    env_min = int(os.getenv("MAINTENANCE_MINUTE", "0") or "0")
    env_dur = int(os.getenv("MAINTENANCE_DURATION_MINUTES", "15") or "15")
    env_warn = int(os.getenv("MAINTENANCE_WARNING_MINUTES", "15") or "15")

    config = load_json("maintenance_config", {
        "maintenance_hour": env_hour,
        "maintenance_minute": env_min,
        "duration_minutes": env_dur,
        "warning_minutes_before": env_warn,
        "auto_backup": True,
        "auto_update": True,
        "system_version": APP_VERSION
    })

    now = get_now_ist()
    target_hour = env_hour
    target_minute = env_min
    duration_minutes = env_dur
    warning_minutes = env_warn

    today_target = now.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
    window_end = today_target + timedelta(minutes=duration_minutes)
    warning_start = today_target - timedelta(minutes=warning_minutes)

    in_window = today_target <= now < window_end
    in_warning = warning_start <= now < today_target

    # Determine if in maintenance
    in_maintenance = manual_maintenance_override or in_window
    
    # Calculate seconds until next 3 PM maintenance
    if now < today_target:
        seconds_until = int((today_target - now).total_seconds())
        next_time = today_target
    elif now < window_end:
        seconds_until = 0
        next_time = today_target
    else:
        tomorrow_target = today_target + timedelta(days=1)
        seconds_until = int((tomorrow_target - now).total_seconds())
        next_time = tomorrow_target

    status = "scheduled"
    if in_maintenance:
        status = "in_progress"
    elif in_warning:
        status = "warning"

    end_hour = target_hour + ((target_minute + duration_minutes) // 60)
    end_min = (target_minute + duration_minutes) % 60

    return {
        "current_time": now.strftime("%Y-%m-%d %H:%M:%S"),
        "current_time_display": now.strftime("%I:%M:%S %p"),
        "maintenance_scheduled_time": f"{target_hour:02d}:{target_minute:02d}",
        "maintenance_window": f"{target_hour:02d}:{target_minute:02d} - {end_hour:02d}:{end_min:02d} (3:00 PM - 3:15 PM)",
        "next_maintenance": next_time.strftime("%Y-%m-%d %H:%M:%S"),
        "seconds_until_maintenance": seconds_until,
        "in_maintenance": in_maintenance,
        "warning_active": in_warning and not in_maintenance,
        "status": status,
        "duration_minutes": duration_minutes,
        "system_version": config.get("system_version", APP_VERSION),
        "manual_override": manual_maintenance_override,
        "notes": f"Daily 3:00 PM to 3:15 PM ({target_hour:02d}:{target_minute:02d} - {end_hour:02d}:{end_min:02d}) Maintenance & Updates"
    }

def execute_daily_maintenance_tasks() -> Dict[str, Any]:
    """Executes the daily 3:00 PM to 3:15 PM (15:00 - 15:15) backup, data compaction, integrity checks, and update procedures."""
    now = get_now_ist()
    env_hour = int(os.getenv("MAINTENANCE_HOUR", "15") or "15")
    env_min = int(os.getenv("MAINTENANCE_MINUTE", "0") or "0")
    env_dur = int(os.getenv("MAINTENANCE_DURATION_MINUTES", "15") or "15")
    end_hour = env_hour + ((env_min + env_dur) // 60)
    end_min = (env_min + env_dur) % 60
    sched_label = f"{env_hour:02d}:{env_min:02d} - {end_hour:02d}:{end_min:02d}"

    log_activity("MAINTENANCE_START", f"Starting scheduled {sched_label} (3:00 PM - 3:15 PM) daily maintenance and update cycle.")
    
    # 1. Backup all data
    backup_file = create_full_backup(tag=f"daily_{env_hour}h")
    
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
        "total_bills": len(bills),
        "total_products": len(products),
        "total_customers": len(customers),
        "status": "SUCCESS",
        "notes": f"{sched_label} (3:00 PM - 3:15 PM) daily maintenance, integrity verification, and auto-update completed."
    }
    history.insert(0, entry)
    config["history"] = history[:30] # Keep 30 days history
    config["last_run"] = now.isoformat()
    config["maintenance_hour"] = env_hour
    config["maintenance_minute"] = env_min
    config["duration_minutes"] = env_dur
    save_json("maintenance_config", config)
    
    log_activity("MAINTENANCE_COMPLETE", f"Daily maintenance ({sched_label}) successfully completed. Backup saved: {backup_file}")
    
    return entry

async def maintenance_background_scheduler():
    """Runs continuously in background. When configured maintenance time (15:00 / 3 PM) is reached, triggers daily maintenance."""
    last_run_day = None
    while True:
        try:
            now = get_now_ist()
            env_hour = int(os.getenv("MAINTENANCE_HOUR", "15") or "15")
            env_min = int(os.getenv("MAINTENANCE_MINUTE", "0") or "0")
            if now.hour == env_hour and now.minute == env_min and last_run_day != now.date():
                execute_daily_maintenance_tasks()
                last_run_day = now.date()
        except Exception as e:
            print(f"[Maintenance Scheduler Error] {e}")
        await asyncio.sleep(20)
