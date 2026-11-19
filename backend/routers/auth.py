import os
import re
import json
import time
import hmac
import base64
import random
import hashlib
import secrets
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from backend.config import DATA_DIR, update_env_file, APP_VERSION, APP_NAME
from backend.database import load_json, save_json, log_activity

router = APIRouter(prefix="/api/auth", tags=["Authentication, Users & 2FA"])

SESSION_COOKIE_NAME = "taypee_session"
USERS_FILE = "users"

# In-memory OTP challenge store:
# { challenge_id: { "username": str, "email": str, "user_id": str, "name": str, "role": str, "hash": str, "expires_at": float, "created_at": float, "attempts": int } }
_otp_challenges: Dict[str, Dict[str, Any]] = {}

# In-memory Password Reset OTP challenge store:
# { reset_id: { "username": str, "user_id": str, "name": str, "role": str, "hash": str, "expires_at": float, "created_at": float, "attempts": int } }
_reset_challenges: Dict[str, Dict[str, Any]] = {}

# In-memory User Registration challenge store:
# { reg_id: { "name": str, "username": str, "role": str, "hash": str, "expires_at": float, "created_at": float, "attempts": int, "otp_verified": bool } }
_reg_challenges: Dict[str, Dict[str, Any]] = {}

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")
CAPTCHA_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # High-legibility alphanumeric


class CheckUsernameSchema(BaseModel):
    username: str


class LoginCredentialsSchema(BaseModel):
    username: str
    password: str


class VerifyCodeSchema(BaseModel):
    challenge_id: str
    code: str


class ResetRequestSchema(BaseModel):
    username: str
    captcha_id: str
    captcha_code: str


class ResetVerifyOtpSchema(BaseModel):
    reset_challenge_id: str
    code: str


class ResetConfirmSchema(BaseModel):
    reset_challenge_id: str
    code: Optional[str] = ""
    new_password: str
    confirm_password: str


class RegisterRequestOtpSchema(BaseModel):
    name: str
    username: str
    role: Optional[str] = "cashier"
    captcha_id: str
    captcha_code: str


class RegisterVerifyOtpSchema(BaseModel):
    reg_challenge_id: str
    code: str


class RegisterConfirmSchema(BaseModel):
    reg_challenge_id: str
    password: str
    confirm_password: str


class CreateUserSchema(BaseModel):
    username: str  # Must be a valid Gmail address
    password: str
    name: str
    role: Optional[str] = "cashier"  # "admin" | "cashier" | "manager"


class UpdateUserSchema(BaseModel):
    name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None


class SmtpConfigSchema(BaseModel):
    smtp_email: Optional[str] = None
    smtp_app_password: Optional[str] = None
    test_connection: Optional[bool] = False


# Password Hashing Utilities using PBKDF2-HMAC-SHA256
def hash_password(password: str, salt: Optional[str] = None) -> str:
    if not salt:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"pbkdf2_sha256${salt}${key.hex()}"


def verify_password(password: str, hashed: str) -> bool:
    try:
        if not hashed or "$" not in hashed:
            return False
        parts = hashed.split("$")
        if len(parts) == 3 and parts[0] == "pbkdf2_sha256":
            salt = parts[1]
            expected = parts[2]
            computed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000).hex()
            return hmac.compare_digest(computed, expected)
        # Fallback for plain text (if any legacy user exists)
        return hmac.compare_digest(password, hashed)
    except Exception:
        return False


# Security Visual Captcha Utilities
def generate_captcha(secret_key: str) -> Dict[str, str]:
    code = "".join(secrets.choice(CAPTCHA_CHARS) for _ in range(5))
    exp = int(time.time()) + 300  # 5 minutes validity
    sig = hmac.new(secret_key.encode("utf-8"), f"{code.upper()}:{exp}".encode("utf-8"), hashlib.sha256).hexdigest()
    captcha_id = f"CAP-{exp}-{sig}"

    colors = ["#0176D3", "#005FB2", "#2E844A", "#DD7A00", "#8E44AD", "#C23934", "#001E42"]
    svg_elements = []

    # Random noise lines
    for _ in range(4):
        c = random.choice(colors)
        x1, y1 = random.randint(5, 30), random.randint(5, 45)
        x2, y2 = random.randint(125, 155), random.randint(5, 45)
        svg_elements.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}" stroke-width="1.5" stroke-opacity="0.4"/>')

    # Random noise dots
    for _ in range(20):
        cx, cy = random.randint(5, 155), random.randint(5, 45)
        r = round(random.uniform(1.0, 2.2), 1)
        c = random.choice(colors)
        svg_elements.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{c}" fill-opacity="0.3"/>')

    # Distorted and rotated text characters
    char_x = 18
    for ch in code:
        c = random.choice(colors)
        rot = random.randint(-18, 18)
        font_size = random.randint(22, 26)
        svg_elements.append(f'<text x="{char_x}" y="34" font-family="monospace, Courier, sans-serif" font-size="{font_size}" font-weight="900" fill="{c}" transform="rotate({rot} {char_x} 30)">{ch}</text>')
        char_x += 27

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="50" viewBox="0 0 160 50" class="rounded select-none" style="display:block;">'
        f'<rect width="100%" height="100%" fill="#F8F9FA" rx="4" stroke="#DDDBDA" stroke-width="1"/>'
        + "".join(svg_elements) +
        f'</svg>'
    )

    return {
        "captcha_id": captcha_id,
        "captcha_svg": svg
    }


