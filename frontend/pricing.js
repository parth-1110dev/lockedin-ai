const STORAGE_PLAN_KEY = "userPlan";
const API_BASE =
  !window.location.hostname || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:8000"
    : `http://${window.location.hostname}:8000`;

const PLAN_CONFIG = {
  free: {
    label: "Free",
    currentText: "Current Plan",
    inactiveText: "Switch to Free",
  },
  pro: {
    label: "Pro",
    currentText: "Current Plan",
    inactiveText: "Upgrade to Pro",
  },
  elite: {
    label: "Elite",
    currentText: "Current Plan",
    inactiveText: "Upgrade to Elite",
  },
};

const CARD_IDS = {
  free: "planFree",
  pro: "planPro",
  elite: "planElite",
};

const BUTTON_IDS = {
  free: "freeCurrentBtn",
  pro: "proUpgradeBtn",
  elite: "eliteUpgradeBtn",
};

const pricingBackBtn = document.getElementById("pricingBackBtn");

let isProcessingCheckout = false;

function normalizePlan(plan) {
  const normalized = String(plan || "").trim().toLowerCase();
  if (normalized === "pro" || normalized === "elite" || normalized === "free") return normalized;
  return "free";
}

function getPlan() {
  return normalizePlan(window.localStorage.getItem(STORAGE_PLAN_KEY) || "free");
}

function setPlan(plan) {
  const normalized = normalizePlan(plan);
  window.localStorage.setItem(STORAGE_PLAN_KEY, normalized);
  window.location.href = "time-selection.html";
}

function getApiBase() {
  return API_BASE;
}

async function getCurrentUserId() {
  try {
    if (window.currentUser && window.currentUser.id) {
      return String(window.currentUser.id).trim();
    }

    const supabaseModule = await import("./supabase.js");
    const supabase = supabaseModule.default;
    const { data } = await supabase.auth.getSession();
    return String(data?.session?.user?.id || "").trim();
  } catch (_error) {
    return "";
  }
}

async function getUpdatedUserPlan(userId) {
  if (!userId) return "";

  try {
    const supabaseModule = await import("./supabase.js");
    const supabase = supabaseModule.default;
    const { data, error } = await supabase.from("users").select("plan").eq("id", userId).maybeSingle();
    if (error) return "";

    return normalizePlan(data && data.plan);
  } catch (_error) {
    return "";
  }
}

function applyUpdatedUserPlan(plan) {
  const normalizedPlan = normalizePlan(plan);
  window.localStorage.setItem(STORAGE_PLAN_KEY, normalizedPlan);
  window.currentUserPlan = normalizedPlan;
  applyActivePlan();
  window.dispatchEvent(new CustomEvent("userPlanUpdated", { detail: { plan: normalizedPlan } }));
}

function getCard(plan) {
  const cardId = CARD_IDS[plan];
  return cardId ? document.getElementById(cardId) : null;
}

function getButton(plan) {
  const buttonId = BUTTON_IDS[plan];
  return buttonId ? document.getElementById(buttonId) : null;
}

function setButtonBusy(button, busy) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent || "";
    }
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Processing...";
    return;
  }

  button.removeAttribute("aria-busy");
  if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

