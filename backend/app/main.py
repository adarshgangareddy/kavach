import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from app import config
from app.agent.guardian import run_agent
from app.agent.schemas import AgentIn
from app.auth import accounts, context
from app.auth.schemas import (
    ForgotPasswordIn,
    LoginIn,
    PasscodeSetIn,
    PasscodeVerifyIn,
    ResetPasswordIn,
    SignupIn,
)
from app.schemas import AnalyzeRequest, AnalyzeResponse
from app.shield.classifier import analyze
from app.complaint.drafting import ComplaintError, build_complaint
from app.complaint.pdf import build_complaint_pdf
from app.complaint.retrieval import corpus
from app.complaint.schemas import ComplaintIn, ComplaintPdfIn
from app.sos import crypto as sos_crypto
from app.sos import notify, people
from app.sos import service as sos
from app.sos.schemas import LocationIn, PersonIn, PersonPatch, ProfileIn, RespondIn, SosIn
from app.vault import index as evidence_index
from app.vault import report, store
from app.vault.schemas import EvidenceIn, TamperIn
from app.security.router import router as security_router

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
# httpx logs every request URL, and Telegram API URLs contain the bot token.
logging.getLogger("httpx").setLevel(logging.WARNING)

@asynccontextmanager
async def lifespan(_app):
    # Telegram bot: links contacts/responders and handles Accept / Decline buttons.
    poller = asyncio.create_task(notify.poll_forever())
    yield
    poller.cancel()


app = FastAPI(title="Kavach AI", version="0.1.0", lifespan=lifespan)

# Lets a browser extension or a separately served frontend call the API during the demo.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def remember_public_address(request, call_next):
    # Remember the https address the app was last opened on, for links sent from a laptop SOS.
    global _last_public_base
    base = _request_base(request)
    if base.startswith("https://") and not base.split("://", 1)[1].startswith(_LOCAL_HOSTS):
        _last_public_base = base
    return await call_next(request)


@app.middleware("http")
async def revalidate_static(request, call_next):
    # Without this, browsers heuristically cache app.js etc. and keep showing an old build.
    response = await call_next(request)
    response.headers.setdefault("Cache-Control", "no-cache")
    return response


SESSION_COOKIE = "kavach_session"
# Pages that need an account. Responder, live-tracking and connect pages stay open: they carry their own codes.
_PRIVATE_PAGES = {"/", "/index.html"}


@app.middleware("http")
async def session(request: Request, call_next):
    """Reads the session cookie or Authorization Bearer header and sets the signed-in account for this request."""
    raw_token = request.cookies.get(SESSION_COOKIE)
    if not raw_token:
        auth_h = request.headers.get("Authorization", "")
        if auth_h.startswith("Bearer "):
            raw_token = auth_h[7:].strip()
        elif "X-Kavach-Token" in request.headers:
            raw_token = request.headers["X-Kavach-Token"].strip()

    user = accounts.user_for_session(raw_token) if raw_token else None
    if request.method == "GET" and request.url.path in _PRIVATE_PAGES and not user:
        return RedirectResponse("/login.html", status_code=303)
    token = context.set_current(user["id"] if user else None)
    try:
        return await call_next(request)
    finally:
        context.reset(token)


@app.exception_handler(404)
async def custom_404_handler(request: Request, exc: HTTPException):
    accept = request.headers.get("accept", "")
    if "text/html" in accept and not request.url.path.startswith("/api"):
        not_found_file = config.FRONTEND_DIR / "404.html"
        if not_found_file.exists():
            return Response(content=not_found_file.read_text(), status_code=404, media_type="text/html")
    return JSONResponse(status_code=404, content={"detail": exc.detail or "Not Found"})


def require_user() -> str:
    uid = context.current()
    if not uid:
        raise HTTPException(401, "Please log in")
    return uid


signed_in = [Depends(require_user)]


# ---------- accounts ----------

def _set_session(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, token, max_age=accounts.SESSION_TTL_S, httponly=True, samesite="lax",
        secure=_request_base(request).startswith("https://"), path="/",
    )


@app.post("/auth/signup")
def auth_signup(body: SignupIn, request: Request):
    try:
        user = accounts.signup(
            username=body.username,
            password=body.password,
            full_name=body.full_name,
            email=body.email,
            phone=body.phone,
        )
    except accounts.AuthError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    response = JSONResponse({"user": user})
    _set_session(response, request, accounts.new_session(user["id"]))
    return response


