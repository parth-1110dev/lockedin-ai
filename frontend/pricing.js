const API_BASE =
  !window.location.hostname ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:8000"
    : "https://lockedin-ai.onrender.com";

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
const checkoutBackdrop = document.getElementById("checkoutBackdrop");
const checkoutLockTargets = [document.querySelector(".nav"), document.querySelector(".page")].filter(Boolean);

let isProcessingCheckout = false;
let checkoutScrollY = 0;
let checkoutTargetsState = [];

function getPlanState() {
  return window.LockedInPlanState || null;
}

function isMobileScreen() {
  return window.innerWidth <= 768;
}

function normalizePlan(plan) {
  const normalized = String(plan || "").trim().toLowerCase();
  if (normalized === "pro" || normalized === "elite" || normalized === "free") return normalized;
  return "free";
}

function getPlan() {
  const planState = getPlanState();
  if (planState && typeof planState.getPlan === "function") {
    return normalizePlan(planState.getPlan());
  }

  return normalizePlan(window.currentUserPlan || "free");
}

function setPlan(plan) {
  window.location.href = "time-selection.html";
}

function setActivePricingPlan(plan) {
  const normalizedPlan = normalizePlan(plan);
  const planState = getPlanState();

  if (planState && typeof planState.setPlan === "function") {
    planState.setPlan(normalizedPlan, { source: "pricing", broadcast: true });
  } else {
    window.currentUserPlan = normalizedPlan;
    window.dispatchEvent(new CustomEvent("userPlanUpdated", { detail: { plan: normalizedPlan, source: "pricing" } }));
  }

  return normalizedPlan;
}

function getApiBase() {
  return API_BASE;
}

