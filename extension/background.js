/**
 * Background Service Worker for Kavach Live Chat Shield.
 * Handles desktop push notifications, badging, and background API proxying
 * (avoids mixed-content / CORS blocking from HTTPS WhatsApp Web to HTTP localhost).
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    kavachEnabled: true,
    kavachApiUrl: "http://localhost:8000",
    threatCount: 0,
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ANALYZE_CHAT") {
    chrome.storage.sync.get(["kavachApiUrl"], (cfg) => {
      const apiUrl = cfg.kavachApiUrl || "http://localhost:8000";
      fetch(`${apiUrl}/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kavach-Client": "extension"
        },
        credentials: "include",
        body: JSON.stringify(msg.payload),
      })
        .then(async (res) => {
          if (!res.ok) {
            const errText = await res.text();
            sendResponse({ ok: false, error: errText || `HTTP ${res.status}` });
          } else {
            const data = await res.json();
            sendResponse({ ok: true, data });
          }
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });
    });
    return true; // Keep message channel open for async sendResponse
  }

  if (msg.type === "SAVE_TO_VAULT") {
    chrome.storage.sync.get(["kavachApiUrl"], (cfg) => {
      const apiUrl = cfg.kavachApiUrl || "http://localhost:8000";
      fetch(`${apiUrl}/evidence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kavach-Client": "extension"
        },
        credentials: "include",
        body: JSON.stringify(msg.payload),
      })
        .then(async (res) => {
          if (!res.ok) {
            const errText = await res.text();
            sendResponse({ ok: false, error: errText || `HTTP ${res.status}` });
          } else {
            const data = await res.json();
            sendResponse({ ok: true, data });
          }
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });
    });
    return true; // Keep message channel open for async sendResponse
  }

  if (msg.type === "TRIGGER_AUTO_ALERT") {
    chrome.storage.sync.get(["kavachApiUrl"], (cfg) => {
      const apiUrl = cfg.kavachApiUrl || "http://localhost:8000";
      fetch(`${apiUrl}/sos/auto-alert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kavach-Client": "extension"
        },
        credentials: "include",
        body: JSON.stringify(msg.payload),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          sendResponse({ ok: res.ok, data });
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });
    });
    return true;
  }

  if (msg.type === "THREAT_DETECTED") {
    // Set badge warning on extension icon
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });

    // Increment threat counter
    chrome.storage.sync.get(["threatCount"], (data) => {
      const count = (data.threatCount || 0) + 1;
      chrome.storage.sync.set({ threatCount: count });
    });

    // Native Desktop Notification
    chrome.notifications.create({
      type: "basic",
      iconUrl: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ef4444'><path d='M12 2L1 21h22L12 2zm0 3.5L20 19H4L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z'/></svg>",
      title: `🚨 Kavach Alert: ${msg.category.replace(/_/g, " ").toUpperCase()}`,
      message: `Threat from ${msg.sender}: ${msg.reason.slice(0, 100)}...`,
      priority: 2,
    });
    sendResponse({ received: true });
  }
});
