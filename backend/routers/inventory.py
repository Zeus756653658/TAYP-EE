from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from backend.database import load_json, save_json, log_activity
from backend.cloud_db import cloud_delete_record

router = APIRouter(prefix="/api/inventory", tags=["Inventory & Suppliers"])

class StockUpdateSchema(BaseModel):
    product_id: str
    quantity_change: int
    reason: Optional[str] = "Manual adjustment"

class StockEditSchema(BaseModel):
    name: str
    current_stock: int
    min_alert_level: int = 5
    cost_price: float = 0.0
    selling_price: float
    supplier: Optional[str] = ""

class SupplierSchema(BaseModel):
    id: Optional[str] = None
    name: str
    contact_person: Optional[str] = ""
    phone: str
    email: Optional[str] = ""
    address: Optional[str] = ""
    pending_dues: Optional[float] = 0.0

class SupplierPaymentSchema(BaseModel):
    supplier_id: str
    amount: float
    payment_mode: str = "Cash"
    notes: Optional[str] = ""

@router.get("/stock")
def get_stock():
    stock = load_json("stock", [])
    for item in stock:
        current = item.get("current_stock", 0)
        min_lvl = item.get("min_alert_level", 5)
        item["is_low_stock"] = current <= min_lvl
    return stock

@router.post("/stock/adjust")
def adjust_stock(adj: StockUpdateSchema):
    stock = load_json("stock", [])
    for s in stock:
        s.pop("is_low_stock", None)
    for s in stock:
        if s["product_id"] == adj.product_id:
            old_qty = s.get("current_stock", 0)
            new_qty = max(0, old_qty + adj.quantity_change)
            s["current_stock"] = new_qty
            save_json("stock", stock)
            log_activity("STOCK_ADJUSTMENT", f"Adjusted {s['name']}: {old_qty} -> {new_qty} ({adj.reason})")
            return {"status": "success", "new_stock": new_qty}
    raise HTTPException(status_code=404, detail="Product not found in stock inventory")

@router.put("/stock/{product_id}")
def edit_stock_item(product_id: str, item: StockEditSchema):
    stock = load_json("stock", [])
    for s in stock:
        s.pop("is_low_stock", None)
    found = False
    updated_stock = None
    for idx, s in enumerate(stock):
        if s["product_id"] == product_id:
            updated_stock = {
                "product_id": product_id,
                "name": item.name,
                "current_stock": max(0, item.current_stock),
                "min_alert_level": max(0, item.min_alert_level),
                "cost_price": item.cost_price,
                "selling_price": item.selling_price,
                "supplier": item.supplier or ""
            }
            stock[idx] = updated_stock
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Stock item not found")
    save_json("stock", stock)

    # Sync name/price/cost with products catalog if present
    products = load_json("products", [])
    prod_changed = False
    for p in products:
        if p["id"] == product_id:
            p["name"] = item.name
            p["price"] = item.selling_price
            p["cost_price"] = item.cost_price
            prod_changed = True
            break
    if prod_changed:
        save_json("products", products)

    log_activity("STOCK_EDIT", f"Edited stock item {item.name} ({product_id}): qty={item.current_stock}, price=₹{item.selling_price}")
    return {"status": "success", "stock": updated_stock}

@router.delete("/stock/{product_id}")
def delete_stock_item(product_id: str):
    stock = load_json("stock", [])
    for s in stock:
        s.pop("is_low_stock", None)
    new_stock = [s for s in stock if s["product_id"] != product_id]
    if len(new_stock) == len(stock):
        raise HTTPException(status_code=404, detail="Stock item not found")
    save_json("stock", new_stock)
    cloud_delete_record("stock", "product_id", product_id)
    log_activity("STOCK_DELETE", f"Deleted stock item {product_id}")
    return {"status": "success", "deleted_id": product_id}

@router.get("/suppliers")
def get_suppliers():
    return load_json("supplier_dealers", [])

@router.post("/suppliers")
def add_supplier(sup: SupplierSchema):
    suppliers = load_json("supplier_dealers", [])
    if not sup.id:
        sup.id = f"SUPP-{len(suppliers) + 1:02d}"
    data = sup.model_dump()
    suppliers.append(data)
    save_json("supplier_dealers", suppliers)
    log_activity("SUPPLIER_ADD", f"Added supplier {sup.name}")
    return {"status": "success", "supplier": data}

@router.post("/suppliers/payment")
def record_supplier_payment(pay: SupplierPaymentSchema):
    suppliers = load_json("supplier_dealers", [])
    supplier = None
    for s in suppliers:
        if s["id"] == pay.supplier_id:
            supplier = s
            break
            
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
        
    old_dues = supplier.get("pending_dues", 0.0)
    new_dues = max(0.0, old_dues - pay.amount)
    supplier["pending_dues"] = round(new_dues, 2)
    save_json("supplier_dealers", suppliers)

    # Save payment record
    payments = load_json("supplier_payments", [])
    payment_record = {
        "id": f"SPAY-{len(payments) + 1:02d}",
        "supplier_id": pay.supplier_id,
        "supplier_name": supplier["name"],
        "amount": pay.amount,
        "payment_mode": pay.payment_mode,
        "notes": pay.notes
    }
    payments.insert(0, payment_record)
    save_json("supplier_payments", payments)

    log_activity("SUPPLIER_PAYMENT", f"Paid ₹{pay.amount} to {supplier['name']}. Pending dues: ₹{new_dues}")
    return {"status": "success", "payment": payment_record, "pending_dues": new_dues}
