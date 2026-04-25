#!/bin/sh
set -e

GARAGE=/usr/local/bin/garage
DATA_DIR=/var/lib/garage/data
META_DIR=/var/lib/garage/meta
CONF=/etc/garage.toml
MARKER="$DATA_DIR/.garage-initialized"

mkdir -p "$DATA_DIR" "$META_DIR"

# ── Generate garage.toml from environment variables ──
cat > "$CONF" <<EOF
metadata_dir = "$META_DIR"
data_dir = "$DATA_DIR"
db_engine = "sqlite"
replication_factor = 1
compression_level = 1

rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "$GARAGE_RPC_SECRET"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"

[s3_web]
bind_addr = "[::]:3902"
root_domain = ".web.garage"
index = "index.html"

[admin]
api_bind_addr = "[::]:3903"
admin_token = "$GARAGE_ADMIN_TOKEN"
metrics_token = "$GARAGE_METRICS_TOKEN"
EOF

# ── Start Garage in background ──
$GARAGE server &
GARAGE_PID=$!

# Wait for admin API to be ready
echo "Waiting for Garage to start..."
for i in $(seq 1 60); do
  if $GARAGE status 2>/dev/null | grep -q "ID"; then
    echo "Garage is ready."
    break
  fi
  sleep 1
done

# ── First-time cluster setup ──
if [ ! -f "$MARKER" ]; then
  echo "Initializing Garage cluster..."

  # Get node ID and assign layout (try multiple methods)
  NODE_ID=""
  for i in $(seq 1 10); do
    NODE_ID=$($GARAGE status 2>/dev/null | grep -oE '[0-9a-f]{16}' | head -1)
    if [ -n "$NODE_ID" ]; then
      break
    fi
    sleep 1
  done

  if [ -n "$NODE_ID" ]; then
    echo "Found node ID: $NODE_ID"
    $GARAGE layout assign "$NODE_ID" -z dc1 -c 1G -t node1
    $GARAGE layout apply --version 1

    # Create API key and bucket
    # Garage v2.3.0 generates keys automatically
    KEY_INFO=$($GARAGE key create generated-images-key)
    echo "Created key: $KEY_INFO"

    $GARAGE bucket create generated-images
    $GARAGE bucket allow generated-images --read --write --key generated-images-key
    $GARAGE bucket website --allow generated-images

    touch "$MARKER"
    echo "Garage initialized successfully."
  else
    echo "WARNING: Could not determine node ID. Initialization skipped."
  fi
else
  echo "Garage already initialized, skipping setup."
fi

# ── Wait for Garage process ──
wait $GARAGE_PID
