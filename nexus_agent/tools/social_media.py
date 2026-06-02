"""Social media publishing tools for the Nexus-Agent Content Creator.

Supported platforms
-------------------
Facebook  — post text (+ optional link/image) to a Facebook Page via Graph API v19.0.
            Requires a Page Access Token with `pages_manage_posts` permission.

TikTok    — post text caption content via the TikTok Content Posting API v2.
            Requires a user access token obtained through the TikTok OAuth2 flow.
            Scope needed: `video.upload`, `video.publish`.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

FACEBOOK_GRAPH_BASE = "https://graph.facebook.com/v19.0"
TIKTOK_API_BASE     = "https://open.tiktokapis.com/v2"


# ── Facebook ──────────────────────────────────────────────────────────────────

async def facebook_verify_token(page_id: str, access_token: str) -> dict[str, Any]:
    """Fetch basic Page info to confirm the token is valid.

    Returns a dict with ``id``, ``name``, and ``fan_count``.
    Raises ``RuntimeError`` on API error.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{FACEBOOK_GRAPH_BASE}/{page_id}",
            params={"fields": "id,name,fan_count", "access_token": access_token},
        )
    data = resp.json()
    _raise_fb_error(data, resp.status_code)
    return {"id": data.get("id"), "name": data.get("name"), "fan_count": data.get("fan_count", 0)}


async def facebook_post_text(
    *,
    page_id: str,
    access_token: str,
    message: str,
    link: str | None = None,
    published: bool = True,
) -> dict[str, Any]:
    """Publish a text post (optionally with a link) to a Facebook Page.

    Returns ``{"platform": "facebook", "post_id": "<id>", "url": "<post_url>"}``.
    """
    payload: dict[str, Any] = {
        "message": message,
        "access_token": access_token,
        "published": published,
    }
    if link:
        payload["link"] = link

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{FACEBOOK_GRAPH_BASE}/{page_id}/feed", data=payload)
    data = resp.json()
    _raise_fb_error(data, resp.status_code)

    post_id = data.get("id", "")
    return {
        "platform": "facebook",
        "post_id": post_id,
        "url": f"https://www.facebook.com/{post_id.replace('_', '/posts/')}",
        "status": "published",
    }


async def facebook_post_photo(
    *,
    page_id: str,
    access_token: str,
    message: str,
    image_url: str,
) -> dict[str, Any]:
    """Publish a photo post with caption to a Facebook Page."""
    payload: dict[str, Any] = {
        "caption": message,
        "url": image_url,
        "access_token": access_token,
    }
    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(f"{FACEBOOK_GRAPH_BASE}/{page_id}/photos", data=payload)
    data = resp.json()
    _raise_fb_error(data, resp.status_code)
    return {
        "platform": "facebook",
        "post_id": data.get("post_id") or data.get("id"),
        "photo_id": data.get("id"),
        "status": "published",
    }


def _raise_fb_error(data: dict, status_code: int) -> None:
    if status_code != 200 or "error" in data:
        err = data.get("error", {})
        msg = err.get("message") or data.get("error_description") or str(data)
        code = err.get("code", status_code)
        raise RuntimeError(f"Facebook API [{code}]: {msg}")


# ── TikTok ────────────────────────────────────────────────────────────────────

TIKTOK_OAUTH_BASE    = "https://www.tiktok.com/v2/auth/authorize/"
TIKTOK_TOKEN_URL     = "https://open.tiktokapis.com/v2/oauth/token/"
TIKTOK_USERINFO_URL  = "https://open.tiktokapis.com/v2/user/info/"


def tiktok_build_auth_url(
    client_key: str,
    redirect_uri: str,
    scopes: list[str] | None = None,
    state: str = "nexus_tiktok",
) -> str:
    """Build the TikTok OAuth2 authorization URL for user login."""
    import urllib.parse
    scope_str = ",".join(scopes or ["user.info.basic", "video.upload", "video.publish"])
    params = {
        "client_key": client_key,
        "response_type": "code",
        "scope": scope_str,
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{TIKTOK_OAUTH_BASE}?{urllib.parse.urlencode(params)}"


async def tiktok_exchange_code(
    *,
    client_key: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
) -> dict[str, Any]:
    """Exchange an authorization code for a TikTok access token."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            TIKTOK_TOKEN_URL,
            data={
                "client_key": client_key,
                "client_secret": client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    data = resp.json()
    _raise_tiktok_error(data)
    return data


async def tiktok_get_user_info(access_token: str) -> dict[str, Any]:
    """Fetch basic user info to verify the TikTok access token."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            TIKTOK_USERINFO_URL,
            params={"fields": "open_id,display_name,avatar_url,follower_count"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    data = resp.json()
    _raise_tiktok_error(data)
    user = data.get("data", {}).get("user", {})
    return {
        "open_id": user.get("open_id"),
        "display_name": user.get("display_name"),
        "avatar_url": user.get("avatar_url"),
        "follower_count": user.get("follower_count", 0),
    }


async def tiktok_post_video(
    *,
    access_token: str,
    video_url: str,
    caption: str,
    privacy_level: str = "PUBLIC_TO_EVERYONE",
    disable_duet: bool = False,
    disable_comment: bool = False,
    disable_stitch: bool = False,
) -> dict[str, Any]:
    """Publish a video post to TikTok via the Content Posting API.

    ``video_url`` must be a publicly accessible URL to an MP4 file.
    Returns the ``publish_id`` which can be used to check posting status.
    """
    payload = {
        "post_info": {
            "title": caption[:2200],
            "privacy_level": privacy_level,
            "disable_duet": disable_duet,
            "disable_comment": disable_comment,
            "disable_stitch": disable_stitch,
        },
        "source_info": {
            "source": "PULL_FROM_URL",
            "video_url": video_url,
        },
        "post_mode": "DIRECT_POST",
        "media_type": "VIDEO",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{TIKTOK_API_BASE}/post/publish/video/init/",
            json=payload,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json; charset=UTF-8",
            },
        )
    data = resp.json()
    _raise_tiktok_error(data)
    return {
        "platform": "tiktok",
        "publish_id": data.get("data", {}).get("publish_id"),
        "status": "processing",
    }


async def tiktok_check_publish_status(
    *,
    access_token: str,
    publish_id: str,
) -> dict[str, Any]:
    """Poll the status of a TikTok post being processed."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{TIKTOK_API_BASE}/post/publish/status/fetch/",
            json={"publish_id": publish_id},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json; charset=UTF-8",
            },
        )
    data = resp.json()
    _raise_tiktok_error(data)
    return data.get("data", {})


def _raise_tiktok_error(data: dict) -> None:
    err = data.get("error", {})
    if isinstance(err, dict) and err.get("code", "ok") != "ok":
        raise RuntimeError(f"TikTok API [{err.get('code')}]: {err.get('message', str(err))}")
    if data.get("error_code") and data.get("error_code") != 0:
        raise RuntimeError(f"TikTok OAuth error [{data.get('error_code')}]: {data.get('description', str(data))}")
