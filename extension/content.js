/**
 * Kavach Live Chat Shield — Content Script for WhatsApp Web & Telegram Web
 * Automatically reads active chat messages via DOM MutationObserver,
 * streams them via the background service worker to the local Groq-powered Kavach API,
 * and displays real-time threat warnings with one-click tamper-proof Vault sealing.
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
    badge.title = "Kavach Live Shield is active. Click to analyze this chat with Groq AI!";
    badge.onclick = (e) => {
      e.stopPropagation();
      badge.innerHTML = `<span class="kavach-status-dot" style="background:#f59e0b;"></span><span>🔄 Reading chat...</span>`;
      performScan(true);
    };
    document.body.appendChild(badge);
  }

  // Extract messages from WhatsApp Web DOM
  function parseWhatsAppMessages() {
    const main = document.querySelector("#main, div[role='region'], div[data-testid='conversation-panel-wrapper'], div[tabindex='-1']") || document.body;

    const contactHeader = document.querySelector(
      "#main header span[dir='auto'], #main header span[title], #main header h2, header div[role='button'] span, span[data-testid='conversation-info-header-chat-title']"
    );
    const contactName = contactHeader?.textContent?.trim() || "Sender";

    // Support all modern WhatsApp Web row structures
    const rows = document.querySelectorAll(
      "#main div[role='row'], div[data-testid='msg-container'], .message-in, .message-out, div[data-id]"
    );
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
        const span = textNode.querySelector("span.selectable-text, span._ao3e, div.copyable-text");
        text = span ? span.textContent?.trim() : textNode.textContent?.trim();
      }

      // Filter out system banners
      if (
        !text ||
        text.length < 2 ||
        text.includes("end-to-end encrypted") ||
        text.includes("Security code changed") ||
        text.includes("Messages and calls are end-to-end")
      ) {
        return;
      }

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
      messages: messages.slice(-30),
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
      messages: messages.slice(-30),
    };
  }

  // Analyze active chat via background worker
  function performScan(force = false) {
    if (!isProtectionEnabled) return;

    const badge = document.getElementById("kavach-live-badge");
    const chatData = activePlatform === "whatsapp" ? parseWhatsAppMessages() : parseTelegramMessages();

    if (!chatData || !chatData.messages.length) {
      if (force && badge) {
        badge.innerHTML = `<span class="kavach-status-dot" style="background:#ef4444;"></span><span>⚠️ Open a chat to scan</span>`;
        setTimeout(() => {
          badge.innerHTML = `<span class="kavach-status-dot"></span><span>🛡️ Kavach Active</span>`;
        }, 2500);
      }
      return;
    }

    const incoming = chatData.messages.filter((m) => m.sender !== "me");
    if (!incoming.length) {
      if (force && badge) {
        badge.innerHTML = `<span class="kavach-status-dot" style="background:#10b981;"></span><span>✓ Outgoing chat · Safe</span>`;
        setTimeout(() => {
          badge.innerHTML = `<span class="kavach-status-dot"></span><span>🛡️ Kavach Active</span>`;
        }, 2500);
      }
      return;
    }

    const fingerprint = incoming.slice(-4).map((m) => m.text).join("::");
    if (!force && fingerprint === lastScannedFingerprint) return;
    lastScannedFingerprint = fingerprint;

    if (force && badge) {
      badge.innerHTML = `<span class="kavach-status-dot" style="background:#6366f1;"></span><span>⚡ Groq AI Checking...</span>`;
    }

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
        if (!response || !response.ok) {
          if (force && badge) {
            badge.innerHTML = `<span class="kavach-status-dot" style="background:#ef4444;"></span><span>⚠️ Kavach API Offline</span>`;
            setTimeout(() => {
              badge.innerHTML = `<span class="kavach-status-dot"></span><span>🛡️ Kavach Active</span>`;
            }, 3000);
          }
          return;
        }

        const verdict = response.data;
        if (verdict.severity !== "low" && verdict.category !== "safe") {
          displayThreatBanner(verdict, chatData);
          if (badge) {
            badge.innerHTML = `<span class="kavach-status-dot" style="background:#ef4444;"></span><span>🚨 Threat Flagged</span>`;
          }
          chrome.runtime?.sendMessage?.({
            type: "THREAT_DETECTED",
            category: verdict.category,
            severity: verdict.severity,
            reason: verdict.reason,
            sender: chatData.contact_name,
          });
        } else {
          removeThreatBanner();
          if (badge) {
            badge.innerHTML = `<span class="kavach-status-dot" style="background:#10b981;"></span><span>🟢 ${chatData.messages.length} msgs · Safe</span>`;
            setTimeout(() => {
              badge.innerHTML = `<span class="kavach-status-dot"></span><span>🛡️ Kavach Active</span>`;
            }, 3500);
          }
        }
      }
    );
  }

  // Display high-visibility fixed banner
  function displayThreatBanner(verdict, chatData) {
    let existing = document.getElementById("kavach-threat-banner");
    if (!existing) {
      existing = document.createElement("div");
      existing.id = "kavach-threat-banner";
      existing.className = "kavach-shield-banner";
      document.body.appendChild(existing);
    }

    const categoryLabel = (verdict.category || "THREAT").replace(/_/g, " ").toUpperCase();
    const senderName = chatData.contact_name || "Sender";

    existing.innerHTML = `
      <div class="kavach-banner-top">
        <span class="kavach-threat-badge">🚨 KAVACH SHIELD: ${categoryLabel}</span>
        <span class="kavach-risk-score">Threat Score: ${verdict.risk_score}/100 (${(verdict.severity || "HIGH").toUpperCase()})</span>
      </div>
      <div class="kavach-banner-body">
        <strong>Harassment / Extortion Warning: Threat detected from ${senderName}:</strong>
        <br/><span style="opacity:0.95; font-size:12.5px; margin-top:4px; display:inline-block;">${verdict.reason}</span>
      </div>
      <div class="kavach-banner-acts">
        <button type="button" class="kavach-btn" id="kavach-act-vault">🔒 Save Evidence to Vault</button>
        <button type="button" class="kavach-btn kavach-btn-sos" id="kavach-act-sos">🚨 Trigger SOS to Guardians</button>
        <button type="button" class="kavach-btn" id="kavach-act-dismiss">Dismiss</button>
      </div>
    `;

    const vaultBtn = document.getElementById("kavach-act-vault");
    vaultBtn.onclick = () => {
      vaultBtn.disabled = true;
      vaultBtn.textContent = "⏳ Sealing Evidence in Vault...";

      const vaultPayload = {
        platform: chatData.platform,
        conversation: senderName,
        messages: chatData.messages.map((m) => ({
          ref: m.id,
          sender: m.sender,
          text: m.text,
          time: m.timestamp || "",
          flagged: m.sender !== "me",
        })),
        analysis: verdict,
        client_captured_at: new Date().toISOString(),
        incident_date: new Date().toISOString().slice(0, 10),
      };

      chrome.runtime?.sendMessage?.(
        {
          type: "SAVE_TO_VAULT",
          payload: vaultPayload,
        },
        (resp) => {
          if (resp && resp.ok) {
            vaultBtn.textContent = "✓ Sealed in Vault!";
            vaultBtn.style.background = "#10b981";
            vaultBtn.style.borderColor = "#10b981";
            setTimeout(() => {
              window.open("http://localhost:8000/index.html#vault", "_blank");
            }, 600);
          } else {
            vaultBtn.disabled = false;
            vaultBtn.textContent = "⚠️ Save Failed - Retry";
            console.error("Kavach Vault error:", resp?.error);
          }
        }
      );
    };

    document.getElementById("kavach-act-sos").onclick = () => {
      window.open("http://localhost:8000/index.html#guardians", "_blank");
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
