const STORAGE_TOPIC_KEY = "lockedin_selected_topic";
const STORAGE_PLAN_KEY = "userPlan";
const STORAGE_CLIENT_RATE_KEY = "lockedin_generate_rate_window";
const STORAGE_EXPLANATION_MODE_KEY = "lockedin_explanation_mode";
const STORAGE_EXPLANATION_TOPIC_KEY = "lockedin_explanation_mode_topic";
const STORAGE_SESSION_CONTENT_KEY = "lockedin_session_content";

const _host = window.location.hostname;
const API_BASE =
  !_host || _host === "localhost" || _host === "127.0.0.1"
    ? "http://127.0.0.1:8000"
    : `http://${_host}:8000`;

const minMinutes = 5;
const FREE_DAILY_SESSION_LIMIT = 5;

function getUserPlan() {
  const plan = window.localStorage.getItem(STORAGE_PLAN_KEY) || "free";
  const normalized = String(plan).trim().toLowerCase();
  if (normalized === "pro" || normalized === "elite" || normalized === "free") return normalized;
  return "free";
}

const motivationMessages = ["You're doing great", "Stay locked in", "Keep going"];

const timerDisplayEl = document.getElementById("timerDisplay");
const exitBtn = document.getElementById("exitBtn");
const topicDisplayEl = document.getElementById("topicDisplay");
const sessionContentEl = document.getElementById("session-content");

const sessionScreen = document.getElementById("sessionScreen");
const completeScreen = document.getElementById("completeScreen");

const motivationEl = document.getElementById("motivationText");

const starButtons = document.querySelectorAll(".star-btn");
const feedbackBox = document.getElementById("feedbackBox");
const homeBtn = document.getElementById("homeBtn");
const startNewBtn = document.getElementById("startNewBtn");
const continueBtn = document.getElementById("continueBtn");
const generateNotesBtn = document.getElementById("generateNotesBtn");
const knowledgePackModal = document.createElement("div");

let intervalId = null;
let motivationIntervalId = null;
let remainingSeconds = 0;
let completedSeconds = 0;
let rating = 0;

