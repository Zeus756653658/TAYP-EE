from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional, Literal, Dict, Any
from backend.database import load_json, save_json, log_activity
from backend.cloud_db import cloud_delete_record, cloud_update_record

router = APIRouter(prefix="/api/appointments", tags=["Appointments & Bookings"])

class AppointmentSchema(BaseModel):
    id: Optional[str] = None
    customer_name: str
    customer_phone: str
    service_name: str
    staff_name: str
    appointment_date: str
    appointment_time: str
    status: Literal["Confirmed", "Pending", "Completed", "Cancelled"] = "Confirmed"
    notes: Optional[str] = ""

class PublicBookingSchema(BaseModel):
    customer_name: str
    customer_phone: str
    service_name: str
    staff_name: Optional[str] = "Any Available Stylist"
    appointment_date: str
    appointment_time: str
    notes: Optional[str] = ""

@router.get("/booking-catalog")
def get_booking_catalog():
    """Public catalog endpoint for standalone appointment booking portal."""
    products = load_json("products", [])
    staff = load_json("staff", [])
    shop = load_json("shop_settings", {})

    services = [
        {
            "id": p.get("id"),
            "name": p.get("name"),
            "category": p.get("category", "General"),
            "price": p.get("price", 0.0),
            "duration_mins": p.get("duration_mins", 30)
        }
        for p in products
        if p.get("type", "service") == "service"
    ]

    active_staff = [
        {
            "id": s.get("id"),
            "name": s.get("name"),
            "role": s.get("role")
        }
        for s in staff
        if s.get("active", True) is not False
    ]

    return {
        "status": "success",
        "shop_name": shop.get("shop_name", "TAYP EE"),
        "currency_symbol": shop.get("currency_symbol", "₹"),
        "services": services,
        "staff": active_staff
    }

@router.post("/book")
def public_book_appointment(booking: PublicBookingSchema):
    """Public standalone booking endpoint for clients/visitors."""
    name = booking.customer_name.strip()
    phone = booking.customer_phone.strip()
    service = booking.service_name.strip()
    date_str = booking.appointment_date.strip()
    time_str = booking.appointment_time.strip()

    if not name or not phone or not service or not date_str or not time_str:
        raise HTTPException(status_code=400, detail="Please fill all required booking details (Name, Phone, Service, Date, Time).")

    appointments = load_json("appointments", [])
    apt_id = f"APT-{len(appointments) + 1001}"

    data = {
        "id": apt_id,
        "customer_name": name,
        "customer_phone": phone,
        "service_name": service,
        "staff_name": booking.staff_name or "Any Available Stylist",
        "appointment_date": date_str,
        "appointment_time": time_str,
        "status": "Confirmed",
        "notes": (booking.notes or "").strip()
    }

    appointments.insert(0, data)
    save_json("appointments", appointments)
    log_activity("APPOINTMENT_PUBLIC_BOOK", f"Public booking: {name} ({phone}) for {service} on {date_str} at {time_str}")

    return {
        "status": "success",
        "appointment": data,
        "message": f"Appointment successfully confirmed for {name}! Reference: {apt_id}"
    }

@router.get("")
def list_appointments():
    return load_json("appointments", [])

@router.post("")
def create_appointment(apt: AppointmentSchema):
    appointments = load_json("appointments", [])
    if not apt.id:
        apt.id = f"APT-{len(appointments) + 1001}"
    data = apt.model_dump()
    appointments.insert(0, data)
    save_json("appointments", appointments)
    log_activity("APPOINTMENT_CREATE", f"Booked appointment for {apt.customer_name} on {apt.appointment_date} at {apt.appointment_time}")
    return {"status": "success", "appointment": data}

@router.put("/{apt_id}")
def update_appointment(apt_id: str, apt: AppointmentSchema):
    appointments = load_json("appointments", [])
    for idx, a in enumerate(appointments):
        if a["id"] == apt_id:
            updated = apt.model_dump()
            updated["id"] = apt_id
            appointments[idx] = updated
            save_json("appointments", appointments)
            cloud_update_record("appointments", "id", apt_id, updated)
            log_activity("APPOINTMENT_UPDATE", f"Updated appointment {apt_id} for {updated['customer_name']}")
            return {"status": "success", "appointment": updated}
    raise HTTPException(status_code=404, detail="Appointment not found")

@router.put("/{apt_id}/status")
def update_appointment_status(apt_id: str, status: Literal["Confirmed", "Pending", "Completed", "Cancelled"]):
    appointments = load_json("appointments", [])
    for a in appointments:
        if a["id"] == apt_id:
            a["status"] = status
            save_json("appointments", appointments)
            cloud_update_record("appointments", "id", apt_id, {"status": status})
            log_activity("APPOINTMENT_STATUS", f"Appointment {apt_id} status changed to {status}")
            return {"status": "success", "appointment": a}
    raise HTTPException(status_code=404, detail="Appointment not found")

@router.delete("/{apt_id}")
def delete_appointment(apt_id: str):
    appointments = load_json("appointments", [])
    new_list = [a for a in appointments if a["id"] != apt_id]
    if len(new_list) == len(appointments):
        raise HTTPException(status_code=404, detail="Appointment not found")
    save_json("appointments", new_list)
    cloud_delete_record("appointments", "id", apt_id)
    log_activity("APPOINTMENT_DELETE", f"Deleted appointment {apt_id}")
    return {"status": "success", "deleted_id": apt_id}
