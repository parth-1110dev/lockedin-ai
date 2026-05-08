import json
import os
import time
import traceback
from urllib import error as urllib_error
from urllib import request as urllib_request

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openai import OpenAI
from razorpay_config import get_razorpay_client as _get_razorpay_client

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


# Simple in-memory rate limit: max requests per IP per rolling 60s window.
RATE_LIMIT_WINDOW_SEC = 60.0
RATE_LIMIT_MAX_PER_WINDOW = 10
# ip -> (window_start_epoch, count_in_window)
_rate_limit_buckets: dict[str, tuple[float, int]] = {}


def _get_plan_config(plan: str) -> dict[str, object]:
    return PLAN_CONFIGS.get(plan, PLAN_CONFIGS["free"])


def _normalize_paid_plan(plan: object) -> str:
    normalized = str(plan or "").strip().lower()
    if normalized in PLAN_PRICING_PAISE:
        return normalized
    return ""


def _update_user_plan_in_supabase(user_id: str, selected_plan: str) -> tuple[bool, str | None]:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return False, "Supabase service role credentials are not configured."

    endpoint = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_USERS_TABLE}?id=eq.{user_id}"
    body = json.dumps({"plan": selected_plan}).encode("utf-8")
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    request = urllib_request.Request(endpoint, data=body, headers=headers, method="PATCH")

    try:
        with urllib_request.urlopen(request, timeout=10) as response:
            response_payload = response.read().decode("utf-8", errors="ignore")
            if not response_payload:
                return False, "Supabase returned an empty response."

            parsed = json.loads(response_payload)
            if not parsed or not isinstance(parsed, list):
                return False, "Supabase returned an invalid response."

            updated_row = parsed[0] if parsed else {}
            updated_plan = str(updated_row.get("plan", "")).strip().lower()
            if not updated_plan:
                return False, "Updated plan was not returned by Supabase."

            return True, updated_plan
    except urllib_error.HTTPError as error:
        details = error.read().decode("utf-8", errors="ignore")
        message = details or str(error)
        return False, message
    except Exception as error:
        return False, str(error)


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
    try:
        plan = _normalize_paid_plan(data.get("selected_plan", data.get("plan", "")))
        if not plan:
            return JSONResponse(
                status_code=400,
                content={"error": "Only paid plans (pro, elite) can be verified."},
            )

        order_id = str(data.get("razorpay_order_id", "")).strip()
        payment_id = str(data.get("razorpay_payment_id", "")).strip()
        signature = str(data.get("razorpay_signature", "")).strip()
        user_id = str(data.get("user_id", "")).strip()

        if not order_id or not payment_id or not signature:
            return JSONResponse(
                status_code=400,
                content={"error": "Missing Razorpay payment details."},
            )

        client_data = _get_razorpay_client()
        razorpay_client, _ = client_data
        if razorpay_client is None:
            return JSONResponse(
                status_code=500,
                content={"error": "Razorpay keys are not configured on server."},
            )

        try:
            razorpay_client.utility.verify_payment_signature(
                {
                    "razorpay_order_id": order_id,
                    "razorpay_payment_id": payment_id,
                    "razorpay_signature": signature,
                }
            )
        except Exception as error:
            print("RAZORPAY SIGNATURE VERIFY ERROR:", str(error))
            return JSONResponse(
                status_code=400,
                content={"error": "Payment signature verification failed."},
            )

        updated, update_result = _update_user_plan_in_supabase(user_id, plan)
        if not updated:
            return JSONResponse(
                status_code=502,
                content={"error": "Payment verified, but plan update failed.", "details": update_result},
            )

        return {
            "verified": True,
            "updated_plan": update_result,
            "user_id": user_id,
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
        }
    except Exception as error:
        traceback.print_exc()
        print("VERIFY PAYMENT ERROR:", str(error))
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to verify Razorpay payment", "details": str(error)},
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
