# Install hume's MCP Pro integration

This branch contains the self-contained MCP Pro build installed on hume. No server-side Node installation or sibling checkout is needed to install the bundled plugin.

## Install on another machine

1. Clone https://github.com/brentkearney/obsidian-mcp-pro-plugin and select integration/hume-2026-10-01. Record the checked-out commit.
2. Locate the destination Obsidian vault; do not assume its path matches hume. Disable MCP Pro in Obsidian before replacing files.
3. Back up the existing `.obsidian/plugins/mcp-pro/` directory outside the vault. Do not publish the backup: data.json may contain credentials.
4. Copy only `main.js`, `manifest.json`, and `styles.css` from this branch into `.obsidian/plugins/mcp-pro/`. Create the directory if this is a new installation. Do not copy node_modules, the repository, or settings from hume into the vault.
5. Preserve the destination's `data.json` unchanged. Re-enable MCP Pro, check its configured port and authentication, and test a read of a known work-vault note through its MCP endpoint. Test a PDF attachment if available; it should return an MCP resource block, not an image block.
6. If verification fails, disable the plugin, restore the three backed-up distribution files, and re-enable it.

Obsidian application and other plugins are not updated by these steps. This installs a local server for the work vault; it does not change Bee's Umbrel endpoint or transfer its folder permissions.

## Provenance

- Plugin source base: d8c4f42, with the local bearer-token forwarding adjustment and sibling-library dependency.
- Core library source: https://github.com/rps321321/obsidian-mcp-pro/commit/7bac7028f39f9922a94762178701abb34b183ea0 (4.1.0).
- Bundled main.js SHA-256: be6cdaeb2e2701ceaf3dedca23ba6d65bd5798ad008e3d3e7d44e2a214933ffd.
- A fresh plugin build on hume matched the installed main.js byte-for-byte before publication.

## Source builds

The local-library dependency is intentional for this snapshot. For source builds, clone the core repository beside this repository as `obsidian-mcp-pro`, check out the exact core commit above, install its dependencies and run its build using Node 24. Then run `npm ci` and `npm run build` in this plugin repository. The committed plugin lockfile records the sibling link, not a standalone published core package. The bundled main.js and its hash are the authoritative parity artifact; freshly resolving core dependencies can yield different output.

Never commit vault contents, data.json, bearer tokens, API tokens, or personal environment files. The preserved core dependency versions previously reported js-yaml and body-parser advisories; matching hume is not a claim that this snapshot is free of known vulnerabilities.
