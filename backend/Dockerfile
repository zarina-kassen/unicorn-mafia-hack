FROM python:3.11-slim

WORKDIR /app

# piccolo_conf.py lives at /app/piccolo_conf.py; adding /app to PYTHONPATH
# ensures Piccolo's engine_finder() can import it as a module.
ENV PYTHONPATH=/app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

COPY pyproject.toml uv.lock .python-version ./

RUN uv sync --frozen --no-dev

COPY piccolo_conf.py ./
COPY app/ app/

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
