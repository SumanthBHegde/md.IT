"""Print the backend's OpenAPI document, the source of the frontend's typed client (P-076).

    cd backend && python -m uv run python ../scripts/export_openapi.py > ../frontend/src/api/openapi.json

Builds the app with placeholder settings (nothing connects) and prints the schema with
sorted keys, so the committed file only changes when the API does. CI fails on a diff.
"""

import json
import sys
from pathlib import Path

from pydantic import SecretStr

# Run from backend/ with its environment; make the backend package importable from scripts/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


def main() -> None:
    settings = Settings(
        db_host="unused",
        db_password=SecretStr("unused"),
        blob_connection_string=SecretStr("UseDevelopmentStorage=true"),
        public_base_url="http://localhost:8080",
        session_secret=SecretStr("x" * 32),
    )
    schema = create_app(settings, providers={}).openapi()
    text = json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    # Bytes, so Windows doesn't turn \n into \r\n: the file must match what CI writes on Linux.
    sys.stdout.buffer.write(text.encode("utf-8"))


if __name__ == "__main__":
    main()
