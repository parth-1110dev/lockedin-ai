import os
import time

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openai import OpenAI

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM_PROMPT_FREE = """You are a simple learning assistant.

Provide clear and basic explanations.
Keep it easy to understand.
Limit depth.
Use fewer examples.

Goal: Give a beginner overview.

Structure:
1. Introduction
2. Core Concepts
3. Deep Dive
4. Examples
5. Reflection
6. Practice
7. Summary

Do NOT behave like a chatbot.
Do NOT ask for user replies.
Only provide structured learning content."""


SYSTEM_PROMPT_PRO = """You are a structured learning coach.

Provide clear and well-organized explanations.
Include multiple examples.
Explain concepts in depth.
Make learning practical.

Goal: Help user understand concepts properly.

Structure:
1. Introduction
2. Core Concepts
3. Deep Dive
4. Examples
5. Reflection
6. Practice
7. Summary

Do NOT behave like a chatbot.
Do NOT ask for user replies.
Only provide structured learning content."""


SYSTEM_PROMPT_ELITE = """You are an expert mentor.

Provide deep, detailed explanations.
Use analogies, comparisons, and advanced insights.
Include multiple real-world examples.
Add reflection prompts and mini exercises.
Make the user feel like they truly master the topic.

Goal: Deliver expert-level understanding.

Structure:
1. Introduction
2. Core Concepts
3. Deep Dive
4. Examples
5. Reflection
6. Practice
7. Summary

Do NOT behave like a chatbot.
Do NOT ask for user replies.
Only provide structured learning content."""


# Simple in-memory rate limit: max requests per IP per rolling 60s window.
RATE_LIMIT_WINDOW_SEC = 60.0
RATE_LIMIT_MAX_PER_WINDOW = 10
# ip -> (window_start_epoch, count_in_window)
_rate_limit_buckets: dict[str, tuple[float, int]] = {}


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def _prune_stale_rate_buckets(now: float) -> None:
    cutoff = now - (RATE_LIMIT_WINDOW_SEC * 2)
    stale = [ip for ip, (window_start, _) in _rate_limit_buckets.items() if window_start < cutoff]
    for ip in stale:
        del _rate_limit_buckets[ip]


def _rate_limit_allow(ip: str, now: float) -> bool:
    """
    Returns True if the request is allowed, False if rate limited.
    Resets the window when older than RATE_LIMIT_WINDOW_SEC.
    """
    if ip not in _rate_limit_buckets:
        _rate_limit_buckets[ip] = (now, 1)
        return True

    window_start, count = _rate_limit_buckets[ip]
    if now - window_start >= RATE_LIMIT_WINDOW_SEC:
        _rate_limit_buckets[ip] = (now, 1)
        return True

    next_count = count + 1
    _rate_limit_buckets[ip] = (window_start, next_count)
    return next_count <= RATE_LIMIT_MAX_PER_WINDOW


@app.post("/generate")
async def generate_content(request: Request, data: dict):
    now = time.time()
    _prune_stale_rate_buckets(now)
    client_ip = _get_client_ip(request)
    if not _rate_limit_allow(client_ip, now):
        return JSONResponse(
            status_code=429,
            content={"error": "Too many requests. Please slow down."},
        )

    try:
        # Safe input handling.
        raw_topic = data.get("topic", "")
        topic = str(raw_topic).strip()
        if not topic:
            return {"error": "Topic is required"}

        # Accept either "duration" (current frontend) or fallback "minutes".
        raw_minutes = data.get("duration", data.get("minutes", 10))
        try:
            minutes = int(raw_minutes)
        except Exception:
            minutes = 10

        plan_raw = data.get("plan", "free")
        plan_normalized = str(plan_raw).strip().lower() if plan_raw is not None else "free"
        if plan_normalized not in ["free", "pro", "elite"]:
            plan_normalized = "free"

        print("REQUEST:", topic, minutes, plan_normalized)
        # Plan-based model + detail level.
        if plan_normalized == "free":
            model = "gpt-4.1-mini"
            detail_level = "basic, beginner-friendly overview"
            max_duration = 30
            system_prompt = SYSTEM_PROMPT_FREE
            max_tokens = 800
        elif plan_normalized == "pro":
            model = "gpt-4.1"
            detail_level = "structured, in-depth explanations with multiple examples"
            max_duration = 60
            system_prompt = SYSTEM_PROMPT_PRO
            max_tokens = 1600
        elif plan_normalized == "elite":
            model = "gpt-4o"
            detail_level = "expert-level, detailed explanations with analogies and real-world insights"
            max_duration = 90
            system_prompt = SYSTEM_PROMPT_ELITE
            max_tokens = 2800
        else:
            model = "gpt-4.1-mini"
            detail_level = "basic, beginner-friendly overview"
            max_duration = 30
            system_prompt = SYSTEM_PROMPT_FREE
            max_tokens = 800

        # Enforce plan-based duration ceiling even if the client sends a higher value.
        try:
            duration_int = max(5, min(int(minutes), max_duration))
        except Exception:
            duration_int = 25

        prompt = f"""Topic: "{topic}"
Session length: {duration_int} minutes.

Plan / detail level: {detail_level}

Output requirements:
- Use clear Markdown with ## and ### headings.
- Follow the 7-part structure (Introduction, Core Concepts, Deep Dive, Examples, Reflection, Practice, Summary).
- Calibrate depth and length to the session duration (short sessions must be clearly shorter/simpler than long ones).
- Stay on-topic; do not invent unrelated modules."""

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.7,
                max_tokens=max_tokens,
            )
            print("SUCCESS RESPONSE")
            return {"content": response.choices[0].message.content}
        except Exception as e:
            print("ERROR OCCURRED:", str(e))
            return {
                "error": "API failed",
                "details": str(e),
            }

    except Exception as e:
        print("UNEXPECTED ERROR:", str(e))
        return {"error": "Internal error", "details": str(e)}


# LAN / mobile: run with
#   uvicorn main:app --host 0.0.0.0 --port 8000
