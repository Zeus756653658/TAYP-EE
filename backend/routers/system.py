import os
import hmac
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Dict, Any, Optional
from datetime import datetime
from backend.config import (
    BACKUP_DIR, 
    APP_VERSION, 
    APP_VERSION_STAGE, 
    APP_BUILD, 
    APP_NAME, 
    update_env_file
)
from backend.database import load_json, log_activity
from backend.cloud_db import (
    get_cloud_config, 
    save_cloud_config, 
    test_cloud_connection, 
    export_cloud_backup_zip,
    push_all_local_to_cloud
)
from backend.maintenance import (
    check_maintenance_status, 
    execute_daily_maintenance_tasks
)
import backend.maintenance as maint_module

router = APIRouter(prefix="/api/system", tags=["System & 3:00 PM (15:00) Maintenance Engine"])

class CloudConfigSchema(BaseModel):
    supabase_url: str
    supabase_key: str

class BypassPinSchema(BaseModel):
    pin: str

@router.post("/verify-bypass-pin")
def verify_bypass_pin(payload: BypassPinSchema):
    expected_pin = os.getenv("EMERGENCY_BYPASS_PIN", "1234").strip()
    if hmac.compare_digest(payload.pin.strip(), expected_pin):
        log_activity("MAINTENANCE_BYPASS", "Emergency cashier bypass PIN verified.")
        return {"valid": True}
    raise HTTPException(status_code=403, detail="Incorrect PIN. Maintenance window locked.")

@router.post("/security-pin")
def update_bypass_pin(payload: BypassPinSchema):
    pin = payload.pin.strip()
    if len(pin) < 4:
        raise HTTPException(status_code=400, detail="PIN must be at least 4 characters.")
    update_env_file({"EMERGENCY_BYPASS_PIN": pin})
    log_activity("SECURITY_PIN_UPDATE", "Updated Emergency Maintenance Bypass PIN in .env")
    return {"status": "success", "message": "Emergency Bypass PIN updated in .env!"}

@router.get("/cloud-status")
def get_cloud_status():
    """Returns current Cloud DB (Supabase) status and connection health (masks secret key)."""
    conf = dict(get_cloud_config())
    # Never expose raw secret key back to browser
    if conf.get("supabase_key"):
        conf["supabase_key"] = ""
        conf["has_key"] = True
    else:
        conf["has_key"] = False
    return conf

@router.post("/cloud-config")
def update_cloud_config(cfg: CloudConfigSchema):
    """Saves Supabase Cloud URL and Key, testing connection immediately."""
    result = save_cloud_config(cfg.supabase_url, cfg.supabase_key)
    log_activity("CLOUD_CONFIG_UPDATE", f"Updated Supabase connection settings. Connected: {result.get('is_connected')}")
    return result

@router.post("/sync-to-cloud")
def sync_local_to_cloud():
    """Uploads/syncs all local data records to Supabase tables."""
    res = push_all_local_to_cloud()
    log_activity("CLOUD_SYNC", "Triggered bulk sync from local buffer to Supabase.")
    return res

@router.get("/download-backup-zip")
def download_backup_zip():
    """Dumps all cloud/server business tables into a ZIP archive and triggers browser download."""
    zip_path = export_cloud_backup_zip()
    return FileResponse(
        path=str(zip_path),
        filename=zip_path.name,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={zip_path.name}"}
    )

@router.get("/maintenance")
def get_maintenance():
    """Returns live countdown and status for the scheduled 3:00 PM (15:00) daily maintenance."""
    return check_maintenance_status()

@router.post("/trigger-maintenance")
def trigger_maintenance_now():
    """Allows Admin to trigger or test the 3:00 PM (15:00) maintenance cycle immediately."""
    result = execute_daily_maintenance_tasks()
    return {
        "status": "success",
        "message": "Daily 3:00 PM (15:00) maintenance & updates routine executed successfully.",
        "details": result
    }

@router.post("/toggle-maintenance-mode")
def toggle_maintenance_mode(enable: bool, reason: str = "Manual Admin Lock"):
    """Simulates or forces the 3:00 PM (15:00) maintenance lock screen."""
    maint_module.manual_maintenance_override = enable
    maint_module.manual_maintenance_reason = reason
    action = "ENABLED" if enable else "DISABLED"
    log_activity("MAINTENANCE_TOGGLE", f"Maintenance lock screen {action} manually: {reason}")
    return {
        "status": "success",
        "in_maintenance": enable,
        "reason": reason
    }

