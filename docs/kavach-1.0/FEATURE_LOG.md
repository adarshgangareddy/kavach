# Kavach 1.0 — Architecture, Requirements & Implementation Log

This document tracks all requirements, design decisions, architectural components, and implementation details for **Kavach 1.0** (Personal Safety Platform for Women and Children).

---

## Architecture Overview

```
                      ┌──────────────────────────────────────────────────────────┐
                      │              Kavach 1.0 Client Interface                 │
                      │  (Responsive PWA: Mobile First, High-Contrast Emergency) │
                      └─────────────┬───────────────────────────────┬────────────┘
                                    │ (Encrypted Sessions/WebCrypto)│
                                    ▼                               ▼
                      ┌──────────────────────────┐    ┌──────────────────────────┐
                      │   Emergency SOS Space    │    │  Protected Safety Circle │
                      │  - One-tap SOS Trigger   │    │  - Trusted Guardians     │
                      │  - Live Location Watch   │    │  - Community Responders  │
                      │  - Dispatched Alerts     │    │  - App Lock Passcode     │
                      └─────────────┬────────────┘    └─────────────┬────────────┘
                                    │                               │
                                    ▼                               ▼
                      ┌──────────────────────────────────────────────────────────┐
                      │             FastAPI Backend (app/main.py)                │
                      │  - Argon2id Password & Passcode Hasher                   │
                      │  - Session Management (HttpOnly 256-bit SHA-256 tokens) │
                      │  - SOS Dispatch Engine (Telegram & SMTP Alerting)       │
                      │  - Auto-Adapting Database Layer (Postgres / SQLite)      │
                      └─────────────┬───────────────────────────────┬────────────┘
                                    │                               │
                                    ▼                               ▼
                ┌───────────────────────────────────┐ ┌──────────────────────────┐
                │        Database Layer             │ │     Local AI Guard       │
                │  - SQLite (Local development)     │ │  - FastEmbed & ChromaDB  │
                │  - Supabase/Neon Postgres (Prod)  │ │  - Groq LLM (Optional)   │
                │  - User-Scoped Row Isolation      │ │  - Keyword Safety Filter │
                └───────────────────────────────────┘ └──────────────────────────┘
```

---

## Log Entry: Step 1 — Real Authentication, Password Recovery & Owner Passcode

### 1. User Requirements
* Real login, registration, and logout flows (no mock or hardcoded state).
* Support for `email`, `phone`, `full_name`, and optional email verification status.
* Password reset mechanism (`/auth/forgot-password` and `/auth/reset-password`).
* App Lock Passcode protection (`/auth/passcode/set` and `/auth/passcode/verify`) to safeguard sensitive safety settings and contacts from unauthorized device access.
* Full account and data deletion (`DELETE /auth/me`) respecting privacy and right-to-be-forgotten.
* Database flexibility: Run locally on SQLite/DBeaver Postgres without paid cloud bills; seamlessly connect to free cloud Postgres (Supabase/Neon) upon deployment.

### 2. Technologies & Primitives Used
* **Argon2id (`argon2-cffi`):** The gold-standard memory-hard password hashing algorithm (RFC 9106) protecting both user passwords and app passcodes against GPU/ASIC cracking.
* **Cryptographic Token Generator (`secrets.token_urlsafe`):** For secure reset tokens and session IDs.
* **Dual-Engine DB Schema Migration (`app.database.schema`):** Auto-migrates database schemas across both SQLite and PostgreSQL using column introspection without downtime.
* **Strict Pydantic Validation (`app.auth.schemas`):** Form sanitization, length bounds, and structure verification.

### 3. Why This Approach?
* **Zero-Cost Cloud Deployment:** Using standard connection URLs allows developers to run on free SQLite locally and migrate to free-tier cloud PostgreSQL (Supabase or Neon) with zero code changes.
* **App Passcode vs OS Restrictions:** An app-level passcode safely locks access to emergency guardian configurations, personal evidence, and live tracker links without falsely claiming to bypass Android OS permission controls.
* **Isolated User Context:** Every query filters by `context.current()` so no user's vault, contacts, or SOS alerts are ever exposed to another account.

### 4. How It Works
1. **Registration:** Hashes password with Argon2id, assigns a unique `uid`, stores user attributes (`full_name`, `email`, `phone`), and issues a secure 256-bit cookie session.
2. **Login:** Accepts username or email, checks lockout threshold (max 5 failed attempts in 15 mins), verifies Argon2id hash, and issues a session cookie.
3. **Password Reset:** Generates a single-use 15-minute token (`reset_token`, `reset_expires`) that resets the user's password once verified.
4. **Owner Passcode:** Sets an independent 4-6 digit numerical PIN hashed with Argon2id for locking the interface.
5. **Account Deletion:** Atomically wipes sessions, vault evidence, trusted contacts, and SOS logs associated with `user_id`.

---

## Log Entry: Step 2 — Redesigned High-Trust Authentication & Guided Onboarding (`login.html`)

### 1. User Requirements
* Replace demo aesthetics with a real-world, trustworthy personal safety portal.
* Display the prominent security guarantee:
  > *"Your evidence vault, trusted contacts and SOS stay private to your account. Nobody else on this app can see them. Passwords are protected with Argon2id hashing. We never store or see your actual password."*
