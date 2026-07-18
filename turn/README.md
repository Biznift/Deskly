# Coturn TURN for Deskly
#
# 1. Copy .env.example → .env and set TURN_SECRET + EXTERNAL_IP
# 2. docker compose up -d
# 3. On signaling, set matching env (see signaling/.env.example)
#
# Windows note: Docker Desktop's `network_mode: host` does not work like Linux.
# If compose fails on Windows, use docker-compose.windows.yml instead.
#
# Test forced relay: enable "Force TURN relay" on the controller connect page.
