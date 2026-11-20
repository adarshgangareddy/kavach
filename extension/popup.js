const toggle = document.getElementById("toggle-shield");
const liveDot = document.getElementById("live-dot");
const liveText = document.getElementById("live-text");
const apiStatus = document.getElementById("api-status");
const threatCount = document.getElementById("threat-count");

chrome.storage.sync.get(["kavachEnabled", "threatCount", "kavachApiUrl"], async (data) => {
  const enabled = data.kavachEnabled !== false;
  toggle.checked = enabled;
  updateUI(enabled);
  threatCount.textContent = data.threatCount || 0;

  // Clear badge upon opening popup
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

