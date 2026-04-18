const STORAGE_TOPIC_KEY = "lockedin_selected_topic";
const STORAGE_PLAN_KEY = "userPlan";
const STORAGE_SESSION_CONTENT_KEY = "lockedin_session_content";

const _host = window.location.hostname;
const API_BASE =
  !_host || _host === "localhost" || _host === "127.0.0.1"
    ? "http://127.0.0.1:8000"
    : `http://${_host}:8000`;

const formatButtons = document.querySelectorAll(".format-btn");
const examModeToggle = document.getElementById("examModeToggle");
const examModeDropdown = document.getElementById("examModeDropdown");
const downloadNotesBtn = document.getElementById("downloadNotesBtn");
const copyNotesBtn = document.getElementById("copyNotesBtn");
const backBtn = document.getElementById("kpBackBtn");
const loadingState = document.getElementById("kpLoadingState");
const contentState = document.getElementById("kpContent");

let selectedFormat = null;
let generatedNotes = "";
let isGenerating = false;
let isDownloading = false;

function getUserPlan() {
  const plan = window.localStorage.getItem(STORAGE_PLAN_KEY) || "free";
  const normalized = String(plan).trim().toLowerCase();
  if (normalized === "pro" || normalized === "elite" || normalized === "free") return normalized;
  return "free";
}

function selectFormat(format) {
  selectedFormat = format;

  formatButtons.forEach((btn) => {
    const btnFormat = btn.getAttribute("data-format");
    const isSelected = btnFormat === selectedFormat;
    btn.classList.toggle("is-selected", isSelected);
    btn.setAttribute("aria-checked", isSelected ? "true" : "false");
  });
}

function toggleExamModeDropdown() {
  if (!examModeToggle || !examModeDropdown) return;
  const isExpanded = examModeToggle.getAttribute("aria-expanded") === "true";
  const nextExpanded = !isExpanded;

  examModeToggle.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
  examModeDropdown.classList.toggle("is-open", nextExpanded);
  examModeDropdown.setAttribute("aria-hidden", nextExpanded ? "false" : "true");
}

function closeExamModeDropdown() {
  if (!examModeToggle || !examModeDropdown) return;
  examModeToggle.setAttribute("aria-expanded", "false");
  examModeDropdown.classList.remove("is-open");
  examModeDropdown.setAttribute("aria-hidden", "true");
}

function setupFormatButtons() {
  formatButtons.forEach((btn) => {
    const btnFormat = btn.getAttribute("data-format");
    if (!btnFormat) return;

    btn.addEventListener("click", () => {
      selectFormat(btnFormat);
      if (btnFormat === "exam") {
        toggleExamModeDropdown();
        return;
      }

      closeExamModeDropdown();
    });
  });
}

function getSafeTopicSlug() {
  const topic = window.localStorage.getItem(STORAGE_TOPIC_KEY) || "notes";
  const sanitized = String(topic)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || "notes";
}

function normalizeContentOrNull() {
  const text = typeof generatedNotes === "string" ? generatedNotes.trim() : "";
  return text.length > 0 ? text : null;
}

function toNotionMarkdown(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "";

  const lines = cleaned.split(/\r?\n/).map((line) => line.trimRight());
  const out = ["# Notion Ready Notes", ""];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      out.push("");
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      out.push(line);
      continue;
    }

    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      out.push(line);
      continue;
    }

    if (/^[A-Za-z][A-Za-z\s]+:$/.test(line)) {
      out.push(`## ${line.slice(0, -1)}`);
      continue;
    }

    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function buildPdfFromText(rawText, title) {
  const jspdfNs = window.jspdf;
  if (!jspdfNs || typeof jspdfNs.jsPDF !== "function") {
    throw new Error("PDF engine unavailable");
  }

  const doc = new jspdfNs.jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 44;
  const marginTop = 52;
  const marginBottom = 48;
  const maxLineWidth = pageWidth - marginX * 2;

  let y = marginTop;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  const titleLines = doc.splitTextToSize(title, maxLineWidth);
  titleLines.forEach((line) => {
    if (y > pageHeight - marginBottom) {
      doc.addPage();
      y = marginTop;
    }
    doc.text(line, marginX, y);
    y += 20;
  });

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const sourceLines = String(rawText)
    .replace(/\r\n/g, "\n")
    .split("\n");

  sourceLines.forEach((line) => {
    const trimmed = line.trim();
    const isHeading = /^#{1,6}\s+/.test(trimmed) || /^[A-Za-z][A-Za-z\s]+:$/.test(trimmed);
    const paragraph = trimmed || " ";
    const chunks = doc.splitTextToSize(paragraph, maxLineWidth);

    if (isHeading) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
    }

    chunks.forEach((chunk) => {
      if (y > pageHeight - marginBottom) {
        doc.addPage();
        y = marginTop;
      }
      doc.text(chunk, marginX, y);
      y += isHeading ? 18 : 15;
    });

    y += trimmed ? 4 : 8;
  });

  return doc;
}

