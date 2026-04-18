const STORAGE_TOPIC_KEY = "lockedin_selected_topic";
const STORAGE_MINUTES_KEY = "lockedin_selected_minutes";
const STORAGE_EXPLANATION_MODE_KEY = "lockedin_explanation_mode";
const STORAGE_EXPLANATION_TOPIC_KEY = "lockedin_explanation_mode_topic";

const minMinutes = 5;
const stepMinutes = 5;

const minusBtn = document.getElementById("minusBtn");
const plusBtn = document.getElementById("plusBtn");
const timeValueEl = document.getElementById("timeValue");
const quickButtons = document.querySelectorAll(".quick-btn");
const explainButtons = document.querySelectorAll(".explain-btn");
const startSessionBtn = document.getElementById("startSessionBtn");
const changeTopicBtn = document.getElementById("changeTopicBtn");
const explainUpgradeModal = document.getElementById("explainUpgradeModal");
const explainUpgradeNowBtn = document.getElementById("explainUpgradeNowBtn");
const explainUpgradeCloseBtn = document.getElementById("explainUpgradeCloseBtn");

let minutes = 30;

function getPlanMinutes(planValue) {
  const normalized = String(planValue || "free").trim().toLowerCase();
  if (normalized === "pro") return 45;
  if (normalized === "elite") return 60;
  return 30;
}

function clamp(value, lower, upper) {
  return Math.max(lower, Math.min(upper, value));
}

const planRaw = window.localStorage.getItem("userPlan") || "free";
const plan = String(planRaw).trim().toLowerCase();
const normalizedPlan =
  plan === "pro" || plan === "elite" || plan === "free" ? plan : "free";

let maxMinutes = getPlanMinutes(normalizedPlan);
let selectedExplanationMode = null;

function isPremiumButton(btn) {
  return btn.getAttribute("data-premium") === "true";
}

function isFreeLockedButton(btn) {
  return normalizedPlan === "free" && isPremiumButton(btn);
}

function updatePremiumButtonStates() {
  explainButtons.forEach((btn) => {
    if (isPremiumButton(btn)) {
      const lockIcon = btn.querySelector(".lock-icon");
      const isFreeTier = normalizedPlan === "free";

      if (isFreeTier) {
        // Free users: show lock icon, disable interaction
        if (lockIcon) lockIcon.classList.remove("hidden");
        btn.classList.add("is-locked");
      } else {
        // Pro/Elite: hide lock icon, enable normal interaction
        if (lockIcon) lockIcon.classList.add("hidden");
        btn.classList.remove("is-locked");
      }
    }
  });
}

function openExplainUpgradeModal() {
  if (!explainUpgradeModal) {
    window.location.href = "pricing.html";
    return;
  }
  explainUpgradeModal.hidden = false;
  explainUpgradeModal.setAttribute("aria-hidden", "false");
}

function closeExplainUpgradeModal() {
  if (!explainUpgradeModal) return;
  explainUpgradeModal.hidden = true;
  explainUpgradeModal.setAttribute("aria-hidden", "true");
}

function persistExplanationModeForTopic(topic) {
  const normalizedTopic = String(topic || "").trim();
  if (selectedExplanationMode) {
    window.localStorage.setItem(STORAGE_EXPLANATION_MODE_KEY, selectedExplanationMode);
    window.localStorage.setItem(STORAGE_EXPLANATION_TOPIC_KEY, normalizedTopic);
  } else {
    window.localStorage.removeItem(STORAGE_EXPLANATION_MODE_KEY);
    window.localStorage.removeItem(STORAGE_EXPLANATION_TOPIC_KEY);
  }
}

function applyExplanationSelection(nextMode) {
  selectedExplanationMode = nextMode || null;

  explainButtons.forEach((btn) => {
    const mode = btn.getAttribute("data-mode");
    const isLocked = isFreeLockedButton(btn);
    
    // Prevent selection of locked buttons
    if (isLocked && selectedExplanationMode === mode) {
      selectedExplanationMode = null;
    }
    
    const selected = Boolean(selectedExplanationMode) && mode === selectedExplanationMode && !isLocked;
    btn.classList.toggle("is-selected", selected);
    btn.setAttribute("aria-checked", selected ? "true" : "false");
  });
}