async function createOrder(plan) {
  const response = await window.fetch(`${getApiBase()}/create-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ plan }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error((payload && payload.error) || "Failed to create checkout order.");
  }

  if (!payload || !payload.order_id || !payload.amount || !payload.currency) {
    throw new Error("Invalid order response from server.");
  }

  return payload;
}

function applyActivePlan() {
  const plan = getPlan();

  Object.keys(CARD_IDS).forEach((key) => {
    const card = getCard(key);
    if (card) card.classList.toggle("active", key === plan);
  });

  Object.keys(BUTTON_IDS).forEach((key) => {
    const button = getButton(key);
    if (!button) return;

    if (key === plan) {
      button.disabled = true;
      button.textContent = PLAN_CONFIG[key].currentText;
      button.removeAttribute("aria-busy");
      return;
    }

    button.disabled = false;
    button.textContent = PLAN_CONFIG[key].inactiveText;
    button.removeAttribute("aria-busy");
  });
}

function getRazorpayKey() {
  const explicitKey = window.RAZORPAY_KEY_ID || window.RAZORPAY_PUBLIC_KEY || window.RAZORPAY_PUBLISHABLE_KEY || "";
  if (explicitKey) return String(explicitKey).trim();

  const host = window.location.hostname;
  if (!host || host === "localhost" || host === "127.0.0.1") {
    return "rzp_test_Sm5invB2a2uTH4";
  }

  return "rzp_live_Sm5XKbysbWdumY";
}

function getPrefilledEmail() {
  try {
    return (window.currentUser && window.currentUser.email) || "";
  } catch (_) {
    return "";
  }
}

function openCheckout(options) {
  if (typeof window.Razorpay !== "function") {
    throw new Error("Razorpay checkout is not available.");
  }

  const instance = new window.Razorpay(options);
  instance.open();
  return instance;
}

async function verifyPaymentWithBackend(plan, response) {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Please sign in before verifying this payment.");
  }

  const verificationResponse = await window.fetch(`${getApiBase()}/verify-payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_order_id: response.razorpay_order_id,
      razorpay_signature: response.razorpay_signature,
      selected_plan: plan,
      user_id: userId,
    }),
  });

  let payload = null;
  try {
    payload = await verificationResponse.json();
  } catch (_error) {
    payload = null;
  }

  if (!verificationResponse.ok) {
    throw new Error((payload && payload.error) || "Payment verification failed.");
  }

  if (!payload || !payload.verified) {
    throw new Error("Payment verification failed.");
  }

  const refreshedPlan = await getUpdatedUserPlan(userId);
  return {
    ...payload,
    refreshedPlan: refreshedPlan || payload.updated_plan || plan,
  };
}

async function startCheckout(plan) {
  const normalizedPlan = normalizePlan(plan);
  if (normalizedPlan === "free") {
    setPlan("free");
    return;
  }

  if (isProcessingCheckout) return;

  const button = getButton(normalizedPlan);
  isProcessingCheckout = true;
  setButtonBusy(button, true);

  try {
    const order = await createOrder(normalizedPlan);
    console.log("Order created:", order);

    const keyId = getRazorpayKey();
    if (!keyId) {
      throw new Error("Razorpay is not configured for this frontend.");
    }

    const prefillEmail = getPrefilledEmail();

    const checkout = openCheckout({
      key: keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.order_id,
      name: "LockedIn AI",
      description: `${PLAN_CONFIG[normalizedPlan].label} Plan Upgrade`,
      prefill: {
        email: prefillEmail,
      },
      theme: {
        color: "#ff4d6d",
      },
      modal: {
        escape: false,
        ondismiss: () => {
          console.log("Razorpay modal dismissed");
          isProcessingCheckout = false;
          setButtonBusy(button, false);
        },
      },
      handler: (response) => {
        (async () => {
          try {
            console.log("Payment successful:", response);
            const verification = await verifyPaymentWithBackend(normalizedPlan, response);
            applyUpdatedUserPlan(verification.refreshedPlan || normalizedPlan);
            window.alert("Plan upgraded successfully");
          } catch (error) {
            window.alert(error && error.message ? error.message : "Payment verification failed.");
          } finally {
            isProcessingCheckout = false;
            setButtonBusy(button, false);
          }
        })();
      },
    });

    if (checkout && typeof checkout.on === "function") {
      checkout.on("payment.failed", (response) => {
        console.log("Payment failed:", response);
        isProcessingCheckout = false;
        setButtonBusy(button, false);
        window.alert(`Payment failed: ${response.error.description}`);
      });
    }
  } catch (error) {
    isProcessingCheckout = false;
    setButtonBusy(button, false);
    window.alert(error && error.message ? error.message : "Unable to start checkout.");
  }
}

function wirePlanButtons() {
  Object.keys(BUTTON_IDS).forEach((plan) => {
    const button = getButton(plan);
    if (!button) return;

    button.addEventListener("click", () => {
      if (plan === getPlan()) {
        setPlan(plan);
        return;
      }

      startCheckout(plan);
    });
  });
}

applyActivePlan();
wirePlanButtons();

if (pricingBackBtn) {
  pricingBackBtn.addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