@app.post("/auth/login")
def auth_login(body: LoginIn, request: Request):
    try:
        user, token = accounts.login(body.username, body.password)
    except accounts.AuthError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    response = JSONResponse({"user": user})
    _set_session(response, request, token)
    return response


@app.post("/auth/logout")
def auth_logout(request: Request):
    accounts.logout(request.cookies.get(SESSION_COOKIE))
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@app.get("/auth/google/callback")
def auth_google_callback():
    """Serves the client-side token receiver for Google OAuth2 implicit flow."""
    html_content = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Kavach — Authenticating with Google...</title>
  <style>body { background:#0a0c10; color:#fff; font-family:system-ui,sans-serif; display:flex; height:100vh; align-items:center; justify-content:center; margin:0; }</style>
</head>
<body>
  <div style="text-align:center;">
    <div style="font-size:32px; margin-bottom:12px;">🛡️</div>
    <div style="font-size:15px; font-weight:600;">Completing Google authentication…</div>
    <div style="font-size:12px; color:#888; margin-top:6px;">Redirecting you to Kavach Dashboard</div>
  </div>
  <script>
    (async () => {
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const token = params.get("access_token");
      if (!token) {
        alert("Google Sign-In canceled or denied.");
        window.location.replace("/login.html");
        return;
      }
      try {
        const uRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: "Bearer " + token }
        });
        if (!uRes.ok) throw new Error("Failed to retrieve Google user profile");
        const u = await uRes.json();
        const res = await fetch("/auth/google/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email: u.email, full_name: u.name, sub: u.sub })
        });
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body.user && body.user.id) {
            try { localStorage.setItem("kavach.lastUser", body.user.id); } catch {}
          }
          window.location.replace("/index.html");
        } else {
          const err = await res.json().catch(() => ({}));
          alert("Login error: " + (err.detail || "Authentication verification failed"));
          window.location.replace("/login.html");
        }
      } catch (err) {
        alert("Google Error: " + err.message);
        window.location.replace("/login.html");
      }
    })();
  </script>
</body>
</html>"""
    return Response(content=html_content, media_type="text/html")


@app.post("/auth/google/verify")
async def auth_google_verify(request: Request):
    data = await request.json()
    email = data.get("email")
    if not email:
        raise HTTPException(400, "Missing email from Google profile")
    try:
        user = accounts.login_or_create_google(email, data.get("full_name", ""), data.get("sub", ""))
    except accounts.AuthError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    response = JSONResponse({"user": user})
    _set_session(response, request, accounts.new_session(user["id"]))
    return response


@app.get("/auth/me")
def auth_me(request: Request):
    user = accounts.user_for_session(request.cookies.get(SESSION_COOKIE))
    if not user:
        raise HTTPException(401, "Please log in")
    return {"user": user}


@app.post("/auth/forgot-password")
def auth_forgot_password(body: ForgotPasswordIn):
    try:
        return accounts.forgot_password(body.email_or_username)
    except accounts.AuthError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.post("/auth/reset-password")
def auth_reset_password(body: ResetPasswordIn):
    try:
        accounts.reset_password(body.token, body.new_password)
        return {"ok": True, "message": "Your password has been reset successfully. Please log in."}
    except accounts.AuthError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.post("/auth/passcode/set")
def auth_set_passcode(body: PasscodeSetIn, user_id: str = Depends(require_user)):
    try:
        accounts.set_passcode(user_id, body.passcode)
        return {"ok": True, "message": "App passcode configured successfully."}
    except accounts.AuthError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.post("/auth/passcode/verify")
def auth_verify_passcode(body: PasscodeVerifyIn, user_id: str = Depends(require_user)):
    try:
        valid = accounts.verify_passcode(user_id, body.passcode)
        if not valid:
            raise HTTPException(401, "Incorrect passcode.")
        return {"ok": True, "valid": True}
    except accounts.AuthError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.delete("/auth/me")
def auth_delete_me(request: Request, user_id: str = Depends(require_user)):
    accounts.delete_account(user_id)
    response = JSONResponse({"ok": True, "message": "Account and all associated safety data permanently deleted."})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@app.get("/maps/config")
def maps_config():
    return {
        "google_maps_api_key": config.GOOGLE_MAPS_API_KEY,
        "google_client_id": config.GOOGLE_CLIENT_ID,
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "llm_configured": bool(config.GROQ_API_KEY),
        "model": config.GROQ_MODEL,
        "demo_mode": config.DEMO_MODE,
        "telegram_on": notify.telegram_on(),
        "email_on": notify.email_on(),
        "google_maps_configured": bool(config.GOOGLE_MAPS_API_KEY),
    }


@app.post("/analyze", response_model=AnalyzeResponse, dependencies=signed_in)
async def analyze_conversation(req: AnalyzeRequest) -> AnalyzeResponse:
    return await analyze(req)


# ---------- Kavach Guardian (AI agent) ----------

@app.post("/agent", dependencies=signed_in)
async def guardian(req: AgentIn):
    """She asks in plain words; the agent picks Kavach's tools step by step and reports the trail."""
    return await run_agent(req)


