import os
import json
import zipfile
import io
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional
import requests
from backend.config import DATA_DIR, BACKUP_DIR, update_env_file

# Runtime status cache (secrets are always loaded from .env / os.environ, never stored in code/JSON)
_cloud_status_cache: Dict[str, Any] = {
    "checked_url": None,
    "checked_key": None,
    "is_connected": False,
    "tables_created": False,
    "last_synced": None,
    "error": None,
    "message": ""
}

def get_cloud_config(force_check: bool = False) -> Dict[str, Any]:
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_KEY", "").strip()

    if not url or not key:
        return {
            "supabase_url": url,
            "supabase_key": "",
            "is_connected": False,
            "tables_created": False,
            "last_synced": None,
            "error": None,
            "message": "Configure SUPABASE_URL and SUPABASE_KEY in .env"
        }

    # Test once per credential pair (or when forced)
    if force_check or _cloud_status_cache["checked_url"] != url or _cloud_status_cache["checked_key"] != key:
        status = test_cloud_connection(url, key)
        _cloud_status_cache.update({
            "checked_url": url,
            "checked_key": key,
            "is_connected": status.get("connected", False),
            "tables_created": status.get("tables_created", False),
            "last_synced": datetime.now().isoformat() if status.get("connected") else None,
            "error": status.get("error", None),
            "message": status.get("message", "")
        })

    return {
        "supabase_url": url,
        "supabase_key": key,
        "is_connected": _cloud_status_cache["is_connected"],
        "tables_created": _cloud_status_cache["tables_created"],
        "last_synced": _cloud_status_cache["last_synced"],
        "error": _cloud_status_cache["error"],
        "message": _cloud_status_cache["message"]
    }

def save_cloud_config(url: str, key: str) -> Dict[str, Any]:
    url = url.strip().rstrip("/")
    key = key.strip()
    update_env_file({
        "SUPABASE_URL": url,
        "SUPABASE_KEY": key
    })
    return get_cloud_config(force_check=True)

def test_cloud_connection(url: str, key: str) -> Dict[str, Any]:
    if not url or not key:
        return {"connected": False, "tables_created": False, "error": "Supabase URL and API Key are required."}
    try:
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}"
        }
        res = requests.get(f"{url}/rest/v1/", headers=headers, timeout=6)
        if res.status_code not in (200, 204):
            return {
                "connected": False, 
                "tables_created": False, 
                "error": f"Cloud returned status {res.status_code}: {res.text[:120]}"
            }

        # Check if tables exist
        t_res = requests.get(f"{url}/rest/v1/products?select=id&limit=1", headers=headers, timeout=6)
        if t_res.status_code == 200:
            return {
                "connected": True,
                "tables_created": True,
                "message": "Supabase connected and database tables verified!"
            }
        else:
            return {
                "connected": True,
                "tables_created": False,
                "message": "Supabase connected successfully! However, SQL tables have not been created yet. Please execute backend/schema.sql in Supabase SQL Editor."
            }
    except Exception as e:
        return {"connected": False, "tables_created": False, "error": str(e)}

# Cloud REST Helper
def _cloud_headers(key: str) -> Dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

def cloud_fetch_setting(key: str) -> Optional[Any]:
    conf = get_cloud_config()
    if not conf.get("is_connected") or not conf.get("supabase_url"):
        return None
    try:
        url = f"{conf['supabase_url']}/rest/v1/settings?key=eq.{key}&select=data"
        res = requests.get(url, headers=_cloud_headers(conf['supabase_key']), timeout=6)
        if res.status_code == 200:
            rows = res.json()
            if isinstance(rows, list) and len(rows) > 0:
                return rows[0].get("data")
    except Exception as e:
        print(f"[Cloud Setting Error] Failed to fetch setting {key}: {e}")
    return None

def cloud_save_setting(key: str, data: Any) -> bool:
    conf = get_cloud_config()
    if not conf.get("is_connected") or not conf.get("supabase_url"):
        return False
    try:
        url = f"{conf['supabase_url']}/rest/v1/settings"
        headers = _cloud_headers(conf['supabase_key'])
        headers["Prefer"] = "resolution=merge-duplicates"
        res = requests.post(url, headers=headers, json={"key": key, "data": data}, timeout=6)
        return res.status_code in (200, 201)
    except Exception as e:
        print(f"[Cloud Setting Error] Failed to save setting {key}: {e}")
    return False

def cloud_fetch_table(table: str) -> Optional[List[Dict[str, Any]]]:
    conf = get_cloud_config()
    if not conf.get("is_connected") or not conf.get("supabase_url") or not conf.get("tables_created"):
        return None
    try:
        url = f"{conf['supabase_url']}/rest/v1/{table}?select=*"
        res = requests.get(url, headers=_cloud_headers(conf['supabase_key']), timeout=6)
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        print(f"[Cloud Error] Failed to fetch {table}: {e}")
    return None

