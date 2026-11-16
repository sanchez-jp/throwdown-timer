# GitHub Pages deployment

The `initial-scaffold` branch is deployed automatically to GitHub Pages by
`.github/workflows/deploy-pages.yml`.

The workflow configures the Pages site, uploads the repository's static files,
and publishes them. A successful deployment exposes the public URL in the
`github-pages` environment and in the workflow summary.

To deploy manually, run **Deploy Throwdown Timer to GitHub Pages** from the
repository's Actions tab using **Run workflow**.
