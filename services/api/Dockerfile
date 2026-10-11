# The Family Hub API. Applies database migrations, then serves on :8000.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # The app is run from source here, not installed, so Alembic can import it too.
    PYTHONPATH=/app

WORKDIR /app

# Dependencies first, so code changes don't reinstall them. With no app/ folder yet this
# installs only the dependencies listed in pyproject.toml.
COPY pyproject.toml ./
RUN pip install .

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

RUN useradd --create-home --uid 1000 app && mkdir -p data/docs && chown -R app data
USER app

EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=20 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"

# --proxy-headers: trust X-Forwarded-* from the web container's nginx.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
