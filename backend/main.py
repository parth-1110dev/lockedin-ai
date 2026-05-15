import json
import os
import time
import traceback

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openai import OpenAI
from razorpay_config import get_razorpay_client as _get_razorpay_client
from supabase import create_client

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

SYSTEM_PROMPT_BASE = """You are LockedIn's learning engine.
Write concise, high-signal lesson content in Markdown.
Use exactly these sections in this order:
1. Introduction
2. Core Concepts
3. Deep Dive
4. Examples
5. Reflection
6. Practice
7. Summary
Rules:
- Stay on topic.
- Avoid filler, repetition, and chatbot-style replies.
- Use short paragraphs and bullets when useful.
- Do not ask the user questions.
- Return only the lesson content."""


PLAN_CONFIGS = {
    "free": {
        "model": "gpt-4o-mini",
        "detail_level": "brief, beginner-friendly overview",
        "max_duration": 30,
        "max_tokens": 500,
        "tier_prompt": "Keep it short and simple. Prioritize clarity over depth.",
    },
    "pro": {
        "model": "gpt-4.1",
        "detail_level": "structured explanations with practical examples",
        "max_duration": 45,
        "max_tokens": 900,
        "tier_prompt": "Balance clarity and depth. Include useful examples and step-by-step progression.",
    },
    "elite": {
        "model": "gpt-4.1",
        "detail_level": "deep explanations with analogies and advanced insight",
        "max_duration": 60,
        "max_tokens": 1400,
        "tier_prompt": """You are an elite-level AI coach focused on behavior change, execution, and real-world results.
Goal: NOT textbook explanations, but actionable guidance that diagnoses the user's situation.

TOPIC MODE SELECTION:
- If the topic is self-improvement, psychology, or productivity, use the existing Elite coaching mode.
- If the topic is technology, geopolitics, economics, or science, activate DEEP KNOWLEDGE MODE.

DEEP KNOWLEDGE MODE OVERRIDE:
- In Deep Knowledge Mode, replace the coaching-only sections below.
- Remove: YOUR SITUATION.
- Remove: LIKELY USER DIAGNOSIS.
- Remove: EXECUTION PLAN (TODAY).
- Remove: START NOW.
- Use this structure instead:
    A. STRUCTURED EXPLANATION - Clear step-by-step breakdown from fundamentals to advanced concepts; include key mechanisms and processes.
    B. KEY COMPONENTS / FACTORS - Bullet breakdown of major elements.
    C. REAL-WORLD CONTEXT - Timeline, examples, or applications.
    D. SIMPLIFIED SUMMARY - 3–5 lines max.
- Go deeper than Pro by covering mechanisms, systems, and cause-effect relationships.
- For knowledge topics, keep length at 1.5x–2x Pro length, with no fluff and no coaching tone.
- Use a clear, structured, expert-level tone with no personalization and no "you are likely" statements.

MANDATORY RESPONSE STRUCTURE:
1. CORE INSIGHT (2–4 lines) - Sharp insight that makes the user feel understood
2. WHY THIS HAPPENS (DEEP EDGE) - 3–5 bullets max; each bullet 1–2 lines; include high-value concepts (for example: temporal discounting, emotional avoidance, self-regulation failure); no long explanations and no textbook tone
3. YOUR SITUATION - Identify 2–3 specific reasons the user is struggling; use direct language like "Right now, your main problem is..." and "You are likely facing..."
4. LIKELY USER DIAGNOSIS - Keep it personalized even without user input; do NOT stay generic
5. EXECUTION PLAN (TODAY) - Replace generic practice/tips content with 3 steps only: Step 1 = extremely small action (2–5 minutes), Step 2 = next logical step, Step 3 = reinforcement step; make each step specific, time-bound, and immediately actionable
6. IMMEDIATE NEXT STEP - Exactly what to do RIGHT NOW (within 5 minutes)
7. START NOW - Give ONE clear instruction, with no explanation, doable in the next 2–5 minutes

EXECUTION PRIORITY RULES:
- EXECUTION PLAN (TODAY) must always be the most detailed and dominant section.
- For each execution step, include a short example only if needed (1 line max).
- In coaching mode, keep the current execution-first structure exactly as written.
- In Deep Knowledge Mode, replace the coaching sections with the Deep Knowledge Mode structure above.

ELITE MENTOR UPGRADE RULES:
- Act as an advanced personalized learning mentor.
- Do not just explain; ensure the user can understand and apply the concept.
- Anticipate confusion by identifying difficult parts and simplifying them proactively.
- Add deeper insight by explaining why concepts work and connecting related ideas.
- Improve clarity with stronger analogies and further breakdown of complex parts.
- Make learning efficient by highlighting what matters most and removing low-value details.
- Personalize by adapting to topic complexity and adjusting depth dynamically.
- Keep explanations concise and high-value.

TONE: Combine the clarity of Pro with the directness of Elite. Prioritize action over explanation. Avoid long theoretical explanations unless necessary.
STYLE CONSTRAINTS: Avoid poetic or overly metaphorical writing. Avoid unnecessary analogies.
BALANCE RULE: Explanation + depth <= 40% of the response. Actionable content >= 60% of the response.
LENGTH CONTROL: Response should feel premium but not bloated. Target 1.3x-1.6x Pro length. Never exceed necessary detail.
OUTPUT RULE: Return structured output only.
PRIORITY: Avoid unnecessary elaboration.""",
    },
}


