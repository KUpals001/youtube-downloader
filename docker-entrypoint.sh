#!/bin/sh
set -e

# Ensure data directory exists and has correct permissions
# We do this at runtime because bind mounts may have different permissions
mkdir -p /app/data

# If running as root, fix permissions and drop to nextjs user
if [ "$(id -u)" = '0' ]; then
    chown -R nextjs:nodejs /app/data
    
    # Run migrations then start the application as nextjs
    exec su-exec nextjs sh -c "npx prisma migrate deploy && npm start"
else
    # If not running as root, just try to run normally
    npx prisma migrate deploy
    exec npm start
fi
