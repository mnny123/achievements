#!/bin/sh
# Assembles the two single-file builds from shared sources:
#   index.html                   - GitHub Pages + Firebase backend (full HTML document)
#   achievement-leaderboard.html - Claude artifact fragment (window.storage backend)
set -e
cd "$(dirname "$0")"

libs() {
  echo '<script>'; cat vendor/react.min.js; echo '</script>'
  echo '<script>'; cat vendor/react-dom.min.js; echo '</script>'
  echo '<script>'; cat vendor/htm.min.js; echo '</script>'
  echo '<script>'; cat app.js; echo '</script>'
}

{
  printf '%s\n' '<!doctype html>' '<html lang="en">' '<head>' \
    '<meta charset="utf-8">' \
    '<meta name="viewport" content="width=device-width, initial-scale=1">' \
    '<meta name="color-scheme" content="light dark">'
  grep -v '<div id="root">' page-top.html
  printf '%s\n' '</head>' '<body>' '<div id="root"></div>'
  cat fb-config.html
  libs
  printf '%s\n' '</body>' '</html>'
} > ../index.html

{ cat page-top.html; libs; } > ../achievement-leaderboard.html
echo "built: index.html ($(wc -c < ../index.html) bytes), achievement-leaderboard.html ($(wc -c < ../achievement-leaderboard.html) bytes)"
