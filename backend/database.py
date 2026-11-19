import json
import shutil
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
import requests
from backend.config import DATA_DIR, BACKUP_DIR
from backend.cloud_db import (
    cloud_fetch_table, 
    export_cloud_backup_zip,
    get_cloud_config
)

_lock = threading.Lock()

def get_file_path(filename: str) -> Path:
    if not filename.endswith(".json"):
        filename = f"{filename}.json"
    return DATA_DIR / filename

def load_json(filename: str, default: Any = None) -> Any:
    path = get_file_path(filename)
    local_data = None
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                local_data = json.load(f)
        except Exception as e:
            print(f"[DB Error] Failed to read {filename}: {e}")

    # 1. If Cloud is active, attempt to read from Cloud
    table_name = filename.replace(".json", "")
    cloud_data = cloud_fetch_table(table_name)
    if cloud_data is not None:
        # Guard: Do not wipe non-empty local catalog/data if cloud table is brand-new & empty
        if isinstance(cloud_data, list) and len(cloud_data) == 0 and isinstance(local_data, list) and len(local_data) > 0:
            return local_data

        # Merge local metadata attributes (like staff email) not in cloud schema
        if table_name == "staff" and isinstance(local_data, list):
            local_by_id = {s.get("id"): s for s in local_data if isinstance(s, dict) and "id" in s}
            for s in cloud_data:
                if isinstance(s, dict) and s.get("id") in local_by_id:
                    loc = local_by_id[s["id"]]
                    for k in ("email", "user_id", "enable_login", "login_role"):
                        if k in loc and (k not in s or not s.get(k)):
                            s[k] = loc[k]

        save_json(filename, cloud_data, skip_cloud=True)
        return cloud_data

    # 2. Local buffer fallback
    if local_data is not None:
        return local_data
    if default is not None:
        save_json(filename, default, skip_cloud=True)
        return default
    return []

def save_json(filename: str, data: Any, skip_cloud: bool = False) -> bool:
    with _lock:
        path = get_file_path(filename)
        temp_path = path.with_suffix(".tmp")
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            temp_path.replace(path)

            # Sync to Supabase Cloud if connected
            if not skip_cloud:
                table_name = filename.replace(".json", "")
                conf = get_cloud_config()
                if conf.get("is_connected") and conf.get("tables_created"):
                    url = conf["supabase_url"]
                    headers = {
                        "apikey": conf["supabase_key"],
                        "Authorization": f"Bearer {conf['supabase_key']}",
                        "Content-Type": "application/json",
                        "Prefer": "resolution=merge-duplicates"
                    }
                    try:
                        requests.post(f"{url}/rest/v1/{table_name}", headers=headers, json=data, timeout=5)
                    except Exception as e:
                        print(f"[Cloud Sync Error] {table_name}: {e}")

            return True
        except Exception as e:
            print(f"[DB Error] Failed to write {filename}: {e}")
            if temp_path.exists():
                temp_path.unlink()
            return False

def log_activity(action: str, details: str, user: str = "Admin") -> None:
    logs = load_json("activity_log", [])
    entry = {
        "timestamp": datetime.now().isoformat(),
        "user": user,
        "action": action,
        "details": details
    }
    logs.insert(0, entry)
    save_json("activity_log", logs[:500])

def create_full_backup(tag: str = "scheduled_5pm") -> str:
    """Exports full cloud/server data into a local ZIP backup."""
    zip_path = export_cloud_backup_zip()
    log_activity("SYSTEM_BACKUP", f"Created cloud data backup archive: {zip_path.name}")
    return str(zip_path)
