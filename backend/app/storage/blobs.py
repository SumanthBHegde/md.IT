"""Blob Storage wrapper: content-addressed blobs named by SHA-256 hex (PRD 6.5)."""

import contextlib
import logging
import re

from azure.core.exceptions import AzureError, ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import BlobClient, BlobServiceClient, ContainerClient, ContentSettings

log = logging.getLogger(__name__)

_HASH = re.compile(r"[0-9a-f]{64}")


def is_blob_hash(value: str) -> bool:
    """A blob name: SHA-256 as 64 lowercase hex characters."""
    return _HASH.fullmatch(value) is not None


class BlobStore:
    def __init__(self, container: ContainerClient) -> None:
        self._container = container

    @classmethod
    def from_connection_string(cls, connection_string: str, container: str) -> BlobStore:
        service = BlobServiceClient.from_connection_string(
            connection_string, retry_total=3, connection_timeout=5, read_timeout=30
        )
        return cls(service.get_container_client(container))

    def ensure_container(self) -> bool:
        """Create the container if missing. Never raises; False when storage is unreachable."""
        # Health checks must answer quickly; default retries take ~90 s on a dead host.
        try:
            if not self._container.exists(retry_total=0, connection_timeout=2, read_timeout=2):
                self._container.create_container(
                    retry_total=0, connection_timeout=2, read_timeout=2
                )
        except ResourceExistsError:
            pass
        except AzureError:
            log.warning("Blob storage is unavailable", exc_info=True)
            return False
        return True

    def exists(self, hash: str) -> bool:
        return self._blob(hash).exists()

    def put(self, hash: str, data: bytes, content_type: str) -> None:
        """Store bytes under their hash; an existing blob is kept (deduplication).

        Callers verify the hash first (the Phase 5 upload route recomputes SHA-256).
        """
        with contextlib.suppress(ResourceExistsError):
            self._blob(hash).upload_blob(
                data, overwrite=False, content_settings=ContentSettings(content_type=content_type)
            )

    def get(self, hash: str) -> bytes | None:
        try:
            return self._blob(hash).download_blob().readall()
        except ResourceNotFoundError:
            return None

    def delete(self, hash: str) -> None:
        """Remove a blob; one that is already gone is fine."""
        with contextlib.suppress(ResourceNotFoundError):
            self._blob(hash).delete_blob()

    def _blob(self, hash: str) -> BlobClient:
        if not is_blob_hash(hash):
            raise ValueError("Blob names must be 64 lowercase hex characters.")
        return self._container.get_blob_client(hash)