function clamp(value, lower, upper) {
  return Math.max(lower, Math.min(upper, value));
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${mm}:${ss}`;
}

function setMotivation(message) {
  if (!motivationEl) return;
  motivationEl.textContent = message;
}

function clearTimerIntervals() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  if (motivationIntervalId) {
    clearInterval(motivationIntervalId);
    motivationIntervalId = null;
  }
}

function clearCountdownInterval() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function resetSessionViewState() {
  if (sessionScreen) {
    sessionScreen.hidden = true;
    sessionScreen.setAttribute("aria-hidden", "true");
    if ("inert" in sessionScreen) {
      sessionScreen.inert = true;
    }
  }

  if (completeScreen) {
    completeScreen.hidden = false;
    completeScreen.removeAttribute("aria-hidden");
    completeScreen.style.pointerEvents = "auto";
    completeScreen.style.position = "relative";
    completeScreen.style.zIndex = "20";
    if ("inert" in completeScreen) {
      completeScreen.inert = false;
    }
  }

  if (startNewBtn) startNewBtn.disabled = false;
  if (continueBtn) continueBtn.disabled = false;
}

function showCompleteScreen() {
  if (remainingSeconds > 0) {
    completedSeconds = remainingSeconds;
  }
  clearTimerIntervals();

  document.body.classList.add("session--complete");

  // Normalize timer display when the session ends early or naturally.
  remainingSeconds = 0;
  if (timerDisplayEl) timerDisplayEl.textContent = formatTime(0);

  resetSessionViewState();

  renderCompletionUpgradeConversion();
}

function applyPlanAndGo(nextPlan) {
  window.localStorage.setItem(STORAGE_PLAN_KEY, nextPlan);
  window.location.href = "time-selection.html";
}

function renderCompletionUpgradeConversion() {
  if (!completeScreen) return;
  const completeCard = completeScreen.querySelector(".complete-card");
  if (!completeCard) return;

  // Remove previous conversion UI to avoid duplicates.
  const existing = completeCard.querySelector("#upgradeConversionSection");
  if (existing) existing.remove();

  const plan = getUserPlan();
  if (plan === "elite") return;

  const wrap = document.createElement("div");
  wrap.id = "upgradeConversionSection";
  wrap.className = "complete-upgrade-conversion";

  const titleEl = document.createElement("div");
  titleEl.className = "complete-upgrade-title";
  const textWrapEl = document.createElement("div");
  textWrapEl.className = "complete-upgrade-text";
  const introEl = document.createElement("p");
  const headingEl = document.createElement("p");
  const bulletsEl = document.createElement("ul");

  const bullet1El = document.createElement("li");
  const bullet2El = document.createElement("li");
  const bullet3El = document.createElement("li");

  const actionsEl = document.createElement("div");
  actionsEl.className = "complete-upgrade-actions";

  const completedMinutes = Math.max(1, Math.round(completedSeconds / 60));

  titleEl.textContent = `You just completed ${completedMinutes} minutes 🚀`;
  introEl.textContent = "You're building real consistency. Most people quit — you're not.";
  headingEl.textContent = "Unlock more with LockedIn Pro:";
  bullet1El.textContent = "Longer sessions";
  bullet2El.textContent = "Deeper AI explanations";
  bullet3El.textContent = "Better learning structure";

  bulletsEl.appendChild(bullet1El);
  bulletsEl.appendChild(bullet2El);
  bulletsEl.appendChild(bullet3El);

  textWrapEl.appendChild(introEl);
  textWrapEl.appendChild(headingEl);
  textWrapEl.appendChild(bulletsEl);

  let targetPlan = null;
  if (plan === "free") targetPlan = "pro";
  else if (plan === "pro") targetPlan = "elite";

  if (targetPlan) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.textContent = "Upgrade Now";
    btn.addEventListener("click", () => applyPlanAndGo(targetPlan));
    actionsEl.appendChild(btn);
  }

  wrap.appendChild(titleEl);
  wrap.appendChild(textWrapEl);
  wrap.appendChild(actionsEl);

  // Insert after the feedback textarea to keep layout stable.
  if (feedbackBox) {
    feedbackBox.insertAdjacentElement("afterend", wrap);
  } else {
    completeCard.appendChild(wrap);
  }
}

function startTimer() {
  if (!timerDisplayEl) return;

  clearCountdownInterval();
  timerDisplayEl.textContent = formatTime(remainingSeconds);

  if (remainingSeconds <= 0) {
    showCompleteScreen();
    return;
  }

  intervalId = window.setInterval(() => {
    remainingSeconds = Math.max(0, remainingSeconds - 1);
    timerDisplayEl.textContent = formatTime(remainingSeconds);

    if (remainingSeconds <= 0) {
      clearTimerIntervals();
      showCompleteScreen();
    }
  }, 1000);
}

function startMotivation() {
  const rotateMs = 13000;
  let idx = 0;

  setMotivation(motivationMessages[idx % motivationMessages.length]);

  motivationIntervalId = window.setInterval(() => {
    idx += 1;
    const next = motivationMessages[idx % motivationMessages.length];
    setMotivation(next);
  }, rotateMs);
}

function setRating(nextRating) {
  rating = nextRating;

  starButtons.forEach((btn) => {
    const value = Number(btn.getAttribute("data-value") || "0");
    const active = value <= rating;
    btn.classList.toggle("star-active", active);
  });
}

function initStars() {
  starButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = Number(btn.getAttribute("data-value") || "0");
      setRating(value);
    });
  });
}

function initNavigation() {
  if (exitBtn) {
    exitBtn.addEventListener("click", () => {
      // Exit immediately ends the session and shows the complete screen.
      showCompleteScreen();
    });
  }

  if (homeBtn) {
    homeBtn.addEventListener("click", () => {
      const isFileContext = window.location.protocol === "file:";
      const target = isFileContext ? "./index.html" : "/";
      window.open(target, "_self");
    });
  }

  if (startNewBtn) {
    startNewBtn.addEventListener("click", () => {
      window.location.href = "time-selection.html";
    });
  }

  if (continueBtn) {
    continueBtn.addEventListener("click", () => {
      window.location.href = "index.html";
    });
  }

  if (generateNotesBtn) {
    generateNotesBtn.addEventListener("click", handleGenerateNotes);
  }
}

function openPricing() {
  window.location.href = "pricing.html";
}

function setupKnowledgePackModal() {
  knowledgePackModal.id = "kpUpgradeModal";
  knowledgePackModal.className = "modal-overlay";
  knowledgePackModal.setAttribute("aria-hidden", "true");
  knowledgePackModal.setAttribute("role", "dialog");
  knowledgePackModal.setAttribute("aria-modal", "true");
  knowledgePackModal.setAttribute("aria-labelledby", "kpUpgradeTitle");

  knowledgePackModal.innerHTML = `
    <div class="modal-card">
      <h2 id="kpUpgradeTitle">Unlock Knowledge Pack Generator</h2>
      <p>
        Convert your session into structured notes and revision sheets with Pro or Elite plans.
      </p>
      <div class="modal-actions">
        <button id="kpUpgradeNowBtn" class="btn btn-primary" type="button">Upgrade</button>
        <button id="kpUpgradeCloseBtn" class="btn btn-outline" type="button">Not Now</button>
      </div>
    </div>
  `;

  document.body.appendChild(knowledgePackModal);

  const upgradeNowBtn = document.getElementById("kpUpgradeNowBtn");
  const upgradeCloseBtn = document.getElementById("kpUpgradeCloseBtn");

  if (upgradeNowBtn) {
    upgradeNowBtn.addEventListener("click", () => {
      window.location.href = "pricing.html";
    });
  }

  if (upgradeCloseBtn) {
    upgradeCloseBtn.addEventListener("click", () => {
      closeKnowledgePackModal();
    });
  }

  knowledgePackModal.addEventListener("click", (event) => {
    if (event.target === knowledgePackModal) {
      closeKnowledgePackModal();
    }
  });
}

function openKnowledgePackModal() {
  knowledgePackModal.removeAttribute("aria-hidden");
  knowledgePackModal.style.display = "flex";
}

function closeKnowledgePackModal() {
  knowledgePackModal.setAttribute("aria-hidden", "true");
  knowledgePackModal.style.display = "none";
}

function handleGenerateNotes() {
  const plan = getUserPlan();

  if (plan === "free") {
    openKnowledgePackModal();
    return;
  }

  // Pro or Elite: navigate to knowledge pack page
  window.location.href = "knowledge-pack.html";
}

function clearSessionContent() {
  if (!sessionContentEl) return;
  sessionContentEl.innerHTML = "";
}

function resetSessionContentLayout() {
  if (!sessionContentEl) return;
  sessionContentEl.style.display = "block";
  sessionContentEl.style.flexDirection = "";
  sessionContentEl.style.alignItems = "";
  sessionContentEl.style.justifyContent = "";
  sessionContentEl.style.gap = "";
  sessionContentEl.classList.add("session-content");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyInlineBold(escapedText) {
  return escapedText.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/**
 * Lightweight markdown → HTML (headings, lists, bold). Input is escaped first.
 */
function markdownToHtml(markdown) {
  const escaped = escapeHtml(markdown);
  const lines = escaped.split(/\r?\n/);
  const parts = [];
  let inList = false;

  function closeList() {
    if (inList) {
      parts.push("</ul>");
      inList = false;
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed === "") {
      closeList();
      continue;
    }

    if (/^####\s+/.test(trimmed)) {
      closeList();
      const t = applyInlineBold(trimmed.replace(/^####\s+/, ""));
      parts.push(`<h4 class="session-subheading">${t}</h4>`);
      continue;
    }
    if (/^###\s+/.test(trimmed)) {
      closeList();
      const t = applyInlineBold(trimmed.replace(/^###\s+/, ""));
      parts.push(`<h3>${t}</h3>`);
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      closeList();
      const t = applyInlineBold(trimmed.replace(/^##\s+/, ""));
      parts.push(`<h2>${t}</h2>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) {
        parts.push("<ul>");
        inList = true;
      }
      const item = applyInlineBold(trimmed.replace(/^[-*]\s+/, ""));
      parts.push(`<li>${item}</li>`);
      continue;
    }

    closeList();
    parts.push(`<p>${applyInlineBold(trimmed)}</p>`);
  }

  closeList();
  return parts.join("");
}