function showLoadingState() {
  loadingState.removeAttribute("hidden");
  contentState.setAttribute("hidden", "");
}

function showContentState() {
  loadingState.setAttribute("hidden", "");
  contentState.removeAttribute("hidden");
}

async function generateKnowledgePack() {
  if (isGenerating) return;
  isGenerating = true;
  showLoadingState();

  try {
    const topic = window.localStorage.getItem(STORAGE_TOPIC_KEY) || "Unknown Topic";
    const sessionContent = window.localStorage.getItem(STORAGE_SESSION_CONTENT_KEY) || "";
    const plan = getUserPlan();
    const effectiveFormat = selectedFormat || "exam";

    const response = await window.fetch(`${API_BASE}/generate-knowledge-pack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        content: sessionContent,
        format: effectiveFormat,
        plan,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.error) {
      throw new Error(data.error || "Failed to generate notes");
    }

    generatedNotes = data.notes || "";
    showContentState();
  } catch (error) {
    console.error("Error generating notes:", error);
    alert("Failed to generate notes. Please try again.");
    showLoadingState();
  } finally {
    isGenerating = false;
  }
}

function downloadNotes() {
  if (!downloadNotesBtn || isDownloading) return;

  const content = normalizeContentOrNull();
  if (!content) {
    alert("No notes available yet. Please generate notes first.");
    return;
  }

  isDownloading = true;
  downloadNotesBtn.disabled = true;

  try {
    const baseName = getSafeTopicSlug();
    const effectiveFormat = selectedFormat || "exam";

    if (effectiveFormat === "pdf" || effectiveFormat === "exam") {
      const title = effectiveFormat === "exam" ? "Exam Mode Notes" : "PDF Notes";
      const doc = buildPdfFromText(content, title);
      const fileName = effectiveFormat === "exam"
        ? `${baseName}-exam-mode-notes.pdf`
        : `${baseName}-notes.pdf`;
      doc.save(fileName);
      return;
    }

    if (effectiveFormat === "notion") {
      const notionContent = toNotionMarkdown(content);
      if (!notionContent.trim()) {
        alert("Could not format notes for Notion.");
        return;
      }
      downloadBlob(notionContent, "text/markdown;charset=utf-8", `${baseName}-notion-ready.md`);
      return;
    }

    if (effectiveFormat === "markdown") {
      downloadBlob(content, "text/markdown;charset=utf-8", `${baseName}-notes.md`);
      return;
    }

    downloadBlob(content, "text/plain;charset=utf-8", `${baseName}-notes.txt`);
  } catch (_err) {
    alert("Download failed. Please try again.");
  } finally {
    window.setTimeout(() => {
      isDownloading = false;
      if (downloadNotesBtn) downloadNotesBtn.disabled = false;
    }, 450);
  }
}

function copyNotesToClipboard() {
  if (!generatedNotes) return;

  navigator.clipboard
    .writeText(generatedNotes)
    .then(() => {
      const oldText = copyNotesBtn.textContent;
      copyNotesBtn.textContent = "Copied!";
      setTimeout(() => {
        copyNotesBtn.textContent = oldText;
      }, 2000);
    })
    .catch(() => {
      alert("Failed to copy to clipboard");
    });
}

function initNavigation() {
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      const isFileContext = window.location.protocol === "file:";
      const target = isFileContext ? "session.html?view=feedback" : "/session.html?view=feedback";
      window.location.href = target;
    });
  }
}

setupFormatButtons();

document.addEventListener("click", (event) => {
  if (!examModeToggle || !examModeDropdown) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (examModeToggle.contains(target) || examModeDropdown.contains(target)) return;
  closeExamModeDropdown();
});

if (downloadNotesBtn) {
  downloadNotesBtn.addEventListener("click", downloadNotes);
}

if (copyNotesBtn) {
  copyNotesBtn.addEventListener("click", copyNotesToClipboard);
}

initNavigation();

window.addEventListener("DOMContentLoaded", () => {
  generateKnowledgePack();
});