async function getCurrentUserId() {
  try {
    if (window.currentUser && window.currentUser.id) {
      try {
        const authModule = await import("./auth.js");
        await authModule.syncSupabaseUserRecord(window.currentUser, "pricing_current_user")
      } catch (_syncError) {
        // continue with the cached auth user id
      }
      return String(window.currentUser.id).trim();
    }

    const supabaseModule = await import("./supabase.js");
    const supabase = supabaseModule.default;
    const { data } = await supabase.auth.getSession();
    const sessionUser = data?.session?.user || null;
    if (sessionUser && sessionUser.id) {
      try {
        const authModule = await import("./auth.js");
        await authModule.syncSupabaseUserRecord(sessionUser, "pricing_session_user")
      } catch (_syncError) {
        // continue with the session user id
      }
    }
    return String(sessionUser?.id || "").trim();
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

async function applyUpdatedUserPlan(plan) {
  const normalizedPlan = setActivePricingPlan(plan);
  applyActivePlan();

  try {
    // Persist previously owned paid plans locally and (best-effort) in auth metadata
    if (normalizedPlan === 'pro' || normalizedPlan === 'elite') {
      const userId = await getCurrentUserId();
      if (userId) await savePreviouslyOwnedPlan(userId, normalizedPlan);
    }
  } catch (_e) {
    // ignore
  }

  try {
    await clearTemporarySessionState();
  } catch (_e) {
    // ignore
  }

  // NOTE: Do NOT perform navigation here. Caller should handle redirects explicitly
}

async function updateUserPlanInBackend(plan) {
  const normalizedPlan = normalizePlan(plan);
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Please sign in before changing your plan.");
  }

  const supabaseModule = await import('./supabase.js');
  const supabase = supabaseModule.default;
  const { error } = await supabase.from('users').update({ plan: normalizedPlan }).eq('id', userId);
  if (error) {
    throw error;
  }

  return normalizedPlan;
}

window.addEventListener("userPlanUpdated", () => {
  applyActivePlan();
});

async function clearTemporarySessionState() {
  try {
    window.localStorage.removeItem('lockedin_selected_topic');
    window.localStorage.removeItem('lockedin_selected_minutes');
    window.localStorage.removeItem('lockedin_explanation_mode');
    window.localStorage.removeItem('lockedin_explanation_mode_topic');
  } catch (_e) {
    // ignore
  }
}

async function savePreviouslyOwnedPlan(userId, plan) {
  if (!userId) return;
  try {
    const supabaseModule = await import('./supabase.js');
    const supabase = supabaseModule.default;

    // Try to read auth user metadata first
    try {
      const { data: authUser } = await supabase.auth.getUser();
      const metadata = authUser?.user?.user_metadata || {};
      const existing = Array.isArray(metadata.previous_plans) ? metadata.previous_plans.slice() : [];
      if (!existing.includes(plan)) existing.push(plan);
      await supabase.auth.updateUser({ data: { previous_plans: existing } });
    } catch (_metadataErr) {
      // ignore metadata update failures
    }

    // Also store a local copy keyed by user id for quick access
    try {
      const key = `ownedPlans_${String(userId).trim()}`;
      const raw = window.localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      if (!arr.includes(plan)) arr.push(plan);
      window.localStorage.setItem(key, JSON.stringify(arr));
    } catch (_e) {
      // ignore
    }
  } catch (_err) {
    // ignore
  }
}

async function getPreviouslyOwnedPlans(userId) {
  if (!userId) return [];
  try {
    const supabaseModule = await import('./supabase.js');
    const supabase = supabaseModule.default;

    // Try auth metadata
    try {
      const { data: authUser } = await supabase.auth.getUser();
      const metadata = authUser?.user?.user_metadata || {};
      if (Array.isArray(metadata.previous_plans)) return metadata.previous_plans.slice();
    } catch (_e) {
      // ignore
    }

    // Fallback to localStorage
    try {
      const key = `ownedPlans_${String(userId).trim()}`;
      const raw = window.localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (_e) {
      // ignore
    }
  } catch (_err) {
    // ignore
  }

  return [];
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

function lockCheckoutScroll() {
  checkoutScrollY = window.scrollY || window.pageYOffset || 0;
  checkoutTargetsState = checkoutLockTargets.map((element) => ({
    element,
    inert: element.inert,
    ariaHidden: element.getAttribute("aria-hidden"),
  }));

  checkoutLockTargets.forEach((element) => {
    element.inert = true;
    element.setAttribute("aria-hidden", "true");
  });

  document.body.classList.add("payment-open");
  document.documentElement.classList.add("payment-open");
  document.body.style.top = `-${checkoutScrollY}px`;

  if (checkoutBackdrop) {
    checkoutBackdrop.hidden = false;
    requestAnimationFrame(() => {
      checkoutBackdrop.classList.add("is-visible");
    });
  }
}

function unlockCheckoutScroll() {
  checkoutTargetsState.forEach(({ element, inert, ariaHidden }) => {
    element.inert = inert;

    if (ariaHidden === null) {
      element.removeAttribute("aria-hidden");
    } else {
      element.setAttribute("aria-hidden", ariaHidden);
    }
  });
  checkoutTargetsState = [];

  document.body.classList.remove("payment-open");
  document.documentElement.classList.remove("payment-open");
  document.body.style.top = "";

  if (checkoutBackdrop) {
    checkoutBackdrop.classList.remove("is-visible");
    checkoutBackdrop.hidden = true;
  }
  
  // Restore scroll position on next frame to ensure DOM is updated
  requestAnimationFrame(() => {
    window.scrollTo(0, checkoutScrollY);
    checkoutScrollY = 0;
  });
}

function resetCheckoutUi(button) {
  isProcessingCheckout = false;
  setButtonBusy(button, false);
  unlockCheckoutScroll();
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

  return "rzp_test_Sm5invB2a2uTH4";
}

function getPrefilledEmail() {
  try {
    return (window.currentUser && window.currentUser.email) || "";
  } catch (_) {
    return "";
  }
}

function waitForScrollToSettle(timeoutMs = 700) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const settleDelayMs = 120;
    let settleTimer = null;
    let timeoutTimer = null;

    const cleanup = () => {
      window.removeEventListener("scroll", handleScroll);

      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }

      if (timeoutTimer !== null) {
        window.clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const finish = () => {
      cleanup();
      resolve();
    };

    const checkScrollPosition = () => {
      const currentY = window.scrollY || window.pageYOffset || 0;

      if (currentY <= 1) {
        finish();
        return;
      }

      if (Date.now() - startTime >= timeoutMs) {
        finish();
        return;
      }

      settleTimer = window.setTimeout(checkScrollPosition, settleDelayMs);
    };

    const handleScroll = () => {
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }

      settleTimer = window.setTimeout(checkScrollPosition, settleDelayMs);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    timeoutTimer = window.setTimeout(finish, timeoutMs);
    checkScrollPosition();
  });
}

async function scrollToTopAndWait() {
  window.scrollTo({ top: 0, behavior: "smooth" });
  await waitForScrollToSettle();
}

function openCheckout(options) {
  if (typeof window.Razorpay !== "function") {
    throw new Error("Razorpay checkout is not available.");
  }

  console.log("WINDOW RAZORPAY:", window.Razorpay);
  console.log("RAZORPAY OPTIONS:", options);
  const instance = new window.Razorpay(options);
  instance.open();
  return instance;
}

async function verifyPaymentWithBackend(plan, response) {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Please sign in before verifying this payment.");
  }

  console.log("[VERIFY PAYMENT] Starting backend verification - user_id:", userId, "plan:", plan);
  
  let verificationResponse;
  try {
    verificationResponse = await window.fetch(`${getApiBase()}/verify-payment`, {
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
  } catch (fetchError) {
    console.error("[VERIFY PAYMENT] Network error during fetch:", fetchError);
    throw new Error(
      "Network error while verifying payment. Your payment may have been processed. Please refresh the page to check your plan status."
    );
  }

  let payload = null;
  try {
    payload = await verificationResponse.json();
  } catch (parseError) {
    console.error("[VERIFY PAYMENT] Failed to parse response:", parseError);
    console.error("[VERIFY PAYMENT] Response status:", verificationResponse.status);
    throw new Error(
      "Server returned an invalid response. Your payment may have been processed. Please refresh the page to check your plan status."
    );
  }

  console.log("[VERIFY PAYMENT] Backend response received - status:", verificationResponse.status, "payload:", payload);

  // CRITICAL: Backend must confirm database update succeeded
  if (!verificationResponse.ok) {
    const serverError = payload && (payload.error || payload.details);
    const step = payload && payload.step;
    
    console.error("[VERIFY PAYMENT] Backend verification FAILED - step:", step, "error:", serverError);
    
    // Different error messages based on which step failed
    if (step === "razorpay_signature") {
      // Payment signature failed - Razorpay rejected it
      throw new Error(
        serverError || "Payment signature verification failed. Your payment was not processed."
      );
    } else if (step === "user_validation") {
      // User not authenticated
      throw new Error("Your session has expired. Please sign in and try again.");
    } else if (step === "database_update" || step === "plan_update") {
      // Payment succeeded but database update failed - THIS IS THE CRITICAL CASE
      throw new Error(
        "Payment processed but we couldn't update your plan. Your payment is safe and will be refunded or credited. Please contact support with payment ID: " +
          (payload.razorpay_payment_id || response.razorpay_payment_id)
      );
    } else {
      // Other errors
      throw new Error(
        (serverError || "Payment verification failed") +
        " Please refresh the page to check your plan status, or contact support."
      );
    }
  }

  // CRITICAL: Validate the success response structure
  if (!payload || !payload.verified || !payload.success) {
    console.error("[VERIFY PAYMENT] Invalid success response structure:", payload);
    throw new Error(
      "Payment verification returned invalid response. Your payment may have been processed. Please refresh the page to check your plan status."
    );
  }

  // CRITICAL: Validate the backend actually updated the plan
  if (!payload.updated_plan) {
    console.error("[VERIFY PAYMENT] Backend response missing updated_plan:", payload);
    throw new Error(
      "Payment succeeded but plan was not updated in response. Your payment is safe. Please refresh the page to check your plan status."
    );
  }

  console.log(
    "[VERIFY PAYMENT] BACKEND CONFIRMATION SUCCESSFUL ✓ - updated_plan:",
    payload.updated_plan,
    "elapsed_ms:",
    payload.elapsed_ms
  );

  return {
    ...payload,
    refreshedPlan: payload.updated_plan || plan,
  };
}

async function startCheckout(plan) {
  const normalizedPlan = normalizePlan(plan);
  if (normalizedPlan === "free") {
    // switching to free is an immediate switch — treat as successful switch
    await updateUserPlanInBackend('free');
    await applyUpdatedUserPlan('free');
    // clear any temporary session state and navigate home
    await clearTemporarySessionState();
    window.location.href = 'index.html';
    return;
  }

  if (isProcessingCheckout) {
    console.log("[CHECKOUT] Checkout already in progress, ignoring duplicate request");
    return;
  }

  const button = getButton(normalizedPlan);
  isProcessingCheckout = true;
  setButtonBusy(button, true);

  // SAFETY: prevent guests from initiating paid checkouts. Require authenticated user.
  try {
    const currentUserId = await getCurrentUserId();
    if (!currentUserId) {
      // Reset UI and show friendly prompt before redirecting to auth.
      resetCheckoutUi(button);
      window.alert(
        "Please create an account to securely save your subscription. You will be redirected to sign up."
      );
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `auth.html?returnTo=${returnTo}`;
      return;
    }
  } catch (_e) {
    // On unexpected errors determining auth, be conservative and block checkout.
    resetCheckoutUi(button);
    window.alert(
      "Please sign in to purchase a plan. You will be redirected to the login page."
    );
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `auth.html?returnTo=${returnTo}`;
    return;
  }

  try {
    console.log("[CHECKOUT] Starting checkout for plan:", normalizedPlan);
    const order = await createOrder(normalizedPlan);
    console.log("[CHECKOUT] Order created:", order.order_id);

    try {
      await scrollToTopAndWait();

      lockCheckoutScroll();

      const keyId = getRazorpayKey();
      if (!keyId) {
        throw new Error("Razorpay is not configured for this frontend.");
      }

      const prefillEmail = getPrefilledEmail();

      console.log("[CHECKOUT] Opening Razorpay modal");
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
            console.log("[CHECKOUT] User dismissed Razorpay modal");
            resetCheckoutUi(button);
          },
        },
        handler: (response) => {
          (async () => {
            console.log("[PAYMENT HANDLER] Payment returned from Razorpay:", {
              payment_id: response.razorpay_payment_id,
              order_id: response.razorpay_order_id,
            });
            
            try {
              console.log("[PAYMENT HANDLER] Waiting for backend verification...");
              // Frontend MUST wait for backend confirmation - do NOT assume success yet
              const verification = await verifyPaymentWithBackend(normalizedPlan, response);

              console.log("[PAYMENT HANDLER] Backend confirmed plan upgrade ✓");
              // ONLY update local state after backend confirms database update
              await applyUpdatedUserPlan(verification.refreshedPlan || normalizedPlan);

              try {
                // Authoritative refresh: fetch the latest plan directly from backend/Supabase
                // This ensures all pages read fresh plan state instead of relying on any cached values.
                const userId = await getCurrentUserId();
                if (userId) {
                  const authModule = await import('./auth.js');
                  await authModule.fetchAndStoreUserPlan(userId);
                }
              } catch (_refreshErr) {
                // Non-fatal: plan state likely already updated, continue.
              }

              console.log("[PAYMENT HANDLER] SUCCESS: Showing success message to user");
              window.alert("Plan upgraded successfully! Enjoy your premium features.");

              // Explicit navigation after successful explicit user action
              try { window.location.href = 'index.html'; } catch (_) {}
            } catch (error) {
              // Error occurred - show clear message but don't update plan state
              const message = error && error.message ? error.message : "Payment verification failed.";
              console.error("[PAYMENT HANDLER] Verification failed:", message);
              window.alert(message);
            } finally {
              // ALWAYS reset UI after payment flow completes (success or failure)
              resetCheckoutUi(button);
            }
          })();
        },
      });

      if (checkout && typeof checkout.on === "function") {
        checkout.on("payment.failed", (response) => {
          console.log("[CHECKOUT] Payment failed in Razorpay:", response);
          resetCheckoutUi(button);
          window.alert(`Payment failed: ${response.error.description}`);
        });
      }
    } catch (error) {
      console.error("[CHECKOUT] Error opening Razorpay:", error);
      resetCheckoutUi(button);
      window.alert(error && error.message ? error.message : "Unable to open checkout. Please try again.");
    }
  } catch (error) {
    console.error("[CHECKOUT] Error starting checkout:", error);
    resetCheckoutUi(button);
    window.alert(error && error.message ? error.message : "Unable to start checkout. Please try again.");
  }
}

