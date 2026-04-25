#!/bin/sh
set -e

# MinIO configuration
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"
MINIO_BUCKET="${MINIO_BUCKET:-generated-images}"
DATA_DIR="/data"

mkdir -p "$DATA_DIR"

echo "Starting MinIO server..."
echo "Root user: $MINIO_ROOT_USER"
echo "Bucket: $MINIO_BUCKET"

# Start MinIO server in the background
minio server "$DATA_DIR" --address ":9000" --console-address ":9001" &
MINIO_PID=$!

# Wait for MinIO to be ready
echo "Waiting for MinIO to start..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:9000/minio/health/live" > /dev/null 2>&1; then
    echo "MinIO is ready."
    break
  fi
  sleep 1
done

# Configure MinIO client
mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

# Create bucket if it doesn't exist
if ! mc ls local/"$MINIO_BUCKET" > /dev/null 2>&1; then
  echo "Creating bucket: $MINIO_BUCKET"
  mc mb local/"$MINIO_BUCKET"
  
  # Set bucket policy to public read for web access
  mc anonymous set download local/"$MINIO_BUCKET"
  
  echo "MinIO initialized successfully."
else
  echo "Bucket already exists, skipping setup."
fi

# Wait for MinIO process
wait $MINIO_PID
