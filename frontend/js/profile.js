/**
 * Kavach Profile & Responders Controller
 * Manages modern e-commerce style user profile & dynamic proximity-based responders network.
 */

(() => {
  const API = new URLSearchParams(location.search).get("api") || "";
  const $ = (sel) => document.querySelector(sel);

  // Profile Elements
  const profView = $("#profile-view");
  const profForm = $("#profile-form");
  const profName = $("#prof-name");
  const profPhone = $("#prof-phone");
  const profEmail = $("#prof-email");
  const profAltPhone = $("#prof-alt-phone");
  const profCity = $("#prof-city");
  const profAddress = $("#prof-address");
  const profPoliceStation = $("#prof-police-station");
  const profReset = $("#prof-reset-btn");

  const profAvatar = $("#prof-avatar-letter");
  const profDisplayName = $("#prof-display-name");
  const profDisplayEmail = $("#prof-display-email");
  const profKpiGuardians = $("#prof-kpi-guardians");

  const profBackBtn = $("#prof-back-btn");
  const profNextBtn = $("#prof-next-btn");

  // Google Top-Right Account Popover Elements
  const googleAccountBtn = $("#google-account-btn");
  const googleAccountPopover = $("#google-account-popover");
  const topAvatarLetter = $("#top-avatar-letter");
  const popoverAvatarLetter = $("#popover-avatar-letter");
  const popoverName = $("#popover-name");
  const popoverEmail = $("#popover-email");
  const popoverProfileBtn = $("#popover-profile-btn");

  // Responders Elements
  const respView = $("#responders-view");
  const respList = $("#responders-list");
  const respForm = $("#add-responder-form");
  const respName = $("#resp-name");
  const respEmail = $("#resp-email");
  const respPhone = $("#resp-phone");
  const respOrg = $("#resp-org");
  const respCitySelect = $("#resp-city-select");
  const respLatInput = $("#resp-lat");
  const respLngInput = $("#resp-lng");

  const userZoneSelect = $("#user-zone-select");
  const detectGpsBtn = $("#detect-gps-btn");
  const filterStatus = $("#responders-filter-status");

  // Default user location: try localStorage first, fallback to Bengaluru Center
  let savedLat = parseFloat(localStorage.getItem("kavach_user_lat"));
  let savedLng = parseFloat(localStorage.getItem("kavach_user_lng"));
  let currentCoord = (!isNaN(savedLat) && !isNaN(savedLng))
    ? { lat: savedLat, lng: savedLng, label: "Live Device GPS" }
    : { lat: 12.9716, lng: 77.5946, label: "Bengaluru" };

  // Automatic Location Sync & Permission Manager (Interval: 1 minute = 60s)
  const locBanner = $("#location-permission-banner");
  const grantLocBtn = $("#grant-location-btn");
  let locationCheckTimer = null;
  let isLocationGranted = false;

  function initLocationSync() {
    requestDeviceLocation(false);

    if (locationCheckTimer) clearInterval(locationCheckTimer);
    locationCheckTimer = setInterval(() => {
      if (!isLocationGranted) {
        requestDeviceLocation(true);
      }
    }, 60000);

    grantLocBtn?.addEventListener("click", () => {
      requestDeviceLocation(true);
    });
  }

  function requestDeviceLocation(isPeriodic = false) {
    if (!navigator.geolocation) {
      if (locBanner) locBanner.style.display = "none";
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        isLocationGranted = true;
        if (locBanner) locBanner.style.display = "none";
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        currentCoord = { lat, lng, label: "Live Device GPS" };
        try {
          localStorage.setItem("kavach_user_lat", lat.toString());
          localStorage.setItem("kavach_user_lng", lng.toString());
        } catch {}

        if (filterStatus) {
          filterStatus.textContent = `📍 Live GPS: ${lat.toFixed(4)}°, ${lng.toFixed(4)}° · 30 km safety radius`;
        }

        // Auto reload responders if view is open
        if (respView && !respView.hidden) {
          loadResponders();
        }

        // Watch position for live movements (e.g. traveling between Bengaluru & Chikkaballapur)
        try {
          navigator.geolocation.watchPosition(
            (p) => {
              isLocationGranted = true;
              currentCoord.lat = p.coords.latitude;
              currentCoord.lng = p.coords.longitude;
              currentCoord.label = "Live Device GPS";
              try {
                localStorage.setItem("kavach_user_lat", p.coords.latitude.toString());
                localStorage.setItem("kavach_user_lng", p.coords.longitude.toString());
              } catch {}
              if (respView && !respView.hidden) {
                loadResponders();
              }
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 30000 }
          );
        } catch {}
      },
      (err) => {
        isLocationGranted = false;
        if (locBanner) {
          locBanner.style.display = "flex";
        }
        if (isPeriodic) {
          window.kavach?.toast("📍 Please allow location access to auto-detect nearby responders and dispatch emergency SOS.");
        }
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  }

  // ---------- Profile Controller ----------
  async function openProfile() {
    window.kavachImport?.close();
    window.kavachVault?.close();
    window.kavachComplaint?.close();
    window.kavachGuardians?.close();
    window.kavachSos?.close();
    window.kavachResponders?.close();
    const mc = document.querySelector("#mock-chat-container");
    if (mc) mc.hidden = true;
    document.body.classList.add("left-collapsed");
    document.body.classList.remove("shield-open");
    window.kavachMobile?.show("main");
    if (profView) profView.hidden = false;
    document.body.classList.remove("at-home");
    await loadProfile();
  }

  function closeProfile() {
    if (profView) profView.hidden = true;
  }

  profBackBtn?.addEventListener("click", () => {
    window.kavachNav?.go("guardians");
  });

  profNextBtn?.addEventListener("click", () => {
    window.kavachNav?.go("safetyspace");
  });

  async function loadProfile() {
    try {
      const res = await fetch(`${API}/auth/profile`);
      if (res.ok) {
        const data = await res.json();
        const u = data.user || {};
        const name = u.full_name || u.username || "Kavach User";
        const email = u.email || "user@kavach.safety";

        if (profAvatar) profAvatar.textContent = (name[0] || "U").toUpperCase();
        if (profDisplayName) profDisplayName.textContent = name;
        if (profDisplayEmail) profDisplayEmail.textContent = email;

        // Sync top-right Google avatar and popover card
        if (topAvatarLetter) topAvatarLetter.textContent = (name[0] || "U").toUpperCase();
        if (popoverAvatarLetter) popoverAvatarLetter.textContent = (name[0] || "U").toUpperCase();
        if (popoverName) popoverName.textContent = name;
        if (popoverEmail) popoverEmail.textContent = email;

        if (profName) profName.value = u.full_name || u.username || "";
        if (profPhone) profPhone.value = u.phone || "";
        if (profEmail) profEmail.value = u.email || "";
        if (profCity) profCity.value = u.city || "";
        if (profAddress) profAddress.value = u.address || "";

        // Check local storage for complementary fields (alternate phone, nearest police station)
        try {
          const stored = JSON.parse(localStorage.getItem("kavach.myDetails") || "{}");
          if (profAltPhone && stored.alt_phone) profAltPhone.value = stored.alt_phone;
          if (profPoliceStation && stored.police_station) profPoliceStation.value = stored.police_station;
        } catch {}

        syncLocalStorage();
      }

      // Sync KPI count for guardians
      try {
        const sRes = await fetch(`${API}/sos/setup`);
        if (sRes.ok) {
          const sData = await sRes.json();
          const count = sData.contacts?.length || 0;
          if (profKpiGuardians) profKpiGuardians.textContent = `${count} Guardian${count === 1 ? "" : "s"} Active`;
        }
      } catch {}
    } catch (err) {
      console.warn("Could not load user profile:", err);
    }
  }

  function syncLocalStorage() {
    try {
      const details = {
        name: profName?.value?.trim() || profDisplayName?.textContent || "",
        phone: profPhone?.value?.trim() || "",
        email: profEmail?.value?.trim() || profDisplayEmail?.textContent || "",
        city: profCity?.value?.trim() || "",
        address: profAddress?.value?.trim() || "",
        alt_phone: profAltPhone?.value?.trim() || "",
        police_station: profPoliceStation?.value?.trim() || "",
      };
      localStorage.setItem("kavach.myDetails", JSON.stringify(details));
    } catch {}
  }

  profForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      full_name: profName?.value?.trim() || "",
      phone: profPhone?.value?.trim() || "",
      city: profCity?.value?.trim() || "",
      address: profAddress?.value?.trim() || "",
    };

    try {
      const res = await fetch(`${API}/auth/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        syncLocalStorage();
        if (profDisplayName) profDisplayName.textContent = payload.full_name || "Kavach User";
        if (profAvatar) profAvatar.textContent = (payload.full_name[0] || "U").toUpperCase();
        window.kavach?.toast("✓ Profile saved! Complainant details will auto-fill into police petitions.");
      } else {
        const err = await res.text();
        window.kavach?.toast("Failed to update profile: " + err);
      }
    } catch (err) {
      window.kavach?.toast("Network error updating profile: " + err.message);
    }
  });

  profReset?.addEventListener("click", () => {
    if (confirm("Clear profile fields?")) {
      profForm?.reset();
      localStorage.removeItem("kavach.myDetails");
      window.kavach?.toast("Fields cleared");
    }
  });

  // ---------- Responders Proximity & Location Controller ----------
  async function openResponders() {
    window.kavachImport?.close();
    window.kavachVault?.close();
    window.kavachComplaint?.close();
    window.kavachGuardians?.close();
    window.kavachSos?.close();
    window.kavachProfile?.close();
    const mc = document.querySelector("#mock-chat-container");
    if (mc) mc.hidden = true;
    document.body.classList.add("left-collapsed");
    document.body.classList.remove("shield-open");
    window.kavachMobile?.show("main");
    if (respView) respView.hidden = false;
    document.body.classList.remove("at-home");
    await loadResponders();
  }

  function closeResponders() {
    if (respView) respView.hidden = true;
  }

  // City presets with coordinates
  const CITY_COORDS = {
    "12.9716,77.5946": { name: "Bengaluru", lat: 12.9716, lng: 77.5946 },
    "13.4355,77.7315": { name: "Chikkaballapur", lat: 13.4355, lng: 77.7315 },
    "12.2958,76.6394": { name: "Mysuru", lat: 12.2958, lng: 76.6394 },
    "12.9141,74.8560": { name: "Mangaluru", lat: 12.9141, lng: 74.8560 },
    "15.3647,75.1240": { name: "Hubballi", lat: 15.3647, lng: 75.1240 },
  };

  userZoneSelect?.addEventListener("change", () => {
    const val = userZoneSelect.value;
    if (CITY_COORDS[val]) {
      currentCoord = CITY_COORDS[val];
      loadResponders();
    }
  });

  detectGpsBtn?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      window.kavach?.toast("Geolocation is not supported by your browser.");
      return;
    }
    detectGpsBtn.disabled = true;
    detectGpsBtn.textContent = "Acquiring GPS…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        currentCoord = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Live Device GPS" };
        detectGpsBtn.disabled = false;
        detectGpsBtn.textContent = "✓ GPS Set";
        window.kavach?.toast(`📍 Proximity set to Device GPS: ${currentCoord.lat.toFixed(4)}, ${currentCoord.lng.toFixed(4)}`);
        loadResponders();
      },
      (err) => {
        detectGpsBtn.disabled = false;
        detectGpsBtn.textContent = "🎯 GPS";
        window.kavach?.toast("Could not acquire device GPS: " + err.message);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  });

  respCitySelect?.addEventListener("change", () => {
    const val = respCitySelect.value;
    if (val === "custom") {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (respLatInput) respLatInput.value = pos.coords.latitude;
            if (respLngInput) respLngInput.value = pos.coords.longitude;
            window.kavach?.toast(`✓ GPS Coordinates captured: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
          },
          (err) => {
            window.kavach?.toast("Could not read device GPS. Falling back to default.");
            if (respLatInput) respLatInput.value = 12.9716;
            if (respLngInput) respLngInput.value = 77.5946;
          },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      }
    } else if (CITY_COORDS[val]) {
      if (respLatInput) respLatInput.value = CITY_COORDS[val].lat;
      if (respLngInput) respLngInput.value = CITY_COORDS[val].lng;
    }
  });

  async function loadResponders() {
    if (!respList) return;
    try {
      const { lat, lng, label } = currentCoord;
      if (filterStatus) {
        filterStatus.textContent = `Proximity center: ${label || `${lat.toFixed(2)}°, ${lng.toFixed(2)}°`} · Safety radius: 30 km`;
      }

      const res = await fetch(`${API}/responders?lat=${lat}&lng=${lng}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const responders = data.responders || [];

      if (!responders.length) {
        respList.innerHTML = `
          <div style="padding: 28px; text-align: center; background: rgba(255,255,255,0.02); border: 1px dashed var(--border); border-radius: 16px;">
            <div style="font-size: 28px; margin-bottom: 8px;">🛡️</div>
            <strong style="display:block; margin-bottom: 4px; font-size: 15px;">No Community Responders Registered Yet</strong>
            <small style="color:var(--muted); font-size: 12.5px;">Be the first trusted safety volunteer to join the rapid incident triage network using the form on the right.</small>
          </div>
        `;
        return;
      }

      const nearby = responders.filter((r) => r.is_nearby);
      const outside = responders.filter((r) => !r.is_nearby);

      function renderCard(r) {
        const initials = (r.name || "R")[0].toUpperCase();
        const org = r.relationship !== "Guardian" ? r.relationship : "Safety Volunteer";
        const tgBadge = r.telegram_linked
          ? '<span class="glass-badge" style="color:#3ecf8e; border-color:rgba(62,207,142,0.3); font-size:10px;">✓ Telegram Linked</span>'
          : '<span class="glass-badge" style="color:var(--muted); font-size:10px;">Awaiting Bot Link</span>';

        const distanceTag = r.distance_km !== null
          ? r.is_nearby
            ? `<span class="glass-badge" style="color:#10b981; border-color:rgba(16,185,129,0.35); font-weight:700;">📍 ${r.distance_km} km away · Within Radius</span>`
            : `<span class="glass-badge" style="color:#f5a524; border-color:rgba(245,165,36,0.35);">📍 ${r.distance_km} km away · Outside Zone</span>`
          : '<span class="glass-badge" style="color:var(--muted);">No Location</span>';

        return `
          <div class="glass-card" style="padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; border-radius: 16px; border-color: ${r.is_nearby ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"};">
            <div style="display: flex; align-items: center; gap: 14px;">
              <div style="width: 44px; height: 44px; border-radius: 50%; background: ${r.is_nearby ? "linear-gradient(135deg, #10b981, #6366f1)" : "linear-gradient(135deg, #64748b, #475569)"}; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; font-size: 16px; box-shadow: 0 4px 14px rgba(0,0,0,0.3);">
                ${initials}
              </div>
              <div>
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <strong style="font-size: 14.5px; color: var(--text);">${r.name}</strong>
                  <span class="glass-badge" style="color: #a5b4fc; border-color: rgba(99,102,241,0.3); font-size: 10px;">${org}</span>
                  ${distanceTag}
                </div>
                <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">
                  📧 ${r.email || "No email"} · 📞 ${r.phone || "No phone"}
                </div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              ${tgBadge}
              ${r.phone ? `<a href="tel:${r.phone}" class="btn btn--primary small" style="background:#10b981; border-color:#10b981; color:#fff; font-size: 11.5px; padding: 5px 12px; border-radius: 8px; text-decoration: none; font-weight:600;">📞 Call</a>` : ""}
              <button type="button" class="btn btn--ghost small" data-update-loc="${r.id}" data-name="${r.name}" style="font-size: 11px; padding: 5px 10px; border-radius: 8px;" title="Sync this responder's location to current device GPS">
                📍 Sync GPS
              </button>
            </div>
          </div>
        `;
      }

      let html = "";
      if (nearby.length) {
        html += `
          <div style="margin-bottom: 8px;">
            <strong style="color: #10b981; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px;">
              <span>🟢</span> Nearby Responders Ready for Dispatch (${nearby.length})
            </strong>
          </div>
          ${nearby.map(renderCard).join("")}
        `;
      } else {
        html += `
          <div style="padding: 16px 20px; background: rgba(245,165,36,0.08); border: 1px dashed rgba(245,165,36,0.3); border-radius: 14px; margin-bottom: 12px;">
            <strong style="color: #f5a524; font-size: 13px; display: block; margin-bottom: 2px;">⚠️ No Active Responders Inside This 30 km Zone</strong>
            <small style="color: var(--muted); font-size: 12px;">Responders registered in other regions will not be alerted for emergencies in ${currentCoord.label || "this location"}.</small>
          </div>
        `;
      }

      if (outside.length) {
        html += `
          <div style="margin-top: 18px; margin-bottom: 8px;">
            <strong style="color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">
              🌐 Active in Other Regions / Beyond 30 km (${outside.length})
            </strong>
          </div>
          ${outside.map(renderCard).join("")}
        `;
      }

      respList.innerHTML = html;
    } catch (err) {
      console.warn("Could not load responders:", err);
      respList.innerHTML = `<p class="muted" style="font-size: 12px;">Offline or could not reach responders network.</p>`;
    }
  }

  // Handle Responder Update Location with Live GPS (No manual prompts)
  respList?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-update-loc]");
    if (!btn) return;
    const rid = btn.dataset.updateLoc;
    const rname = btn.dataset.name || "Responder";

    if (!navigator.geolocation) {
      window.kavach?.toast("Geolocation is not supported by your browser.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Acquiring GPS…";

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const newLat = pos.coords.latitude;
        const newLng = pos.coords.longitude;
        try {
          btn.textContent = "Updating…";
          const res = await fetch(`${API}/people/${rid}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: newLat, lng: newLng }),
          });
          if (res.ok) {
            window.kavach?.toast(`✓ ${rname} live location updated to ${newLat.toFixed(4)}, ${newLng.toFixed(4)}!`);
            await loadResponders();
          } else {
            const err = await res.text();
            window.kavach?.toast("Update failed: " + err);
          }
        } catch (err) {
          window.kavach?.toast("Network error: " + err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = "📍 Sync GPS";
        }
      },
      (err) => {
        btn.disabled = false;
        btn.textContent = "📍 Sync GPS";
        window.kavach?.toast("Could not read device GPS: " + err.message);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  });

  respForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const latVal = parseFloat(respLatInput?.value) || 12.9716;
    const lngVal = parseFloat(respLngInput?.value) || 77.5946;

    const payload = {
      kind: "responder",
      name: respName?.value?.trim() || "",
      email: respEmail?.value?.trim() || "",
      phone: respPhone?.value?.trim() || "",
      relationship: respOrg?.value?.trim() || "Safety Volunteer",
      lat: latVal,
      lng: lngVal,
    };

    try {
      const res = await fetch(`${API}/people`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        respForm.reset();
        window.kavach?.toast("✓ Registered as First Responder with base location! You will receive proximity alerts.");
        await loadResponders();
      } else {
        const err = await res.text();
        window.kavach?.toast("Registration error: " + err);
      }
    } catch (err) {
      window.kavach?.toast("Network error: " + err.message);
    }
  });

  // ---------- Google Account Popover Controller ----------
  googleAccountBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (googleAccountPopover) googleAccountPopover.style.display = "none";
    if (window.kavachNav) {
      window.kavachNav.go("profile");
    } else {
      openProfile();
    }
  });

  popoverProfileBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (googleAccountPopover) googleAccountPopover.style.display = "none";
    if (window.kavachNav) {
      window.kavachNav.go("profile");
    } else {
      openProfile();
    }
  });

  document.addEventListener("click", (e) => {
    if (googleAccountPopover && !googleAccountPopover.contains(e.target) && !googleAccountBtn?.contains(e.target)) {
      googleAccountPopover.style.display = "none";
    }
  });

  window.kavachProfile = { open: openProfile, close: closeProfile, loadProfile };
  window.kavachResponders = { open: openResponders, close: closeResponders, loadResponders };

  // Initial load
  loadProfile();
  initLocationSync();
})();
