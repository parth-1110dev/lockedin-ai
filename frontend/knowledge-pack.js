console.log("KNOWLEDGE PACK JS LOADED");

const STORAGE_TOPIC_KEY = "lockedin_selected_topic";
const STORAGE_SESSION_CONTENT_KEY = "lockedin_session_content";

const _host = window.location.hostname;
const API_BASE =
  !window.location.hostname ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:8000"
    : "https://lockedin-ai.onrender.com";

const formatButtons = document.querySelectorAll(".format-btn");
const examModeToggle = document.getElementById("examModeToggle");
const examModeDropdown = document.getElementById("examModeDropdown");
const downloadNotesBtn = document.getElementById("downloadNotesBtn");
const copyNotesBtn = document.getElementById("copyNotesBtn");
const backBtn = document.getElementById("kpBackBtn");
const loadingState = document.getElementById("kpLoadingState");
const contentState = document.getElementById("kpContent");

const KP_PERF_LOG_ENABLED = (() => {
  try {
    const debugFlag = window.localStorage.getItem("lockedin_perf_debug");
    return (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      debugFlag === "1"
    );
  } catch (_error) {
    return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  }
})();

function logKnowledgePackPerformance(label, details) {
  if (!KP_PERF_LOG_ENABLED || typeof console === "undefined") return;
  if (typeof console.debug === "function") {
    console.debug("[KnowledgePackPerf]", label, details);
    return;
  }
  console.log("[KnowledgePackPerf]", label, details);
}

let selectedFormat = null;
let generatedNotes = "";
let isGenerating = false;
let isDownloading = false;
let sessionMathBlocks = new Map();

function isKatexAvailable() {
  return typeof window.katex !== "undefined" && typeof window.katex.renderToString === "function";
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

function looksLikeMathContent(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;

  const hasMathOperator =
    normalized.includes("=") ||
    normalized.includes("^") ||
    normalized.includes("_") ||
    normalized.includes("/") ||
    normalized.includes("+") ||
    normalized.includes("-") ||
    normalized.includes("*");

  if (hasMathOperator && /[A-Za-z0-9]/.test(normalized)) return true;

  return false;
}

function makeMathToken(index) {
  return `@@LOCKEDIN_MATH_BLOCK_${index}@@`;
}

function findEscapedClosing(text, startIndex, closeChar) {
  for (let index = startIndex; index < text.length - 1; index += 1) {
    if (text[index] !== "\\" || text[index + 1] !== closeChar) continue;
    if (isEscaped(text, index)) continue;
    return index;
  }
  return -1;
}

function findMatchingFence(text, startIndex, openChar, closeChar) {
  let depth = 0;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === openChar) {
      depth += 1;
      continue;
    }

    if (char === closeChar) {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    }
  }

  return -1;
}

function extractSessionMathBlocks(markdown) {
  const source = String(markdown || "");
  const blocks = [];
  let output = "";

  function appendMathBlock(startIndex, endIndex, latex, displayMode) {
    const token = makeMathToken(blocks.length);
    blocks.push({ token, latex, displayMode });
    output += token;
    return endIndex + 1;
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === "\\" && source[index + 1] === "(") {
      const closingIndex = findEscapedClosing(source, index + 2, ")");
      if (closingIndex !== -1) {
        const latex = source.slice(index + 2, closingIndex);
        index = appendMathBlock(index, closingIndex + 1, latex, false) - 1;
        continue;
      }
    }

    if (char === "\\" && source[index + 1] === "[") {
      const closingIndex = findEscapedClosing(source, index + 2, "]");
      if (closingIndex !== -1) {
        const latex = source.slice(index + 2, closingIndex);
        index = appendMathBlock(index, closingIndex + 1, latex, true) - 1;
        continue;
      }
    }

    if (char === "$") {
      const isDisplay = source[index + 1] === "$";
      const openingLength = isDisplay ? 2 : 1;
      const closingIndex = findClosingDelimiter(source, index + openingLength, isDisplay ? "$$" : "$");
      if (closingIndex !== -1) {
        const latex = source.slice(index + openingLength, closingIndex);
        index = appendMathBlock(index, closingIndex + openingLength - 1, latex, isDisplay) - 1;
        continue;
      }
    }

    if (char === "(") {
      const closingIndex = findMatchingFence(source, index + 1, "(", ")");
      if (closingIndex !== -1) {
        const latex = source.slice(index + 1, closingIndex);
        if (looksLikeMathContent(latex)) {
          index = appendMathBlock(index, closingIndex, latex, false) - 1;
          continue;
        }
      }
    }

    if (char === "[") {
      const closingIndex = findMatchingFence(source, index + 1, "[", "]");
      if (closingIndex !== -1) {
        const latex = source.slice(index + 1, closingIndex);
        if (looksLikeMathContent(latex)) {
          index = appendMathBlock(index, closingIndex, latex, true) - 1;
          continue;
        }
      }
    }

    output += char;
  }

  return { markdown: output, blocks };
}

