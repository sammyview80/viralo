"""LinkedIn REST API publisher."""
import os
import logging
import requests
from typing import Optional
from pathlib import Path
from .base import BasePublisher, PublishResult

log = logging.getLogger(__name__)

LI_API = "https://api.linkedin.com/rest"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
CLIENT_ID = os.getenv("LINKEDIN_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("LINKEDIN_CLIENT_SECRET", "")


class LinkedInPublisher(BasePublisher):
    def publish(self, video_path: str, caption: str, hashtags: list[str], access_token: str,
                refresh_token: Optional[str] = None, person_urn: str = "", **kwargs) -> PublishResult:
        try:
            if not person_urn:
                return PublishResult(success=False, error="person_urn required (urn:li:person:xxx or urn:li:organization:xxx)")

            headers = {
                "Authorization": f"Bearer {access_token}",
                "LinkedIn-Version": "202405",
                "Content-Type": "application/json",
                "X-Restli-Protocol-Version": "2.0.0",
            }
            file_size = Path(video_path).stat().st_size

            # Step 1: Init video upload
            r = requests.post(
                f"{LI_API}/videos?action=initializeUpload",
                headers=headers,
                json={"initializeUploadRequest": {
                    "owner": person_urn,
                    "fileSizeBytes": file_size,
                    "uploadCaptions": False,
                    "uploadThumbnail": False,
                }},
                timeout=30,
            )
            r.raise_for_status()
            upload_data = r.json().get("value", {})
            video_urn = upload_data.get("video")
            upload_instructions = upload_data.get("uploadInstructions", [])
            upload_token = upload_data.get("uploadToken", "")

            # Step 2: Upload chunks
            with open(video_path, "rb") as f:
                for instr in upload_instructions:
                    chunk_start = instr.get("firstByte", 0)
                    chunk_end = instr.get("lastByte", file_size - 1)
                    upload_url = instr["uploadUrl"]
                    f.seek(chunk_start)
                    chunk = f.read(chunk_end - chunk_start + 1)
                    etag_resp = requests.put(
                        upload_url,
                        data=chunk,
                        headers={"Content-Type": "application/octet-stream"},
                        timeout=120,
                    )
                    etag_resp.raise_for_status()

            # Step 3: Finalize upload
            requests.post(
                f"{LI_API}/videos?action=finalizeUpload",
                headers=headers,
                json={"finalizeUploadRequest": {
                    "video": video_urn,
                    "uploadToken": upload_token,
                    "uploadedPartIds": [i.get("uploadUrl", "") for i in upload_instructions],
                }},
                timeout=30,
            ).raise_for_status()

            # Step 4: Create post
            tags_text = " ".join(f"#{h.lstrip('#')}" for h in hashtags[:10])
            full_text = f"{caption}\n{tags_text}"[:3000]
            post_body = {
                "author": person_urn,
                "commentary": full_text,
                "visibility": "PUBLIC",
                "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": []},
                "content": {"media": {"title": caption[:200], "id": video_urn}},
                "lifecycleState": "PUBLISHED",
                "isReshareDisabledByAuthor": False,
            }
            r3 = requests.post(f"{LI_API}/posts", headers=headers, json=post_body, timeout=30)
            r3.raise_for_status()
            post_id = r3.headers.get("x-restli-id", "")
            return PublishResult(success=True, platform_post_id=post_id)
        except requests.HTTPError as e:
            if e.response.status_code == 429:
                return PublishResult(success=False, error="LinkedIn rate limited", retry_after_seconds=900)
            return PublishResult(success=False, error=f"HTTP {e.response.status_code}: {e.response.text[:300]}")
        except Exception as e:
            return PublishResult(success=False, error=str(e)[:500])

    def refresh_token(self, refresh_token: str) -> dict:
        r = requests.post(TOKEN_URL, data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
        }, timeout=15)
        r.raise_for_status()
        return r.json()