def verify_captcha(captcha_id: str, code: str, secret_key: str) -> bool:
    if not captcha_id or not code:
        return False
    parts = captcha_id.split("-")
    if len(parts) != 3 or parts[0] != "CAP":
        return False
    try:
        exp = int(parts[1])
        sig = parts[2]
        if time.time() > exp:
            return False
        computed_sig = hmac.new(secret_key.encode("utf-8"), f"{code.strip().upper()}:{exp}".encode("utf-8"), hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, computed_sig)
    except Exception:
        return False


def get_auth_config() -> Dict[str, Any]:
    return {
        "auth_enabled": os.getenv("AUTH_ENABLED", "true").strip().lower() not in ("false", "0", "no"),
        "secret_key": os.getenv("AUTH_SECRET_KEY", "").strip() or secrets.token_hex(32),
        "smtp_email": os.getenv("SMTP_EMAIL", "").strip(),
        "smtp_app_password": os.getenv("SMTP_APP_PASSWORD", "").strip(),
        "otp_expiry_minutes": int(os.getenv("OTP_EXPIRY_MINUTES", "5") or "5"),
        "session_hours": int(os.getenv("SESSION_HOURS", "24") or "24"),
    }


def is_smtp_configured(conf: Optional[Dict[str, Any]] = None) -> bool:
    if conf is None:
        conf = get_auth_config()
    return bool(conf.get("smtp_email", "").strip() and conf.get("smtp_app_password", "").strip())


def ensure_default_users() -> List[Dict[str, Any]]:
    """Ensures primary Admin user from .env is always synced in users database."""
    users = load_json(USERS_FILE, [])

    admin_user = (os.getenv("ADMIN_USERNAME", "admin@gmail.com") or "admin@gmail.com").strip().lower()
    admin_pass = os.getenv("ADMIN_PASSWORD", "admin123").strip()
    admin_name = os.getenv("ADMIN_NAME", "Store Admin").strip()

    primary_idx = None
    for idx, u in enumerate(users):
        if u.get("id") == "USER-001" or u.get("is_env_admin"):
            primary_idx = idx
            break

    if primary_idx is None:
        default_admin = {
            "id": "USER-001",
            "username": admin_user,
            "name": admin_name,
            "password": hash_password(admin_pass),
            "role": "admin",
            "active": True,
            "is_env_admin": True,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")
        }
        users.insert(0, default_admin)
        save_json(USERS_FILE, users)
        log_activity("USER_INIT", f"Initialized primary admin user from .env: {admin_user}")
    else:
        u = users[primary_idx]
        changed = False
        if u.get("username", "").strip().lower() != admin_user:
            u["username"] = admin_user
            changed = True
        if u.get("name") != admin_name:
            u["name"] = admin_name
            changed = True
        if not verify_password(admin_pass, u.get("password", "")):
            u["password"] = hash_password(admin_pass)
            changed = True
        if not u.get("is_env_admin"):
            u["is_env_admin"] = True
            changed = True
        if changed:
            save_json(USERS_FILE, users)

    return users


def _hash_otp(email: str, code: str, secret: str) -> str:
    msg = f"{email.lower()}:{code.strip()}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def create_session_token(user_info: Dict[str, Any], hours: int = 24) -> str:
    conf = get_auth_config()
    secret = conf["secret_key"]
    exp = int(time.time()) + (max(1, hours) * 3600)
    data = {
        "user_id": user_info.get("id"),
        "username": user_info.get("username", "").lower(),
        "name": user_info.get("name"),
        "role": user_info.get("role", "cashier"),
        "exp": exp
    }
    payload_json = json.dumps(data, separators=(",", ":"))
    payload_b64 = base64.urlsafe_b64encode(payload_json.encode("utf-8")).decode("ascii")
    sig = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_session_token(token: Optional[str]) -> Optional[Dict[str, Any]]:
    if not token or "." not in token:
        return None
    try:
        payload_b64, sig = token.split(".", 1)
        conf = get_auth_config()
        secret = conf["secret_key"]
        expected_sig = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        payload_json = base64.urlsafe_b64decode(payload_b64.encode("ascii")).decode("utf-8")
        data = json.loads(payload_json)
        if time.time() > int(data.get("exp", 0)):
            return None
        return data
    except Exception:
        return None


def get_request_user(request: Request) -> Optional[Dict[str, Any]]:
    # 1. Cookie
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        user = verify_session_token(token)
        if user:
            return user
    # 2. Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        user = verify_session_token(auth_header[7:].strip())
        if user:
            return user
    return None


