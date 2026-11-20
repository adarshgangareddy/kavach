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
    badge.title = "Kavach Live Shield is active. Click to test live threat detection!";
    badge.onclick = (e) => {
      e.stopPropagation();
      simulateTestThreat();
    };
    document.body.appendChild(badge);
  }

  // Extract messages from WhatsApp Web DOM
  function parseWhatsAppMessages() {
    const main = document.querySelector("#main, div[role='region'], div[data-testid='conversation-panel-wrapper']");
    if (!main) return null;

    const contactHeader = main.querySelector("header span[dir='auto'], header span[title], header div[role='button'] span, header h2");
    const contactName = contactHeader?.textContent?.trim() || "Sender";

    // Support both older and modern WhatsApp Web DOM structures
    const msgNodes = main.querySelectorAll(".message-in, .message-out, div[data-id], div[data-testid='msg-container']");
    if (!msgNodes.length) return null;

    const messages = [];
    msgNodes.forEach((node, idx) => {
      // Determine if message is outgoing or incoming
      const dataId = node.getAttribute("data-id") || "";
      const isOut = node.classList.contains("message-out") || dataId.startsWith("true_");
      
      const textNode = node.querySelector(".selectable-text, .copyable-text span, div[data-pre-plain-text], span._ao3e");
      const text = textNode?.textContent?.trim();
      if (!text) return;

      messages.push({
        id: `wa-${idx}-${text.slice(0, 10).replace(/\s/g, "_")}`,
        sender: isOut ? "me" : contactName,
        text: text,
        timestamp: "",
      });
    });

    return {
      platform: "whatsapp-web",
      self_handle: "me",
      contact_name: contactName,
      messages: messages.slice(-20),
    };
  }

  // Extract messages from Telegram Web DOM
  function parseTelegramMessages() {
    const main = document.querySelector(".messages-container, .bubbles-group, .chat-info, .history, .bubbles");
    if (!main) return null;

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
        id: `tg-${idx}-${text.slice(0, 10).replace(/\s/g, "_")}`,
        sender: isOut ? "me" : contactName,
        text: text,
        timestamp: "",
      });
    });

    return {
      platform: "telegram-web",
      self_handle: "me",
      contact_name: contactName,
      messages: messages.slice(-20),
    };
  }

  // Analyze active chat via background worker
  function performScan() {
    if (!isProtectionEnabled) return;

    const chatData = activePlatform === "whatsapp" ? parseWhatsAppMessages() : parseTelegramMessages();
    if (!chatData || !chatData.messages.length) return;

    const incoming = chatData.messages.filter((m) => m.sender !== "me");
    if (!incoming.length) return;

    const fingerprint = incoming.slice(-3).map((m) => m.text).join("::");
    if (fingerprint === lastScannedFingerprint) return;
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
        }
      }
    );
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
        <strong>Harassment Warning:</strong> Threatening communication detected from <em>${senderName}</em>.
        <br/><span style="opacity:0.9; font-size:12px; margin-top:3px; display:inline-block;">${verdict.reason}</span>
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

  // Test simulation
  function simulateTestThreat() {
    displayThreatBanner(
      {
        category: "stalking",
        risk_score: 94,
        severity: "high",
        reason: "Simulated harassment pattern: Unsolicited tracking, repeated intimidation, and explicit threats.",
      },
      "Test Sender"
    );
  }

  // Listen for direct messages from extension popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "TRIGGER_TEST_BANNER") {
      simulateTestThreat();
      sendResponse({ ok: true });
    }
  });

  // Observe DOM changes on WhatsApp / Telegram
  function setupObserver() {
    const observer = new MutationObserver(() => {
      clearTimeout(scanDebounceTimer);
      scanDebounceTimer = setTimeout(performScan, 1400);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    injectStatusBadge();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupObserver);
  } else {
    setupObserver();
  }
})();
