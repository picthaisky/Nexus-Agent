"""Notification system — Email (SMTP) and LINE Notify."""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

logger = logging.getLogger(__name__)


# ── Email ─────────────────────────────────────────────────────────────────────

def send_email(
    *,
    to: str,
    subject: str,
    body_html: str,
    body_text: str = "",
    smtp_host: str,
    smtp_port: int = 587,
    smtp_user: str,
    smtp_password: str,
    smtp_from: str,
    use_tls: bool = True,
) -> bool:
    """Send an email via SMTP. Returns True on success."""
    if not (smtp_host and smtp_user and to):
        logger.warning("Email not configured — skipping notification")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = smtp_from or smtp_user
    msg["To"]      = to

    if body_text:
        msg.attach(MIMEText(body_text, "plain", "utf-8"))
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    try:
        if use_tls:
            server = smtplib.SMTP(smtp_host, smtp_port)
            server.starttls()
        else:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port)
        server.login(smtp_user, smtp_password)
        server.sendmail(smtp_from or smtp_user, [to], msg.as_string())
        server.quit()
        logger.info("Email sent to %s: %s", to, subject)
        return True
    except Exception as exc:
        logger.error("Email send failed: %s", exc)
        return False


def _task_email_body(task_id: str, goal: str, status: str, error: str | None) -> tuple[str, str]:
    """Return (html, plain) email body for a task completion notification."""
    icon   = "✅" if status == "completed" else "❌"
    color  = "#16a34a" if status == "completed" else "#dc2626"
    label  = "สำเร็จ" if status == "completed" else "ล้มเหลว"
    error_block = f"<p style='color:#dc2626'><strong>Error:</strong> {error}</p>" if error else ""

    html = f"""
<html><body style="font-family:sans-serif;color:#1e293b;max-width:600px">
  <h2 style="color:{color}">{icon} Task {label}</h2>
  <p><strong>Task ID:</strong> <code>{task_id}</code></p>
  <p><strong>Goal:</strong> {goal[:200]}</p>
  <p><strong>Status:</strong> <span style="color:{color};font-weight:bold">{status.upper()}</span></p>
  {error_block}
  <hr style="border:1px solid #e2e8f0"/>
  <p style="color:#94a3b8;font-size:12px">Nexus-Agent · Cyber-Thai Command Center</p>
</body></html>"""

    plain = f"{icon} Task {label}\nID: {task_id}\nGoal: {goal[:200]}\nStatus: {status}\n"
    if error:
        plain += f"Error: {error}\n"
    return html, plain


async def notify_task_complete(
    task_id: str,
    goal: str,
    status: str,
    error: str | None = None,
) -> None:
    """Send task completion notification via all configured channels."""
    from nexus_agent.core.settings import get_settings
    s = get_settings()

    html, plain = _task_email_body(task_id, goal, status, error)
    subject     = f"[Nexus-Agent] Task {'Completed' if status == 'completed' else 'Failed'}: {goal[:60]}"

    # Email
    if s.smtp_host and s.notification_email:
        try:
            send_email(
                to=s.notification_email,
                subject=subject,
                body_html=html,
                body_text=plain,
                smtp_host=s.smtp_host,
                smtp_port=s.smtp_port,
                smtp_user=s.smtp_user,
                smtp_password=s.smtp_password,
                smtp_from=s.smtp_from,
                use_tls=s.smtp_use_tls,
            )
        except Exception as exc:
            logger.warning("Email notification failed: %s", exc)

    # LINE Notify
    if s.line_notify_token:
        await send_line_notify(
            token=s.line_notify_token,
            message=f"\n{plain}",
        )


# ── LINE Notify ───────────────────────────────────────────────────────────────

async def send_line_notify(*, token: str, message: str) -> bool:
    """Send a LINE Notify message. Returns True on success."""
    if not token:
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://notify-api.line.me/api/notify",
                headers={"Authorization": f"Bearer {token}"},
                data={"message": message[:1000]},
            )
        if resp.status_code == 200:
            logger.info("LINE Notify sent: %s", message[:50])
            return True
        logger.warning("LINE Notify failed: %s %s", resp.status_code, resp.text)
        return False
    except Exception as exc:
        logger.error("LINE Notify error: %s", exc)
        return False


async def test_email(settings_override: dict | None = None) -> dict:
    """Test email configuration. Returns {'ok': bool, 'message': str}."""
    from nexus_agent.core.settings import get_settings
    s = get_settings()
    cfg = settings_override or {}
    try:
        ok = send_email(
            to=cfg.get("to", s.notification_email) or s.smtp_user,
            subject="[Nexus-Agent] Test Notification",
            body_html="<h2>✅ Email configuration is working!</h2>",
            body_text="Nexus-Agent email test — configuration is working.",
            smtp_host=cfg.get("smtp_host", s.smtp_host),
            smtp_port=int(cfg.get("smtp_port", s.smtp_port)),
            smtp_user=cfg.get("smtp_user", s.smtp_user),
            smtp_password=cfg.get("smtp_password", s.smtp_password),
            smtp_from=cfg.get("smtp_from", s.smtp_from),
            use_tls=bool(cfg.get("use_tls", s.smtp_use_tls)),
        )
        return {"ok": ok, "message": "Email sent successfully" if ok else "Failed to send email"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


async def test_line(token: str | None = None) -> dict:
    """Test LINE Notify. Returns {'ok': bool, 'message': str}."""
    from nexus_agent.core.settings import get_settings
    s  = get_settings()
    tk = token or s.line_notify_token
    ok = await send_line_notify(token=tk, message="\n✅ Nexus-Agent LINE Notify test — connection successful!")
    return {"ok": ok, "message": "LINE Notify sent" if ok else "Failed — check your token"}
