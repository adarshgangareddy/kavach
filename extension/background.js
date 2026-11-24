/**
 * Background Service Worker for Kavach Live Chat Shield.
 * Handles desktop push notifications, badging, background API proxying,
 * and authenticated session linking with the local Kavach web app.
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    kavachEnabled: true,
    kavachApiUrl: "http://127.0.0.1:8000",
    threatCount: 0,
  });
});

// Retrieve the session token from Kavach cookies (supports both 127.0.0.1 and localhost)
async function getKavachAuth() {
  return new Promise((resolve) => {
    if (!chrome.cookies) return resolve({ token: null, host: null });
    chrome.cookies.getAll({ name: "kavach_session" }, (cookies) => {
      if (cookies && cookies.length > 0) {
        cookies.sort((a, b) => (b.expirationDate || 0) - (a.expirationDate || 0));
        const cookie = cookies[0];
        const domain = (cookie.domain || "").replace(/^\./, "");
        const host = domain.includes("127.0.0.1") ? "http://127.0.0.1:8000" : "http://localhost:8000";
        return resolve({ token: cookie.value, host: host });
      }
      resolve({ token: null, host: null });
    });
  });
}

// Find working API endpoint
async function resolveApiBase() {
  const auth = await getKavachAuth();
  const cfg = await new Promise((r) => chrome.storage.sync.get(["kavachApiUrl"], r));
  const candidates = [
    auth.host,
    cfg?.kavachApiUrl,
    "http://127.0.0.1:8000",
    "http://localhost:8000",
  ].filter(Boolean);

  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1200) });
      if (res.ok) return { apiUrl: url, token: auth.token };
    } catch {}
  }
  return { apiUrl: cfg?.kavachApiUrl || "http://127.0.0.1:8000", token: auth.token };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ANALYZE_CHAT") {
    resolveApiBase().then(({ apiUrl, token }) => {
      const headers = {
        "Content-Type": "application/json",
        "X-Kavach-Client": "extension",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        headers["X-Kavach-Token"] = token;
      }

      fetch(`${apiUrl}/analyze`, {
        method: "POST",
        headers: headers,
        credentials: "include",
        body: JSON.stringify(msg.payload),
      })
        .then(async (res) => {
          if (!res.ok) {
            const errText = await res.text();
            sendResponse({ ok: false, error: errText || `HTTP ${res.status}` });
          } else {
            const data = await res.json();
            sendResponse({ ok: true, data, apiUrl });
          }
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });
    });
    return true; // Keep message channel open for async sendResponse
  }

  if (msg.type === "SAVE_TO_VAULT") {
    resolveApiBase().then(({ apiUrl, token }) => {
      const headers = {
        "Content-Type": "application/json",
        "X-Kavach-Client": "extension",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        headers["X-Kavach-Token"] = token;
      }

      fetch(`${apiUrl}/evidence`, {
        method: "POST",
        headers: headers,
        credentials: "include",
        body: JSON.stringify(msg.payload),
      })
        .then(async (res) => {
          if (!res.ok) {
            const errText = await res.text();
            sendResponse({ ok: false, error: errText || `HTTP ${res.status}` });
          } else {
            const data = await res.json();
            sendResponse({ ok: true, data, apiUrl });
          }
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });
    });
    return true;
  }

  if (msg.type === "TRIGGER_AUTO_ALERT") {
    resolveApiBase().then(({ apiUrl, token }) => {
      const headers = {
        "Content-Type": "application/json",
        "X-Kavach-Client": "extension",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        headers["X-Kavach-Token"] = token;
      }

      fetch(`${apiUrl}/sos/auto-alert`, {
        method: "POST",
        headers: headers,
        credentials: "include",
        body: JSON.stringify(msg.payload),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          sendResponse({ ok: res.ok, data, apiUrl });
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });
    });
    return true;
  }

  if (msg.type === "GET_KAVACH_SESSION") {
    resolveApiBase().then(({ apiUrl, token }) => {
      const headers = { "X-Kavach-Client": "extension" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      fetch(`${apiUrl}/auth/me`, { headers, credentials: "include" })
        .then((r) => r.json())
        .then((u) => sendResponse({ ok: true, user: u, apiUrl, token }))
        .catch((err) => sendResponse({ ok: false, error: err.message, apiUrl }));
    });
    return true;
  }

  if (msg.type === "THREAT_DETECTED") {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });

    chrome.storage.sync.get(["threatCount"], (data) => {
      const count = (data.threatCount || 0) + 1;
      chrome.storage.sync.set({ threatCount: count });
    });

    const isCritical = (msg.risk_score || 0) >= 95;
    chrome.notifications.create({
      type: "basic",
      iconUrl: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ef4444'><path d='M12 2L1 21h22L12 2zm0 3.5L20 19H4L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z'/></svg>",
      title: isCritical
        ? `🚨 CRITICAL EMERGENCY (Score: ${msg.risk_score}%): ${msg.category.replace(/_/g, " ").toUpperCase()}`
        : `⚠️ Kavach Alert: ${msg.category.replace(/_/g, " ").toUpperCase()} (${msg.risk_score}%)`,
      message: `Threat from ${msg.sender}: ${msg.reason.slice(0, 110)}...`,
      priority: 2,
    });
    sendResponse({ received: true });
  }
});