# ---------- Evidence Vault ----------

@app.post("/evidence", dependencies=signed_in)
def save_evidence(item: EvidenceIn, background: BackgroundTasks):
    try:
        sealed = store.save_capture(item)
    except store.EvidenceError as exc:
        raise HTTPException(400, str(exc)) from exc
    # Embedding into the vector DB happens after the reply, so sealing never waits on the model.
    background.add_task(evidence_index.index_capture, sealed["capture_id"])
    return sealed


@app.get("/evidence/search", dependencies=signed_in)
def search_evidence(q: str, k: int = 5, conversation: str | None = None, flagged_only: bool = False):
    """Semantic search over sealed messages ("when did he talk about my college?")."""
    if not q.strip():
        raise HTTPException(400, "query is empty")
    try:
        hits = evidence_index.search(q, k=max(1, min(k, 20)), conversation=conversation, flagged_only=flagged_only)
    except Exception as exc:  # embedding model can't load (offline first run)
        raise HTTPException(503, f"semantic search unavailable: {exc}") from exc
    return {"query": q, "results": hits}


@app.get("/evidence", dependencies=signed_in)
def list_evidence():
    rows = store.all_rows()
    return {"records": rows, "verification": store.verify(rows)}


@app.get("/evidence/verify", dependencies=signed_in)
def verify_evidence():
    return store.verify()


@app.get("/evidence/report", dependencies=signed_in)
def evidence_report():
    pdf = report.build_report()
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="kavach-evidence-report.pdf"'},
    )


@app.get("/evidence/screenshot/{digest}", dependencies=signed_in)
def evidence_screenshot(digest: str):
    shot = store.screenshot(digest) if store.owns_screenshot(digest) else None
    if shot is None:
        raise HTTPException(404, "screenshot not found")
    data, ext = shot
    return Response(data, media_type="image/png" if ext == "png" else "image/jpeg")


@app.delete("/evidence", dependencies=signed_in)
def clear_evidence():
    """Deletes everything in the Vault. Asked for by her, after use."""
    store.clear()
    evidence_index.clear()
    return {"ok": True}


@app.post("/evidence/demo/tamper", dependencies=signed_in)
def demo_tamper(body: TamperIn):
    if not config.DEMO_MODE:
        raise HTTPException(403, "demo mode is off")
    try:
        return store.demo_tamper(body.record_id, body.rehash)
    except store.EvidenceError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/evidence/demo/reset", dependencies=signed_in)
def demo_reset():
    if not config.DEMO_MODE:
        raise HTTPException(403, "demo mode is off")
    store.demo_reset()
    evidence_index.clear()
    return {"ok": True}


# ---------- Complaint Assistant ----------

@app.post("/complaint", dependencies=signed_in)
async def draft_complaint(body: ComplaintIn):
    _own_capture(body.capture_id)
    try:
        return await build_complaint(body.capture_id)
    except ComplaintError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/complaint/pdf", dependencies=signed_in)
def complaint_pdf(body: ComplaintPdfIn):
    _own_capture(body.capture_id)
    return Response(
        build_complaint_pdf(body),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="kavach-complaint.pdf"'},
    )


def _own_capture(capture_id: str) -> None:
    if not any(r["capture_id"] == capture_id for r in store.all_rows()):
        raise HTTPException(404, "capture not found in your Evidence Vault")


@app.get("/legal/sections")
def legal_sections():
    """The whole corpus, so anyone can see exactly which laws the assistant is allowed to cite."""
    return {"sections": corpus()}