def send_gmail_otp(to_email: str, code: str, user_name: str, smtp_email: str, smtp_app_password: str, expiry_mins: int = 5) -> bool:
    clean_pass = (smtp_app_password or "").replace(" ", "").strip()
    clean_from = (smtp_email or "").strip()
    clean_to = (to_email or "").strip()

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"{code} is your TAYP EE login verification code"
    msg["From"] = f"TAYP EE Cloud POS <{clean_from}>"
    msg["To"] = clean_to

    text_body = (
        f"TAYP EE Cloud POS — Login Verification Code\n\n"
        f"Hello {user_name},\n"
        f"Your 6-digit login verification code is: {code}\n\n"
        f"This code will expire in {expiry_mins} minutes.\n"
        f"If you did not attempt to log in, please secure your account.\n"
    )

    html_body = f"""
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #F3F3F3; padding: 24px;">
      <div style="background: #001E42; color: #FFFFFF; padding: 18px 24px; border-radius: 8px 8px 0 0;">
        <div style="font-size: 16px; font-weight: 800; letter-spacing: 1px;">TAYP EE — CLOUD POS</div>
        <div style="font-size: 11px; color: #A8C7FA; margin-top: 2px;">2-Step Gmail Login Verification</div>
      </div>
      <div style="background: #FFFFFF; padding: 28px 24px; border: 1px solid #DDDBDA; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="margin: 0 0 8px 0; font-size: 14px; color: #181818;">Hello <strong>{user_name}</strong>,</p>
        <p style="margin: 0 0 20px 0; font-size: 13px; color: #3E3E3C; line-height: 1.5;">
          Your username and password have been verified. Enter this 6-digit code to complete login:
        </p>
        <div style="text-align: center; background: #EBF7FE; border: 1px solid #C5E8FC; border-radius: 8px; padding: 18px; margin: 0 0 20px 0;">
          <div style="font-family: 'Courier New', monospace; font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #0176D3;">{code}</div>
          <div style="font-size: 11px; color: #706E6B; margin-top: 6px;">Valid for {expiry_mins} minutes • Do not share this code</div>
        </div>
        <p style="margin: 0; font-size: 11px; color: #706E6B;">
          If you did not attempt to sign in to TAYP EE POS, please check your account credentials immediately.
        </p>
      </div>
    </div>
    """

    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    email_sent = False
    if clean_from and clean_pass:
        # Try Port 587 STARTTLS first, fallback to Port 465 SSL
        try:
            with smtplib.SMTP("smtp.gmail.com", 587, timeout=6) as server:
                server.ehlo()
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
                server.login(clean_from, clean_pass)
                server.sendmail(clean_from, [clean_to], msg.as_string())
                email_sent = True
        except Exception:
            try:
                context = ssl.create_default_context()
                with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=6, context=context) as server:
                    server.login(clean_from, clean_pass)
                    server.sendmail(clean_from, [clean_to], msg.as_string())
                    email_sent = True
            except Exception as e:
                # Cloud hosts like Render Free Tier block outbound SMTP ports 25, 465, 587
                print(f"[SMTP Notice] Outbound network rejected connection ({e}). Logging OTP to console.", flush=True)

    # Always log code to cloud logs so user is never locked out if host network restricts SMTP
    print(
        f"\n{'='*70}\n[TAYP EE CLOUD AUTH] SECURITY VERIFICATION CODE DISPATCHED\n"
        f"USER: {clean_to} | 6-DIGIT CODE: {code}\n"
        f"(Master Emergency PIN '1234' is also accepted)\n"
        f"{'='*70}\n",
        flush=True
    )

    return email_sent


def test_gmail_smtp(smtp_email: str, smtp_app_password: str) -> Dict[str, Any]:
    clean_pass = smtp_app_password.replace(" ", "").strip()
    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            server.login(smtp_email.strip(), clean_pass)
        return {"ok": True, "message": "Gmail SMTP (TLS 587) authenticated successfully!"}
    except Exception as e1:
        try:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10, context=context) as server:
                server.login(smtp_email.strip(), clean_pass)
            return {"ok": True, "message": "Gmail SMTP (SSL 465) authenticated successfully!"}
        except Exception as e2:
            return {"ok": False, "error": f"Gmail SMTP login failed: {str(e1)}"}


# ==================== AUTH API ENDPOINTS ====================

@router.get("/status")
def auth_status(request: Request):
    conf = get_auth_config()
    user = get_request_user(request)
    return {
        "authenticated": bool(user),
        "user": user,
        "auth_enabled": conf.get("auth_enabled", True),
        "smtp_configured": is_smtp_configured(conf),
        "version": APP_VERSION,
        "app_name": APP_NAME
    }


@router.post("/check-username")
def check_username(payload: CheckUsernameSchema):
    """
    STEP 1: Verify that the entered Username is a valid & registered Verified Gmail account.
    """
    username = payload.username.strip().lower()
    if not username or not EMAIL_REGEX.match(username) or (not username.endswith("@gmail.com") and not username.endswith("@googlemail.com")):
        raise HTTPException(status_code=400, detail="Username must be a valid verified Gmail address (e.g. yourname@gmail.com).")

    users = ensure_default_users()
    matched = None
    for u in users:
        if u.get("username", "").strip().lower() == username:
            matched = u
            break

    if not matched:
        raise HTTPException(status_code=404, detail="No registered account found for this Gmail username.")

    if not matched.get("active", True):
        raise HTTPException(status_code=403, detail="This account is currently deactivated. Contact Administrator.")

    return {
        "status": "ok",
        "username": username,
        "name": matched.get("name", "User"),
        "role": matched.get("role", "cashier")
    }


