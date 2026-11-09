#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
rm -rf site
mkdir -p site
cp index.html styles.css app.js words.js sw.js manifest.webmanifest site/
cp -R fonts icons site/
find site -type f | sort
du -sh site
