#!/bin/sh
set -e

CONF=/tmp/turnserver.runtime.conf
cp /etc/coturn/turnserver.conf "$CONF"

SECRET="${TURN_SECRET:-deskly-dev-secret-change-me}"
echo "static-auth-secret=${SECRET}" >> "$CONF"

if [ -n "$EXTERNAL_IP" ]; then
  echo "external-ip=${EXTERNAL_IP}" >> "$CONF"
fi

# Allow loopback / LAN testing
echo "listening-ip=0.0.0.0" >> "$CONF"
echo "relay-ip=0.0.0.0" >> "$CONF"

exec turnserver -c "$CONF" --log-file=stdout
