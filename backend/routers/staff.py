from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel
from typing import List, Optional, Literal
from datetime import datetime
from backend.database import load_json, save_json, log_activity
from backend.cloud_db import cloud_delete_record
from backend.routers.auth import get_request_user, ensure_default_users, hash_password

router = APIRouter(prefix="/api/staff", tags=["Staff, Gmail & Commissions"])


class StaffSchema(BaseModel):
    id: Optional[str] = None
    user_id: Optional[str] = None
    name: str
    role: str
    phone: Optional[str] = ""
    email: Optional[str] = ""  # Staff Gmail address
    base_commission: Optional[float] = 20.0
    active: Optional[bool] = True
    enable_login: Optional[bool] = False
    login_password: Optional[str] = None
    login_role: Optional[str] = "cashier"


class StaffResetPasswordSchema(BaseModel):
    new_password: str


def ensure_default_staff() -> List[dict]:
    """Ensures staff.json is populated initially while strictly respecting deleted staff."""
    staff_list = load_json("staff", [])
    if staff_list:
        return staff_list

    deleted_registry = set(load_json("deleted_staff", []))
    users = ensure_default_users()
    existing_emails = {str(s.get("email", "")).strip().lower(): s for s in staff_list if s.get("email")}
    existing_ids = {s.get("id") for s in staff_list}

    default_roles = {
        "admin@gmail.com": ("Store Admin", "Store Manager", 20.0),
        "imran.ali@gmail.com": ("Imran Ali", "Senior Stylist", 25.0),
        "vikram.barber@gmail.com": ("Vikram Singh", "Master Barber", 20.0),
        "pooja.spa@gmail.com": ("Pooja Malhotra", "Spa & Skin Specialist", 30.0),
        "counter.taypee@gmail.com": ("Counter / Salon General", "Front Desk Cashier", 0.0),
    }

    updated = False
    for u in users:
        u_email = str(u.get("username", "")).strip().lower()
        if not u_email or u_email in deleted_registry:
            continue

        if u_email in existing_emails:
            continue

        u_id = u.get("id", "")
        if u_id.startswith("USER-"):
            cand_id = f"STAFF-{u_id.split('-')[1]}"
        else:
            cand_id = f"STAFF-{len(staff_list) + 1:03d}"

        if cand_id in deleted_registry or cand_id in existing_ids:
            cand_id = f"STAFF-{len(staff_list) + 1:03d}"

        if cand_id in deleted_registry:
            continue

        if u_email in default_roles:
            name, role_title, comm = default_roles[u_email]
        else:
            name = u.get("name", "Staff Member")
            role_title = "Owner / Admin" if u.get("role") == "admin" else ("Floor Manager" if u.get("role") == "manager" else "Cashier / Stylist")
            comm = 20.0

        new_entry = {
            "id": cand_id,
            "user_id": u.get("id"),
            "name": name,
            "role": role_title,
            "phone": "",
            "email": u_email,
            "base_commission": comm,
            "active": u.get("active", True),
            "enable_login": True,
            "login_role": u.get("role", "cashier")
        }
        staff_list.append(new_entry)
        existing_emails[u_email] = new_entry
        existing_ids.add(cand_id)
        updated = True

    if updated:
        save_json("staff", staff_list)

    return staff_list