EXPLANATION_MODE_GUIDANCE = {
    "beginner_friendly": """Explain in a beginner-friendly way:
- Use simple language.
- Avoid jargon.
- Break concepts into small parts.""",
    "like_im_5": """Explain like the user is a complete beginner:
- Use very simple words.
- Use analogies.
- Keep it extremely easy to understand.""",
    "real_world_analogies": """Explain using real-world analogies:
- Relate concepts to everyday situations.
- Focus on intuition over theory.""",
    "technical_deep_dive": """Explain in a technical and detailed way:
- Include deeper concepts.
- Use proper terminology.
- Add structured breakdowns.""",
    "exam_focused": """Explain in an exam-focused way:
- Highlight key points.
- Include definitions.
- Emphasize what is important to remember.""",
}


PLAN_PRICING_PAISE = {
    "pro": 29900,
    "elite": 59900,
}
PAYMENT_CURRENCY = "INR"

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").strip()
SUPABASE_SERVICE_ROLE_KEY = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
SUPABASE_USERS_TABLE = "users"

# Initialize Supabase client using official SDK
_supabase_client = None
if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    _supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    print(f"Supabase SDK client initialized with URL: {SUPABASE_URL}")
else:
    print("WARNING: Supabase credentials not configured - SDK client will not be initialized")


# Simple in-memory rate limit: max requests per IP per rolling 60s window.
RATE_LIMIT_WINDOW_SEC = 60.0
RATE_LIMIT_MAX_PER_WINDOW = 10
# ip -> (window_start_epoch, count_in_window)
_rate_limit_buckets: dict[str, tuple[float, int]] = {}

# In-memory idempotency cache for verify-payment calls.
# Prevents duplicate plan upgrades if the same verification is retried.
# Key: (user_id, payment_id), Value: (result_timestamp, response)
_verify_payment_idempotency_cache: dict[tuple[str, str], tuple[float, dict]] = {}
VERIFY_PAYMENT_CACHE_TTL_SEC = 3600.0  # 1 hour


def _get_plan_config(plan: str) -> dict[str, object]:
    return PLAN_CONFIGS.get(plan, PLAN_CONFIGS["free"])


def _normalize_paid_plan(plan: object) -> str:
    normalized = str(plan or "").strip().lower()
    if normalized in PLAN_PRICING_PAISE:
        return normalized
    return ""


def _normalize_user_email(email: object) -> str:
    return str(email or "").strip().lower()


def _extract_single_row(response: object) -> dict | None:
    rows = getattr(response, "data", None)
    if not isinstance(rows, list) or len(rows) != 1:
        return None
    row = rows[0]
    return row if isinstance(row, dict) else None


