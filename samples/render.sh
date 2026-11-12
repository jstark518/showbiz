#!/usr/bin/env bash
# Rasterizes every template to a JPEG, with its stock wording.
#
# You do not need this to use the templates: the control panel renders them
# itself, in the browser, with the words you type. This is for seeding a fresh
# install in bulk, or for eyeballing all of them after an edit without clicking
# through the gallery.
#
# SVG is deliberately not an accepted upload type (see server/src/routes/media.ts),
# so the sources are design files, not something the sign ever loads. Rendering
# uses headless Chrome because it is the one renderer present on a stock Mac
# that handles gradients, filters and web-safe fonts correctly.
set -euo pipefail

# Resolved before the cd, or it would land wherever the script was invoked from.
out="$(cd "$(dirname "$0")" && pwd)/out"
cd "$(dirname "$0")/../server/templates"
mkdir -p "$out"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [[ ! -x "$CHROME" ]]; then
  echo "Chrome not found at $CHROME — set CHROME to a Chrome/Chromium binary." >&2
  exit 1
fi

for svg in *.svg; do
  name="${svg%.svg}"
  # The screenshot is the viewport, so the window has to match the SVG's own
  # intrinsic size or the result is cropped or padded.
  width=$(sed -n 's/.*<svg[^>]* width="\([0-9]*\)".*/\1/p' "$svg" | head -1)
  height=$(sed -n 's/.*<svg[^>]* height="\([0-9]*\)".*/\1/p' "$svg" | head -1)

  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 \
    --window-size="${width},${height}" \
    --screenshot="$out/${name}.png" \
    "file://$PWD/${svg}" >/dev/null 2>&1

  # JPEG keeps these well under the upload limit; they are photographic
  # gradients, which PNG stores badly.
  sips -s format jpeg -s formatOptions 88 "$out/${name}.png" --out "$out/${name}.jpg" >/dev/null
  rm "$out/${name}.png"
  printf '%-22s %sx%s  %s\n' "$name" "$width" "$height" "$(du -h "$out/${name}.jpg" | cut -f1)"
done
