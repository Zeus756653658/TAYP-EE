from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from backend.database import load_json, save_json, log_activity
from backend.cloud_db import cloud_delete_record

router = APIRouter(prefix="/api/expenses", tags=["Expenses & EOD Day Closing"])

class ExpenseSchema(BaseModel):
    id: Optional[str] = None
    date: Optional[str] = None
    category: str
    amount: float
    payment_mode: str = "Cash"
    description: str
    recorded_by: Optional[str] = "Admin"

@router.get("")
def list_expenses(date_filter: Optional[str] = None):
    expenses = load_json("daily_expenses", [])
    if date_filter:
        expenses = [e for e in expenses if e.get("date") == date_filter]
    return expenses

@router.post("")
def add_expense(exp: ExpenseSchema):
    expenses = load_json("daily_expenses", [])
    if not exp.id:
        exp.id = f"EXP-{len(expenses) + 101:03d}"
    if not exp.date:
        exp.date = datetime.now().strftime("%Y-%m-%d")

    data = exp.model_dump()
    expenses.insert(0, data)
    save_json("daily_expenses", expenses)
    log_activity("EXPENSE_RECORDED", f"Recorded expense ₹{exp.amount} for '{exp.description}' ({exp.category})")
    return {"status": "success", "expense": data}

@router.put("/{expense_id}")
def update_expense(expense_id: str, exp: ExpenseSchema):
    expenses = load_json("daily_expenses", [])
    for idx, e in enumerate(expenses):
        if e["id"] == expense_id:
            updated = exp.model_dump()
            updated["id"] = expense_id
            if not updated.get("date"):
                updated["date"] = e.get("date") or datetime.now().strftime("%Y-%m-%d")
            expenses[idx] = updated
            save_json("daily_expenses", expenses)
            log_activity("EXPENSE_UPDATED", f"Updated expense {expense_id}: ₹{updated['amount']} ({updated['category']})")
            return {"status": "success", "expense": updated}
    raise HTTPException(status_code=404, detail="Expense not found")

@router.delete("/{expense_id}")
def delete_expense(expense_id: str):
    expenses = load_json("daily_expenses", [])
    new_list = [e for e in expenses if e["id"] != expense_id]
    if len(new_list) == len(expenses):
        raise HTTPException(status_code=404, detail="Expense not found")
    save_json("daily_expenses", new_list)
    cloud_delete_record("daily_expenses", "id", expense_id)
    log_activity("EXPENSE_DELETED", f"Deleted expense {expense_id}")
    return {"status": "success", "deleted_id": expense_id}

@router.get("/eod-closing")
def get_eod_closing(target_date: Optional[str] = None):
    """Calculates End-of-Day settlement: Total Bills, Cash in Drawer, UPI, Card, Expenses, Net Cash."""
    if not target_date:
        target_date = datetime.now().strftime("%Y-%m-%d")

    bills = load_json("bills", [])
    expenses = load_json("daily_expenses", [])

    today_bills = [b for b in bills if b.get("created_at", "").startswith(target_date)]
    today_expenses = [e for e in expenses if e.get("date") == target_date]

    total_bills_count = len(today_bills)
    total_sales_revenue = sum(b.get("rounded_total", 0.0) for b in today_bills)

    cash_collected = 0.0
    upi_collected = 0.0
    card_collected = 0.0
    wallet_collected = 0.0
    khata_collected = 0.0

    for b in today_bills:
        mode = b.get("payment_mode", "Cash")
        amt = b.get("rounded_total", 0.0)
        if mode == "Cash":
            cash_collected += amt
        elif mode == "UPI":
            upi_collected += amt
        elif mode == "Card":
            card_collected += amt
        elif mode == "Wallet":
            wallet_collected += amt
        elif mode == "Khata":
            khata_collected += amt
        elif mode == "Split":
            split = b.get("split_details", {})
            cash_collected += split.get("Cash", 0.0)
            upi_collected += split.get("UPI", 0.0)
            card_collected += split.get("Card", 0.0)

    total_expenses_amount = sum(e.get("amount", 0.0) for e in today_expenses)
    cash_expenses = sum(e.get("amount", 0.0) for e in today_expenses if e.get("payment_mode") == "Cash")
    
    net_cash_in_drawer = cash_collected - cash_expenses
    net_profit = total_sales_revenue - total_expenses_amount

    return {
        "date": target_date,
        "total_bills": total_bills_count,
        "total_revenue": round(total_sales_revenue, 2),
        "total_expenses": round(total_expenses_amount, 2),
        "net_profit": round(net_profit, 2),
        "breakdown": {
            "cash_collected": round(cash_collected, 2),
            "cash_expenses": round(cash_expenses, 2),
            "net_cash_in_drawer": round(net_cash_in_drawer, 2),
            "upi_collected": round(upi_collected, 2),
            "card_collected": round(card_collected, 2),
            "wallet_collected": round(wallet_collected, 2),
            "khata_collected": round(khata_collected, 2)
        }
    }