@app.post("/sync-user")
async def sync_user(data: dict):
    """
    Ensure public.users uses the Supabase auth user ID as its primary key.

    If the auth user row already exists, keep it in sync.
    If a legacy row exists under the same email but a different ID, migrate it
    to the auth user ID so future plan updates target the correct row.
    """
    if not _supabase_client:
        message = "Supabase SDK client is not initialized. Credentials missing."
        print(f"[Supabase][User Sync] CRITICAL ERROR: {message}")
        return JSONResponse(status_code=500, content={"error": message, "step": "supabase_config"})

    user_id = str(data.get("user_id", "")).strip()
    email = _normalize_user_email(data.get("email", ""))
    source = str(data.get("source", "unknown")).strip() or "unknown"

    print("[Supabase][User Sync] START")
    print(f"[Supabase][User Sync] source={source} auth_user_id={user_id} email={email or 'n/a'}")

    if not user_id:
        message = "Missing auth user ID."
        print(f"[Supabase][User Sync] VALIDATION ERROR: {message}")
        return JSONResponse(status_code=400, content={"error": message, "step": "user_validation"})

    try:
        existing_by_id = _extract_single_row(
            _supabase_client.table(SUPABASE_USERS_TABLE)
            .select("id,email,plan")
            .eq("id", user_id)
            .execute()
        )

        if existing_by_id:
            existing_email = _normalize_user_email(existing_by_id.get("email", ""))
            existing_plan = str(existing_by_id.get("plan", "free")).strip().lower() or "free"
            print(
                f"[Supabase][User Sync] MATCHED auth_user_id={user_id} users_table_id={existing_by_id.get('id', '')} plan={existing_plan}"
            )

            if email and existing_email != email:
                update_response = (
                    _supabase_client.table(SUPABASE_USERS_TABLE)
                    .update({"email": email})
                    .eq("id", user_id)
                    .execute()
                )
                print(f"[Supabase][User Sync] Email refreshed for auth_user_id={user_id} response={update_response}")

            confirm_row = _extract_single_row(
                _supabase_client.table(SUPABASE_USERS_TABLE)
                .select("id,email,plan")
                .eq("id", user_id)
                .execute()
            )
            if not confirm_row:
                message = "Users row disappeared after matching by auth ID."
                print(f"[Supabase][User Sync] CONFIRM ERROR: {message}")
                return JSONResponse(status_code=500, content={"error": message, "step": "confirm"})

            confirm_id = str(confirm_row.get("id", "")).strip()
            confirm_email = _normalize_user_email(confirm_row.get("email", ""))
            print(
                f"[Supabase][User Sync] SUCCESS auth_user_id={user_id} users_table_id={confirm_id} email={confirm_email or 'n/a'} match=True"
            )
            return {
                "success": True,
                "matched": True,
                "action": "existing_match",
                "user_id": user_id,
                "users_table_id": confirm_id,
                "email": confirm_email,
                "plan": str(confirm_row.get("plan", "free")).strip().lower() or "free",
            }

        legacy_row = None
        if email:
            legacy_row = _extract_single_row(
                _supabase_client.table(SUPABASE_USERS_TABLE)
                .select("id,email,plan")
                .eq("email", email)
                .execute()
            )

        if legacy_row and str(legacy_row.get("id", "")).strip() != user_id:
            legacy_id = str(legacy_row.get("id", "")).strip()
            legacy_plan = str(legacy_row.get("plan", "free")).strip().lower() or "free"
            print(
                f"[Supabase][User Sync] REPAIR legacy_row_id={legacy_id} -> auth_user_id={user_id} email={email or 'n/a'} plan={legacy_plan}"
            )
            repair_response = (
                _supabase_client.table(SUPABASE_USERS_TABLE)
                .update({"id": user_id, "email": email or legacy_row.get("email", ""), "plan": legacy_plan})
                .eq("id", legacy_id)
                .execute()
            )
            print(f"[Supabase][User Sync] Repair response={repair_response}")
        else:
            print(f"[Supabase][User Sync] INSERT auth_user_id={user_id} email={email or 'n/a'}")
            insert_response = (
                _supabase_client.table(SUPABASE_USERS_TABLE)
                .insert({"id": user_id, "email": email, "plan": "free"})
                .execute()
            )
            print(f"[Supabase][User Sync] Insert response={insert_response}")

        confirm_row = _extract_single_row(
            _supabase_client.table(SUPABASE_USERS_TABLE)
            .select("id,email,plan")
            .eq("id", user_id)
            .execute()
        )
        if not confirm_row:
            message = "Users row not found after sync attempt."
            print(f"[Supabase][User Sync] CONFIRM ERROR: {message}")
            return JSONResponse(status_code=500, content={"error": message, "step": "confirm"})

        confirm_id = str(confirm_row.get("id", "")).strip()
        confirm_email = _normalize_user_email(confirm_row.get("email", ""))
        confirm_plan = str(confirm_row.get("plan", "free")).strip().lower() or "free"

        if confirm_id != user_id:
            message = f"Synced row ID mismatch: expected={user_id}, got={confirm_id}"
            print(f"[Supabase][User Sync] MISMATCH ERROR: {message}")
            return JSONResponse(status_code=500, content={"error": message, "step": "confirm"})

        print(
            f"[Supabase][User Sync] SUCCESS auth_user_id={user_id} users_table_id={confirm_id} email={confirm_email or 'n/a'} match=True"
        )
        return {
            "success": True,
            "matched": True,
            "action": "repaired_or_inserted",
            "user_id": user_id,
            "users_table_id": confirm_id,
            "email": confirm_email,
            "plan": confirm_plan,
        }
    except Exception as error:
        traceback.print_exc()
        message = str(error)
        print(f"[Supabase][User Sync] EXCEPTION: {message}")
        return JSONResponse(status_code=500, content={"error": message, "step": "unexpected_error"})