function renderMathToken(token) {
  const block = sessionMathBlocks.get(token);
  if (!block) return token;
  return renderLatex(block.latex, block.displayMode);
}

function readMathToken(text, index) {
  const prefix = "@@LOCKEDIN_MATH_BLOCK_";
  if (!text.startsWith(prefix, index)) return null;

  const endIndex = text.indexOf("@@", index + prefix.length);
  if (endIndex === -1) return null;

  const token = text.slice(index, endIndex + 2);
  if (!sessionMathBlocks.has(token)) return null;

  return { token, length: token.length };
}

function createMathTokenBlock(token) {
  const block = sessionMathBlocks.get(token);
  if (!block) return null;
  return createMathBlock(block.latex);
}

function isMathTokenLine(trimmedLine) {
  return typeof trimmedLine === "string" && sessionMathBlocks.has(trimmedLine);
}

function isEscaped(text, index) {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function findClosingDelimiter(text, startIndex, delimiter) {
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] !== "$") continue;
    if (delimiter === "$$") {
      if (text[index + 1] !== "$") continue;
      if (isEscaped(text, index)) {
        index += 1;
        continue;
      }
      return index;
    }

    if (text[index + 1] === "$") continue;
    if (isEscaped(text, index)) continue;
    return index;
  }

  return -1;
}

function renderLatex(latex, displayMode) {
  const normalizedLatex = String(latex || "").trim();
  if (!normalizedLatex) {
    return displayMode ? '<div class="math-fallback"></div>' : "";
  }

  if (!isKatexAvailable()) {
    return `<span class="math-fallback">${escapeHtml(displayMode ? `$$${normalizedLatex}$$` : `$${normalizedLatex}$`)}</span>`;
  }

  try {
    return window.katex.renderToString(normalizedLatex, {
      displayMode,
      throwOnError: false,
      strict: "warn",
      trust: false,
    });
  } catch (_error) {
    return `<span class="math-fallback">${escapeHtml(displayMode ? `$$${normalizedLatex}$$` : `$${normalizedLatex}$`)}</span>`;
  }
}

