const STORAGE_TOPIC_KEY = "lockedin_selected_topic";
const STORAGE_MINUTES_KEY = "lockedin_selected_minutes";

const minMinutes = 5;
const stepMinutes = 5;

const minusBtn = document.getElementById("minusBtn");
const plusBtn = document.getElementById("plusBtn");
const timeValueEl = document.getElementById("timeValue");
const quickButtons = document.querySelectorAll(".quick-btn");
const startSessionBtn = document.getElementById("startSessionBtn");
const changeTopicBtn = document.getElementById("changeTopicBtn");

let minutes = 25;

function clamp(value, lower, upper) {
  return Math.max(lower, Math.min(upper, value));
}

const planRaw = window.localStorage.getItem("userPlan") || "free";
const plan = String(planRaw).trim().toLowerCase();
const normalizedPlan =
  plan === "pro" || plan === "elite" || plan === "free" ? plan : "free";

let maxMinutes = 30;
if (normalizedPlan === "pro") maxMinutes = 60;
if (normalizedPlan === "elite") maxMinutes = 90;

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
    const next = Number(btn.getAttribute("data-min") || "25");
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
  window.location.href = "session.html";
});

const minutesRaw = (window.localStorage.getItem(STORAGE_MINUTES_KEY) || "").trim();
const minutesParsed = Number.parseInt(minutesRaw, 10);

if (!Number.isNaN(minutesParsed)) {
  minutes = clamp(minutesParsed, minMinutes, maxMinutes);
}

setMinutes(minutes);

window.addEventListener("DOMContentLoaded", () => {
  updateUpgradeUI();
});

updateUpgradeUI();

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