* Support real login with email or registered username, show/hide password toggle, and loading state.
* Support real registration with Full Name, Email, Mobile number with country code (+91 default), password strength criteria checklist, confirm password, and Terms & Privacy Policy acceptance.
* Add full password recovery flow (token request + instant token password update).
* Guided Onboarding Modal triggered immediately after signup:
  - Step 1: Welcome & Safety Circle Explanation.
  - Step 2: Transparent Permission Explanations (Location, Critical Notifications, Calling).
  - Step 3: Owner App Passcode Setup (numeric PIN saved via `/auth/passcode/set`).
  - Step 4: Add First Trusted Guardian (saved via `/people`).
  - Step 5: Dashboard Entry.

### 2. Technologies & Primitives Used
* **Responsive HTML5 / CSS3 (CSS Variables, Flexbox, CSS Grid):** Mobile-first layout with high-contrast emergency typography.
* **Fetch API with Credentials (`same-origin`):** Secure transmission of HttpOnly cookies without exposing raw session tokens to JavaScript.
* **Real-Time Client-Side Validation:** Instant entropy scoring, password matching, and regex sanitization.
* **Accessible Dialog Modals:** Modal overlays for password recovery and onboarding steps with keyboard and focus management.

### 3. Why This Approach?
* **First-Run Friction Reduction:** Rather than dropping a newly registered user onto a blank page, the guided onboarding flow ensures their safety circle (PIN passcode + first guardian) is configured before danger occurs.
* **Zero Fake States:** All buttons communicate with real backend endpoints (`/auth/signup`, `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/passcode/set`, `/people`).

---

## Log Entry: Step 3 — Real-World Safety Dashboard (`index.html`)

### 1. User Requirements
* Transform `index.html` from the poetic "bloom garden" demo into a high-trust, productive women and children safety command center.
* Prominently feature the security guarantee box:
  > *"Your evidence vault, trusted contacts and SOS stay private to your account. Nobody else on this app can see them. Passwords are protected with Argon2id hashing. We never store or see your actual password."*
* Include live safety status bar with direct national helpline dials (112, 1091, 1930, 181).
* Display trusted guardians directly on the home dashboard with Telegram connection status.
* 3-Step "How Kavach Protects You" section:
  1. Configure your safety circle.
  2. Add trusted guardians.
  3. Trigger SOS when in danger.
* Deep-dive safety feature cards (Discreet SOS, Encrypted GPS, Verified Responders, Evidence Vault, Legal Drafts, Battery-Conscious Operation).
* Parent & Device Security controls (Owner Passcode, OS sandboxing explanation, and Permanent Account Deletion).
* Real footer with working links to Privacy Policy (`/privacy.html`), Terms (`/terms.html`), and Support.

### 2. Technologies & Primitives Used
* **Modular Screen Navigation (`nav.js`):** Coordinates switching between Dashboard, Threat Shield, Evidence Vault, and SOS Space without page reloads.
* **Dynamic Guardian Fetching:** Automatically populates trusted contacts from `GET /people?kind=contact`.
* **Permanent Data Wipe:** Integrated with `DELETE /auth/me` to atomically erase user records upon confirmation.

---

## Log Entry: Step 4 — Dynamic 15-Minute Responder Location Auto-Update (`responder.html`)

### 1. User Requirements
* Better responder portal layout.
* Location must not remain fixed or static; it should automatically update wherever the responder travels every 15 minutes.

### 2. Technologies & Primitives Used
* **HTML5 Geolocation API (`navigator.geolocation.getCurrentPosition`):** Queries device GPS with `enableHighAccuracy: true`.
* **Periodic Background Sync Interval:** `setInterval(updateMyLocation, 15 * 60 * 1000)` sends coordinates to `PATCH /people/{id}`.
* **Leaflet & OpenStreetMap:** Displays interactive map pins and calculates dynamic distances from active SOS emergencies.

### 3. Why This Approach?
* Responders move around cities; fixed coordinates caused alerts to target volunteers who had already left the area. Automatic periodic updates ensure dispatch accuracy without draining battery.

---

## Log Entry: Step 5 — Google Services & Original Bloom UI/UX Restoration

### 1. User Requirements
* Revert the homepage (`index.html`) layout back to the original beloved Bloom Scene UI/UX with glowing SVG orbits, interactive flowers, and status sparkles.
* Update only the description on the homepage with:
  > *"Your evidence vault, trusted contacts and SOS stay private to your account. Nobody else on this app can see them. Passwords are protected with Argon2id hashing. We never store or see your actual password."*
* In `login.html`, preserve the original glowing 3D WebGL lotus animation and add the **"Continue with Google"** button with official branding.
* Add Google Maps support so the user can paste their Google Maps API Key into `backend/.env`.

### 2. Technologies & Primitives Used
* **Bloom Design System & SVG Scene:** Restored the 4-flower orbit scene (Accounts, Devices, Privacy, Passwords) with high-contrast accessibility support.
* **Three.js 3D Lotus Animation:** Preserved the WebGL renderer on `login.html`.
* **Google Identity Services:** Added the "Continue with Google" action button on `login.html`.
* **Google Maps API Integration:**
  - Added `GOOGLE_MAPS_API_KEY` and `GOOGLE_CLIENT_ID` configuration in `backend/app/config.py` and `backend/.env`.
  - Added endpoint `GET /maps/config` in `backend/app/main.py`.
  - Updated `frontend/responder.html` and `frontend/track.html` to automatically load high-resolution Google Maps layers when `GOOGLE_MAPS_API_KEY` is provided, falling back gracefully to OpenStreetMap if not set.

---