function renderInlineContent(rawText) {
  const text = String(rawText || "");
  if (!text) return "";

  let html = "";
  let buffer = "";

  const flushBuffer = () => {
    if (!buffer) return;
    html += applyInlineBold(escapeHtml(buffer));
    buffer = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    const mathToken = readMathToken(text, index);
    if (mathToken) {
      flushBuffer();
      html += renderMathToken(mathToken.token);
      index += mathToken.length - 1;
      continue;
    }

    if (char === "\\" && text[index + 1] === "$") {
      buffer += "$";
      index += 1;
      continue;
    }

    if (char === "$") {
      const displayMode = text[index + 1] === "$";
      const openingLength = displayMode ? 2 : 1;
      const closingIndex = findClosingDelimiter(text, index + openingLength, displayMode ? "$$" : "$");

      if (closingIndex !== -1) {
        flushBuffer();
        const latex = text.slice(index + openingLength, closingIndex);
        html += renderLatex(latex, displayMode);
        index = closingIndex + openingLength - 1;
        continue;
      }
    }

    if (char === "\\" && text[index + 1] === "(") {
      const closingIndex = findEscapedClosing(text, index + 2, ")");
      if (closingIndex !== -1) {
        flushBuffer();
        const latex = text.slice(index + 2, closingIndex);
        html += renderLatex(latex, false);
        index = closingIndex + 1;
        continue;
      }
    }

    if (char === "\\" && text[index + 1] === "[") {
      const closingIndex = findEscapedClosing(text, index + 2, "]");
      if (closingIndex !== -1) {
        flushBuffer();
        const latex = text.slice(index + 2, closingIndex);
        html += renderLatex(latex, true);
        index = closingIndex + 1;
        continue;
      }
    }

    buffer += char;
  }

  flushBuffer();
  return html;
}

function createMarkdownBlock(tagName, className, rawText) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  element.innerHTML = renderInlineContent(rawText);
  return element;
}

function createMathBlock(rawLatex) {
  const block = document.createElement("div");
  block.className = "math-block";
  block.innerHTML = renderLatex(rawLatex, true);
  return block;
}

