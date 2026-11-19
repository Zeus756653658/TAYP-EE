from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from backend.database import load_json, save_json, log_activity
from backend.cloud_db import cloud_delete_record

router = APIRouter(prefix="/api/products", tags=["Products & Services"])

class ProductSchema(BaseModel):
    id: Optional[str] = None
    name: str
    category: str
    type: Literal["service", "product"] = "service"
    price: float
    cost_price: Optional[float] = 0.0
    duration_mins: Optional[int] = 30
    barcode: Optional[str] = ""
    commission_percent: Optional[float] = 20.0
    tax_percent: Optional[float] = 18.0

@router.get("", response_model=List[dict])
def list_products():
    products = load_json("products", [])
    stock = load_json("stock", [])
    stock_map = {s["product_id"]: s for s in stock if s.get("product_id")}

    enriched = []
    seen_ids = set()

    for p in products:
        item = dict(p)
        pid = item.get("id")
        seen_ids.add(pid)
        if pid in stock_map:
            st = stock_map[pid]
            cur = st.get("current_stock", 0)
            min_lvl = st.get("min_alert_level", 5)
            item["current_stock"] = cur
            item["min_alert_level"] = min_lvl
            item["is_low_stock"] = cur <= min_lvl
        enriched.append(item)

    # Smart Auto-Include: Any stock item missing from products catalog still shows on POS
    for pid, st in stock_map.items():
        if pid not in seen_ids:
            cur = st.get("current_stock", 0)
            min_lvl = st.get("min_alert_level", 5)
            enriched.append({
                "id": pid,
                "name": st.get("name", pid),
                "category": "Retail Products",
                "type": "product",
                "price": st.get("selling_price", 0.0),
                "cost_price": st.get("cost_price", 0.0),
                "duration_mins": 0,
                "barcode": pid,
                "commission_percent": 10.0,
                "tax_percent": 18.0,
                "current_stock": cur,
                "min_alert_level": min_lvl,
                "is_low_stock": cur <= min_lvl
            })

    return enriched

@router.get("/barcode/{code}")
def get_by_barcode(code: str):
    products = list_products()
    for p in products:
        if p.get("barcode") == code or p.get("id") == code:
            return p
    raise HTTPException(status_code=404, detail="Product with this barcode not found")

@router.post("")
def add_product(item: ProductSchema):
    products = load_json("products", [])
    
    # Safe auto-generate unique ID if not provided
    if not item.id:
        existing_nums = []
        for p in products:
            pid = str(p.get("id", ""))
            if pid.startswith("PROD-") and pid[5:].isdigit():
                existing_nums.append(int(pid[5:]))
        next_num = (max(existing_nums) + 1) if existing_nums else (len(products) + 1)
        item.id = f"PROD-{next_num:03d}"
        
    # Check duplicate ID
    if any(p["id"] == item.id for p in products):
        raise HTTPException(status_code=400, detail="Product ID already exists")

    new_prod = item.model_dump()
    products.append(new_prod)
    save_json("products", products)
    
    # If it is a product, also add entry in stock.json
    if item.type == "product":
        stock = load_json("stock", [])
        if not any(s["product_id"] == item.id for s in stock):
            stock.append({
                "product_id": item.id,
                "name": item.name,
                "current_stock": 10,
                "min_alert_level": 5,
                "cost_price": item.cost_price or 0.0,
                "selling_price": item.price,
                "supplier": "Default Supplier"
            })
            save_json("stock", stock)
            
    log_activity("PRODUCT_ADD", f"Added item: {item.name} ({item.id})")
    return {"status": "success", "product": new_prod}

@router.put("/{product_id}")
def update_product(product_id: str, item: ProductSchema):
    products = load_json("products", [])
    for idx, p in enumerate(products):
        if p["id"] == product_id:
            updated = item.model_dump()
            updated["id"] = product_id
            products[idx] = updated
            save_json("products", products)

            # Sync with stock if present or if switched to product
            stock = load_json("stock", [])
            for s in stock:
                s.pop("is_low_stock", None)
            stock_found = False
            for s in stock:
                if s["product_id"] == product_id:
                    s["name"] = updated["name"]
                    s["selling_price"] = updated["price"]
                    s["cost_price"] = updated.get("cost_price") or 0.0
                    stock_found = True
                    break
            if not stock_found and updated.get("type") == "product":
                stock.append({
                    "product_id": product_id,
                    "name": updated["name"],
                    "current_stock": 10,
                    "min_alert_level": 5,
                    "cost_price": updated.get("cost_price") or 0.0,
                    "selling_price": updated["price"],
                    "supplier": "Default Supplier"
                })
                stock_found = True
            if stock_found:
                save_json("stock", stock)

            log_activity("PRODUCT_UPDATE", f"Updated product: {updated['name']} ({product_id})")
            return {"status": "success", "product": updated}
    raise HTTPException(status_code=404, detail="Product not found")

@router.delete("/{product_id}")
def delete_product(product_id: str):
    products = load_json("products", [])
    new_list = [p for p in products if p["id"] != product_id]
    if len(new_list) == len(products):
        raise HTTPException(status_code=404, detail="Product not found")
    save_json("products", new_list)
    cloud_delete_record("products", "id", product_id)

    # Also remove from stock if present
    stock = load_json("stock", [])
    new_stock = [s for s in stock if s["product_id"] != product_id]
    if len(new_stock) != len(stock):
        for s in new_stock:
            s.pop("is_low_stock", None)
        save_json("stock", new_stock)
        cloud_delete_record("stock", "product_id", product_id)

    log_activity("PRODUCT_DELETE", f"Deleted product: {product_id}")
    return {"status": "success", "deleted_id": product_id}
