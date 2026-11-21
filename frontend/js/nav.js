// Top navigation, the home screen, and the phone layout.
//
// The feature screens (Shield, Vault, SOS) already know how to open themselves;
// this file leaves / returns to the home screen, keeps the nav highlight right, and on
// phones shows one pane at a time (chat list, main screen, or side panel).
(() => {
  const API = new URLSearchParams(location.search).get("api") || "";
  const body = document.body;
  const links = [...document.querySelectorAll(".nav-link[data-nav]")];
  const tabs = [...document.querySelectorAll(".tabbar [data-tab]")];
  const phone = window.matchMedia("(max-width: 820px)");

  function setActive(name) {
    links.forEach((l) => l.classList.toggle("active", l.dataset.nav === name));
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === (name || "home")));
  }

  function leaveHome() {
    body.classList.remove("at-home");
  }

  function goHome() {
    body.classList.add("at-home");
    setActive(null);
    mobile.pill(null);
  }

  function closeAllViews() {
    window.kavachVault?.close();
    window.kavachImport?.close();
    window.kavachComplaint?.close();
    window.kavachSos?.close();
    window.kavachResponders?.close();
    window.kavachProfile?.close();
    window.kavachSettings?.close();

    const views = ["#import-view", "#vault-view", "#complaint-view", "#guardians-view", "#safetyspace-view", "#responders-view", "#profile-view", "#settings-view"];
    views.forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) el.hidden = true;
    });

    const mc = document.querySelector("#mock-chat-container");
    if (mc) mc.hidden = true;

    const chatArea = document.querySelector("#chat-area");
    if (chatArea) chatArea.hidden = true;

    body.classList.remove("vaulting", "sosing", "calling");
  }

  function go(where) {
    if (where === "home") {
      body.classList.remove("menu-open");
      closeAllViews();
      return goHome();
    }
    body.classList.remove("menu-open");
    leaveHome();
    closeAllViews();

    const stTrigger = document.querySelector("#safetyspace-mobile-trigger");
    const contactsEyebrow = document.querySelector("#contacts-eyebrow");

    if (where === "safetyspace" || where === "shield") {
      window.kavachSos?.open();
      const el = document.querySelector("#safetyspace-view");
      if (el) el.hidden = false;
      body.classList.add("left-collapsed");
      body.classList.remove("shield-mode");
      setActive("safetyspace");
    } else if (where === "guardians" || where === "sos") {
      window.kavachSos?.open();
      window.kavachSos?.loadSetup?.();
      const el = document.querySelector("#guardians-view");
      if (el) el.hidden = false;
      body.classList.add("left-collapsed");
      body.classList.remove("shield-mode");
      setActive("guardians");
    } else if (where === "scan") {
      window.kavachSos?.close();
      const ssView = document.querySelector("#safetyspace-view");
      if (ssView) ssView.hidden = true;
      document.querySelector("#import-btn")?.click();
      body.classList.add("left-collapsed");
      body.classList.add("shield-mode");
      setActive("safetyspace");
    } else if (where === "vault") {
      window.kavachVault?.open();
      const el = document.querySelector("#vault-view");
      if (el) el.hidden = false;
      body.classList.remove("left-collapsed");
      body.classList.remove("shield-mode");
      if (stTrigger) stTrigger.style.display = "none";
      if (contactsEyebrow) contactsEyebrow.textContent = "Previous Evidence";
      setActive("vault");
    } else if (where === "responders") {
      window.kavachResponders?.open();
      const el = document.querySelector("#responders-view");
      if (el) el.hidden = false;
      body.classList.add("left-collapsed");
      body.classList.remove("shield-mode");
      if (stTrigger) stTrigger.style.display = "none";
      setActive("responders");
    } else if (where === "profile") {
      window.kavachProfile?.open();
      const el = document.querySelector("#profile-view");
      if (el) el.hidden = false;
      body.classList.add("left-collapsed");
      body.classList.remove("shield-mode");
      if (stTrigger) stTrigger.style.display = "none";
      setActive("profile");
    } else if (where === "settings") {
      window.kavachSettings?.open();
      const el = document.querySelector("#settings-view");
      if (el) el.hidden = false;
      body.classList.add("left-collapsed");
      body.classList.remove("shield-mode");
      if (stTrigger) stTrigger.style.display = "none";
      setActive("settings");
    }
  }

  // Mobile Menu Drawer Toggle (3 lines button)
  const mobileMenuBtn = document.querySelector("#mobile-menu-btn");
  const closeSidebarMenuBtn = document.querySelector("#close-sidebar-menu-btn");
  mobileMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    body.classList.toggle("menu-open");
  });
  closeSidebarMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    body.classList.remove("menu-open");
  });

  // Mobile Sidebar Dashboard links
  document.querySelectorAll(".sidebar-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      body.classList.remove("menu-open");
      const navTarget = btn.dataset.nav;
      if (navTarget) go(navTarget);
    });
  });

  // Sidebar Kavach AI button (symbol + name, borderless)
  document.querySelector("#sidebar-ai-btn")?.addEventListener("click", () => {
    body.classList.remove("menu-open");
    body.classList.add("shield-open");
  });

  // Navbar Auto-Hide on Scroll Down, Show on Scroll Up
  let lastScrollY = window.scrollY;
  const topbar = document.querySelector(".topbar");
  window.addEventListener("scroll", () => {
    const currentScrollY = window.scrollY;
    if (currentScrollY > 50 && currentScrollY > lastScrollY + 8) {
      topbar?.classList.add("topbar--hidden");
    } else if (currentScrollY < lastScrollY - 6 || currentScrollY <= 20) {
      topbar?.classList.remove("topbar--hidden");
    }
    lastScrollY = currentScrollY;
  }, { passive: true });

  // Sidebar Toggles (Left Collapsible Sidebar & Right AI Drawer)
  document.querySelector("#toggle-left-sidebar-btn")?.addEventListener("click", () => {
    body.classList.toggle("left-collapsed");
  });

  document.querySelector("#toggle-ai-sidebar-btn")?.addEventListener("click", () => {
    body.classList.toggle("shield-open");
  });

  document.querySelector("#close-ai-panel-btn")?.addEventListener("click", () => {
    body.classList.remove("shield-open");
  });

  // ---------- phone layout: one pane at a time ----------
  const pill = document.querySelector("#m-pill");
  let pillLabel = null;
  const mobile = {
    show(view) {
      body.classList.remove("m-list", "m-main", "m-panel");
      body.classList.add(`m-${view}`);
      pill.hidden = view !== "main" || !pillLabel;
      if (phone.matches) window.scrollTo(0, 0);
    },
    // The floating button that opens the side panel ("Risk 85 · High ›", "Details ›"...).
    pill(label) {
      pillLabel = label;
      pill.textContent = label || "";
      pill.hidden = !label || !body.classList.contains("m-main") || body.classList.contains("at-home");
    },
  };
  window.kavachMobile = mobile;

  pill.addEventListener("click", () => mobile.show("panel"));
  document.querySelector("#panel-back").addEventListener("click", () => mobile.show("main"));
  document.querySelector("#chat-back").addEventListener("click", () => {
    mobile.show("list");
    mobile.pill(null);
  });
  // Opening a chat or the screenshot import moves to the main pane and closes menu drawer
  document.querySelector("#contact-list").addEventListener("click", (e) => {
    body.classList.remove("menu-open");
    if (e.target.closest(".contact")) mobile.show("main");
    setActive("shield");
  });
  document.querySelector("#import-btn").addEventListener("click", () => {
    body.classList.remove("menu-open");
    mobile.show("main");
  });

  // Close menu drawer when clicking outside contacts sidebar
  document.addEventListener("click", (e) => {
    if (body.classList.contains("menu-open")) {
      const contactsEl = document.querySelector(".contacts");
      const menuBtn = document.querySelector("#mobile-menu-btn");
      if (contactsEl && !contactsEl.contains(e.target) && !menuBtn?.contains(e.target)) {
        body.classList.remove("menu-open");
      }
    }
  });

  // ---------- top nav + tab bar ----------
  // Top nav bar: clicking any section switches directly to it
  links.forEach((l) =>
    l.addEventListener("click", () => {
      go(l.dataset.nav);
    })
  );
  tabs.forEach((t) => t.addEventListener("click", () => go(t.dataset.tab)));
  document.querySelectorAll("[data-go]").forEach((el) => el.addEventListener("click", () => go(el.dataset.go)));
  document.querySelector("#home-link").addEventListener("click", goHome);
  document.querySelector("#settings-back-btn")?.addEventListener("click", goHome);
  document.querySelector("#quick-exit")?.addEventListener("click", () => {
    window.kavachImport?.close();
    window.kavachVault?.close();
    window.kavachComplaint?.close();
    window.kavachSos?.close();
    goHome();
  });

  // Preferences remain local to this device. The CSS 2D scene doubles as the
  // screen-reader and no-WebGL fallback; reduced motion removes all idle motion.
  const reducedMotion = document.querySelector("#reduced-motion");
  const highContrast = document.querySelector("#high-contrast");
  try {
    reducedMotion.checked = localStorage.getItem("bloom.reduceMotion") === "1";
    highContrast.checked = localStorage.getItem("bloom.highContrast") === "1";
  } catch { /* preferences remain usable for this page session */ }
  const applyPreferences = () => {
    body.classList.toggle("reduce-motion", reducedMotion.checked || matchMedia("(prefers-reduced-motion: reduce)").matches);
    body.classList.toggle("high-contrast", highContrast.checked);
    try {
      localStorage.setItem("bloom.reduceMotion", reducedMotion.checked ? "1" : "0");
      localStorage.setItem("bloom.highContrast", highContrast.checked ? "1" : "0");
    } catch { /* private browsing may disable localStorage */ }
  };
  reducedMotion.addEventListener("change", applyPreferences);
  highContrast.addEventListener("change", applyPreferences);
  applyPreferences();
  setActive(null);
  window.kavachHome = goHome;
  window.kavachNav = { go, goHome, closeAllViews, setActive };

  // ---------- Reset everything (before a demo) ----------
  // The server ends any running SOS and clears the Vault and SOS history; reloading
  // clears the scanned chats and any draft, which only live on this page.
  document.querySelector("#reset-all").addEventListener("click", async (e) => {
    const btn = e.currentTarget; // read before the await: currentTarget is null afterwards
    if (!(await kavachConfirm("Reset everything? This ends any running SOS and deletes sealed evidence. Contacts and responders stay.", { ok: "Reset", danger: true }))) return;
    btn.disabled = true;
    btn.textContent = "Resetting…";
    try {
      const res = await fetch(`${new URLSearchParams(location.search).get("api") || ""}/reset`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      try {
        localStorage.removeItem("kavach.myDetails");
      } catch {
        /* nothing stored */
      }
      location.reload();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Reset everything";
      window.kavach?.toast(`Reset failed: ${err.message}`);
    }
  });

  // ---------- Scan → Check → Seal → Report bar ----------
  const steps = [...document.querySelectorAll("#flowbar [data-step]")];
  window.kavachFlow = {
    set(n) {
      steps.forEach((s) => {
        const k = Number(s.dataset.step);
        s.classList.toggle("done", k < n);
        s.classList.toggle("current", k === n);
      });
    },
  };

  // Installable app + offline shell (https or localhost only).
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // Handle deep-links from WhatsApp extension or direct URLs (#guardians, #sos, #vault, #shield, #scan, #responders, #profile)
  function handleDeepLink() {
    const hash = (location.hash || "").replace("#", "").toLowerCase();
    if (!hash) return;
    if (hash === "guardians" || hash === "sos" || hash === "safetyspace") {
      setTimeout(() => go("guardians"), 150);
    } else if (hash === "vault") {
      setTimeout(() => go("vault"), 150);
    } else if (hash === "responders") {
      setTimeout(() => go("responders"), 150);
    } else if (hash === "profile") {
      setTimeout(() => go("profile"), 150);
    } else if (hash === "shield" || hash === "scan") {
      setTimeout(() => go(hash), 150);
    }
  }

  window.addEventListener("hashchange", handleDeepLink);
  setTimeout(handleDeepLink, 250);

  (async () => {
    const status = document.querySelector("#nav-status");
    try {
      const h = await (await fetch(`${API}/health`)).json();
      status.textContent = h.llm_configured ? "AI on" : "Keyword mode";
    } catch {
      status.textContent = "Offline";
    }
  })();
})();