function renderSessionMarkdown(markdown) {
  if (!sessionContentEl) return;
  clearSessionContent();
  resetSessionContentLayout();
  sessionContentEl.innerHTML = markdownToHtml(markdown);

  // Store session content for knowledge pack generation
  window.localStorage.setItem(STORAGE_SESSION_CONTENT_KEY, markdown);
}

function renderSessionPlainText(
  text,
  { textAlign = "left", skipLayoutReset = false } = {}
) {
  if (!sessionContentEl) return;
  clearSessionContent();
  if (!skipLayoutReset) {
    resetSessionContentLayout();
  }

  const textEl = document.createElement("div");
  textEl.className = "session-content-plain";
  textEl.textContent = String(text);
  textEl.style.whiteSpace = "pre-wrap";
  textEl.style.lineHeight = "1.6";
  textEl.style.fontSize = "16px";
  textEl.style.textAlign = textAlign;
  textEl.style.color = "#ffffff";

  sessionContentEl.appendChild(textEl);
}

function renderSessionMessageWithUpgrade(message, upgradeLabel) {
  if (!sessionContentEl) return;
  clearSessionContent();
  sessionContentEl.classList.add("session-content");

  sessionContentEl.style.display = "flex";
  sessionContentEl.style.flexDirection = "column";
  sessionContentEl.style.alignItems = "center";
  sessionContentEl.style.justifyContent = "center";
  sessionContentEl.style.gap = "14px";

  renderSessionPlainText(message, { textAlign: "center", skipLayoutReset: true });

  const buttonEl = document.createElement("button");
  buttonEl.type = "button";
  buttonEl.className = "btn btn-outline";
  buttonEl.textContent = upgradeLabel;
  buttonEl.addEventListener("click", openPricing);
  buttonEl.style.alignSelf = "center";

  sessionContentEl.appendChild(buttonEl);
}

