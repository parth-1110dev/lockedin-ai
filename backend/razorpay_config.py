import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
import razorpay


_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH)


@dataclass(frozen=True)
class RazorpayConfig:
    key_id: str
    key_secret: str


@lru_cache(maxsize=1)
def get_razorpay_config() -> RazorpayConfig | None:
    key_id = (os.getenv("RAZORPAY_KEY_ID") or "").strip()
    key_secret = (os.getenv("RAZORPAY_KEY_SECRET") or "").strip()

    if not key_id or not key_secret:
        return None

    return RazorpayConfig(key_id=key_id, key_secret=key_secret)


def get_razorpay_client() -> tuple[razorpay.Client | None, str | None]:
    config = get_razorpay_config()
    if config is None:
        return None, None

    client = razorpay.Client(auth=(config.key_id, config.key_secret))
    return client, config.key_id