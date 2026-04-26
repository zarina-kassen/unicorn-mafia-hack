# Testing: Backend API & Logfire Observability

How to test the frame-mog FastAPI backend and verify Logfire observability.

## Devin Secrets Needed

- `LOGFIRE_TOKEN` — Pydantic Logfire **read** token for querying telemetry data via the API. Stored as a repo-scoped secret.

## Running Tests

```sh
cd backend && uv run pytest -q          # full suite
cd backend && uv run pytest tests/test_templates.py::test_health_endpoint -v  # single test
```

## Testing API Endpoints Locally

The backend requires `DATABASE_URL`, `OPENROUTER_API_KEY`, `MUBIT_API_KEY`, and `CLERK_SECRET_KEY` to start the full server. If these are unavailable, use pytest's `TestClient` instead:

```python
from fastapi.testclient import TestClient
from app.main import app
from app.auth.clerk import require_auth

app.dependency_overrides[require_auth] = lambda: "test-user-id"
client = TestClient(app, follow_redirects=False)
r = client.get("/health")
assert r.status_code == 200
app.dependency_overrides.pop(require_auth, None)
```

Key points:
- Always override `require_auth` dependency for testing (all routes except `/health` and `/` require auth)
- Use `follow_redirects=False` when testing redirect behavior
- The TestClient bypasses `lifespan` events by default, so DB-dependent routes may not work without additional mocking

## Querying Logfire for Errors

Use the Logfire REST API to check for errors in production:

```sh
# Find errors and exceptions
curl -s -G "https://logfire-api.pydantic.dev/v1/query" \
  -H "Authorization: Bearer ${LOGFIRE_TOKEN}" \
  --data-urlencode "sql=SELECT start_timestamp, message, http_response_status_code, exception_type, exception_message FROM records WHERE level >= 13 OR is_exception = true OR http_response_status_code >= 400 ORDER BY start_timestamp DESC LIMIT 50"

# Check span distribution (find noisy endpoints)
curl -s -G "https://logfire-api.pydantic.dev/v1/query" \
  -H "Authorization: Bearer ${LOGFIRE_TOKEN}" \
  --data-urlencode "sql=SELECT DISTINCT span_name, COUNT(*) as cnt FROM records GROUP BY span_name ORDER BY cnt DESC LIMIT 50"

# Check slow requests
curl -s -G "https://logfire-api.pydantic.dev/v1/query" \
  -H "Authorization: Bearer ${LOGFIRE_TOKEN}" \
  --data-urlencode "sql=SELECT start_timestamp, message, duration FROM records WHERE duration > 5 ORDER BY duration DESC LIMIT 20"
```

Notes:
- The API uses **GET** with query params (not POST)
- There is a per-minute rate limit — space out queries if you hit `429`
- Level values: 9=info, 13=warning, 17=error
- The `records` table contains all spans/logs. Use `information_schema.columns` to discover available columns

## Logfire Instrumentation

`logfire.instrument_fastapi()` in `app/main.py` traces all FastAPI requests. The `excluded_urls` parameter accepts comma-separated regex patterns (matched via `re.search` against the full URL) to suppress noisy endpoints like health checks.

Other instrumented libraries: `pydantic_ai`, `asyncpg`, `httpx`.

## Lint & Format

```sh
cd backend
uvx ruff check .            # lint
uvx ruff format --check .    # format
uvx ty check .               # type check
```
