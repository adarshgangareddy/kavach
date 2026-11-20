/**
 * Kavach Live Chat Shield — Content Script for WhatsApp Web & Telegram Web
 * Automatically reads active chat messages via DOM MutationObserver,
 * streams them to the local Kavach Smart Shield API, and displays real-time threat warnings.
 */

(() => {
  const KAVACH_API = "http://localhost:8000";
  let activePlatform = location.host.includes("whatsapp.com") ? "whatsapp" : "telegram";
  let lastScannedFingerprint = "";
  let scanDebounceTimer = null;
  let isProtectionEnabled = true;

  // Retrieve user settings from chrome.storage
  chrome.storage?.sync?.get(["kavachEnabled", "kavachApiUrl"], (res) => {
    if (res?.kavachEnabled !== undefined) isProtectionEnabled = res.kavachEnabled;
  });

  // Inject Kavach persistent active badge into the web page
  function injectStatusBadge() {
    if (document.getElementById("kavach-live-badge")) return;
    const badge = document.createElement("div");
    badge.id = "kavach-live-badge";
    badge.className = "kavach-status-badge";
    badge.innerHTML = `<span class="kavach-status-dot"></span><span>Kavach Active</span>`;
    badge.title = "Kavach Live Shield is monitoring incoming messages for threats & harassment.";
    badge.onclick = () => window.open(KAVACH_API, "_blank");
    document.body.appendChild(badge);
  }

  // Extract messages from WhatsApp Web DOM
  function parseWhatsAppMessages() {
    const main = document.querySelector("#main, div[role='region']");
    if (!main) return null;

    const contactHeader = main.querySelector("header span[dir='auto'], header span[title]");
    const contactName = contactHeader?.textContent?.trim() || "Sender";

    const msgNodes = main.querySelectorAll(".message-in, .message-out");
    if (!msgNodes.length) return null;

    const messages = [];
    msgNodes.forEach((node, idx) => {
      const isOut = node.classList.contains("message-out");
      const textNode = node.querySelector(".selectable-text, .copyable-text span");
      const text = textNode?.textContent?.trim();
      if (!text) return;

      const timeNode = node.querySelector("span[dir='auto'][class*='time'], span[data-testid*='time']");
      const time = timeNode?.textContent?.trim() || "";

      messages.push({
        id: `wa-${idx}-${text.slice(0, 10).replace(/\s/g, "_")}`,
        sender: isOut ? "me" : contactName,
        text: text,
        timestamp: time,
      });
    });

    return {
      platform: "whatsapp-web",
      self_handle: "me",
      contact_name: contactName,
      messages: messages.slice(-20), // Analyze the last 20 messages for context
      containerNode: main,
    };
  }

  // Extract messages from Telegram Web DOM (both WebK and WebA versions)
  function parseTelegramMessages() {
    const main = document.querySelector(".messages-container, .bubbles-group, .chat-info");
    if (!main) return null;

    const header = document.querySelector(".chat-info .peer-title, .top .name, .chat-title");
    const contactName = header?.textContent?.trim() || "Sender";

    const msgNodes = document.querySelectorAll(".bubble, .message");
    if (!msgNodes.length) return null;

    const messages = [];
    msgNodes.forEach((node, idx) => {
      const isOut = node.classList.contains("is-out") || node.classList.contains("own");
      const textNode = node.querySelector(".message-content, .text-content, .bubble-content");
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
      containerNode: main,
    };
  }

  // Analyze active chat
  async function performScan() {
    if (!isProtectionEnabled) return;

    const chatData = activePlatform === "whatsapp" ? parseWhatsAppMessages() : parseTelegramMessages();
    if (!chatData || !chatData.messages.length) return;

    // Build fingerprint of last 3 incoming messages to avoid redundant scans
    const incoming = chatData.messages.filter((m) => m.sender !== "me");
    if (!incoming.length) return;
    const fingerprint = incoming.slice(-3).map((m) => m.text).join("::");
    if (fingerprint === lastScannedFingerprint) return;
    lastScannedFingerprint = fingerprint;

    try {
      const res = await fetch(`${KAVACH_API}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: chatData.platform,
          self_handle: "me",
          messages: chatData.messages,
        }),
      });

      if (!res.ok) return;
      const verdict = await res.json();

      // Show alert banner if high/medium risk is detected
      if (verdict.severity !== "low" && verdict.category !== "safe") {
        displayThreatBanner(chatData.containerNode, verdict, chatData.contact_name);
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
    } catch (err) {
      // Local Kavach backend offline or starting up
    }
  }

  function displayThreatBanner(container, verdict, senderName) {
    let existing = document.getElementById("kavach-threat-banner");
    if (!existing) {
      existing = document.createElement("div");
      existing.id = "kavach-threat-banner";
      existing.className = "kavach-shield-banner";
      const insertionPoint = container.querySelector(".copyable-area, .messages-container") || container;
      insertionPoint.prepend(existing);
    }

    const categoryLabel = verdict.category.replace(/_/g, " ").toUpperCase();
    existing.innerHTML = `
      <div class="kavach-banner-top">
        <span class="kavach-threat-badge">🚨 KAVACH SHIELD: ${categoryLabel}</span>
        <span class="kavach-risk-score">Risk Score: ${verdict.risk_score}/100 (${verdict.severity.toUpperCase()})</span>
      </div>
      <div class="kavach-banner-body">
        <strong>Warning:</strong> Kavach detected potential ${categoryLabel.toLowerCase()} from <em>${senderName}</em>.
        <br/><span style="opacity:0.85;">${verdict.reason}</span>
      </div>
      <div class="kavach-banner-acts">
        <button type="button" class="kavach-btn" id="kavach-act-vault">🔒 Save Tamper-Proof Evidence</button>
        <button type="button" class="kavach-btn kavach-btn-sos" id="kavach-act-sos">🚨 Trigger SOS to Guardians</button>
        <button type="button" class="kavach-btn" id="kavach-act-dismiss">Dismiss</button>
      </div>
    `;

    document.getElementById("kavach-act-vault").onclick = () => {
      window.open(`${KAVACH_API}/index.html#vault`, "_blank");
    };
    document.getElementById("kavach-act-sos").onclick = () => {
      window.open(`${KAVACH_API}/index.html#sos`, "_blank");
    };
    document.getElementById("kavach-act-dismiss").onclick = () => {
      existing.remove();
    };
  }

  function removeThreatBanner() {
    const existing = document.getElementById("kavach-threat-banner");
    if (existing) existing.remove();
  }

  // Observe DOM changes on WhatsApp / Telegram
  function setupObserver() {
    const observer = new MutationObserver(() => {
      clearTimeout(scanDebounceTimer);
      scanDebounceTimer = setTimeout(performScan, 1400); // 1.4s debounce after typing/updates
    });

    observer.observe(document.body, { childList: true, subtree: true });
    injectStatusBadge();
  }

  // Start when page is loaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupObserver);
  } else {
    setupObserver();
  }
})();