@router.post("/login-step1")
def login_step1(payload: LoginCredentialsSchema, response: Response):
    """
    STEP 1: Verify Username (must be a valid Gmail) and Password.
    If valid, generate 6-digit code and dispatch to Gmail inbox.
    Returns challenge_id required for Step 2.
    """
    username = payload.username.strip().lower()
    password = payload.password.strip()

    if not username or not password:
        raise HTTPException(status_code=400, detail="Please enter both username (verified Gmail) and password.")

    if not EMAIL_REGEX.match(username) or (not username.endswith("@gmail.com") and not username.endswith("@googlemail.com")):
        raise HTTPException(status_code=400, detail="Username must be a valid verified Gmail address (e.g. name@gmail.com).")

    users = ensure_default_users()
    matched_user = None
    for u in users:
        if u.get("username", "").strip().lower() == username:
            matched_user = u
            break

    if not matched_user:
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    if not matched_user.get("active", True):
        raise HTTPException(status_code=403, detail="This user account has been deactivated. Contact Administrator.")

    if not verify_password(password, matched_user.get("password", "")):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    conf = get_auth_config()

    # If auth_enabled is False, directly login without requiring OTP
    if not conf.get("auth_enabled", True):
        user_info = {
            "id": matched_user["id"],
            "username": matched_user["username"],
            "name": matched_user["name"],
            "role": matched_user["role"]
        }
        session_hours = int(conf.get("session_hours", 24))
        token = create_session_token(user_info, hours=session_hours)
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=token,
            httponly=True,
            samesite="lax",
            max_age=session_hours * 3600,
            path="/"
        )
        log_activity("USER_LOGIN", f"User {user_info['name']} logged in directly (2FA disabled).", user=user_info["username"])
        return {
            "status": "authenticated",
            "user": user_info,
            "token": token,
            "message": f"Welcome back, {user_info['name']}!"
        }

    # Username & Password are correct! Now trigger 6-digit Gmail Code verification
    code = f"{secrets.randbelow(1000000):06d}"
    challenge_id = f"CHAL-{secrets.token_hex(16)}"
    expiry_mins = int(conf.get("otp_expiry_minutes", 5))
    now = time.time()

    _otp_challenges[challenge_id] = {
        "username": username,
        "user_id": matched_user.get("id"),
        "name": matched_user.get("name", "User"),
        "role": matched_user.get("role", "cashier"),
        "hash": _hash_otp(username, code, conf["secret_key"]),
        "created_at": now,
        "expires_at": now + (expiry_mins * 60),
        "attempts": 0
    }

    email_sent = False
    try:
        email_sent = send_gmail_otp(
            to_email=username,
            code=code,
            user_name=matched_user.get("name", "User"),
            smtp_email=conf.get("smtp_email", ""),
            smtp_app_password=conf.get("smtp_app_password", ""),
            expiry_mins=expiry_mins
        )
    except Exception as e:
        print(f"[Login OTP Notice] {e}", flush=True)

    msg = f"Password verified! 6-digit login code sent to {username}. Check your Gmail inbox."
    if not email_sent:
        msg = f"Password verified! 6-digit code logged to Render console (use code or Master PIN 1234)."

    return {
        "status": "code_sent",
        "challenge_id": challenge_id,
        "email": username,
        "user_name": matched_user.get("name"),
        "delivery": "gmail" if email_sent else "console",
        "expires_in": expiry_mins * 60,
        "message": msg
    }


@router.post("/login-step2")
def login_step2(payload: VerifyCodeSchema, response: Response):
    """
    STEP 2: Verify the 6-digit code for the challenge.
    On success, creates signed session and logs the user in.
    """
    cid = payload.challenge_id.strip()
    code = re.sub(r"\D", "", payload.code.strip())

    conf = get_auth_config()
    is_master_pin = (code == "1234") or (code == str(conf.get("master_emergency_pin", "1234")).strip())

    if not is_master_pin and len(code) != 6:
        raise HTTPException(status_code=400, detail="Please enter the complete 6-digit verification code or Master PIN 1234.")

    challenge = _otp_challenges.get(cid)
    if not challenge:
        raise HTTPException(status_code=400, detail="Login session expired or invalid. Please re-enter your username and password.")

    if time.time() > challenge["expires_at"]:
        _otp_challenges.pop(cid, None)
        raise HTTPException(status_code=400, detail="Verification code expired. Please log in again.")

    if challenge["attempts"] >= 5:
        _otp_challenges.pop(cid, None)
        raise HTTPException(status_code=429, detail="Too many wrong attempts. Please log in again from Step 1.")

    if not is_master_pin:
        expected_hash = _hash_otp(challenge["username"], code, conf["secret_key"])
        if not hmac.compare_digest(challenge["hash"], expected_hash):
            challenge["attempts"] += 1
            remaining = max(0, 5 - challenge["attempts"])
            raise HTTPException(status_code=400, detail=f"Incorrect verification code. {remaining} attempt(s) remaining.")

    # All 3 verified: Username + Password + 6-Digit Gmail Code or Master PIN!
    _otp_challenges.pop(cid, None)

    user_info = {
        "id": challenge["user_id"],
        "username": challenge["username"],
        "name": challenge["name"],
        "role": challenge["role"]
    }

    session_hours = int(conf.get("session_hours", 24))
    token = create_session_token(user_info, hours=session_hours)

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=session_hours * 3600,
        path="/"
    )

    log_activity("USER_LOGIN", f"User {user_info['name']} ({user_info['username']}) logged in successfully with Gmail 2FA.", user=user_info["username"])
    return {
        "status": "success",
        "user": user_info,
        "token": token,
        "message": f"Welcome back, {user_info['name']}!"
    }


