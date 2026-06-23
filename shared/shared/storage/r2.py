import os
import boto3
from botocore.config import Config
from shared.storage.base import StorageAdapter


class R2Adapter(StorageAdapter):
    def __init__(self):
        self.client = boto3.client(
            "s3",
            endpoint_url=os.getenv("CF_R2_ENDPOINT"),
            aws_access_key_id=os.getenv("CF_R2_ACCESS_KEY"),
            aws_secret_access_key=os.getenv("CF_R2_SECRET_KEY"),
            config=Config(signature_version="s3v4"),
        )
        self.bucket = os.getenv("CF_R2_BUCKET", "viralo-videos")

    async def upload(self, data, path: str, content_type: str = "video/mp4") -> str:
        content = data if isinstance(data, bytes) else data.read()
        self.client.put_object(Bucket=self.bucket, Key=path, Body=content, ContentType=content_type)
        return path

    async def get_signed_url(self, path: str, expires_in: int = 3600) -> str:
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": path}, ExpiresIn=expires_in
        )

    async def download(self, path: str, dest_path: str) -> None:
        self.client.download_file(self.bucket, path, dest_path)

    async def delete(self, path: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=path)