@router.get("/backups")
def list_backups():
    backups = []
    if BACKUP_DIR.exists():
        for file in sorted(BACKUP_DIR.glob("*.zip"), reverse=True):
            stat = file.stat()
            backups.append({
                "filename": file.name,
                "size_kb": round(stat.st_size / 1024, 2),
                "created_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            })
    return backups

@router.get("/logs")
def get_activity_logs(limit: int = 50):
    logs = load_json("activity_log", [])
    return logs[:limit]

@router.get("/search")
def global_search(q: str = ""):
    """Global search across Products, Customers, Bills, Stock, Staff, and Appointments."""
    query = q.lower().strip()
    if not query:
        return {"products": [], "customers": [], "bills": [], "staff": [], "stock": [], "appointments": []}

    products = [
        p for p in load_json("products", [])
        if query in str(p.get("name", "")).lower()
        or query in str(p.get("category", "")).lower()
        or query in str(p.get("barcode", "")).lower()
        or query in str(p.get("id", "")).lower()
    ][:8]

    customers = [
        c for c in load_json("customers", [])
        if query in str(c.get("name", "")).lower()
        or query in str(c.get("phone", "")).lower()
        or query in str(c.get("id", "")).lower()
    ][:8]

    bills = [
        b for b in load_json("bills", [])
        if query in str(b.get("invoice_number", "")).lower()
        or query in str((b.get("customer") or {}).get("name", "")).lower()
        or query in str((b.get("customer") or {}).get("phone", "")).lower()
        or query in str(b.get("payment_mode", "")).lower()
    ][:8]

    staff = [
        s for s in load_json("staff", [])
        if query in str(s.get("id", "")).lower()
        or query in str(s.get("user_id", "")).lower()
        or query in str(s.get("name", "")).lower()
        or query in str(s.get("role", "")).lower()
        or query in str(s.get("phone", "")).lower()
        or query in str(s.get("email", "")).lower()
    ][:6]

    stock = [
        s for s in load_json("stock", [])
        if query in str(s.get("name", "")).lower()
        or query in str(s.get("product_id", "")).lower()
        or query in str(s.get("supplier", "")).lower()
    ][:6]

    appointments = [
        a for a in load_json("appointments", [])
        if query in str(a.get("customer_name", "")).lower()
        or query in str(a.get("customer_phone", "")).lower()
        or query in str(a.get("service_name", "")).lower()
        or query in str(a.get("staff_name", "")).lower()
    ][:6]

    return {
        "products": products,
        "customers": customers,
        "bills": bills,
        "staff": staff,
        "stock": stock,
        "appointments": appointments
    }

@router.get("/dashboard-stats")
def get_dashboard_stats():
    today = datetime.now().strftime("%Y-%m-%d")
    month = datetime.now().strftime("%Y-%m")
    
    bills = load_json("bills", [])
    stock = load_json("stock", [])
    customers = load_json("customers", [])
    appointments = load_json("appointments", [])
    expenses = load_json("daily_expenses", [])

    today_bills = [b for b in bills if b.get("created_at", "").startswith(today)]
    month_bills = [b for b in bills if b.get("created_at", "").startswith(month)]

    today_sales = sum(b.get("rounded_total", 0.0) for b in today_bills)
    month_sales = sum(b.get("rounded_total", 0.0) for b in month_bills)

    today_expenses = sum(e.get("amount", 0.0) for e in expenses if e.get("date") == today)
    today_profit = today_sales - today_expenses

    low_stock_count = sum(1 for s in stock if s.get("current_stock", 0) <= s.get("min_alert_level", 5))
    today_appointments = sum(1 for a in appointments if a.get("appointment_date") == today and a.get("status") != "Cancelled")
    
    return {
        "today_sales": round(today_sales, 2),
        "month_sales": round(month_sales, 2),
        "today_expenses": round(today_expenses, 2),
        "today_profit": round(today_profit, 2),
        "today_bills_count": len(today_bills),
        "total_customers": len(customers),
        "low_stock_count": low_stock_count,
        "today_appointments_count": today_appointments,
        "system_version": APP_VERSION
    }

@router.get("/version")
def get_system_version_info():
    """Returns official TAYP EE Version System metadata."""
    return {
        "app_name": "TAYP EE",
        "full_name": APP_NAME,
        "version": APP_VERSION,
        "stage": APP_VERSION_STAGE,
        "build": APP_BUILD,
        "semver": "0.1.0",
        "channel": "Beta Channel",
        "release_date": "2026-11-20",
        "status": "up_to_date"
    }
