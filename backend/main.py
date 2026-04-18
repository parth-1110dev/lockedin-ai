import json
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

TONE: Combine the clarity of Pro with the directness of Elite. Prioritize action over explanation. Avoid long theoretical explanations unless necessary.
STYLE CONSTRAINTS: Avoid poetic or overly metaphorical writing. Avoid unnecessary analogies.
BALANCE RULE: Explanation + depth <= 40% of the response. Actionable content >= 60% of the response.
LENGTH CONTROL: Response should feel premium but not bloated. Target 1.3x-1.6x Pro length. Never exceed necessary detail.
OUTPUT RULE: Return structured output only.
PRIORITY: Avoid unnecessary elaboration.""",
    },
}


# Simple in-memory rate limit: max requests per IP per rolling 60s window.
RATE_LIMIT_WINDOW_SEC = 60.0
RATE_LIMIT_MAX_PER_WINDOW = 10
# ip -> (window_start_epoch, count_in_window)
_rate_limit_buckets: dict[str, tuple[float, int]] = {}


def _get_plan_config(plan: str) -> dict[str, object]:
    return PLAN_CONFIGS.get(plan, PLAN_CONFIGS["free"])


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

        explanation_mode_raw = data.get("explanation_mode", "")
        explanation_mode = str(explanation_mode_raw).strip()

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

        system_prompt = f"{SYSTEM_PROMPT_BASE}\n\nPlan guidance: {tier_prompt}"

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
                format_instruction = """Format the notes as EXAM-READY NOTES:

# Key Concepts (5-7 essential points)
- List main concepts in bullet format

# Definitions  
Define 5-10 key terms from the session

# Frequently Asked Questions
Provide 3-4 common Q&A pairs

# Short Answer Explanations
Brief explanations (2-3 sentences each) for complex topics

# Quick Revision Cheat Sheet
One-page summary in bullet format"""
            elif note_format == "markdown":
                format_instruction = """Format the notes in clean Markdown:
Use ## for sections
Use - for bullets
Use bold for emphasis
Keep it scannable and organized"""
            elif note_format == "notion":
                format_instruction = """Format the notes for Notion import:
Use # for main headings
Use - for nested bullets
Include metadata fields like:
- Topic: [insert]
- Date: [insert]
- Key Concepts: [list]"""
            else:  # PDF
                format_instruction = """Format the notes for PDF export:
Use clear hierarchical structure
Keep formatting simple
Use section breaks
Make it printable-friendly"""

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
