#!/usr/bin/env bash
# Re-download vendor assets into web/vendor (requires network).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/web/vendor"
mkdir -p "$OUT"

fetch() {
  local url="$1" dest="$2"
  echo "→ $dest"
  curl -fsSL --connect-timeout 30 -o "$dest" "$url"
}

fetch "https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js" "$OUT/marked.min.js"
fetch "https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js" "$OUT/purify.min.js"
fetch "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/highlight.min.js" "$OUT/highlight.min.js"
fetch "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/styles/github.min.css" "$OUT/highlight-github.min.css"
fetch "https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown-light.min.css" "$OUT/github-markdown-light.min.css"
fetch "https://cdn.jsdelivr.net/npm/mermaid@11.6.0/dist/mermaid.min.js" "$OUT/mermaid.min.js"

ls -lh "$OUT"
echo "Done."
