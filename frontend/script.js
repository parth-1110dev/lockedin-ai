const topicForm = document.getElementById("topicForm");
const topicInput = document.getElementById("topicInput");
const hint = document.getElementById("hint");
const startBtn = document.getElementById("startBtn");

const STORAGE_TOPIC_KEY = "lockedin_selected_topic";
const STORAGE_EXPLANATION_MODE_KEY = "lockedin_explanation_mode";
const STORAGE_EXPLANATION_TOPIC_KEY = "lockedin_explanation_mode_topic";

const topicButtons = document.querySelectorAll(".topic-pill");

function setHint(message) {
  hint.textContent = message;
}

function setSingleTopicInInput(topic) {
  // Enforce single-topic rule: replace whatever is currently in the input.
  topicInput.value = topic;
}

function goToTimeSelectionWithTopic(topic) {
  const previousTopic = (window.localStorage.getItem(STORAGE_TOPIC_KEY) || "").trim();
  const nextTopic = String(topic || "").trim();

  if (previousTopic && previousTopic !== nextTopic) {
    window.localStorage.removeItem(STORAGE_EXPLANATION_MODE_KEY);
    window.localStorage.removeItem(STORAGE_EXPLANATION_TOPIC_KEY);
  }

  window.localStorage.setItem(STORAGE_TOPIC_KEY, topic);
  window.location.href = "time-selection.html";
}

topicButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const topic = btn.getAttribute("data-topic") || "";
    if (!topic) return;

    setSingleTopicInInput(topic);
    topicInput.focus();
    setHint(`Selected: ${topic}`);
  });
});

topicForm.addEventListener("submit", (e) => {
  e.preventDefault();

  // Only navigate on explicit submit (Enter or arrow).
  const raw = topicInput.value.trim();
  if (!raw) {
    setHint("Pick a topic first.");
    topicInput.focus();
    return;
  }

  // Enforce ONE topic even if user typed commas.
  const firstTopic = raw.split(",")[0].trim();
  if (!firstTopic) {
    setHint("Pick a topic first.");
    topicInput.focus();
    return;
  }

  topicInput.value = firstTopic;
  goToTimeSelectionWithTopic(firstTopic);
});

if (startBtn) {
  startBtn.addEventListener("click", () => {
    // Keep the flow controlled: do not redirect here.
    topicInput.scrollIntoView({ behavior: "smooth", block: "center" });
    topicInput.focus();
    setHint("Press Enter (or the arrow) to continue.");
  });
}

