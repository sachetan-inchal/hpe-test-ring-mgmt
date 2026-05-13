# Stage 1: Build the React Dashboard
FROM node:20-slim AS builder
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm install
COPY dashboard/ ./
RUN npm run build

# Stage 2: Python API
FROM python:3.12-slim

WORKDIR /app

# System dependencies (if any)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY api ./api
COPY discovery ./discovery
COPY simulator ./simulator
COPY data ./data

# Copy built frontend from Stage 1
COPY --from=builder /app/dashboard/dist ./dashboard/dist

# Set environment
ENV PYTHONPATH=/app/api:/app
ENV PYTHONUNBUFFERED=1

EXPOSE 5005

WORKDIR /app/api
CMD ["python", "app.py"]