# ---------- Discreet SOS + Responder Network ----------

_tasks: set = set()


def _me() -> str:
    return context.current() or sos.LEGACY_USER


def _own_sos(sos_id: str) -> None:
    s = _sos_call(sos.get_sos, sos_id)
    if s["user"] != _me():
        raise HTTPException(404, "SOS not found")


def _background(coro) -> None:
    """Send alerts without making her wait; keep a reference so the task isn't collected.
    Only call from async endpoints: create_task needs the running event loop."""
    t = asyncio.create_task(coro)
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


_LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]")
_last_public_base: str | None = None


def _request_base(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    if "trycloudflare.com" in host:  # the tunnel is always https, even if the header says otherwise
        proto = "https"
    return f"{proto}://{host}"


def _public_base(request: Request) -> str:
    """The address put into links we send out. Links must open on phones, so never localhost
    when the app has been reached over a public address (e.g. the https tunnel)."""
    if config.PUBLIC_URL:
        return config.PUBLIC_URL
    base = _request_base(request)
    is_local = base.split("://", 1)[1].startswith(_LOCAL_HOSTS)
    return (_last_public_base or base) if is_local else base


def _sos_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except sos.SosError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    except people.PeopleError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


def _decrypt(ciphertext: str) -> dict:
    try:
        return sos_crypto.decrypt_location(ciphertext)
    except Exception as exc:
        raise HTTPException(400, "could not decrypt location") from exc


@app.get("/sos/key")
def sos_key():
    """RSA-OAEP public key the browser uses to encrypt her location before sending it."""
    return {"alg": "RSA-OAEP-256", "spki": sos_crypto.public_key_spki_b64()}


@app.get("/sos/setup")
async def sos_setup():
    """What the SOS setup screen needs: her name, contacts, and which alert channels work.
    Without an account (the responder page) only the bot name is shared."""
    if not context.current():
        return {"telegram": {"on": notify.telegram_on(), "bot": await notify.bot_username()}, "radius_m": sos.RADIUS_M}
    return {
        "name": people.her_name(),
        "contacts": people.list_kind("contact"),
        "telegram": {"on": notify.telegram_on(), "bot": await notify.bot_username(),
                     "problem": notify.problems["telegram"]},
        "email_on": notify.email_on(),
        "email_problem": notify.problems["email"],
        "radius_m": sos.RADIUS_M,
    }


@app.get("/sos/invite", dependencies=signed_in)
async def sos_invite():
    """The shared Telegram link: anyone who opens it and taps Start becomes a trusted contact."""
    return {"link": await notify.invite_link()}


@app.post("/sos/invite/reset", dependencies=signed_in)
async def sos_invite_reset():
    """New invite link; the old one stops adding people (contacts already added stay)."""
    people.invite_code(reset=True)
    return {"link": await notify.invite_link()}


@app.post("/sos/test-channels", dependencies=signed_in)
async def sos_test_channels():
    """Sends a test over Telegram (to connected contacts) and email (to the Gmail account itself)."""
    return await notify.test_channels()


@app.put("/sos/profile", dependencies=signed_in)
def sos_profile(body: ProfileIn):
    return {"name": people.set_her_name(body.name)}


_EVENT = {"started": "sos_started", "first_fix": "location_found", "repeated": "sos_repeated"}


@app.post("/sos", dependencies=signed_in)
async def sos_trigger(body: SosIn, request: Request):
    loc = _decrypt(body.ciphertext) if body.ciphertext else None
    source = body.location_source if loc else "none"
    result = _sos_call(sos.trigger, _me(), loc, body.trigger, source, _public_base(request))
    _background(getattr(notify, _EVENT[result.pop("event")])(result["sos_id"]))
    return result


@app.post("/sos/safe", dependencies=signed_in)
async def sos_safe():
    """'I'm safe' from any screen: ends her running SOS, if any, and tells contacts and responders."""
    active = sos.active_for(_me())
    if not active:
        return {"ended": False}
    sos.cancel(active["sos_id"])
    _background(notify.sos_ended(active["sos_id"]))
    return {"ended": True, "sos_id": active["sos_id"]}


@app.get("/sos/active", dependencies=signed_in)
def sos_active():
    """Her running SOS, if any (declared before /sos/{sos_id} so it isn't taken as an id)."""
    return {"active": sos.active_for(_me())}


@app.get("/sos/{sos_id}", dependencies=signed_in)
def sos_status(sos_id: str):
    _own_sos(sos_id)
    return _sos_call(sos.summary, sos_id)


@app.post("/sos/{sos_id}/location", dependencies=signed_in)
async def sos_location(sos_id: str, body: LocationIn):
    """Live GPS from her phone while the SOS is active."""
    _own_sos(sos_id)
    result = _sos_call(sos.update_location, sos_id, _decrypt(body.ciphertext))
    _background(notify.location_found(sos_id) if result["first_fix"] else notify.location_updated(sos_id))
    return result


@app.post("/sos/{sos_id}/cancel", dependencies=signed_in)
async def sos_cancel(sos_id: str):
    _own_sos(sos_id)
    result = _sos_call(sos.cancel, sos_id)
    _background(notify.sos_ended(sos_id))
    return result


@app.get("/sos/track/{token}")
def sos_track(token: str):
    return _sos_call(sos.track, token)


@app.post("/sos/{sos_id}/respond")
async def responder_respond(sos_id: str, body: RespondIn):
    result = _sos_call(sos.respond, sos_id, body.responder_id, body.action)
    if result["status"] == "accepted" and result["changed"]:
        _background(notify.responder_accepted(sos_id, body.responder_id))
    return result


@app.post("/reset", dependencies=signed_in)
async def reset_everything():
    """One button before a demo: ends any running SOS (pins stop), then clears SOS history and the Vault.
    Trusted contacts, responders and her name stay, so the demo is ready to run again."""
    active = sos.active_for(_me())
    if active:
        sos.cancel(active["sos_id"])
        await notify.sos_ended(active["sos_id"])  # before the history goes, so live pins are stopped
    sos.reset(_me())
    store.clear()
    evidence_index.clear()
    return {"ok": True, "ended_sos": bool(active)}


@app.delete("/sos/history", dependencies=signed_in)
def sos_clear_history():
    _sos_call(sos.clear_history, _me())
    return {"ok": True}


@app.post("/sos/demo/reset", dependencies=signed_in)
def sos_demo_reset():
    if not config.DEMO_MODE:
        raise HTTPException(403, "demo mode is off")
    sos.reset(_me())
    return {"ok": True}


# ---------- people: her trusted contacts and registered responders ----------

def _person(pid: str) -> dict:
    """A contact only for the account it belongs to; responders manage themselves (responder page)."""
    p = _sos_call(people.get, pid)
    if p["kind"] == "contact" and (not context.current() or not people.owns(p)):
        raise HTTPException(404, "person not found")
    return p


@app.get("/people")
def people_list(kind: str = "contact"):
    if kind == "contact":
        require_user()
    return {"people": people.list_kind(kind)}


@app.post("/people")
async def people_create(body: PersonIn):
    if body.kind == "contact":
        require_user()
    p = _sos_call(
        people.create,
        body.kind,
        body.name,
        body.phone,
        body.email,
        body.lat,
        body.lng,
        None,
        body.relationship,
        body.whatsapp,
    )
    return {**p, "telegram_link": await notify.link_for(p)}


@app.patch("/people/{pid}")
def people_update(pid: str, body: PersonPatch):
    _person(pid)
    return _sos_call(people.update, pid, **body.model_dump())


@app.delete("/people/{pid}")
def people_delete(pid: str):
    _person(pid)
    _sos_call(people.delete, pid)
    return {"ok": True}


@app.get("/people/{pid}/telegram")
async def people_telegram(pid: str):
    p = _person(pid)
    return {"link": await notify.link_for(p), "linked": p["telegram_chat_id"] is not None}


@app.post("/people/{pid}/verify")
def people_verify(pid: str, verified: bool = True):
    """Admin approval of a responder. Demo mode only until there are real admin accounts."""
    if not config.DEMO_MODE:
        raise HTTPException(403, "demo mode is off")
    return _sos_call(people.verify, pid, verified)


@app.get("/responders")
def responders():
    return {"responders": people.list_kind("responder"), "radius_m": sos.RADIUS_M}


@app.get("/responders/{responder_id}/alerts")
def responder_alerts(responder_id: str):
    return {"alerts": _sos_call(sos.alerts_for, responder_id)}


app.include_router(security_router)

# Mounted last so API routes take precedence over static files.
app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
