from fastapi import APIRouter
from typing import Dict, Any
from backend.database import load_json, save_json, log_activity

router = APIRouter(prefix="/api/settings", tags=["Settings & Configurations"])

@router.get("")
def get_all_settings():
    return {
        "shop": load_json("shop_settings", {}),
        "tax": load_json("tax_settings", {}),
        "upi": load_json("upi_settings", {}),
        "print": load_json("print_settings", {})
    }

@router.post("/shop")
def update_shop_settings(data: Dict[str, Any]):
    save_json("shop_settings", data)
    log_activity("SETTINGS_UPDATE", "Updated Shop Profile & Branding settings.")
    return {"status": "success", "settings": data}

@router.post("/tax")
def update_tax_settings(data: Dict[str, Any]):
    save_json("tax_settings", data)
    log_activity("SETTINGS_UPDATE", "Updated GST & Tax rates settings.")
    return {"status": "success", "settings": data}

@router.post("/upi")
def update_upi_settings(data: Dict[str, Any]):
    save_json("upi_settings", data)
    log_activity("SETTINGS_UPDATE", "Updated UPI Payment Gateway VPA.")
    return {"status": "success", "settings": data}

@router.post("/print")
def update_print_settings(data: Dict[str, Any]):
    save_json("print_settings", data)
    log_activity("SETTINGS_UPDATE", "Updated Thermal Printer formatting options.")
    return {"status": "success", "settings": data}