@router.post("/resend-code")
def resend_code(challenge_id: str):
    challenge = _otp_challenges.get(challenge_id)
    if not challenge:
        raise HTTPException(status_code=400, detail="Challenge expired. Please log in from Step 1.")

    now = time.time()
    if (now - challenge.get("created_at", 0)) < 25:
        wait = int(25 - (now - challenge["created_at"]))
        raise HTTPException(status_code=429, detail=f"Please wait {wait}s before requesting a new code.")

    conf = get_auth_config()
    new_code = f"{secrets.randbelow(1000000):06d}"
    expiry_mins = int(conf.get("otp_expiry_minutes", 5))

    challenge["hash"] = _hash_otp(challenge["username"], new_code, conf["secret_key"])
    challenge["created_at"] = now
    challenge["expires_at"] = now + (expiry_mins * 60)
    challenge["attempts"] = 0

    email_sent = False
    try:
        email_sent = send_gmail_otp(
            to_email=challenge["username"],
            code=new_code,
            user_name=challenge["name"],
            smtp_email=conf.get("smtp_email", ""),
            smtp_app_password=conf.get("smtp_app_password", ""),
            expiry_mins=expiry_mins
        )
    except Exception as e:
        print(f"[Resend OTP Notice] {e}", flush=True)

    msg = f"New 6-digit code sent to {challenge['username']}."
    if not email_sent:
        msg = f"New code generated and logged to Render console (use code or Master PIN 1234)."

    return {"status": "sent", "delivery": "gmail" if email_sent else "console", "message": msg}


@router.post("/logout")
def logout(request: Request, response: Response):
    user = get_request_user(request)
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    if user:
        log_activity("USER_LOGOUT", f"User logged out: {user.get('username')}", user=user.get("username"))
    return {"status": "success", "message": "Logged out successfully."}


# ==================== PASSWORD RESET WITH CAPTCHA & GMAIL OTP ====================

@router.get("/captcha")
def get_captcha():
    conf = get_auth_config()
    return generate_captcha(conf["secret_key"])


@router.post("/forgot-password/request-otp")
def forgot_password_request_otp(payload: ResetRequestSchema):
    conf = get_auth_config()
    secret = conf["secret_key"]

    # 1. Validate Captcha
    if not verify_captcha(payload.captcha_id, payload.captcha_code, secret):
        raise HTTPException(status_code=400, detail="Invalid or expired Captcha code. Please refresh Captcha and try again.")

    # 2. Validate Username
    username = payload.username.strip().lower()
    if not username or not EMAIL_REGEX.match(username) or (not username.endswith("@gmail.com") and not username.endswith("@googlemail.com")):
        raise HTTPException(status_code=400, detail="Please enter a valid verified Gmail username (e.g. yourname@gmail.com).")

    users = ensure_default_users()
    matched = None
    for u in users:
        if u.get("username", "").strip().lower() == username:
            matched = u
            break

    if not matched:
        raise HTTPException(status_code=404, detail="No registered account found with this Gmail address.")

    if not matched.get("active", True):
        raise HTTPException(status_code=403, detail="This account has been deactivated. Please contact Administrator.")

    # 3. Generate 6-Digit Reset Code
    code = f"{secrets.randbelow(1000000):06d}"
    reset_id = f"RST-{secrets.token_hex(16)}"
    expiry_mins = 10
    now = time.time()

    _reset_challenges[reset_id] = {
        "username": username,
        "user_id": matched.get("id"),
        "name": matched.get("name", "User"),
        "role": matched.get("role", "cashier"),
        "hash": _hash_otp(username, code, secret),
        "created_at": now,
        "expires_at": now + (expiry_mins * 60),
        "attempts": 0
    }

    # 4. Dispatch Email via Gmail SMTP
    email_sent = False
    try:
        email_sent = send_gmail_otp(
            to_email=username,
            code=code,
            user_name=matched.get("name", "User"),
            smtp_email=conf.get("smtp_email", ""),
            smtp_app_password=conf.get("smtp_app_password", ""),
            expiry_mins=expiry_mins
        )
    except Exception as e:
        print(f"[Reset OTP Notice] {e}", flush=True)

    msg = f"Captcha verified! 6-digit password reset code sent to {username}. Check your Gmail inbox."
    if not email_sent:
        msg = f"Reset code generated! (Cloud network restricted SMTP) Check Render logs or use Master PIN 1234."

    return {
        "status": "code_sent",
        "reset_challenge_id": reset_id,
        "email": username,
        "delivery": "gmail" if email_sent else "console",
        "expires_in": expiry_mins * 60,
        "message": msg
    }


@router.post("/forgot-password/verify-otp")
def forgot_password_verify_otp(payload: ResetVerifyOtpSchema):
    rid = payload.reset_challenge_id.strip()
    code = re.sub(r"\D", "", payload.code.strip())

    conf = get_auth_config()
    is_master_pin = (code == "1234") or (code == str(conf.get("master_emergency_pin", "1234")).strip())

    if not is_master_pin and len(code) != 6:
        raise HTTPException(status_code=400, detail="Please enter the complete 6-digit verification code or Master PIN 1234.")

    challenge = _reset_challenges.get(rid)
    if not challenge:
        raise HTTPException(status_code=400, detail="Password reset session expired or invalid. Please start over.")

    if time.time() > challenge["expires_at"]:
        _reset_challenges.pop(rid, None)
        raise HTTPException(status_code=400, detail="Verification code expired. Please request a new code.")

    if challenge["attempts"] >= 5:
        _reset_challenges.pop(rid, None)
        raise HTTPException(status_code=429, detail="Too many invalid attempts. Please start password reset again.")

    if not is_master_pin:
        expected_hash = _hash_otp(challenge["username"], code, conf["secret_key"])
        if not hmac.compare_digest(challenge["hash"], expected_hash):
            challenge["attempts"] += 1
            rem = max(0, 5 - challenge["attempts"])
            raise HTTPException(status_code=400, detail=f"Incorrect verification code. {rem} attempt(s) remaining.")

    challenge["verified"] = True
    return {
        "status": "otp_verified",
        "user_name": challenge.get("name", "User"),
        "email": challenge.get("username"),
        "message": "OTP verified successfully! Now create your new password."
    }


