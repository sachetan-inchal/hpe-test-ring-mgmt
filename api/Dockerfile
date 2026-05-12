FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY api /app/api
COPY discovery /app/discovery
COPY simulator /app/simulator
COPY data /app/data

ENV PYTHONPATH=/app/api:/app
EXPOSE 5005

WORKDIR /app/api
CMD ["python", "app.py"]