function getPlanMaxMinutes(plan) {
  if (plan === "free") return 30;
  if (plan === "pro") return 45;
  if (plan === "elite") return 60;
  return 30;
}

function getPlanSessionMinutes(plan) {
  return getPlanMaxMinutes(plan);
}

function getTodayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getFreeSessionsUsedToday() {
  const todayKey = getTodayKey();
  const counterKey = `lockedin_free_sessions_${todayKey}`;
  const valueRaw = window.localStorage.getItem(counterKey) || "0";
  const value = Number.parseInt(valueRaw, 10);
  return Number.isNaN(value) ? 0 : value;
}

function incrementFreeSessionsUsedToday() {
  const todayKey = getTodayKey();
  const counterKey = `lockedin_free_sessions_${todayKey}`;
  const next = getFreeSessionsUsedToday() + 1;
  window.localStorage.setItem(counterKey, String(next));
}

const CLIENT_RATE_WINDOW_MS = 60_000;
const CLIENT_RATE_MAX = 10;

function readClientRateState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_CLIENT_RATE_KEY);
    if (!raw) return { windowStart: 0, count: 0 };
    const parsed = JSON.parse(raw);
    const windowStart = Number(parsed.windowStart) || 0;
    const count = Number(parsed.count) || 0;
    return { windowStart, count };
  } catch (_e) {
    return { windowStart: 0, count: 0 };
  }
}

function writeClientRateState(windowStart, count) {
  window.localStorage.setItem(
    STORAGE_CLIENT_RATE_KEY,
    JSON.stringify({ windowStart, count })
  );
}

function clientRateAllowAndRecord() {
  const now = Date.now();
  let { windowStart, count } = readClientRateState();
  if (!windowStart || now - windowStart >= CLIENT_RATE_WINDOW_MS) {
    windowStart = now;
    count = 0;
  }
  if (count >= CLIENT_RATE_MAX) {
    return false;
  }
  count += 1;
  writeClientRateState(windowStart, count);
  return true;
}

let generateRequestInFlight = false;

