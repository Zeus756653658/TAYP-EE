import os
import secrets
from pathlib import Path
from typing import Dict

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"
DATA_DIR = BASE_DIR / "data"
BACKUP_DIR = BASE_DIR / "backups"
FRONTEND_DIR = BASE_DIR / "frontend"
REPASS_DIR = BASE_DIR / "repass"
REGISTER_DIR = BASE_DIR / "register"
APPOINTMENT_DIR = BASE_DIR / "appointment"

DATA_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_DIR.mkdir(parents=True, exist_ok=True)
REPASS_DIR.mkdir(parents=True, exist_ok=True)
REGISTER_DIR.mkdir(parents=True, exist_ok=True)
APPOINTMENT_DIR.mkdir(parents=True, exist_ok=True)


def _load_env_file(env_path: Path) -> None:
    """Loads key=value pairs from .env into os.environ."""
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv(dotenv_path=env_path, override=True)
        return
    except ImportError:
        pass

    if not env_path.exists():
        return
    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key:
                os.environ[key] = val
    except Exception as e:
        print(f"[Config Warning] Could not parse .env file: {e}")


def update_env_file(updates: Dict[str, str]) -> None:
    """Updates keys in both live os.environ and the project .env file."""
    for k, v in updates.items():
        os.environ[k] = str(v)

    lines = []
    if ENV_FILE.exists():
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()

    remaining = {k: str(v) for k, v in updates.items()}
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            k = stripped.split("=", 1)[0].strip()
            if k in remaining:
                new_lines.append(f"{k}={remaining.pop(k)}")
                continue
        new_lines.append(line)

    for k, v in remaining.items():
        new_lines.append(f"{k}={v}")

    try:
        ENV_FILE.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    except Exception as e:
        print(f"[Config Warning] Could not persist updates to .env: {e}")


# Load .env immediately at startup
_load_env_file(ENV_FILE)

# Ensure AUTH_SECRET_KEY exists in runtime env
if not os.getenv("AUTH_SECRET_KEY", "").strip():
    os.environ["AUTH_SECRET_KEY"] = secrets.token_hex(32)

# Server Config (loaded from .env / OS environment)
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8080"))
APP_NAME = os.getenv("APP_NAME", "TAYP EE — Cloud POS & Business Suite")
APP_VERSION = os.getenv("APP_VERSION", "0.1.0 BETA")
APP_VERSION_STAGE = "BETA"
APP_BUILD = "2026.11.20-b1"
