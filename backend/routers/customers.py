from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional
from backend.database import load_json, save_json, log_activity
from backend.cloud_db import cloud_delete_record

router = APIRouter(prefix="/api/customers", tags=["Customers & CRM"])

class CustomerSchema(BaseModel):
    id: Optional[str] = None
    name: str
    phone: str
    email: Optional[str] = ""
    address: Optional[str] = ""
    loyalty_points: Optional[int] = 0
    wallet_balance: Optional[float] = 0.0
    khata_balance: Optional[float] = 0.0
    membership_tier: Optional[str] = "Regular"
    notes: Optional[str] = ""

class WalletTransactionSchema(BaseModel):
    amount: float
    payment_mode: str = "Cash"
    notes: Optional[str] = "Wallet top-up"

class KhataSettlementSchema(BaseModel):
    amount: float
    payment_mode: str = "Cash"
    notes: Optional[str] = "Khata payment received"

@router.get("", response_model=List[dict])
def list_customers():
    return load_json("customers", [])

@router.get("/search")
def search_customers(q: str = Query(..., min_length=1)):
    query = q.lower().strip()
    customers = load_json("customers", [])
    results = [
        c for c in customers
        if query in c.get("name", "").lower() or query in c.get("phone", "")
    ]
    return results

@router.post("")
def add_customer(cust: CustomerSchema):
    customers = load_json("customers", [])
    
    # Check phone duplicate
    for c in customers:
        if c.get("phone") == cust.phone:
            raise HTTPException(status_code=400, detail="Customer with this phone already exists")
            
    if not cust.id:
        cust.id = f"CUST-{len(customers) + 1:03d}"

    data = cust.model_dump()
    data["total_visits"] = 0
    data["total_spend"] = 0.0
    customers.append(data)
    save_json("customers", customers)
    log_activity("CUSTOMER_ADD", f"Created customer: {cust.name} ({cust.phone})")
    return {"status": "success", "customer": data}

@router.put("/{cust_id}")
def update_customer(cust_id: str, cust: CustomerSchema):
    customers = load_json("customers", [])
    for idx, c in enumerate(customers):
        if c["id"] == cust_id:
            updated = cust.model_dump()
            updated["id"] = cust_id
            updated["total_visits"] = c.get("total_visits", 0)
            updated["total_spend"] = c.get("total_spend", 0.0)
            customers[idx] = updated
            save_json("customers", customers)
            log_activity("CUSTOMER_UPDATE", f"Updated customer {cust.name} ({cust_id})")
            return {"status": "success", "customer": updated}
    raise HTTPException(status_code=404, detail="Customer not found")

@router.delete("/{cust_id}")
def delete_customer(cust_id: str):
    customers = load_json("customers", [])
    new_list = [c for c in customers if c["id"] != cust_id]
    if len(new_list) == len(customers):
        raise HTTPException(status_code=404, detail="Customer not found")
    save_json("customers", new_list)
    cloud_delete_record("customers", "id", cust_id)
    log_activity("CUSTOMER_DELETE", f"Deleted customer {cust_id}")
    return {"status": "success", "deleted_id": cust_id}

@router.post("/{cust_id}/recharge-wallet")
def recharge_wallet(cust_id: str, tx: WalletTransactionSchema):
    customers = load_json("customers", [])
    for idx, c in enumerate(customers):
        if c["id"] == cust_id:
            current_bal = c.get("wallet_balance", 0.0)
            new_bal = current_bal + tx.amount
            c["wallet_balance"] = round(new_bal, 2)
            save_json("customers", customers)
            log_activity("WALLET_RECHARGE", f"Customer {c['name']} recharged wallet with ₹{tx.amount}. New balance: ₹{c['wallet_balance']}")
            return {"status": "success", "new_balance": c["wallet_balance"]}
    raise HTTPException(status_code=404, detail="Customer not found")

@router.post("/{cust_id}/settle-khata")
def settle_khata(cust_id: str, tx: KhataSettlementSchema):
    customers = load_json("customers", [])
    for idx, c in enumerate(customers):
        if c["id"] == cust_id:
            current_khata = c.get("khata_balance", 0.0)
            new_khata = max(0.0, current_khata - tx.amount)
            c["khata_balance"] = round(new_khata, 2)
            save_json("customers", customers)
            log_activity("KHATA_SETTLEMENT", f"Customer {c['name']} settled ₹{tx.amount} khata. Pending: ₹{c['khata_balance']}")
            return {"status": "success", "pending_khata": c["khata_balance"]}
    raise HTTPException(status_code=404, detail="Customer not found")
