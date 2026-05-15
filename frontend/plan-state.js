(function (window) {
  const VALID_PLANS = new Set(["free", "pro", "elite"]);
  const CHANNEL_NAME = "lockedin-plan-state";
  const STORAGE_EVENT_KEY = "lockedin_plan_state_event";

  let activePlan = normalizePlan(window.currentUserPlan || "free");
  let activeUserId = "";
  let broadcastChannel = null;

  function normalizePlan(plan) {
    const normalized = String(plan || "").trim().toLowerCase();
    return VALID_PLANS.has(normalized) ? normalized : "free";
  }

  function emitPlanChange(detail) {
    window.currentUserPlan = detail.plan;
    window.dispatchEvent(
      new CustomEvent("userPlanUpdated", {
        detail,
      })
    );
  }

  function broadcastPlan(detail) {
    if (detail.source === "broadcast") {
      return;
    }

    if (broadcastChannel) {
      try {
        broadcastChannel.postMessage({ type: "plan-updated", detail });
        return;
      } catch (_error) {
        // Fall through to the storage-event fallback.
      }
    }

    try {
      window.localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify({ ...detail, timestamp: Date.now() }));
      window.localStorage.removeItem(STORAGE_EVENT_KEY);
    } catch (_error) {
      // ignore
    }
  }

  function setPlan(plan, options) {
    const normalized = normalizePlan(plan);
    const nextOptions = options || {};
    const previousPlan = activePlan;

    activePlan = normalized;
    if (typeof nextOptions.userId !== "undefined") {
      activeUserId = String(nextOptions.userId || "").trim();
    }

    const detail = {
      plan: activePlan,
      previousPlan,
      source: String(nextOptions.source || "unknown"),
      userId: activeUserId,
    };

    emitPlanChange(detail);

    if (nextOptions.broadcast !== false) {
      broadcastPlan(detail);
    }

    return activePlan;
  }

  function getPlan() {
    return normalizePlan(activePlan || window.currentUserPlan || "free");
  }

  function getUserId() {
    return activeUserId;
  }

  function initBroadcastListener() {
    if (typeof window.BroadcastChannel === "function") {
      try {
        broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
        broadcastChannel.onmessage = (event) => {
          const message = event && event.data ? event.data : null;
          if (!message || message.type !== "plan-updated" || !message.detail) {
            return;
          }

          const incoming = message.detail;
          setPlan(incoming.plan, {
            source: "broadcast",
            userId: incoming.userId || "",
            broadcast: false,
          });
        };
        return;
      } catch (_error) {
        broadcastChannel = null;
      }
    }

    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_EVENT_KEY || !event.newValue) {
        return;
      }

      try {
        const parsed = JSON.parse(event.newValue);
        if (!parsed || !parsed.plan) {
          return;
        }

        setPlan(parsed.plan, {
          source: "broadcast",
          userId: parsed.userId || "",
          broadcast: false,
        });
      } catch (_error) {
        // ignore malformed sync payloads
      }
    });
  }

  initBroadcastListener();

  window.LockedInPlanState = {
    normalizePlan,
    setPlan,
    getPlan,
    getUserId,
  };

  window.currentUserPlan = activePlan;
})(window);