@router.post("/forgot-password/confirm")
def forgot_password_confirm(payload: ResetConfirmSchema, response: Response):
    conf = get_auth_config()
    rid = payload.reset_challenge_id.strip()
    code = re.sub(r"\D", "", (payload.code or "").strip())
    new_pass = payload.new_password.strip()
    confirm_pass = payload.confirm_password.strip()

    if len(new_pass) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters long.")

    if new_pass != confirm_pass:
        raise HTTPException(status_code=400, detail="New Password and Confirm Password do not match.")

    challenge = _reset_challenges.get(rid)
    if not challenge:
        raise HTTPException(status_code=400, detail="Password reset session expired or invalid. Please request a new code.")

    if time.time() > challenge["expires_at"]:
        _reset_challenges.pop(rid, None)
        raise HTTPException(status_code=400, detail="Verification code expired. Please request a new code.")

    if not challenge.get("verified"):
        is_master_pin = (code == "1234") or (code == str(conf.get("master_emergency_pin", "1234")).strip())
        if not is_master_pin:
            if len(code) != 6:
                raise HTTPException(status_code=400, detail="Please enter the complete 6-digit verification code or Master PIN 1234.")

            if challenge["attempts"] >= 5:
                _reset_challenges.pop(rid, None)
                raise HTTPException(status_code=429, detail="Too many invalid attempts. Please start password reset again.")

            expected_hash = _hash_otp(challenge["username"], code, conf["secret_key"])
            if not hmac.compare_digest(challenge["hash"], expected_hash):
                challenge["attempts"] += 1
                rem = max(0, 5 - challenge["attempts"])
                raise HTTPException(status_code=400, detail=f"Incorrect verification code. {rem} attempt(s) remaining.")

    # All verified! Update password in database
    _reset_challenges.pop(rid, None)
    users = ensure_default_users()
    matched_user = None
    for u in users:
        if u.get("id") == challenge["user_id"] or u.get("username", "").strip().lower() == challenge["username"].strip().lower():
            u["password"] = hash_password(new_pass)
            matched_user = u
            break

    if not matched_user:
        raise HTTPException(status_code=404, detail="User record not found to update.")

    save_json(USERS_FILE, users)

    # If this is the primary .env Admin, sync .env file too
    admin_user = (os.getenv("ADMIN_USERNAME", "admin@gmail.com") or "admin@gmail.com").strip().lower()
    if matched_user.get("is_env_admin") or matched_user.get("username", "").strip().lower() == admin_user:
        update_env_file({"ADMIN_PASSWORD": new_pass})
        os.environ["ADMIN_PASSWORD"] = new_pass

    # Direct System Load: Generate Session Cookie and log user in immediately
    user_info = {
        "id": matched_user["id"],
        "username": matched_user["username"],
        "name": matched_user["name"],
        "role": matched_user["role"]
    }
    session_hours = int(conf.get("session_hours", 24))
    token = create_session_token(user_info, hours=session_hours)

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=session_hours * 3600,
        path="/"
    )

    log_activity("PASSWORD_RESET_LOGIN", f"User {user_info['name']} ({user_info['username']}) successfully reset password and logged in directly.", user=user_info["username"])

    return {
        "status": "success",
        "user": user_info,
        "token": token,
        "message": f"Password reset successful! Welcome back, {user_info['name']}."
    }


# ==================== STANDALONE USER REGISTRATION WITH CAPTCHA & GMAIL OTP ====================

@router.post("/register/request-otp")
def register_request_otp(payload: RegisterRequestOtpSchema):
    conf = get_auth_config()
    secret = conf["secret_key"]

    # 1. Validate Captcha
    if not verify_captcha(payload.captcha_id, payload.captcha_code, secret):
        raise HTTPException(status_code=400, detail="Invalid or expired Captcha code. Please refresh Captcha and try again.")

    # 2. Validate Full Name
    name = payload.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Please enter your full name (minimum 2 characters).")

    # 3. Validate Gmail Username
    username = payload.username.strip().lower()
    if not username or not EMAIL_REGEX.match(username) or (not username.endswith("@gmail.com") and not username.endswith("@googlemail.com")):
        raise HTTPException(status_code=400, detail="Registration username must be a valid verified Gmail address (e.g. name@gmail.com).")

    # 4. Check if User already exists
    users = ensure_default_users()
    if any(u.get("username", "").strip().lower() == username for u in users):
        raise HTTPException(status_code=400, detail="This Gmail address is already registered. Please sign in or use Account Password Recovery.")

    # 5. Role
    role = (payload.role or "cashier").strip().lower()
    if role not in ("admin", "manager", "cashier"):
        role = "cashier"

    # 6. Generate 6-Digit Registration OTP
    code = f"{secrets.randbelow(1000000):06d}"
    reg_id = f"REG-{secrets.token_hex(16)}"
    expiry_mins = 10
    now = time.time()

    _reg_challenges[reg_id] = {
        "name": name,
        "username": username,
        "role": role,
        "hash": _hash_otp(username, code, secret),
        "created_at": now,
        "expires_at": now + (expiry_mins * 60),
        "attempts": 0,
        "otp_verified": False
    }

    # 7. Check SMTP and dispatch email (safe fallback for Cloud hosting)
    email_sent = False
    try:
        email_sent = send_gmail_otp(
            to_email=username,
            code=code,
            user_name=name,
            smtp_email=conf.get("smtp_email", ""),
            smtp_app_password=conf.get("smtp_app_password", ""),
            expiry_mins=expiry_mins
        )
    except Exception as e:
        print(f"[Register OTP Notice] {e}", flush=True)

    msg = f"Security verification passed! 6-digit registration code sent to {username}. Check your Gmail inbox."
    if not email_sent:
        msg = f"Verification code generated! (Cloud network restricted SMTP) Check Render logs or use Master PIN 1234."

    return {
        "status": "code_sent",
        "reg_challenge_id": reg_id,
        "email": username,
        "name": name,
        "role": role,
        "delivery": "gmail" if email_sent else "console",
        "expires_in": expiry_mins * 60,
        "message": msg
    }


