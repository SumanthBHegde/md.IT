"""Blob routes: verified uploads, per-user ownership, sandboxed downloads (P-061, P-065)."""

import hashlib
import threading

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from app.db.models import Blob, User, UserBlob
from app.services.accounts import Identity, delete_account, upsert_user
from app.services.blobs import MAX_BLOB_BYTES, store_blob
from app.storage.blobs import BlobStore
from tests.support import sign_in

pytestmark = pytest.mark.integration

MD = "# Notes\n\nShared text ✓\n".encode()
PNG = b"\x89PNG\r\n\x1a\n" + bytes(16)
# Valid UTF-8 and valid SVG: passes both the Markdown and the SVG check.
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"/>'


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


def test_lost_object_is_restored_by_the_next_upload(
    client: TestClient, clean_db: Engine, blob_store: BlobStore
) -> None:
    sign_in(client, clean_db)
    put(client, MD)
    blob_store.delete(sha(MD))  # e.g. a sweep's commit failed after deleting the object
    assert put(client, MD).status_code == 200
    assert client.get(f"/api/blobs/{sha(MD)}").content == MD


def test_upload_racing_a_sweep_keeps_the_object(
    clean_db: Engine, blob_store: BlobStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Final review, Important 1: alice's request has a snapshot from before bob stored H; bob
    # deletes his account while alice's upload runs. Alice's blob must still have its bytes.
    with Session(clean_db, expire_on_commit=False) as db:
        alice = upsert_user(db, Identity("dev", "alice", None))
        bob = upsert_user(db, Identity("dev", "bob", None))

    def delete_bob() -> None:
        with Session(clean_db) as db:
            user = db.get(User, bob.id)
            assert user is not None
            delete_account(db, blob_store, user)

    sweeper = threading.Thread(target=delete_bob)
    real_put, real_exists = BlobStore.put, BlobStore.exists

    def sweep_now() -> None:
        if sweeper.ident is None:
            sweeper.start()
            sweeper.join(timeout=1.5)  # finishes, or waits on alice's row lock

    def put_then_sweep(self: BlobStore, hash: str, data: bytes, content_type: str) -> None:
        real_put(self, hash, data, content_type)
        sweep_now()

    def exists_then_sweep(self: BlobStore, hash: str) -> bool:
        found = real_exists(self, hash)
        sweep_now()
        return found

    with Session(clean_db) as alice_db:
        alice_user = alice_db.get(User, alice.id)  # fixes alice's snapshot, like the auth lookup
        assert alice_user is not None
        with Session(clean_db) as bob_db:
            bob_user = bob_db.get(User, bob.id)
            assert bob_user is not None
            store_blob(bob_db, blob_store, bob_user, sha(MD), "text/markdown", MD)
        monkeypatch.setattr(BlobStore, "put", put_then_sweep)
        monkeypatch.setattr(BlobStore, "exists", exists_then_sweep)
        assert store_blob(alice_db, blob_store, alice_user, sha(MD), "text/markdown", MD)
    sweeper.join(timeout=30)
    monkeypatch.undo()
    assert blob_store.get(sha(MD)) == MD
    with Session(clean_db) as db:
        assert db.get(Blob, sha(MD)) is not None


def test_content_type_is_per_owner(
    client: TestClient, other_client: TestClient, clean_db: Engine
) -> None:
    # Final review, Important 2: the first uploader must not decide the type others get.
    sign_in(client, clean_db, "alice")
    sign_in(other_client, clean_db, "bob")
    assert put(client, SVG, "text/markdown").status_code == 201
    response = put(other_client, SVG, "image/svg+xml")
    assert response.status_code == 201
    assert response.json()["content_type"] == "image/svg+xml"
    assert other_client.get(f"/api/blobs/{sha(SVG)}").headers["content-type"] == "image/svg+xml"
    alice_type = client.get(f"/api/blobs/{sha(SVG)}").headers["content-type"]
    assert alice_type.startswith("text/markdown")
