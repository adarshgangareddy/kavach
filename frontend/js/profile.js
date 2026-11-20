/**
 * Kavach Profile & Emergency Responders Module
 * Manages user legal details for auto-inclusion in police complaint drafts,
 * and emergency helplines & nearby community responders.
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
  const profCity = $("#prof-city");
  const profAddress = $("#prof-address");
  const profReset = $("#prof-reset-btn");

  // Responders Elements
  const respView = $("#responders-view");

  // ---------- Profile Controller ----------
  async function openProfile() {
    window.kavachImport?.close();
    window.kavachVault?.close();
    window.kavachComplaint?.close();
    window.kavachGuardians?.close();
    window.kavachResponders?.close();
    window.kavachMobile?.show("main");
    if (profView) profView.hidden = false;
    document.body.classList.remove("at-home");
    loadProfile();
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
        if (profName) profName.value = u.full_name || u.username || "";
        if (profPhone) profPhone.value = u.phone || "";
        if (profEmail) profEmail.value = u.email || "";
        if (profCity) profCity.value = u.city || "";
        if (profAddress) profAddress.value = u.address || "";

        // Sync with localStorage so complaints immediately reflect this
        localStorage.setItem(
          "kavach.myDetails",
          JSON.stringify({
            name: u.full_name || u.username || "",
            phone: u.phone || "",
            email: u.email || "",
            city: u.city || "",
            address: u.address || "",
          })
        );
      }
    } catch (err) {
      console.warn("Could not load user profile:", err);
    }
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
        localStorage.setItem(
          "kavach.myDetails",
          JSON.stringify({
            name: payload.full_name,
            phone: payload.phone,
            email: profEmail?.value?.trim() || "",
            city: payload.city,
            address: payload.address,
          })
        );
        window.kavach?.toast("✓ Profile saved! Will automatically autofill all police complaints.");
      } else {
        const err = await res.text();
        window.kavach?.toast("Failed to update profile: " + err);
      }
    } catch (err) {
      window.kavach?.toast("Network error updating profile: " + err.message);
    }
  });

  profReset?.addEventListener("click", () => {
    if (confirm("Reset profile fields?")) {
      profForm?.reset();
      localStorage.removeItem("kavach.myDetails");
    }
  });

  // ---------- Responders Controller ----------
  function openResponders() {
    window.kavachImport?.close();
    window.kavachVault?.close();
    window.kavachComplaint?.close();
    window.kavachGuardians?.close();
    window.kavachProfile?.close();
    window.kavachMobile?.show("main");
    if (respView) respView.hidden = false;
    document.body.classList.remove("at-home");
  }

  function closeResponders() {
    if (respView) respView.hidden = true;
  }

  window.kavachProfile = { open: openProfile, close: closeProfile, loadProfile };
  window.kavachResponders = { open: openResponders, close: closeResponders };

  // Initial load
  loadProfile();
})();