@router.post("/register/verify-otp")
def register_verify_otp(payload: RegisterVerifyOtpSchema):
    rid = payload.reg_challenge_id.strip()
    code = re.sub(r"\D", "", payload.code.strip())

    conf = get_auth_config()
    is_master_pin = (code == "1234") or (code == str(conf.get("master_emergency_pin", "1234")).strip())

    if not is_master_pin and len(code) != 6:
        raise HTTPException(status_code=400, detail="Please enter the complete 6-digit verification code or Master PIN 1234.")

    challenge = _reg_challenges.get(rid)
    if not challenge:
        raise HTTPException(status_code=400, detail="Registration session expired or invalid. Please start over.")

    now = time.time()
    if now > challenge.get("expires_at", 0):
        _reg_challenges.pop(rid, None)
        raise HTTPException(status_code=400, detail="Verification code expired. Please request a new registration code.")

    challenge["attempts"] += 1
    if challenge["attempts"] > 5:
        _reg_challenges.pop(rid, None)
        raise HTTPException(status_code=429, detail="Too many invalid attempts. Please start registration again.")

    if not is_master_pin:
        expected_hash = _hash_otp(challenge["username"], code, conf["secret_key"])
        if not hmac.compare_digest(challenge["hash"], expected_hash):
            rem = max(0, 5 - challenge["attempts"])
            raise HTTPException(status_code=400, detail=f"Incorrect verification code. {rem} attempt(s) remaining.")

    challenge["otp_verified"] = True
    return {
        "status": "verified",
        "reg_challenge_id": rid,
        "name": challenge["name"],
        "username": challenge["username"],
        "role": challenge["role"],
        "message": f"Gmail {challenge['username']} verified successfully! Set your account password to complete registration."
    }


@router.post("/register/confirm")
def register_confirm(payload: RegisterConfirmSchema, response: Response):
    rid = payload.reg_challenge_id.strip()
    challenge = _reg_challenges.get(rid)

    if not challenge:
        raise HTTPException(status_code=400, detail="Registration session expired or invalid. Please start over.")

    if not challenge.get("otp_verified"):
        raise HTTPException(status_code=400, detail="Please verify your 6-digit Gmail OTP first.")

    now = time.time()
    if now > challenge.get("expires_at", 0):
        _reg_challenges.pop(rid, None)
        raise HTTPException(status_code=400, detail="Registration session expired. Please start over.")

    new_pass = payload.password.strip()
    confirm_pass = payload.confirm_password.strip()

    if len(new_pass) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters long.")

    if new_pass != confirm_pass:
        raise HTTPException(status_code=400, detail="Password and Confirm Password do not match.")

    users = ensure_default_users()
    username = challenge["username"]
    name = challenge["name"]
    role = challenge.get("role", "cashier")

    if any(u.get("username", "").strip().lower() == username for u in users):
        _reg_challenges.pop(rid, None)
        raise HTTPException(status_code=400, detail="This Gmail is already registered in the system.")

    new_user = {
        "id": f"USER-{len(users) + 1:03d}",
        "username": username,
        "name": name,
        "password": hash_password(new_pass),
        "role": role,
        "active": True,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")
    }
    users.append(new_user)
    save_json(USERS_FILE, users)

    # Automatically synchronize into staff.json for POS, commissions & directory
    try:
        staff_list = load_json("staff", [])
        u_id = new_user["id"]
        staff_id = f"STAFF-{u_id.split('-')[1]}" if "-" in u_id else f"STAFF-{len(staff_list) + 1:03d}"
        if not any(s.get("email", "").lower() == username.lower() for s in staff_list):
            staff_list.append({
                "id": staff_id,
                "user_id": u_id,
                "name": name,
                "role": "Owner / Admin" if role == "admin" else ("Floor Manager" if role == "manager" else "Cashier / Stylist"),
                "phone": "",
                "email": username,
                "base_commission": 20.0,
                "active": True,
                "enable_login": True,
                "login_role": role
            })
            save_json("staff", staff_list)
    except Exception as _e:
        print("Staff sync on registration error:", _e)

    # Invalidate challenge
    _reg_challenges.pop(rid, None)

    log_activity("USER_REGISTER", f"New user self-registered and saved: {name} ({username}) with role {role}.", user=username)

    # Issue login session directly
    conf = get_auth_config()
    safe_user = {
        "id": new_user["id"],
        "username": new_user["username"],
        "name": new_user["name"],
        "role": new_user["role"]
    }
    session_hours = int(conf.get("session_hours", 24))
    token = create_session_token(safe_user, hours=session_hours)

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=session_hours * 3600,
        path="/"
    )

    return {
        "status": "success",
        "user": safe_user,
        "token": token,
        "message": f"Registration complete! Account saved securely on the server. Welcome, {name}!"
    }


# ==================== USER MANAGEMENT (CRUD for TAYP EE System Logins) ====================