def _update_user_plan_in_supabase(user_id: str, selected_plan: str) -> tuple[bool, str | None]:
    """
    Update user's plan using official Supabase Python SDK.
    
    Flow:
    1. Validate inputs and SDK client availability
    2. Normalize plan to valid value
    3. Execute update via SDK with retries
    4. Verify returned data exists and matches expected plan
    5. Confirm update with explicit read query
    
    Returns:
        (success: bool, result_or_error: str | None)
        - (True, updated_plan) if successful
        - (False, error_message) if failed after all retries
    """
    if not _supabase_client:
        message = "Supabase SDK client is not initialized. Credentials missing."
        print(f"[Supabase] CRITICAL ERROR: {message}")
        return False, message

    if not user_id:
        message = "Invalid or missing user_id."
        print(f"[Supabase] Validation ERROR: {message}")
        return False, message

    normalized_plan = _normalize_paid_plan(selected_plan)
    if not normalized_plan:
        message = "Invalid plan specified."
        print(f"[Supabase] Validation ERROR: {message}")
        return False, message

    preflight_row = _extract_single_row(
        _supabase_client.table(SUPABASE_USERS_TABLE)
        .select("id,email,plan")
        .eq("id", user_id)
        .execute()
    )
    if not preflight_row:
        message = f"No users row found for auth user ID {user_id}."
        print(f"[Supabase] Preflight ERROR: {message}")
        return False, message

    preflight_id = str(preflight_row.get("id", "")).strip()
    preflight_email = _normalize_user_email(preflight_row.get("email", ""))
    preflight_plan = str(preflight_row.get("plan", "free")).strip().lower() or "free"
    print(
        f"[Supabase] Preflight MATCH auth_user_id={user_id} users_table_id={preflight_id} email={preflight_email or 'n/a'} current_plan={preflight_plan}"
    )
    if preflight_id != user_id:
        message = f"Preflight users row ID mismatch: expected={user_id}, got={preflight_id}"
        print(f"[Supabase] Preflight ERROR: {message}")
        return False, message

    max_retries = 2
    for attempt in range(0, max_retries + 1):
        try:
            print(f"[Supabase] Update attempt={attempt} user_id={user_id} plan={normalized_plan}")
            
            # STEP 1: Execute UPDATE via SDK
            update_started = time.monotonic()
            
            print("=== PLAN UPDATE START ===")
            print("USER ID:", user_id)
            print("PLAN:", normalized_plan)

            update_response = (
                _supabase_client.table(SUPABASE_USERS_TABLE)
                .update({"plan": normalized_plan})
                .eq("id", user_id)
                .execute()
            )

            print("UPDATE RESPONSE:", update_response)
            print("UPDATE DATA:", update_response.data)
            
            update_elapsed_ms = round((time.monotonic() - update_started) * 1000, 2)
            print(
                f"[Supabase] Update response attempt={attempt} elapsed_ms={update_elapsed_ms} "
                f"status_code={getattr(update_response, 'status_code', 'N/A')}"
            )
            
            # STEP 2: Verify returned data exists
            if not hasattr(update_response, 'data') or update_response.data is None:
                message = "Supabase update returned no data."
                print(f"[Supabase] Data validation ERROR attempt={attempt}: {message}")
                if attempt < max_retries:
                    time.sleep(1 + attempt)
                    continue
                return False, message
            
            updated_rows = update_response.data
            if not isinstance(updated_rows, list) or len(updated_rows) != 1:
                message = f"Supabase expected 1 updated row, got {len(updated_rows) if isinstance(updated_rows, list) else 'non-list'}."
                print(f"[Supabase] Row count ERROR attempt={attempt}: {message}")
                if attempt < max_retries:
                    time.sleep(1 + attempt)
                    continue
                return False, message
            
            updated_row = updated_rows[0]
            updated_user_id = str(updated_row.get("id", "")).strip()
            updated_plan = str(updated_row.get("plan", "")).strip().lower()
            
            # STEP 3: Verify user_id matches
            if updated_user_id != user_id:
                message = f"Returned user_id mismatch: expected={user_id}, got={updated_user_id}"
                print(f"[Supabase] User ID validation ERROR attempt={attempt}: {message}")
                if attempt < max_retries:
                    time.sleep(1 + attempt)
                    continue
                return False, message
            
            # STEP 4: Verify plan matches
            if not updated_plan:
                message = "Updated plan field was empty or missing."
                print(f"[Supabase] Plan field ERROR attempt={attempt}: {message}")
                if attempt < max_retries:
                    time.sleep(1 + attempt)
                    continue
                return False, message
            
            if updated_plan != normalized_plan:
                message = f"Returned plan mismatch: expected={normalized_plan}, got={updated_plan}"
                print(f"[Supabase] Plan value ERROR attempt={attempt}: {message}")
                if attempt < max_retries:
                    time.sleep(1 + attempt)
                    continue
                return False, message
            
            # STEP 5: Confirm update with explicit read query
            print(f"[Supabase] Confirming update attempt={attempt} user_id={user_id}")
            confirm_started = time.monotonic()
            
            confirm_response = (
                _supabase_client.table(SUPABASE_USERS_TABLE)
                .select("id,plan")
                .eq("id", user_id)
                .execute()
            )

            print("CONFIRM RESPONSE:", confirm_response)
            print("CONFIRM DATA:", confirm_response.data)
            
            confirm_elapsed_ms = round((time.monotonic() - confirm_started) * 1000, 2)
            print(
                f"[Supabase] Confirm response attempt={attempt} elapsed_ms={confirm_elapsed_ms}"
            )
            
            # Verify confirmation response
            if not hasattr(confirm_response, 'data') or confirm_response.data is None:
                message = "Supabase confirmation query returned no data."
                print(f"[Supabase] Confirm data validation ERROR attempt={attempt}: {message}")
                if attempt < max_retries:
                    time.sleep(1 + attempt)
                    continue
                return False, message
            
            confirm_rows = confirm_response.data
            if not isinstance(confirm_rows, list) or len(confirm_rows) != 1:
                message = f"Confirmation expected 1 row, got {len(confirm_rows) if isinstance(confirm_rows, list) else 'non-list'}."
                print(f"[Supabase] Confirm row count ERROR attempt={attempt}: {message}")
                if attempt < max_retries:
                    time.sleep(1 + attempt)
                    continue
                return False, message
            
            confirm_row = confirm_rows[0]
            confirm_user_id = str(confirm_row.get("id", "")).strip()
            confirm_plan = str(confirm_row.get("plan", "")).strip().lower()
            
            # Final verification
            if confirm_user_id != user_id or confirm_plan != normalized_plan:
                message = (
                    f"Confirmation mismatch: user_id={confirm_user_id} (expected={user_id}), "
                    f"plan={confirm_plan} (expected={normalized_plan})"
                )
                print(f"[Supabase] Confirm mismatch ERROR attempt={attempt}: {message}")
                if attempt < max_retries:
                    time.sleep(1 + attempt)
                    continue
                return False, message
            
            # SUCCESS
            print(
                f"[Supabase] SUCCESS ✓ attempt={attempt} user_id={user_id} plan={updated_plan} "
                f"update_elapsed_ms={update_elapsed_ms} confirm_elapsed_ms={confirm_elapsed_ms}"
            )
            return True, updated_plan
            
        except Exception as error:
            traceback.print_exc()
            message = str(error)
            print(f"[Supabase] Exception attempt={attempt}: {message}")
            if attempt < max_retries:
                time.sleep(1 + attempt)
                continue
            return False, message


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


