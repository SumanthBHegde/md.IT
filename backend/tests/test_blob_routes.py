"""Blob routes: verified uploads, per-user ownership, sandboxed downloads (P-061, P-065)."""

import hashlib

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import Blob, User, UserBlob
from app.services import blobs as blob_service
from app.services.blobs import MAX_BLOB_BYTES
from app.storage.blobs import BlobStore
from tests.support import sign_in

pytestmark = pytest.mark.integration

MD = "# Notes\n\nShared text ✓\n".encode()
PNG = b"\x89PNG\r\n\x1a\n" + bytes(16)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def put(
    client: TestClient, data: bytes, ctype: str = "text/markdown", hash: str | None = None
) -> httpx2.Response:
    return client.put(
        f"/api/blobs/{hash or sha(data)}", content=data, headers={"Content-Type": ctype}
    )


def count(engine: Engine, model: type) -> int:
    with Session(engine) as db:
        return db.scalar(select(func.count()).select_from(model)) or 0


def test_upload_then_head_and_get(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    response = put(client, MD)
    assert response.status_code == 201
    assert response.json() == {"hash": sha(MD), "size": len(MD), "content_type": "text/markdown"}
    assert client.head(f"/api/blobs/{sha(MD)}").status_code == 200
    got = client.get(f"/api/blobs/{sha(MD)}")
    assert got.status_code == 200
    assert got.content == MD
    assert got.headers["content-type"].startswith("text/markdown")
    assert got.headers["x-content-type-options"] == "nosniff"
    assert got.headers["content-security-policy"] == "sandbox; default-src 'none'"
    assert got.headers["content-disposition"] == "attachment"
    assert got.headers["cache-control"] == "private, max-age=31536000, immutable"


def test_image_keeps_its_type(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    assert put(client, PNG, "image/png").status_code == 201
    assert client.get(f"/api/blobs/{sha(PNG)}").headers["content-type"] == "image/png"


def test_second_upload_by_same_user_is_200(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    put(client, MD)
    assert put(client, MD).status_code == 200
    assert count(clean_db, UserBlob) == 1


def test_unknown_blob_is_404(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    assert client.head(f"/api/blobs/{sha(b'nothing')}").status_code == 404
    assert client.get(f"/api/blobs/{sha(b'nothing')}").json()["error"]["code"] == "not_found"


def test_other_users_cannot_see_a_blob(
    client: TestClient, other_client: TestClient, clean_db: Engine
) -> None:
    sign_in(client, clean_db, "alice")
    sign_in(other_client, clean_db, "bob")
    put(client, MD)
    assert other_client.head(f"/api/blobs/{sha(MD)}").status_code == 404
    assert other_client.get(f"/api/blobs/{sha(MD)}").status_code == 404


def test_dedup_across_users_one_object_two_owners(
    client: TestClient, other_client: TestClient, clean_db: Engine
) -> None:
    sign_in(client, clean_db, "alice")
    sign_in(other_client, clean_db, "bob")
    assert put(client, MD).status_code == 201
    assert put(other_client, MD).status_code == 201  # new for bob, though stored already
    assert count(clean_db, Blob) == 1
    assert count(clean_db, UserBlob) == 2
    assert other_client.get(f"/api/blobs/{sha(MD)}").content == MD


def test_hash_mismatch_is_422(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    response = put(client, MD, hash=sha(b"something else"))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "hash_mismatch"
    assert count(clean_db, Blob) == 0


def test_too_large_is_413(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    data = b"a" * (MAX_BLOB_BYTES + 1)
    response = put(client, data)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "too_large"


def test_exactly_the_limit_is_accepted(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    assert put(client, b"a" * MAX_BLOB_BYTES).status_code == 201


def test_unsupported_type_is_415(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    response = put(client, b"%PDF-1.7", "application/pdf")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_type"


def test_wrong_bytes_for_type_is_415(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    assert put(client, PNG, "image/jpeg").status_code == 415


def test_content_type_parameters_are_ignored(client: TestClient, clean_db: Engine) -> None:
    # Review Focus 3: what browsers and fetch commonly send.
    sign_in(client, clean_db)
    response = put(client, MD, "text/markdown; charset=utf-8")
    assert response.status_code == 201
    assert response.json()["content_type"] == "text/markdown"


@pytest.mark.parametrize("bad", ["ABC", "A" * 64, "a" * 63, "a" * 65])
def test_invalid_hash_is_404(client: TestClient, clean_db: Engine, bad: str) -> None:
    sign_in(client, clean_db)
    assert put(client, MD, hash=bad).status_code == 404
    assert client.head(f"/api/blobs/{bad}").status_code == 404
    assert client.get(f"/api/blobs/{bad}").status_code == 404


def test_upload_retries_after_a_swept_row(
    client: TestClient,
    other_client: TestClient,
    clean_db: Engine,
    blob_store: BlobStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # bob stored the blob; while alice uploads the same bytes, an account-delete sweep removes
    # bob's ownership, the row and the object. Alice's ownership insert then fails its foreign
    # key once; the upload must run again and store the object afresh.
    sign_in(client, clean_db, "alice")
    sign_in(other_client, clean_db, "bob")
    put(other_client, MD)
    real_insert = blob_service._insert_owner
    calls = []

    def swept_first(db: Session, user: User, hash: str) -> None:
        calls.append(hash)
        if len(calls) == 1:
            with Session(clean_db) as other:
                other.execute(delete(UserBlob).where(UserBlob.hash == hash))
                other.execute(delete(Blob).where(Blob.hash == hash))
                other.commit()
            blob_store.delete(hash)
        real_insert(db, user, hash)

    monkeypatch.setattr(blob_service, "_insert_owner", swept_first)
    assert put(client, MD).status_code == 201
    assert len(calls) == 2
    assert blob_store.get(sha(MD)) == MD
    assert client.get(f"/api/blobs/{sha(MD)}").content == MD


def test_integrity_error_is_what_the_sweep_race_raises(clean_db: Engine) -> None:
    # The retry above depends on the FK failure surfacing as IntegrityError.
    with Session(clean_db) as db:
        db.add(User(provider="dev", provider_user_id="x"))
        db.commit()
        user = db.scalars(select(User)).one()
        with pytest.raises(IntegrityError):
            blob_service._insert_owner(db, user, "f" * 64)