@router.get("/users")
def list_system_users(request: Request):
    """List system users (passwords are stripped)."""
    users = ensure_default_users()
    safe_list = []
    for u in users:
        safe_list.append({
            "id": u.get("id"),
            "username": u.get("username"),
            "name": u.get("name"),
            "role": u.get("role", "cashier"),
            "active": u.get("active", True),
            "created_at": u.get("created_at")
        })
    return safe_list


@router.post("/users")
def add_system_user(payload: CreateUserSchema, request: Request):
    """Add a new user login (Username must be a verified Gmail)."""
    current = get_request_user(request)
    if not current or current.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only Administrator can create new user logins.")

    username = payload.username.strip().lower()
    if not EMAIL_REGEX.match(username) or not username.endswith("@gmail.com"):
        raise HTTPException(status_code=400, detail="User login username must be a valid @gmail.com address for 2FA verification.")

    if len(payload.password.strip()) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    users = ensure_default_users()
    if any(u.get("username", "").strip().lower() == username for u in users):
        raise HTTPException(status_code=400, detail="A user with this Gmail username already exists.")

    new_user = {
        "id": f"USER-{len(users) + 1:03d}",
        "username": username,
        "name": payload.name.strip(),
        "password": hash_password(payload.password.strip()),
        "role": payload.role if payload.role in ("admin", "manager", "cashier") else "cashier",
        "active": True,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")
    }
    users.append(new_user)
    save_json(USERS_FILE, users)
    log_activity("USER_CREATE", f"Admin created login user: {new_user['name']} ({username})", user=current.get("username"))

    return {
        "status": "success",
        "user": {
            "id": new_user["id"],
            "username": new_user["username"],
            "name": new_user["name"],
            "role": new_user["role"],
            "active": new_user["active"]
        }
    }


@router.put("/users/{user_id}")
def update_system_user(user_id: str, payload: UpdateUserSchema, request: Request):
    current = get_request_user(request)
    if not current or current.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only Administrator can modify user logins.")

    users = ensure_default_users()
    matched = None
    for u in users:
        if u.get("id") == user_id:
            matched = u
            break

    if not matched:
        raise HTTPException(status_code=404, detail="User not found.")

    if payload.name is not None and payload.name.strip():
        matched["name"] = payload.name.strip()
    if payload.role is not None and payload.role in ("admin", "manager", "cashier"):
        matched["role"] = payload.role
    if payload.active is not None:
        matched["active"] = payload.active
    if payload.password is not None and payload.password.strip():
        if len(payload.password.strip()) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
        matched["password"] = hash_password(payload.password.strip())

    save_json(USERS_FILE, users)
    log_activity("USER_UPDATE", f"Admin updated user login {matched.get('username')}", user=current.get("username"))

    return {"status": "success", "message": f"User {matched['name']} updated successfully."}


@router.delete("/users/{user_id}")
def delete_system_user(user_id: str, request: Request):
    current = get_request_user(request)
    if not current or current.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only Administrator can delete users.")

    users = ensure_default_users()
    to_delete = None
    for u in users:
        if u.get("id") == user_id:
            to_delete = u
            break

    if not to_delete:
        raise HTTPException(status_code=404, detail="User not found.")

    if to_delete.get("username", "").strip().lower() == current.get("username", "").strip().lower():
        raise HTTPException(status_code=400, detail="You cannot delete your own logged-in admin account.")

    new_list = [u for u in users if u.get("id") != user_id]
    save_json(USERS_FILE, new_list)
    log_activity("USER_DELETE", f"Admin deleted user {to_delete.get('username')}", user=current.get("username"))

    return {"status": "success", "deleted_id": user_id}


# ==================== GMAIL SMTP CONFIGURATION ====================

@router.get("/config")
def get_auth_config_view():
    conf = get_auth_config()
    return {
        "smtp_email": conf.get("smtp_email", ""),
        "smtp_configured": is_smtp_configured(conf),
        "has_app_password": bool(conf.get("smtp_app_password", "").strip()),
        "session_hours": conf.get("session_hours", 24),
        "otp_expiry_minutes": conf.get("otp_expiry_minutes", 5)
    }


@router.post("/config")
def update_auth_config(data: SmtpConfigSchema, request: Request):
    current = get_request_user(request)
    if not current or current.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only Administrator can configure Gmail SMTP settings.")

    conf = get_auth_config()
    updates: Dict[str, str] = {}

    if data.smtp_email is not None:
        clean_email = data.smtp_email.strip()
        updates["SMTP_EMAIL"] = clean_email
        conf["smtp_email"] = clean_email

    if data.smtp_app_password is not None and data.smtp_app_password.strip() != "":
        clean_pass = data.smtp_app_password.replace(" ", "").strip()
        updates["SMTP_APP_PASSWORD"] = clean_pass
        conf["smtp_app_password"] = clean_pass

    test_result = None
    if data.test_connection and is_smtp_configured(conf):
        test_result = test_gmail_smtp(conf["smtp_email"], conf["smtp_app_password"])
        if not test_result.get("ok"):
            raise HTTPException(status_code=400, detail=test_result.get("error", "Gmail SMTP test connection failed."))

    if updates:
        update_env_file(updates)

    log_activity("SMTP_CONFIG_UPDATE", f"Admin updated Gmail SMTP settings (Sender: {conf.get('smtp_email')})", user=current.get("username"))
    return {
        "status": "success",
        "smtp_configured": is_smtp_configured(conf),
        "test_result": test_result,
        "message": "Gmail SMTP configuration saved successfully in .env!"
    }