def _prune_stale_idempotency_cache(now: float) -> None:
    """Remove expired idempotency cache entries."""
    cutoff = now - VERIFY_PAYMENT_CACHE_TTL_SEC
    stale = [key for key, (ts, _) in _verify_payment_idempotency_cache.items() if ts < cutoff]
    for key in stale:
        del _verify_payment_idempotency_cache[key]


def _get_idempotency_cache_key(user_id: str, payment_id: str) -> tuple[str, str]:
    """Generate idempotency cache key from user_id and payment_id."""
    return (user_id.strip(), payment_id.strip())


def _check_idempotency_cache(user_id: str, payment_id: str, now: float) -> dict | None:
    """Check if this payment verification was already processed. Returns cached response or None."""
    _prune_stale_idempotency_cache(now)
    key = _get_idempotency_cache_key(user_id, payment_id)
    if key in _verify_payment_idempotency_cache:
        ts, response = _verify_payment_idempotency_cache[key]
        print(f"IDEMPOTENCY CACHE HIT: key={key} cached_at={ts}")
        return response
    return None


def _set_idempotency_cache(user_id: str, payment_id: str, response: dict, now: float) -> None:
    """Cache the verification response for duplicate request prevention."""
    key = _get_idempotency_cache_key(user_id, payment_id)
    _verify_payment_idempotency_cache[key] = (now, response)
    print(f"IDEMPOTENCY CACHE SET: key={key} cached_response={response}")


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


@app.post("/create-order")
async def create_order(data: dict):
    try:
        plan = _normalize_paid_plan(data.get("plan", ""))
        if not plan:
            return JSONResponse(
                status_code=400,
                content={"error": "Only paid plans (pro, elite) can create an order."},
            )

        client_data = _get_razorpay_client()
        razorpay_client, _ = client_data
        if razorpay_client is None:
            return JSONResponse(
                status_code=500,
                content={"error": "Razorpay keys are not configured on server."},
            )

        amount = PLAN_PRICING_PAISE[plan]
        user_id = str(data.get("user_id", "")).strip()
        receipt = f"lockedin_{plan}_{int(time.time())}"

        notes = {"plan": plan}
        if user_id:
            notes["user_id"] = user_id

        try:
            order = razorpay_client.order.create(
                data={
                    "amount": amount,
                    "currency": PAYMENT_CURRENCY,
                    "receipt": receipt,
                    "notes": notes,
                }
            )
        except Exception as e:
            print("RAZORPAY ORDER CREATE ERROR:", str(e))
            return JSONResponse(
                status_code=502,
                content={"error": "Failed to create Razorpay order"},
            )

        order_id = order.get("id")
        if not order_id:
            return JSONResponse(
                status_code=502,
                content={"error": "Razorpay returned invalid order response"},
            )

        return {
            "order_id": order_id,
            "amount": amount,
            "currency": PAYMENT_CURRENCY,
        }
    except Exception as e:
        print("CREATE ORDER ERROR:", str(e))
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to create Razorpay order", "details": str(e)},
        )


