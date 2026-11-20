/**
 * Kavach Profile & Responders Controller
 * Manages modern e-commerce style user profile & verified community responders network.
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
        window.kavach?.toast("✓ Profile saved! Legal complainant details will autofill into all police reports.");
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

  // ---------- Responders Controller ----------
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

  async function loadResponders() {
    if (!respList) return;
    try {
      const res = await fetch(`${API}/responders`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const responders = data.responders || [];

      if (!responders.length) {
        respList.innerHTML = `
          <div style="padding: 24px; text-align: center; background: rgba(255,255,255,0.02); border: 1px dashed var(--border); border-radius: 8px;">
            <div style="font-size: 24px; margin-bottom: 6px;">🛡️</div>
            <strong style="display:block; margin-bottom: 4px;">No Community Responders Registered Yet</strong>
            <small style="color:var(--muted);">Be the first trusted safety volunteer to join the rapid incident triage network using the form on the right.</small>
          </div>
        `;
        return;
      }

      respList.innerHTML = responders
        .map((r) => {
          const initials = (r.name || "R")[0].toUpperCase();
          const org = r.relationship !== "Guardian" ? r.relationship : "Community Volunteer";
          const tgBadge = r.telegram_linked
            ? '<span class="glass-badge" style="color:#3ecf8e; border-color:rgba(62,207,142,0.3);">Telegram Active</span>'
            : '<span class="glass-badge" style="color:var(--muted);">Awaiting Bot Link</span>';

          return `
            <div class="glass-card" style="padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 14px;">
                <div style="width: 42px; height: 42px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #3ecf8e); display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; font-size: 16px;">
                  ${initials}
                </div>
                <div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <strong style="font-size: 14.5px; color: var(--text);">${r.name}</strong>
                    <span class="glass-badge" style="color: #6366f1; border-color: rgba(99,102,241,0.3); font-size: 10px;">${org}</span>
                  </div>
                  <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">
                    📧 ${r.email || "No email"} · 📞 ${r.phone || "No phone"}
                  </div>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 10px;">
                ${tgBadge}
                <a href="tel:${r.phone}" class="btn btn--ghost small" style="font-size: 11px; padding: 4px 10px;">Call Volunteer</a>
              </div>
            </div>
          `;
        })
        .join("");
    } catch (err) {
      console.warn("Could not load responders:", err);
      respList.innerHTML = `<p class="muted" style="font-size: 12px;">Offline or could not reach responders network.</p>`;
    }
  }

  respForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      kind: "responder",
      name: respName?.value?.trim() || "",
      email: respEmail?.value?.trim() || "",
      phone: respPhone?.value?.trim() || "",
      relationship: respOrg?.value?.trim() || "Safety Volunteer",
    };

    try {
      const res = await fetch(`${API}/people`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        respForm.reset();
        window.kavach?.toast("✓ Registered as First Responder! You are now part of the emergency triage network.");
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
    if (!googleAccountPopover) return;
    const isHidden = googleAccountPopover.style.display === "none" || !googleAccountPopover.style.display;
    googleAccountPopover.style.display = isHidden ? "block" : "none";
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
})();