function appendMarkdownLine(fragment, rendererState, rawLine) {
  const trimmed = rawLine.trim();

  if (isMathTokenLine(trimmed)) {
    rendererState.listEl = null;
    const mathBlock = createMathTokenBlock(trimmed);
    if (mathBlock) {
      fragment.appendChild(mathBlock);
    }
    return;
  }

  if (rendererState.mathBlock) {
    const closingIndex = rawLine.indexOf("$$");
    if (closingIndex === -1) {
      rendererState.mathBlock.lines.push(rawLine);
      return;
    }

    rendererState.mathBlock.lines.push(rawLine.slice(0, closingIndex));
    fragment.appendChild(createMathBlock(rendererState.mathBlock.lines.join("\n")));
    rendererState.mathBlock = null;

    const remainder = rawLine.slice(closingIndex + 2).trim();
    if (remainder) {
      appendMarkdownLine(fragment, rendererState, remainder);
    }
    return;
  }

  if (trimmed.startsWith("$$")) {
    const endIndex = trimmed.lastIndexOf("$$");
    if (endIndex > 1) {
      const latex = trimmed.slice(2, endIndex);
      fragment.appendChild(createMathBlock(latex));
      const remainder = trimmed.slice(endIndex + 2).trim();
      if (remainder) {
        appendMarkdownLine(fragment, rendererState, remainder);
      }
      return;
    }

    rendererState.mathBlock = { lines: [rawLine.slice(rawLine.indexOf("$$") + 2)] };
    return;
  }

  if (trimmed === "") {
    rendererState.listEl = null;
    return;
  }

  if (/^####\s+/.test(trimmed)) {
    rendererState.listEl = null;
    fragment.appendChild(
      createMarkdownBlock("h4", "session-subheading", trimmed.replace(/^####\s+/, ""))
    );
    return;
  }

  if (/^###\s+/.test(trimmed)) {
    rendererState.listEl = null;
    fragment.appendChild(createMarkdownBlock("h3", "", trimmed.replace(/^###\s+/, "")));
    return;
  }

  if (/^##\s+/.test(trimmed)) {
    rendererState.listEl = null;
    fragment.appendChild(createMarkdownBlock("h2", "", trimmed.replace(/^##\s+/, "")));
    return;
  }

  if (/^[-*]\s+/.test(trimmed)) {
    if (!rendererState.listEl) {
      rendererState.listEl = document.createElement("ul");
      fragment.appendChild(rendererState.listEl);
    }

    rendererState.listEl.appendChild(
      createMarkdownBlock("li", "", trimmed.replace(/^[-*]\s+/, ""))
    );
    return;
  }

  rendererState.listEl = null;
  fragment.appendChild(createMarkdownBlock("p", "", trimmed));
}

function buildMarkdownFragment(markdown) {
  const normalizedMarkdown = String(markdown || "");
  const fragment = document.createDocumentFragment();
  const rendererState = { listEl: null, mathBlock: null };

  const extracted = extractSessionMathBlocks(normalizedMarkdown.replace(/\r\n/g, "\n"));
  sessionMathBlocks = new Map(extracted.blocks.map((block) => [block.token, block]));

  const lines = extracted.markdown.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    appendMarkdownLine(fragment, rendererState, lines[index]);
  }

  return fragment;
}

function normalizePlan(plan) {
  const normalized = String(plan || "").trim().toLowerCase();
  if (normalized === "pro" || normalized === "elite" || normalized === "free") return normalized;
  return "free";
}

function getCurrentPlan() {
  const planState = window.LockedInPlanState;
  if (planState && typeof planState.getCurrentActivePlan === "function") {
    return normalizePlan(planState.getCurrentActivePlan());
  }

  return "free";
}

function getUserPlan() {
  return getCurrentPlan();
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

async function buildPdfFromText(rawText, title, filename) {
  console.log("PDF FUNCTION STARTED");
  const jspdfNs = window.jspdf;
  if (!jspdfNs || typeof jspdfNs.jsPDF !== "function") {
    throw new Error("PDF engine unavailable");
  }

  const doc = new jspdfNs.jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const sidePaddingPx = 60;
  const sideMarginPt = 45;
  const exportContainer = document.createElement("div");
  exportContainer.style.position = "fixed";
  exportContainer.style.left = "-10000px";
  exportContainer.style.top = "0";
  exportContainer.style.opacity = "1";
  exportContainer.style.pointerEvents = "none";
  exportContainer.style.zIndex = "-1";
  exportContainer.style.width = "760px";
  exportContainer.style.padding = `36px ${sidePaddingPx}px`;
  exportContainer.style.background = "#ffffff";
  exportContainer.style.color = "#111827";
  exportContainer.style.boxSizing = "border-box";
  exportContainer.style.fontFamily = "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
  exportContainer.style.lineHeight = "1.6";
  exportContainer.style.wordBreak = "break-word";
  exportContainer.innerHTML = `
    <style>
      h1, h2, h3, h4, p, ul { margin-top: 0; }
      h1 { font-size: 24px; margin-bottom: 18px; }
      h2 { font-size: 18px; margin: 18px 0 10px; }
      h3 { font-size: 16px; margin: 16px 0 8px; }
      h4 { font-size: 15px; margin: 14px 0 8px; }
      p, li { font-size: 12px; margin-bottom: 8px; }
      ul { padding-left: 20px; margin-bottom: 12px; }
      .math-block { margin: 10px 0; overflow-x: auto; }
      .katex-display { margin: 0; overflow-x: auto; overflow-y: hidden; }
      .math-fallback { white-space: pre-wrap; word-break: break-word; }
    </style>
  `;

  const titleEl = document.createElement("h1");
  titleEl.textContent = title;
  exportContainer.appendChild(titleEl);
  exportContainer.appendChild(buildMarkdownFragment(String(rawText || "")));
  document.body.appendChild(exportContainer);

  try {
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });

    console.log("MATH BLOCK COUNT:", sessionMathBlocks.size);

    //if (sessionMathBlocks.size > 0) {
      //const katexNodes = exportContainer.querySelectorAll(".katex, .katex-display, .math-fallback");
      //if (!katexNodes.length) {
        //console.warn("KaTeX render missing in export container");
        //throw new Error("KaTeX render missing in export container");
      //}
    //}

    if (typeof doc.html === "function" && typeof window.html2canvas === "function") {
      console.log("USING HTML EXPORT");
      let timeoutId = null;
      await Promise.race([
        new Promise((resolve, reject) => {
          try {
            doc.html(exportContainer, {
              margin: [36, sideMarginPt, 36, sideMarginPt],
              autoPaging: "text",
              x: 0,
              y: 0,
              width: pageWidth - sideMarginPt * 2,
              windowWidth: 760,
              callback: () => {
                console.log("HTML EXPORT COMPLETED");
                resolve();
              },
              html2canvas: { scale: 1 },
            });
          } catch (error) {
            reject(error);
          }
        }),
        new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error("HTML PDF export timed out"));
          }, 12000);
        }),
      ]);
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      doc.save(filename);
      return doc;
    }

    if (typeof window.html2canvas !== "function") {
      throw new Error("HTML PDF export unavailable");
    }

    console.log("USING CANVAS EXPORT")

    const canvas = await window.html2canvas(exportContainer, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });

    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = sideMarginPt;
    const imageWidth = pageWidth - margin * 2;
    const imageHeight = (canvas.height * imageWidth) / canvas.width;
    const pageHeightAvailable = pageHeight - margin * 2;
    const imageData = canvas.toDataURL("image/png");

    let remainingHeight = imageHeight;
    let yOffset = margin;

    doc.addImage(imageData, "PNG", margin, yOffset, imageWidth, imageHeight);
    remainingHeight -= pageHeightAvailable;

    while (remainingHeight > 0) {
      yOffset = remainingHeight - imageHeight + margin;
      doc.addPage();
      doc.addImage(imageData, "PNG", margin, yOffset, imageWidth, imageHeight);
      remainingHeight -= pageHeightAvailable;
    }

    doc.save(filename);
    return doc;
  } finally {
    if (exportContainer.parentNode) {
      exportContainer.parentNode.removeChild(exportContainer);
    }
  }
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
  generatedNotes = "";
  const generationStartedAt = window.performance.now();

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
      alert(data.error || "Failed to generate notes. Please try again.");
      showContentState();
      return;
    }
    showLoadingState();

    generatedNotes = data.notes || "";
    window.localStorage.setItem(
      "lockedin_generated_notes",
      generatedNotes
    );
    showContentState();
    logKnowledgePackPerformance("notes generated", {
      plan,
      format: effectiveFormat,
      characters: generatedNotes.length,
      elapsedMs: Math.round(window.performance.now() - generationStartedAt),
    });
  } catch (error) {
    console.error("Error generating notes:", error);
    alert("Failed to generate notes. Please try again.");
    showContentState();
  } finally {
    isGenerating = false;
  }
}