@app.post("/verify-payment")
async def verify_payment(data: dict):
    """
    ATOMIC PAYMENT VERIFICATION FLOW:
    1. Check for duplicate/idempotent requests (prevent repeated upgrades)
    2. Validate and normalize inputs
    3. Verify Razorpay payment signature securely
    4. Validate authenticated user exists and plan is valid
    5. Update Supabase users table with confirmed DB success
    6. Return final success response only after full DB confirmation

    This endpoint is the SINGLE SOURCE OF TRUTH for payment finalization.
    Frontend must NEVER assume success before receiving confirmation from this endpoint.
    """
    verification_start = time.time()
    
    try:
        # STEP 0: INPUT NORMALIZATION & BASIC VALIDATION
        print("=" * 80)
        print("VERIFY PAYMENT: Starting payment verification flow")
        print("=" * 80)
        
        plan = _normalize_paid_plan(data.get("selected_plan", data.get("plan", "")))
        if not plan:
            print("VERIFY PAYMENT [STEP 0]: Plan validation FAILED - invalid plan")
            return JSONResponse(
                status_code=400,
                content={"error": "Only paid plans (pro, elite) can be verified.", "step": "plan_validation"},
            )

        order_id = str(data.get("razorpay_order_id", "")).strip()
        payment_id = str(data.get("razorpay_payment_id", "")).strip()
        signature = str(data.get("razorpay_signature", "")).strip()
        user_id = str(data.get("user_id", "")).strip()

        print(f"VERIFY PAYMENT [STEP 0]: Inputs normalized - user_id={user_id}, plan={plan}, payment_id={payment_id}")

        # STEP 0.5: CHECK IDEMPOTENCY (PREVENT DUPLICATE UPGRADES)
        now = time.time()
        cached_response = _check_idempotency_cache(user_id, payment_id, now)
        if cached_response is not None:
            print(f"VERIFY PAYMENT [IDEMPOTENCY]: Duplicate request detected, returning cached response")
            return cached_response

        # STEP 1: VALIDATE AUTHENTICATED USER
        if not user_id:
            print("VERIFY PAYMENT [STEP 1]: User validation FAILED - missing user_id (unauthenticated)")
            error_response = {
                "error": "User not authenticated or session expired.",
                "step": "user_validation",
                "authenticated": False,
            }
            return JSONResponse(status_code=401, content=error_response)
        print(f"VERIFY PAYMENT [STEP 1]: User validation PASSED - user_id={user_id}")

        # STEP 2: VALIDATE RAZORPAY PAYMENT DETAILS
        if not order_id or not payment_id or not signature:
            print("VERIFY PAYMENT [STEP 2]: Razorpay details validation FAILED - missing payment details")
            error_response = {
                "error": "Missing Razorpay payment details.",
                "step": "payment_details_validation",
            }
            return JSONResponse(status_code=400, content=error_response)
        print(f"VERIFY PAYMENT [STEP 2]: Razorpay details validation PASSED")

        # STEP 3: VALIDATE SELECTED PLAN
        if plan not in PLAN_PRICING_PAISE:
            print(f"VERIFY PAYMENT [STEP 3]: Plan validation FAILED - plan={plan} not in pricing config")
            error_response = {
                "error": "Selected plan is not available.",
                "step": "plan_validation",
            }
            return JSONResponse(status_code=400, content=error_response)
        print(f"VERIFY PAYMENT [STEP 3]: Plan validation PASSED - plan={plan}")

        # STEP 4: VERIFY RAZORPAY SIGNATURE (SECURE CRYPTOGRAPHIC VERIFICATION)
        client_data = _get_razorpay_client()
        razorpay_client, razorpay_key_id = client_data
        if razorpay_client is None:
            print("VERIFY PAYMENT [STEP 4]: Razorpay client initialization FAILED - missing keys")
            error_response = {
                "error": "Razorpay is not configured on server.",
                "step": "razorpay_config",
            }
            return JSONResponse(status_code=500, content=error_response)

        try:
            print(f"VERIFY PAYMENT [STEP 4]: Verifying Razorpay signature - order={order_id}, payment={payment_id}")
            razorpay_client.utility.verify_payment_signature(
                {
                    "razorpay_order_id": order_id,
                    "razorpay_payment_id": payment_id,
                    "razorpay_signature": signature,
                }
            )
            print("VERIFY PAYMENT [STEP 4]: Razorpay signature verification PASSED ✓")
        except Exception as error:
            traceback.print_exc()
            print(f"VERIFY PAYMENT [STEP 4]: Razorpay signature verification FAILED - {str(error)}")
            error_response = {
                "error": "Payment signature verification failed. Payment was not processed.",
                "step": "razorpay_signature",
                "details": str(error),
            }
            return JSONResponse(status_code=400, content=error_response)

        # STEP 5: UPDATE SUPABASE WITH RETRIES AND CONFIRMATION
        print(f"VERIFY PAYMENT [STEP 5]: Attempting Supabase plan update - user_id={user_id}, plan={plan}")
        updated, update_result = _update_user_plan_in_supabase(user_id, plan)
        
        if not updated:
            print(f"VERIFY PAYMENT [STEP 5]: Supabase plan update FAILED (all {2+1} attempts exhausted) - {update_result}")
            error_response = {
                "error": "Payment processed but database update failed. Your payment is secure.",
                "step": "database_update",
                "details": update_result,
                "razorpay_payment_id": payment_id,
                "razorpay_order_id": order_id,
            }
            return JSONResponse(status_code=502, content=error_response)

        print(f"VERIFY PAYMENT [STEP 5]: Supabase plan update PASSED ✓ - updated_plan={update_result}")

        # STEP 6: BUILD FINAL SUCCESS RESPONSE
        print("VERIFY PAYMENT [STEP 6]: All verification steps PASSED ✓ - Building final response")
        verification_elapsed_ms = round((time.time() - verification_start) * 1000, 2)
        
        success_response = {
            "verified": True,
            "success": True,
            "updated_plan": update_result,
            "user_id": user_id,
            "razorpay_payment_id": payment_id,
            "razorpay_order_id": order_id,
            "step": "complete",
            "elapsed_ms": verification_elapsed_ms,
        }

        # Cache this successful verification for idempotency
        _set_idempotency_cache(user_id, payment_id, success_response, now)
        
        print("=" * 80)
        print(f"VERIFY PAYMENT: SUCCESS ✓ - user_id={user_id}, plan={update_result}, elapsed_ms={verification_elapsed_ms}")
        print("=" * 80)
        
        return success_response

    except Exception as error:
        traceback.print_exc()
        verification_elapsed_ms = round((time.time() - verification_start) * 1000, 2)
        print(f"VERIFY PAYMENT [UNEXPECTED ERROR]: {str(error)} (elapsed_ms={verification_elapsed_ms})")
        print("=" * 80)
        return JSONResponse(
            status_code=500,
            content={
                "error": "An unexpected error occurred during payment verification.",
                "step": "unexpected_error",
                "details": str(error),
                "elapsed_ms": verification_elapsed_ms,
            },
        )


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

        explanation_mode_raw = data.get("explanation_mode", "")
        explanation_mode = str(explanation_mode_raw).strip().lower()

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

        config = _get_plan_config(plan_normalized)
        model = config["model"]
        detail_level = config["detail_level"]
        max_duration = config["max_duration"]
        max_tokens = config["max_tokens"]
        tier_prompt = config["tier_prompt"]

        # Enforce plan-based duration ceiling even if the client sends a higher value.
        try:
            duration_int = max(5, min(int(minutes), max_duration))
        except Exception:
            duration_int = 10

        explanation_mode_guidance = EXPLANATION_MODE_GUIDANCE.get(explanation_mode, "")

        system_prompt = f"{SYSTEM_PROMPT_BASE}\n\nPlan guidance: {tier_prompt}"
        if explanation_mode_guidance:
            system_prompt = f"{system_prompt}\n\nExplain Like mode guidance: {explanation_mode_guidance}"

        prompt = {
            "topic": topic,
            "session_length_minutes": duration_int,
            "detail_level": detail_level,
            "output_requirements": [
                "Use Markdown headings ## and ### only.",
                "Keep the 7 required sections in the exact order.",
                "Match depth to the session length.",
                "Stay on topic and do not invent unrelated modules.",
            ],
        }

        if explanation_mode:
            prompt["explanation_mode"] = explanation_mode

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": json.dumps(prompt, ensure_ascii=False, separators=(",", ":")),
                    },
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