async function fetchAiSessionContent(topic, minutes, plan, explanationMode) {
  if (generateRequestInFlight) {
    return;
  }

  if (!clientRateAllowAndRecord()) {
    renderSessionPlainText(
      "You're making requests too quickly. Please wait a moment.",
      { textAlign: "center" }
    );
    return;
  }

  generateRequestInFlight = true;
  renderSessionPlainText("Generating your session...", { textAlign: "center" });

  try {
    const payload = {
      topic,
      duration: minutes,
      plan,
    };

    if (explanationMode) {
      payload.explanation_mode = explanationMode;
    }

    const response = await window.fetch(`${API_BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (data.error || response.status === 429) {
      renderSessionPlainText(
        "You're making requests too quickly. Please wait a moment.",
        { textAlign: "center" }
      );
      return;
    }

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const content = typeof data?.content === "string" ? data.content.trim() : "";
    if (!content || content.startsWith("Error occurred:")) {
      throw new Error("Backend returned an error payload");
    }

    if (plan === "free") {
      incrementFreeSessionsUsedToday();
    }

    renderSessionMarkdown(content);
  } catch (_error) {
    renderSessionPlainText("Something went wrong. Please try again.", {
      textAlign: "center",
    });
  } finally {
    generateRequestInFlight = false;
  }
}

// Init: read saved topic/time from previous page.
function initFromStorage() {
  const plan = getUserPlan();
  const selectedTopic = window.localStorage.getItem(STORAGE_TOPIC_KEY) || "";
  const explanationTopic = (window.localStorage.getItem(STORAGE_EXPLANATION_TOPIC_KEY) || "").trim();
  const savedExplanationMode = (window.localStorage.getItem(STORAGE_EXPLANATION_MODE_KEY) || "").trim();
  const explanationMode = explanationTopic && explanationTopic === selectedTopic.trim()
    ? savedExplanationMode
    : "";
  const planMaxMinutes = getPlanMaxMinutes(plan);
  const requestedMinutes = getPlanSessionMinutes(plan);

  // FREE plan: block attempts > 30 minutes (even if a previous plan stored a higher value).
  if (plan === "free" && requestedMinutes > planMaxMinutes) {
    remainingSeconds = 0;
    if (timerDisplayEl) timerDisplayEl.textContent = formatTime(0);
    renderSessionMessageWithUpgrade("Unlock longer sessions with Pro", "Upgrade");
    return false;
  }

  const safeMinutes = clamp(requestedMinutes, minMinutes, planMaxMinutes);

  remainingSeconds = safeMinutes * 60;
  completedSeconds = remainingSeconds;

  document.body.classList.remove("session--complete");

  if (topicDisplayEl) topicDisplayEl.textContent = selectedTopic || "your topic";

  // Free tier enforcement: max 5 sessions/day.
  if (plan === "free" && getFreeSessionsUsedToday() >= FREE_DAILY_SESSION_LIMIT) {
    remainingSeconds = 0;
    if (timerDisplayEl) timerDisplayEl.textContent = formatTime(0);
    renderSessionMessageWithUpgrade(
      "You’ve reached your daily limit.\nUpgrade to continue your progress.",
      "Upgrade Now"
    );
    return false;
  }

  fetchAiSessionContent(selectedTopic, safeMinutes, plan, explanationMode);
  return true;
}

function shouldOpenFeedbackViewFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") === "feedback";
}

function initFeedbackView() {
  clearTimerIntervals();
  remainingSeconds = 0;
  completedSeconds = 0;
  if (timerDisplayEl) timerDisplayEl.textContent = formatTime(0);
  document.body.classList.add("session--complete");
  resetSessionViewState();
  renderCompletionUpgradeConversion();
}

const forceFeedbackView = shouldOpenFeedbackViewFromQuery();
const sessionAllowed = forceFeedbackView ? false : initFromStorage();
initStars();
initNavigation();
setupKnowledgePackModal();

if (forceFeedbackView) {
  initFeedbackView();
}

window.addEventListener("beforeunload", clearTimerIntervals);

if (sessionAllowed) {
  startMotivation();
  startTimer();
}

// Optional: if user leaves feedback, store it for later sessions (non-blocking).
if (feedbackBox) {
  feedbackBox.addEventListener("input", () => {
    // Keep it simple: store latest draft only.
    window.localStorage.setItem("lockedin_last_feedback", feedbackBox.value);
  });
}

