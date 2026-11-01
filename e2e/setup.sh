#!/bin/sh
# One-time E2E environment (not stored in the repository: ~30 MB web build + generated videos).
#  1) Lampa web build from https://github.com/yumata/lampa (prebuilt), pinned to the commit with app_version 3.4.4
#     that the tests were written for -> ../ref/lampa-built. Another build: LAMPA_COMMIT=<sha> sh e2e/setup.sh
#  2) silent test videos of exact length (VP8 without audio: with Opus the WebM duration is ~8 ms longer and breaks duration checks)
# Needs: git, ffmpeg/ffprobe, internet access (only for the git fetch).
set -e
cd "$(dirname "$0")"
LAMPA_COMMIT="${LAMPA_COMMIT:-4294a571aad8883116e57d975ad05519f84be13e}"
if [ ! -f ../ref/lampa-built/app.min.js ]; then
  mkdir -p ../ref/lampa-built
  git -C ../ref/lampa-built init -q
  git -C ../ref/lampa-built fetch -q --depth 1 https://github.com/yumata/lampa.git "$LAMPA_COMMIT"
  git -C ../ref/lampa-built checkout -q FETCH_HEAD
fi
grep -o "app_version: '[0-9.]*'" ../ref/lampa-built/app.min.js | head -1
mkdir -p www/video www/subs
gen() { [ -f "www/video/$1" ] || ffmpeg -hide_banner -loglevel error -y -f lavfi -i "color=c=$3:s=160x90:r=$4" -t "$2" -c:v libvpx -b:v 20k -g $(( $4 * 2 )) -an "www/video/$1"; }
gen got_s01e01.webm 3700 0x203050 2 &
gen got_s01e02.webm 3400 0x305020 2 &
gen aot_s01e01.webm 1420 0x502030 2 &
gen movie_7600.webm 7600 0x403020 1 &
wait
for f in www/video/*.webm; do echo "$f $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"; done
echo "Done. Run: npm run e2e (the local server on 127.0.0.1:8123 is started automatically)"