@app.post("/generate-knowledge-pack")
async def generate_knowledge_pack(request: Request, data: dict):
    try:
        # Safe input handling.
        topic_raw = data.get("topic", "")
        topic = str(topic_raw).strip()

        content_raw = data.get("content", "")
        content = str(content_raw).strip()

        format_raw = data.get("format", "exam")
        note_format = str(format_raw).strip().lower() if format_raw else "exam"
        if note_format not in ["pdf", "exam", "markdown", "notion"]:
            note_format = "exam"

        plan_raw = data.get("plan", "free")
        plan_normalized = str(plan_raw).strip().lower() if plan_raw is not None else "free"
        if plan_normalized not in ["free", "pro", "elite"]:
            plan_normalized = "free"

        if not content:
            return {"error": "No session content provided"}

        # Generate knowledge pack based on format
        try:
            system_prompt = """You are a knowledge extraction specialist.
Convert the provided session content into structured notes.
Be concise, organized, and focus on key learnings.
Return only the formatted notes content."""

            if note_format == "exam":
                format_instruction = """Convert the session into HIGH-YIELD, PDF-READY exam notes.

STRICT STRUCTURE (FOLLOW EXACTLY):

# [TOPIC NAME] -- HIGH-YIELD EXAM NOTES

---

## 1. Key Concepts

- Only the most important ideas
- Keep each point short and precise

---

## 2. Important Definitions

- Clear, exam-ready definitions
- Easy to memorize
- No long paragraphs

---

## 3. Frequently Asked Questions

- Include questions most likely to appear in exams
- Focus on conceptual and theory-based questions

---

## 4. Short Answer Explanations

- 2-4 line answers
- Direct and to the point
- No unnecessary explanation

---

## 5. Quick Revision Sheet (MOST IMPORTANT)

- Ultra-condensed version of the topic
- Bullet points only
- Designed for 1-2 minute revision

---

## 6. High Probability Topics

- Identify what is most likely to be asked
- Focus only on important areas

---

## 7. Common Mistakes

- List mistakes students commonly make
- Keep each point short and actionable

---

## 8. Memory Triggers

- Add short memory cues
- Keep them simple and easy to recall

---

## 9. 30-Second Strategy (VERY IMPORTANT)

- Give a quick decision-making approach
- Help user identify how to solve questions fast

---

## 10. Where This Appears

- List common problem patterns or use-cases
- Help user recognize the concept in exams

---

STRICT FORMATTING RULES (NON-NEGOTIABLE):

1. Use ONLY standard ASCII characters
- Use <=, >= instead of special symbols
- Use -> instead of arrows
- DO NOT use fancy quotes or symbols

2. Avoid broken characters or encoding artifacts

3. Keep formatting CLEAN
- Proper spacing between sections
- Consistent bullet points
- No random line breaks

4. Keep content SCANNABLE
- Short lines
- No large paragraphs

5. No repetition

6. Do NOT over-explain

PDF OPTIMIZATION:
- Output must look clean when converted to PDF
- Avoid special characters that break rendering
- Keep alignment consistent

GOAL:
This should feel like a last-minute revision cheat sheet that a student can confidently use just before entering an exam."""
            elif note_format == "markdown":
                format_instruction = """Convert the session content into structured notes.

FORMAT:
## Topic Overview
## Key Concepts
- Bullet points
## Important Explanations
## Examples (if applicable)
## Summary

Keep it clean, structured, and easy to revise.
Return valid Markdown only."""
            elif note_format == "notion":
                format_instruction = """Convert the session content into structured notes for Notion.

FORMAT:
# Topic Overview
# Key Concepts
- Bullet points
# Important Explanations
# Examples (if applicable)
# Summary

Keep it clean, structured, and easy to revise.
Use headings and bullets only. Avoid raw/unformatted text."""
            else:  # PDF
                format_instruction = """Convert the session content into structured notes for PDF export.

FORMAT:
Topic Overview
Key Concepts (bullet points)
Important Explanations
Examples (if applicable)
Summary

Keep it clean, structured, and easy to revise."""

            prompt = {
                "topic": topic,
                "session_content": content,
                "format": note_format,
                "instruction": format_instruction,
            }

            response = client.chat.completions.create(
                model="gpt-4o-mini" if plan_normalized == "free" else "gpt-4.1",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": json.dumps(prompt, ensure_ascii=False, separators=(",", ":")),
                    },
                ],
                temperature=0.7,
                max_tokens=2000,
            )

            notes = response.choices[0].message.content.strip()
            return {"notes": notes}

        except Exception as e:
            print("ERROR GENERATING KNOWLEDGE PACK:", str(e))
            return {"error": "Failed to generate notes", "details": str(e)}

    except Exception as e:
        print("UNEXPECTED ERROR IN KNOWLEDGE PACK:", str(e))
        return {"error": "Internal error", "details": str(e)}


# LAN / mobile: run with
#   uvicorn main:app --host 0.0.0.0 --port 8000
