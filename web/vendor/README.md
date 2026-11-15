# Vendor (local, offline-first)

Pinned copies served by Feature Hub at `/vendor/...`.

| File | Package | Version |
|------|---------|---------|
| `marked.min.js` | marked | 15.0.7 |
| `purify.min.js` | dompurify | 3.2.4 |
| `highlight.min.js` | highlight.js | 11.11.1 |
| `highlight-github.min.css` | highlight.js theme | 11.11.1 |
| `github-markdown-light.min.css` | compact local stylesheet | — |
| `mermaid.min.js` | mermaid | 11.16.1 (lazy-loaded) |

Refresh from CDN when network allows:

```bash
./scripts/fetch-vendor.sh
```