function wirePlanButtons() {
  Object.keys(BUTTON_IDS).forEach((plan) => {
    const button = getButton(plan);
    if (!button) return;

    button.addEventListener("click", async () => {
      if (plan === getPlan()) {
        setPlan(plan);
        return;
      }

      // If user previously owned this paid plan, reactivate without opening checkout
      const userId = await getCurrentUserId();
      const owned = await getPreviouslyOwnedPlans(userId);
      const normalized = normalizePlan(plan);
      if ((normalized === 'pro' || normalized === 'elite') && owned.includes(normalized)) {
        try {
          const supabaseModule = await import('./supabase.js');
          const supabase = supabaseModule.default;
          if (userId) {
            const { error } = await supabase.from('users').update({ plan: normalized }).eq('id', userId);
            if (error) {
              console.warn('[Plan Reactivate] supabase update error:', error);
            }
          }

          await applyUpdatedUserPlan(normalized);

          try {
            const authModule = await import('./auth.js');
            if (userId) await authModule.fetchAndStoreUserPlan(userId);
          } catch (_e) {
            // ignore
          }
          await savePreviouslyOwnedPlan(userId, normalized);
          await clearTemporarySessionState();
          window.location.href = 'index.html';
          return;
        } catch (err) {
          console.error('[Plan Reactivate] failed, falling back to checkout', err);
        }
      }

      startCheckout(plan);
    });
  });
}

// Initialization: determine previous plans and adjust button labels accordingly
;(async () => {
  try {
    const userId = await getCurrentUserId();
    if (userId) {
      const serverPlan = await getUpdatedUserPlan(userId);
      setActivePricingPlan(serverPlan || "free");
    } else {
      setActivePricingPlan("free");
    }

    // Read previously-owned plans for display-only label adjustments.
    const owned = await getPreviouslyOwnedPlans(userId);
    if (Array.isArray(owned) && owned.includes('pro')) {
      PLAN_CONFIG.pro.inactiveText = 'Switch to Pro';
    }
    if (Array.isArray(owned) && owned.includes('elite')) {
      PLAN_CONFIG.elite.inactiveText = 'Switch to Elite';
    }
  } catch (_e) {
    // ignore errors and fall back to the default free view until auth data arrives
    setActivePricingPlan("free");
  }

  // Render UI and wire interactions. No plan activation occurs here.
  applyActivePlan();
  wirePlanButtons();
})();

if (pricingBackBtn) {
  pricingBackBtn.addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

