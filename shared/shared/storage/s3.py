import os
import boto3
from botocore.config import Config
from shared.storage.base import StorageAdapter


class S3Adapter(StorageAdapter):
    def __init__(self):
        self.client = boto3.client(
            "s3",
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            region_name=os.getenv("AWS_S3_REGION", "us-east-1"),
            config=Config(
                connect_timeout=10, read_timeout=120,
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )
        self.bucket = os.getenv("AWS_S3_BUCKET", "viralo-videos")

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
