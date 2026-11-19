from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime
import io
import urllib.parse
import qrcode
from backend.database import load_json, save_json, log_activity

router = APIRouter(prefix="/api/billing", tags=["Billing & Invoicing"])

class CartItemSchema(BaseModel):
    id: str
    name: str
    category: str
    type: Literal["service", "product"] = "service"
    price: float
    quantity: int = 1
    staff_id: Optional[str] = ""
    staff_name: Optional[str] = "Default"
    staff_commission: Optional[float] = 0.0
    discount_amount: Optional[float] = 0.0
    total: float

class CreateBillSchema(BaseModel):
    customer: Optional[Dict[str, Any]] = None
    items: List[CartItemSchema]
    discount_type: Literal["flat", "percent"] = "flat"
    discount_value: float = 0.0
    discount_amount: float = 0.0
    tax_enabled: bool = True
    tax_percent: float = 18.0
    tax_amount: float = 0.0
    subtotal: float
    grand_total: float
    rounded_total: float
    payment_mode: Literal["Cash", "UPI", "Card", "Wallet", "Khata", "Split"] = "Cash"
    split_details: Optional[Dict[str, float]] = None
    notes: Optional[str] = ""
    cashier: str = "Admin"

@router.get("/next-invoice")
def get_next_invoice_number():
    shop = load_json("shop_settings", {"invoice_prefix": "INV", "next_invoice_number": 1001})
    prefix = shop.get("invoice_prefix", "INV")
    next_num = shop.get("next_invoice_number", 1001)
    return {"invoice_number": f"{prefix}-{next_num}"}

@router.get("/upi-qr")
def generate_upi_qr(amount: float = Query(..., gt=0), invoice: str = "INV-0000"):
    """Generates dynamic UPI QR Code PNG for instant scan & pay."""
    upi_settings = load_json("upi_settings", {
        "upi_id": "taypee@upi",
        "merchant_name": "TAYP EE",
        "merchant_code": "5411"
    })
    vpa = upi_settings.get("upi_id", "taypee@upi")
    name = upi_settings.get("merchant_name", "TAYP EE")
    
    # UPI URI standard: upi://pay?pa=...&pn=...&am=...&tn=...&cu=INR
    params = {
        "pa": vpa,
        "pn": name,
        "am": f"{amount:.2f}",
        "tn": f"Bill {invoice}",
        "cu": "INR"
    }
    upi_string = f"upi://pay?{urllib.parse.urlencode(params)}"
    
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(upi_string)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0F172A", back_color="white")
    
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return Response(content=buf.getvalue(), media_type="image/png")

@router.post("/create-bill")
def create_bill(bill_req: CreateBillSchema):
    if not bill_req.items:
        raise HTTPException(status_code=400, detail="Cart cannot be empty")

    shop = load_json("shop_settings", {"invoice_prefix": "INV", "next_invoice_number": 1001})
    prefix = shop.get("invoice_prefix", "INV")
    next_num = shop.get("next_invoice_number", 1001)
    invoice_number = f"{prefix}-{next_num}"
    
    # Update shop next invoice counter
    shop["next_invoice_number"] = next_num + 1
    save_json("shop_settings", shop)

    now = datetime.now()
    bill_data = bill_req.model_dump()
    bill_data["invoice_number"] = invoice_number
    bill_data["created_at"] = now.isoformat()
    bill_data["created_at_display"] = now.strftime("%d %b %Y, %I:%M %p")
    bill_data["status"] = "Paid"

    # 1. Save Bill
    bills = load_json("bills", [])
    bills.insert(0, bill_data)
    save_json("bills", bills)

    # 2. Update Inventory Stock for products
    stock = load_json("stock", [])
    stock_modified = False
    for item in bill_req.items:
        if item.type == "product":
            for s in stock:
                if s["product_id"] == item.id:
                    s["current_stock"] = max(0, s.get("current_stock", 0) - item.quantity)
                    stock_modified = True
    if stock_modified:
        save_json("stock", stock)

    # 3. Update Customer CRM metrics, points & wallet/khata
    if bill_req.customer and bill_req.customer.get("phone"):
        phone = bill_req.customer.get("phone")
        customers = load_json("customers", [])
        cust_match = None
        for c in customers:
            if c.get("phone") == phone:
                cust_match = c
                break
                
        # If customer doesn't exist, create profile automatically
        if not cust_match:
            cust_match = {
                "id": f"CUST-{len(customers) + 1:03d}",
                "name": bill_req.customer.get("name", "Guest"),
                "phone": phone,
                "loyalty_points": 0,
                "wallet_balance": 0.0,
                "khata_balance": 0.0,
                "total_visits": 0,
                "total_spend": 0.0,
                "membership_tier": "Regular"
            }
            customers.append(cust_match)

        # Increment stats
        cust_match["total_visits"] = cust_match.get("total_visits", 0) + 1
        cust_match["total_spend"] = round(cust_match.get("total_spend", 0.0) + bill_req.rounded_total, 2)
        # 1 loyalty point per 100 spent
        points_earned = int(bill_req.rounded_total // 100)
        cust_match["loyalty_points"] = cust_match.get("loyalty_points", 0) + points_earned

        # If payment mode is Wallet
        if bill_req.payment_mode == "Wallet":
            cust_match["wallet_balance"] = round(max(0.0, cust_match.get("wallet_balance", 0.0) - bill_req.rounded_total), 2)
        # If payment mode is Khata (Credit)
        elif bill_req.payment_mode == "Khata":
            cust_match["khata_balance"] = round(cust_match.get("khata_balance", 0.0) + bill_req.rounded_total, 2)

        save_json("customers", customers)

    log_activity(
        "BILL_GENERATED", 
        f"Invoice {invoice_number} created for ₹{bill_req.rounded_total} ({bill_req.payment_mode}) by {bill_req.cashier}"
    )

    return {
        "status": "success",
        "invoice_number": invoice_number,
        "bill": bill_data
    }

@router.get("/bills")
def list_bills(limit: int = 50, date_filter: Optional[str] = None):
    bills = load_json("bills", [])
    if date_filter:
        bills = [b for b in bills if b.get("created_at", "").startswith(date_filter)]
    return bills[:limit]

@router.get("/bills/{invoice_number}")
def get_bill(invoice_number: str):
    bills = load_json("bills", [])
    for b in bills:
        if b.get("invoice_number") == invoice_number:
            return b
    raise HTTPException(status_code=404, detail="Invoice not found")