function setupExplanationOptions() {
  const currentTopic = (window.localStorage.getItem(STORAGE_TOPIC_KEY) || "").trim();

  // Do not preselect any explanation mode on entry.
  window.localStorage.removeItem(STORAGE_EXPLANATION_MODE_KEY);
  window.localStorage.removeItem(STORAGE_EXPLANATION_TOPIC_KEY);

  explainButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const locked = isFreeLockedButton(btn);
      if (locked) {
        openExplainUpgradeModal();
        return;
      }

      const mode = btn.getAttribute("data-mode") || "";
      if (!mode) return;

      applyExplanationSelection(mode);
      persistExplanationModeForTopic(currentTopic);
    });
  });

  // Update premium button visibility based on plan
  updatePremiumButtonStates();

  applyExplanationSelection(null);
  persistExplanationModeForTopic(currentTopic);
}

function updateUpgradeUI() {
  const planValue = window.localStorage.getItem("userPlan") || "free";
  const p = String(planValue).trim().toLowerCase();
  const tier =
    p === "pro" || p === "elite" || p === "free" ? p : "free";

  const upgradeContainer = document.getElementById("upgradeContainer");
  const upgradeText = document.getElementById("upgradeText");
  const upgradeButton = document.getElementById("upgradeButton");

  if (!upgradeContainer || !upgradeText || !upgradeButton) return;

  const atMax = minutes >= maxMinutes;

  if (tier === "elite") {
    upgradeContainer.style.display = "none";
    upgradeText.style.display = "none";
    upgradeButton.style.display = "none";
    upgradeContainer.setAttribute("aria-hidden", "true");
    return;
  }

  if (tier === "free") {
    upgradeText.innerText = "Upgrade to Pro for longer sessions";
  } else if (tier === "pro") {
    upgradeText.innerText =
      "Upgrade to Elite for even longer sessions and better AI";
  }

  upgradeText.style.display = "";

  if (atMax) {
    upgradeContainer.style.display = "flex";
    upgradeButton.style.display = "";
    upgradeContainer.setAttribute("aria-hidden", "false");
  } else {
    upgradeContainer.style.display = "none";
    upgradeButton.style.display = "none";
    upgradeContainer.setAttribute("aria-hidden", "true");
  }
}

function setMinutes(next) {
  minutes = clamp(next, minMinutes, maxMinutes);
  timeValueEl.textContent = String(minutes);

  minusBtn.disabled = minutes <= minMinutes;
  plusBtn.disabled = minutes >= maxMinutes;
  updateUpgradeUI();
}

minusBtn.addEventListener("click", () => setMinutes(minutes - stepMinutes));
plusBtn.addEventListener("click", () => {
  if (minutes >= maxMinutes) return;
  setMinutes(minutes + stepMinutes);
});

quickButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const next = Number(btn.getAttribute("data-min") || "30");
    setMinutes(next);
  });
});

startSessionBtn.addEventListener("click", () => {
  if (startSessionBtn.disabled) return;

  const topic = (window.localStorage.getItem(STORAGE_TOPIC_KEY) || "").trim();
  if (!topic) {
    window.location.href = "index.html";
    return;
  }

  startSessionBtn.disabled = true;

  window.localStorage.setItem(STORAGE_TOPIC_KEY, topic);
  window.localStorage.setItem(
    STORAGE_MINUTES_KEY,
    String(clamp(minutes, minMinutes, maxMinutes))
  );

  if (selectedExplanationMode) {
    window.localStorage.setItem(STORAGE_EXPLANATION_MODE_KEY, selectedExplanationMode);
    window.localStorage.setItem(STORAGE_EXPLANATION_TOPIC_KEY, topic);
  } else {
    window.localStorage.removeItem(STORAGE_EXPLANATION_MODE_KEY);
    window.localStorage.removeItem(STORAGE_EXPLANATION_TOPIC_KEY);
  }

  window.location.href = "session.html";
});

minutes = maxMinutes;

setMinutes(minutes);

window.addEventListener("DOMContentLoaded", () => {
  updateUpgradeUI();
});

updateUpgradeUI();
setupExplanationOptions();

if (explainUpgradeNowBtn) {
  explainUpgradeNowBtn.addEventListener("click", () => {
    window.location.href = "pricing.html";
  });
}

if (explainUpgradeCloseBtn) {
  explainUpgradeCloseBtn.addEventListener("click", () => {
    closeExplainUpgradeModal();
  });
}

if (explainUpgradeModal) {
  explainUpgradeModal.addEventListener("click", (event) => {
    if (event.target === explainUpgradeModal) {
      closeExplainUpgradeModal();
    }
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeExplainUpgradeModal();
  }
});

const upgradeButtonEl = document.getElementById("upgradeButton");
if (upgradeButtonEl) {
  upgradeButtonEl.addEventListener("click", () => {
    window.location.href = "pricing.html";
  });
}

if (changeTopicBtn) {
  changeTopicBtn.addEventListener("click", () => {
    window.location.href = "index.html";
  });
}