def _sync_staff_login_user(s: StaffSchema):
    email = (s.email or "").strip().lower()
    if not email or not s.enable_login:
        return

    users = ensure_default_users()
    matched = None
    for u in users:
        if u.get("username", "").strip().lower() == email:
            matched = u
            break

    if matched:
        matched["name"] = s.name.strip()
        if s.login_role in ("admin", "manager", "cashier"):
            matched["role"] = s.login_role
        if s.login_password and len(s.login_password.strip()) >= 6:
            matched["password"] = hash_password(s.login_password.strip())
    else:
        initial_pass = s.login_password.strip() if (s.login_password and len(s.login_password.strip()) >= 6) else "staff123"
        new_u = {
            "id": f"USER-{len(users) + 1:03d}",
            "username": email,
            "name": s.name.strip(),
            "password": hash_password(initial_pass),
            "role": s.login_role if s.login_role in ("admin", "manager", "cashier") else "cashier",
            "active": True,
            "created_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        }
        users.append(new_u)

    save_json("users", users)


@router.get("")
def list_staff():
    return ensure_default_staff()


@router.post("")
def add_staff(s: StaffSchema):
    staff_list = load_json("staff", [])
    if not s.id:
        s.id = f"STAFF-{len(staff_list) + 1:03d}"
    data = s.model_dump()
    data.pop("login_password", None)
    staff_list.append(data)
    save_json("staff", staff_list)

    if s.enable_login and s.email:
        _sync_staff_login_user(s)

    log_activity("STAFF_ADD", f"Added staff member: {s.name} ({s.role}, Gmail: {s.email or 'None'})")
    return {"status": "success", "staff": data}


@router.put("/{staff_id}")
def update_staff(staff_id: str, s: StaffSchema):
    staff_list = load_json("staff", [])
    for idx, member in enumerate(staff_list):
        if member["id"] == staff_id:
            updated = s.model_dump()
            updated["id"] = staff_id
            updated.pop("login_password", None)
            staff_list[idx] = updated
            save_json("staff", staff_list)

            if s.enable_login and s.email:
                _sync_staff_login_user(s)

            log_activity("STAFF_UPDATE", f"Updated staff: {s.name} (Gmail: {s.email or 'None'})")
            return {"status": "success", "staff": updated}
    raise HTTPException(status_code=404, detail="Staff member not found")


@router.delete("/{staff_id}")
def delete_staff(staff_id: str, request: Request):
    staff_list = load_json("staff", [])
    member = next((m for m in staff_list if m["id"] == staff_id), None)
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found")

    email = str(member.get("email", "")).strip().lower()
    current = None
    try:
        current = get_request_user(request)
    except Exception:
        pass
    if current and current.get("username", "").strip().lower() == email:
        raise HTTPException(status_code=400, detail="Cannot delete your own active staff account while signed in.")

    # 1. Remove from staff.json
    new_list = [m for m in staff_list if m["id"] != staff_id]
    save_json("staff", new_list)

    # 2. Register in deleted_staff so auto-sync never brings them back
    deleted_registry = load_json("deleted_staff", [])
    if staff_id not in deleted_registry:
        deleted_registry.append(staff_id)
    if email and email not in deleted_registry:
        deleted_registry.append(email)
    save_json("deleted_staff", deleted_registry)

    # 3. Also remove login user from users.json (if not primary admin USER-001)
    if email:
        users = load_json("users", [])
        new_users = [u for u in users if str(u.get("username", "")).strip().lower() != email or u.get("id") == "USER-001"]
        save_json("users", new_users)

    cloud_delete_record("staff", "id", staff_id)
    log_activity("STAFF_DELETE", f"Deleted staff member: {member.get('name')} ({staff_id})")
    return {"status": "success", "deleted_id": staff_id}


@router.post("/{staff_id}/reset-password")
def reset_staff_password(staff_id: str, payload: StaffResetPasswordSchema, request: Request):
    current = get_request_user(request)
    if not current or current.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only Administrator can reset staff passwords.")

    staff_list = load_json("staff", [])
    member = next((m for m in staff_list if m["id"] == staff_id), None)
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found.")

    email = (member.get("email") or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Staff member does not have a valid Gmail address. Please update staff profile first.")

    new_pass = payload.new_password.strip()
    if len(new_pass) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters long.")

    users = ensure_default_users()
    matched = next((u for u in users if u.get("username", "").strip().lower() == email), None)
    if matched:
        matched["password"] = hash_password(new_pass)
    else:
        # Create user account for this staff
        matched = {
            "id": f"USER-{len(users) + 1:03d}",
            "username": email,
            "name": member.get("name", "Staff"),
            "password": hash_password(new_pass),
            "role": "cashier",
            "active": True,
            "created_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        }
        users.append(matched)

    save_json("users", users)
    log_activity("STAFF_PASSWORD_RESET", f"Admin reset password for staff member {member.get('name')} ({email})", user=current.get("username"))
    return {
        "status": "success",
        "message": f"Password reset successfully for {member.get('name')} ({email})!"
    }


@router.get("/performance")
def get_staff_performance(period: Literal["today", "month", "all"] = Query("all")):
    staff_list = ensure_default_staff()
    bills = load_json("bills", [])
    users = load_json("users", [])

    user_map = {str(u.get("username", "")).strip().lower(): u for u in users}

    # Filter bills strictly by requested period
    if period == "today":
        today_prefix = datetime.now().strftime("%Y-%m-%d")
        bills = [b for b in bills if str(b.get("created_at", "")).startswith(today_prefix)]
    elif period == "month":
        month_prefix = datetime.now().strftime("%Y-%m")
        bills = [b for b in bills if str(b.get("created_at", "")).startswith(month_prefix)]

    performance = {}
    name_to_id = {}
    for st in staff_list:
        sid = st["id"]
        email = st.get("email", "")
        has_login = bool(email and email.strip().lower() in user_map)
        login_role = user_map.get(email.strip().lower(), {}).get("role", "") if email else ""

        performance[sid] = {
            "id": sid,
            "user_id": st.get("user_id", ""),
            "name": st["name"],
            "role": st["role"],
            "phone": st.get("phone", ""),
            "email": email,
            "base_commission": st.get("base_commission", 20.0),
            "active": st.get("active", True),
            "has_login": has_login,
            "login_role": login_role,
            "total_services": 0,
            "total_revenue": 0.0,
            "total_commission": 0.0
        }
        name_to_id[str(st.get("name", "")).strip().lower()] = sid

    for bill in bills:
        for item in bill.get("items", []):
            st_id = item.get("staff_id")
            if st_id not in performance:
                st_name = str(item.get("staff_name", "")).strip().lower()
                st_id = name_to_id.get(st_name)
            if st_id in performance:
                qty = item.get("quantity", 1)
                tot = float(item.get("total", 0.0) or 0.0)
                comm = float(item.get("staff_commission", 0.0) or 0.0)
                performance[st_id]["total_services"] += qty
                performance[st_id]["total_revenue"] = round(performance[st_id]["total_revenue"] + tot, 2)
                performance[st_id]["total_commission"] = round(performance[st_id]["total_commission"] + (comm * qty), 2)

    return list(performance.values())
