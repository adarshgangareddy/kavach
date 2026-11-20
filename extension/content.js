/**
 * Kavach Live Chat Shield — Content Script for WhatsApp Web & Telegram Web
 * Automatically reads active chat messages via DOM MutationObserver,
 * streams them via the background service worker to the local Kavach API,
 * and displays real-time threat warnings directly in the chat.
 */

(() => {
  let activePlatform = location.host.includes("whatsapp.com") ? "whatsapp" : "telegram";
  let lastScannedFingerprint = "";
  let scanDebounceTimer = null;
  let isProtectionEnabled = true;

  chrome.storage?.sync?.get(["kavachEnabled"], (res) => {
    if (res?.kavachEnabled !== undefined) isProtectionEnabled = res.kavachEnabled;
  });

  // Inject Kavach persistent floating badge into the page
  function injectStatusBadge() {
    if (document.getElementById("kavach-live-badge")) return;
    const badge = document.createElement("div");
    badge.id = "kavach-live-badge";
    badge.className = "kavach-status-badge";
    badge.innerHTML = `<span class="kavach-status-dot"></span><span>🛡️ Kavach Active</span>`;
    badge.title = "Kavach Live Shield is active. Click to immediately scan this chat!";
    badge.onclick = (e) => {
      e.stopPropagation();
      performScan(true);
    };
    document.body.appendChild(badge);
  }

  // Extract messages from WhatsApp Web DOM
  function parseWhatsAppMessages() {
    const main = document.querySelector("#main, div[role='region'], div[data-testid='conversation-panel-wrapper'], div[tabindex='-1']") || document.body;

    const contactHeader = document.querySelector("#main header span[dir='auto'], header span[title], header div[role='button'] span, header h2, span[data-testid='conversation-info-header-chat-title']");
    const contactName = contactHeader?.textContent?.trim() || "Sender";

    // Support all modern WhatsApp Web row structures
    const rows = document.querySelectorAll("#main div[role='row'], div[data-testid='msg-container'], .message-in, .message-out, div[data-id]");
    if (!rows.length) return null;

    const messages = [];
    rows.forEach((node, idx) => {
      const dataId = node.getAttribute("data-id") || node.closest("div[data-id]")?.getAttribute("data-id") || "";
      const isOut = node.classList.contains("message-out") || dataId.startsWith("true_");

      const textNode = node.querySelector(".selectable-text, .copyable-text, span._ao3e, div[data-pre-plain-text]") || node;
      let text = "";
      if (textNode.classList?.contains("selectable-text") || textNode.classList?.contains("_ao3e")) {
        text = textNode.textContent?.trim();
      } else {
        const span = textNode.querySelector("span.selectable-text, span._ao3e");
        text = span ? span.textContent?.trim() : textNode.textContent?.trim();
      }

      // Filter out system labels (e.g. "Messages and calls are end-to-end encrypted", timestamps only)
      if (!text || text.length < 2 || text.includes("end-to-end encrypted") || text.includes("Security code changed")) return;

      messages.push({
        id: `wa-${idx}-${text.slice(0, 15).replace(/[^a-zA-Z0-9]/g, "_")}`,
        sender: isOut ? "me" : contactName,
        text: text,
        timestamp: "",
      });
    });

    return {
      platform: "whatsapp-web",
      self_handle: "me",
      contact_name: contactName,
      messages: messages.slice(-25),
    };
  }

  // Extract messages from Telegram Web DOM
  function parseTelegramMessages() {
    const main = document.querySelector(".messages-container, .bubbles-group, .chat-info, .history, .bubbles") || document.body;

    const header = document.querySelector(".chat-info .peer-title, .top .name, .chat-title, .user-title");
    const contactName = header?.textContent?.trim() || "Sender";

    const msgNodes = document.querySelectorAll(".bubble, .message, .bubble-content");
    if (!msgNodes.length) return null;

    const messages = [];
    msgNodes.forEach((node, idx) => {
      const isOut = node.classList.contains("is-out") || node.classList.contains("own");
      const textNode = node.querySelector(".message-content, .text-content, .bubble-content, .message");
      const text = textNode?.textContent?.trim();
      if (!text) return;

      messages.push({
        id: `tg-${idx}-${text.slice(0, 15).replace(/[^a-zA-Z0-9]/g, "_")}`,
        sender: isOut ? "me" : contactName,
        text: text,
        timestamp: "",
      });
    });

    return {
      platform: "telegram-web",
      self_handle: "me",
      contact_name: contactName,
      messages: messages.slice(-25),
    };
  }

  // Analyze active chat via background worker
  function performScan(force = false) {
    if (!isProtectionEnabled) return;

    const chatData = activePlatform === "whatsapp" ? parseWhatsAppMessages() : parseTelegramMessages();
    if (!chatData || !chatData.messages.length) return;

    const incoming = chatData.messages.filter((m) => m.sender !== "me");
    if (!incoming.length) return;

    const fingerprint = incoming.slice(-4).map((m) => m.text).join("::");
    if (!force && fingerprint === lastScannedFingerprint) return;
    lastScannedFingerprint = fingerprint;

    chrome.runtime?.sendMessage?.(
      {
        type: "ANALYZE_CHAT",
        payload: {
          platform: chatData.platform,
          self_handle: "me",
          messages: chatData.messages,
        },
      },
      (response) => {
        if (!response || !response.ok) return;
        const verdict = response.data;
        if (verdict.severity !== "low" && verdict.category !== "safe") {
          displayThreatBanner(verdict, chatData.contact_name);
          chrome.runtime?.sendMessage?.({
            type: "THREAT_DETECTED",
            category: verdict.category,
            severity: verdict.severity,
            reason: verdict.reason,
            sender: chatData.contact_name,
          });
        } else {
          removeThreatBanner();
          if (force) {
            showSafeNotification(chatData.contact_name, chatData.messages.length);
          }
        }
      }
    );
  }

  function showSafeNotification(contactName, count) {
    const badge = document.getElementById("kavach-live-badge");
    if (!badge) return;
    const original = badge.innerHTML;
    badge.innerHTML = `<span class="kavach-status-dot" style="background:#10b981;"></span><span>✓ ${count} msgs checked: Safe</span>`;
    setTimeout(() => {
      badge.innerHTML = original;
    }, 4000);
  }

  // Display high-visibility fixed banner
  function displayThreatBanner(verdict, senderName) {
    let existing = document.getElementById("kavach-threat-banner");
    if (!existing) {
      existing = document.createElement("div");
      existing.id = "kavach-threat-banner";
      existing.className = "kavach-shield-banner";
      document.body.appendChild(existing);
    }

    const categoryLabel = (verdict.category || "THREAT").replace(/_/g, " ").toUpperCase();
    existing.innerHTML = `
      <div class="kavach-banner-top">
        <span class="kavach-threat-badge">🚨 KAVACH SHIELD: ${categoryLabel}</span>
        <span class="kavach-risk-score">Threat Score: ${verdict.risk_score}/100 (${(verdict.severity || "HIGH").toUpperCase()})</span>
      </div>
      <div class="kavach-banner-body">
        <strong>Extortion / Harassment Detected from ${senderName}:</strong>
        <br/><span style="opacity:0.95; font-size:12.5px; margin-top:4px; display:inline-block;">${verdict.reason}</span>
      </div>
      <div class="kavach-banner-acts">
        <button type="button" class="kavach-btn" id="kavach-act-vault">🔒 Save Evidence to Vault</button>
        <button type="button" class="kavach-btn kavach-btn-sos" id="kavach-act-sos">🚨 Trigger SOS to Guardians</button>
        <button type="button" class="kavach-btn" id="kavach-act-dismiss">Dismiss</button>
      </div>
    `;

    document.getElementById("kavach-act-vault").onclick = () => {
      window.open("http://localhost:8000/index.html#vault", "_blank");
    };
    document.getElementById("kavach-act-sos").onclick = () => {
      window.open("http://localhost:8000/index.html#sos", "_blank");
    };
    document.getElementById("kavach-act-dismiss").onclick = () => {
      existing.remove();
    };
  }

  function removeThreatBanner() {
    const existing = document.getElementById("kavach-threat-banner");
    if (existing) existing.remove();
  }

  // Listen for direct messages from extension popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "TRIGGER_TEST_BANNER") {
      performScan(true);
      sendResponse({ ok: true });
    }
  });

  // Observe DOM changes and sidebar chat clicks
  function setupObserver() {
    const observer = new MutationObserver(() => {
      clearTimeout(scanDebounceTimer);
      scanDebounceTimer = setTimeout(() => performScan(false), 1200);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Instantly scan when user clicks any contact in the left conversation list
    document.addEventListener("click", (e) => {
      if (e.target.closest("#pane-side, div[role='listitem'], div[data-testid='cell-frame-container'], header")) {
        setTimeout(() => performScan(true), 600);
      }
    });

    injectStatusBadge();
    // Run an initial scan after loading
    setTimeout(() => performScan(true), 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupObserver);
  } else {
    setupObserver();
  }
})();
