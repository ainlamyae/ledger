# Deployment

[Docs](../README.md) › Development

How to publish Ledger on GitHub Pages and keep the OAuth client and Content-Security-Policy in step.

## At a glance

- **Host:** GitHub Pages, straight from the `main` branch; no build or CI step.
- **OAuth:** the published origin must be an authorized JavaScript origin on the OAuth client.
- **Row addresses:** GitHub Pages serves `404.html` for paths with no file, which opens the right row.
- **CSP lives in the HTML:** Pages can't send headers, so every page carries the policy in a `<meta>`.

## Publish

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Set **Source** to **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. The site appears at `https://<user>.github.io/<repo>/`.
5. In Google Cloud, add `https://<user>.github.io` to the OAuth client's **Authorized JavaScript origins** and to the Picker API key's allowed referrers.

## Hosts

| Origin | Used for |
|---|---|
| `https://<user>.github.io` | Production |
| `http://localhost:8000` | Local development with `python scripts/serve.py 8000` |

## Keeping pages in step

- **New page or address:** copy a stub from the same depth, change only `<base href>` and `<title>`, then run `python scripts/build_sitemap.py`.
- **New script host or API:** add the host to the CSP `<meta>` on every page: `index.html`, every stub and `404.html`.
- **Edited `404.html` script:** recompute its `sha256-` hash in that page's CSP (see [Security](security.md)).
- **New library version:** update the URL and its integrity hash together (see [Security](security.md)).
- **Absolute URLs:** `sitemap.xml` and the root `index.html` canonical name the published site; update them if the repository moves.

## Related

- [Security](security.md): scopes, secrets, what leaves the browser, CSP, pinned libraries.
- [Getting started](getting-started.md): template sheet, Google Cloud, `config.js`, local server, API keys.
- [Architecture](architecture.md): system, section pages, boot order, modules, tech stack.
- [Site map](../reference/site-map.md): every address and its breadcrumb.