def cloud_insert_record(table: str, data: Dict[str, Any]) -> bool:
    conf = get_cloud_config()
    if not conf.get("is_connected") or not conf.get("supabase_url") or not conf.get("tables_created"):
        return False
    try:
        url = f"{conf['supabase_url']}/rest/v1/{table}"
        res = requests.post(url, headers=_cloud_headers(conf['supabase_key']), json=data, timeout=6)
        return res.status_code in (200, 201)
    except Exception as e:
        print(f"[Cloud Error] Failed to insert into {table}: {e}")
        return False

def cloud_update_record(table: str, id_col: str, id_val: Any, data: Dict[str, Any]) -> bool:
    conf = get_cloud_config()
    if not conf.get("is_connected") or not conf.get("supabase_url") or not conf.get("tables_created"):
        return False
    try:
        url = f"{conf['supabase_url']}/rest/v1/{table}?{id_col}=eq.{id_val}"
        res = requests.patch(url, headers=_cloud_headers(conf['supabase_key']), json=data, timeout=6)
        return res.status_code in (200, 204)
    except Exception as e:
        print(f"[Cloud Error] Failed to update {table}: {e}")
        return False

def cloud_delete_record(table: str, id_col: str, id_val: Any) -> bool:
    conf = get_cloud_config()
    if not conf.get("is_connected") or not conf.get("supabase_url") or not conf.get("tables_created"):
        return False
    try:
        url = f"{conf['supabase_url']}/rest/v1/{table}?{id_col}=eq.{id_val}"
        res = requests.delete(url, headers=_cloud_headers(conf['supabase_key']), timeout=6)
        return res.status_code in (200, 204)
    except Exception as e:
        print(f"[Cloud Error] Failed to delete from {table}: {e}")
        return False

def push_all_local_to_cloud() -> Dict[str, Any]:
    """Uploads all local business JSON data to Supabase Cloud tables."""
    conf = get_cloud_config()
    if not conf.get("is_connected") or not conf.get("supabase_url"):
        return {"status": "error", "message": "Supabase is not connected"}
    
    url = conf["supabase_url"]
    headers = _cloud_headers(conf["supabase_key"])
    headers["Prefer"] = "resolution=merge-duplicates"

    tables_map = {
        "products": "products",
        "customers": "customers",
        "stock": "stock",
        "staff": "staff",
        "daily_expenses": "daily_expenses",
        "appointments": "appointments",
        "bills": "bills"
    }

    synced_counts = {}
    for local_file, cloud_table in tables_map.items():
        p = DATA_DIR / f"{local_file}.json"
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    records = json.load(f)
                if isinstance(records, list) and len(records) > 0:
                    payload = records
                    if cloud_table == "products":
                        payload = [
                            {
                                "id": p["id"],
                                "name": p["name"],
                                "category": p.get("category", "General"),
                                "type": p.get("type", "service"),
                                "price": float(p.get("price", 0.0)),
                                "cost_price": float(p.get("cost_price", 0.0)),
                                "duration_mins": int(p.get("duration_mins", 30)),
                                "barcode": str(p.get("barcode", "") or ""),
                                "commission_percent": float(p.get("commission_percent", 20.0)),
                                "tax_percent": float(p.get("tax_percent", 18.0))
                            }
                            for p in records if isinstance(p, dict) and "id" in p
                        ]
                    elif cloud_table == "staff":
                        payload = [
                            {
                                "id": s["id"],
                                "name": s["name"],
                                "role": s["role"],
                                "phone": s.get("phone", ""),
                                "base_commission": s.get("base_commission", 20.0),
                                "active": s.get("active", True)
                            }
                            for s in records if isinstance(s, dict) and "id" in s
                        ]
                    res = requests.post(f"{url}/rest/v1/{cloud_table}", headers=headers, json=payload, timeout=10)
                    synced_counts[cloud_table] = len(records) if res.status_code in (200, 201) else f"Error {res.status_code}"
            except Exception as e:
                synced_counts[cloud_table] = str(e)

    return {"status": "success", "synced": synced_counts}

# LOCAL DATA EXPORT: Creates a ZIP download from Server / Cloud tables
def export_cloud_backup_zip() -> Path:
    """Exports all current Cloud & Server business records into a local ZIP archive."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_filename = f"cloud_data_backup_{timestamp}.zip"
    zip_path = BACKUP_DIR / zip_filename

    tables = [
        "bills", "products", "customers", "stock", "staff", 
        "daily_expenses", "appointments", "card_membership",
        "supplier_dealers", "supplier_payments", "shop_settings",
        "tax_settings", "upi_settings", "print_settings", "activity_log"
    ]

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for t in tables:
            data = None
            cloud_data = cloud_fetch_table(t)
            if cloud_data is not None:
                data = cloud_data
            else:
                local_file = DATA_DIR / f"{t}.json"
                if local_file.exists():
                    try:
                        with open(local_file, "r", encoding="utf-8") as f:
                            data = json.load(f)
                    except Exception:
                        data = []
                else:
                    data = []
            
            json_bytes = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
            zipf.writestr(f"{t}.json", json_bytes)

        manifest = {
            "system": "TAYP EE Web POS",
            "export_type": "Cloud Server Snapshot",
            "timestamp": datetime.now().isoformat(),
            "exported_tables": tables
        }
        zipf.writestr("manifest.json", json.dumps(manifest, indent=2))

    return zip_path
