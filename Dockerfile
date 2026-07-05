# Multi-stage Dockerfile to build React frontend and run FastAPI backend in a python image.
# Stage 1: build frontend using Node
# Stage 2: run backend with Python, copy built frontend into backend/frontend_build

# ------------------ Stage 1: frontend builder ------------------
FROM node:18-bullseye AS builder
WORKDIR /app

# copy only frontend package files to leverage cache
COPY frontend/package.json frontend/yarn.lock ./frontend/
WORKDIR /app/frontend
RUN corepack enable && corepack prepare yarn@1.22.22 --activate || true
RUN yarn install --frozen-lockfile --production=false

# copy frontend sources and build
COPY frontend ./
RUN yarn build

# ------------------ Stage 2: runtime ------------------
FROM python:3.11-slim
WORKDIR /app

# install system deps for pillow, bcrypt, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    libssl-dev \
    libjpeg-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# create app user
RUN useradd --create-home appuser

# copy backend
COPY backend ./backend

# copy built frontend from builder
COPY --from=builder /app/frontend/build ./backend/frontend_build

# Install Python deps
RUN pip install --no-cache-dir -r backend/requirements.txt

# expose port and set default env
ENV PORT=8001
ENV PYTHONUNBUFFERED=1

# ensure uploads dir exists and is writable
RUN mkdir -p /app/backend/uploads && chown -R appuser:appuser /app/backend

USER appuser
WORKDIR /app/backend

# Start uvicorn
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "${PORT}"]
