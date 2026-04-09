const STORAGE_PLAN_KEY = "userPlan";

function setPlan(plan) {
  window.localStorage.setItem(STORAGE_PLAN_KEY, plan);
  // After selection, go back to time selection.
  window.location.href = "time-selection.html";
}

function getPlan() {
  const plan = window.localStorage.getItem(STORAGE_PLAN_KEY) || "free";
  const normalized = String(plan).trim().toLowerCase();
  if (normalized === "pro" || normalized === "elite" || normalized === "free") return normalized;
  return "free";
}

const freeCard = document.getElementById("planFree");
const proCard = document.getElementById("planPro");
const eliteCard = document.getElementById("planElite");

const freeCurrentBtn = document.getElementById("freeCurrentBtn");
const proUpgradeBtn = document.getElementById("proUpgradeBtn");
const eliteUpgradeBtn = document.getElementById("eliteUpgradeBtn");
const pricingBackBtn = document.getElementById("pricingBackBtn");

function applyActivePlan() {
  const plan = getPlan();

  [freeCard, proCard, eliteCard].forEach((card) => {
    if (card) card.classList.remove("active");
  });

  if (plan === "free" && freeCard) freeCard.classList.add("active");
  if (plan === "pro" && proCard) proCard.classList.add("active");
  if (plan === "elite" && eliteCard) eliteCard.classList.add("active");

  if (freeCurrentBtn) {
    if (plan === "free") {
      freeCurrentBtn.disabled = true;
      freeCurrentBtn.textContent = "Current Plan";
    } else {
      freeCurrentBtn.disabled = false;
      freeCurrentBtn.textContent = "Switch to Free";
      freeCurrentBtn.onclick = () => setPlan("free");
    }
  }

  if (proUpgradeBtn) {
    if (plan === "pro") {
      proUpgradeBtn.disabled = true;
      proUpgradeBtn.textContent = "Current Plan";
    } else {
      proUpgradeBtn.disabled = false;
      proUpgradeBtn.textContent = "Upgrade to Pro";
      proUpgradeBtn.onclick = () => setPlan("pro");
    }
  }

  if (eliteUpgradeBtn) {
    if (plan === "elite") {
      eliteUpgradeBtn.disabled = true;
      eliteUpgradeBtn.textContent = "Current Plan";
    } else {
      eliteUpgradeBtn.disabled = false;
      eliteUpgradeBtn.textContent = "Upgrade to Elite";
      eliteUpgradeBtn.onclick = () => setPlan("elite");
    }
  }
}

applyActivePlan();

if (pricingBackBtn) {
  pricingBackBtn.addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