async function downloadNotes() {
  if (!downloadNotesBtn || isDownloading) return;

  if (!generatedNotes) {
    generatedNotes =
      window.localStorage.getItem("lockedin_generated_notes") || "";
  }

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
      const fileName = effectiveFormat === "exam"
        ? `${baseName}-exam-mode-notes.pdf`
        : `${baseName}-notes.pdf`;
      console.log("ABOUT TO CALL PDF");
      console.log("FORMAT:", effectiveFormat);
      console.log("CONTENT LENGTH:", content.length);
      await buildPdfFromText(content, title, fileName);
      window.localStorage.removeItem("lockedin_generated_notes");
      return;
    }

    if (effectiveFormat === "notion") {
      const notionContent = toNotionMarkdown(content);
      if (!notionContent.trim()) {
        alert("Could not format notes for Notion.");
        return;
      }
      downloadBlob(notionContent, "text/markdown;charset=utf-8", `${baseName}-notion-ready.md`);
      window.localStorage.removeItem("lockedin_generated_notes");
      return;
    }

    if (effectiveFormat === "markdown") {
      downloadBlob(content, "text/markdown;charset=utf-8", `${baseName}-notes.md`);
      window.localStorage.removeItem("lockedin_generated_notes");
      return;
    }

    downloadBlob(content, "text/plain;charset=utf-8", `${baseName}-notes.txt`);
    window.localStorage.removeItem("lockedin_generated_notes");
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
      const target = "session.html?view=feedback";
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
