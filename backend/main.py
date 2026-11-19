import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from backend.config import FRONTEND_DIR, REPASS_DIR, REGISTER_DIR, APPOINTMENT_DIR, APP_NAME, APP_VERSION
from backend.maintenance import maintenance_background_scheduler
from backend.routers import (
    auth,
    billing,
    products,
    customers,
    inventory,
    staff,
    expenses,
    appointments,
    settings,
    system
)
from backend.routers.auth import get_request_user, get_auth_config

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start 3:00 PM (15:00) Maintenance background task
    task = asyncio.create_task(maintenance_background_scheduler())
    yield
    task.cancel()

app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Next-Generation Web Point of Sale, CRM, Inventory & Auto-Maintenance Suite",
    lifespan=lifespan
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Public routes allowed before Gmail 3-Step authentication & Password Reset & Registration
PUBLIC_API_PATHS = {
    "/api/auth/status",
    "/api/auth/check-username",
    "/api/auth/login-step1",
    "/api/auth/login-step2",
    "/api/auth/resend-code",
    "/api/auth/logout",
    "/api/auth/captcha",
    "/api/auth/forgot-password/request-otp",
    "/api/auth/forgot-password/verify-otp",
    "/api/auth/forgot-password/confirm",
    "/api/auth/register/request-otp",
    "/api/auth/register/verify-otp",
    "/api/auth/register/confirm",
    "/api/system/maintenance",
    "/api/system/verify-bypass-pin",
    "/api/system/cloud-status",
    "/api/system/version",
    "/api/appointments/booking-catalog",
    "/api/appointments/book"
}

@app.middleware("http")
async def auth_guard_middleware(request: Request, call_next):
    path = request.url.path
    is_public = path in PUBLIC_API_PATHS or (path == "/api/settings" and request.method == "GET")
    if path.startswith("/api/") and not is_public and request.method != "OPTIONS":
        conf = get_auth_config()
        if conf.get("auth_enabled", True):
            user = get_request_user(request)
            if not user:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Authentication required. Please sign in with Gmail verification code."}
                )
    return await call_next(request)

# Register API Routers
app.include_router(auth.router)
app.include_router(billing.router)
app.include_router(products.router)
app.include_router(customers.router)
app.include_router(inventory.router)
app.include_router(staff.router)
app.include_router(expenses.router)
app.include_router(appointments.router)
app.include_router(settings.router)
app.include_router(system.router)

# Serve Frontend static assets
app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")
if (FRONTEND_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

# Serve Dedicated Repass Standalone Password Reset Portal
app.mount("/repass", StaticFiles(directory=str(REPASS_DIR), html=True), name="repass")

@app.get("/repass")
def serve_repass():
    return FileResponse(REPASS_DIR / "index.html")

# Serve Dedicated Register Standalone Registration Portal
app.mount("/register", StaticFiles(directory=str(REGISTER_DIR), html=True), name="register")

@app.get("/register")
def serve_register():
    return FileResponse(REGISTER_DIR / "index.html")

# Serve Dedicated Appointment Booking Standalone Portal
app.mount("/appointment", StaticFiles(directory=str(APPOINTMENT_DIR), html=True), name="appointment")

@app.get("/appointment")
def serve_appointment():
    return FileResponse(APPOINTMENT_DIR / "index.html")

@app.get("/booking")
def serve_booking():
    return FileResponse(APPOINTMENT_DIR / "index.html")

# Serve Favicons & App Icons
@app.get("/favicon.ico")
def serve_favicon_ico():
    return FileResponse(FRONTEND_DIR / "favicon.ico", media_type="image/x-icon")

@app.get("/favicon.svg")
def serve_favicon_svg():
    return FileResponse(FRONTEND_DIR / "favicon.svg", media_type="image/svg+xml")

@app.get("/favicon.png")
def serve_favicon_png():
    return FileResponse(FRONTEND_DIR / "favicon.png", media_type="image/png")

@app.get("/favicon-32x32.png")
def serve_favicon_32():
    return FileResponse(FRONTEND_DIR / "favicon-32x32.png", media_type="image/png")

@app.get("/favicon-16x16.png")
def serve_favicon_16():
    return FileResponse(FRONTEND_DIR / "favicon-16x16.png", media_type="image/png")

@app.get("/apple-touch-icon.png")
def serve_apple_touch_icon():
    return FileResponse(FRONTEND_DIR / "apple-touch-icon.png", media_type="image/png")

@app.get("/")
def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")

if __name__ == "__main__":
    import uvicorn
    from backend.config import HOST, PORT
    uvicorn.run("backend.main:app", host=HOST, port=PORT, reload=True)
