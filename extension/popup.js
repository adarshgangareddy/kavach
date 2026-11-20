const toggle = document.getElementById("toggle-shield");
const liveDot = document.getElementById("live-dot");
const liveText = document.getElementById("live-text");
const apiStatus = document.getElementById("api-status");
const threatCount = document.getElementById("threat-count");
const testBtn = document.getElementById("test-banner-btn");

chrome.storage.sync.get(["kavachEnabled", "threatCount", "kavachApiUrl"], async (data) => {
  const enabled = data.kavachEnabled !== false;
  toggle.checked = enabled;
  updateUI(enabled);
  threatCount.textContent = data.threatCount || 0;

  chrome.action.setBadgeText({ text: "" });

  const apiUrl = data.kavachApiUrl || "http://localhost:8000";
  try {
    const res = await fetch(`${apiUrl}/health`);
    if (res.ok) {
      apiStatus.textContent = "Online (Local API)";
      apiStatus.style.color = "#10b981";
    } else {
      throw new Error();
    }
  } catch {
    apiStatus.textContent = "Offline (Backend down)";
    apiStatus.style.color = "#ef4444";
  }
});

toggle.addEventListener("change", (e) => {
  const isEnabled = e.target.checked;
  chrome.storage.sync.set({ kavachEnabled: isEnabled });
  updateUI(isEnabled);
});

function updateUI(enabled) {
  if (enabled) {
    liveDot.className = "dot";
    liveText.textContent = "Shield Active";
  } else {
    liveDot.className = "dot off";
    liveText.textContent = "Shield Paused";
  }
}

// Test trigger in the active WhatsApp/Telegram tab
testBtn?.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0]) return;
    chrome.scripting?.executeScript?.({
      target: { tabId: tabs[0].id },
      func: () => {
        const badge = document.getElementById("kavach-live-badge");
        if (badge) badge.click();
        else alert("Open WhatsApp Web or Telegram Web tab first to see the in-chat banner!");
      },
    });
  });
});
