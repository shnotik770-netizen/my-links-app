#!/bin/sh
# Run after changing anything in public/: gives the files a new version so browsers
# stop using cached copies (and open tabs reload themselves via version.json).
set -e
cd "$(dirname "$0")/public"
V=$(date +%Y.%m.%d-%H%M%S)
sed -i -E "s/\?v=[0-9.-]+\"/?v=$V\"/g" index.html
sed -i -E "s/const VERSION = '[^']*'/const VERSION = '$V'/" app.js
printf '{"version": "%s"}\n' "$V" > version.json
echo "version $V"
