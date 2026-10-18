# Notices / 第三方声明

## Adapted code from DeepSeek Harness

Parts of `scripts/lib/` are adapted from the reference plugin market index generator of
DeepSeek Harness (`apps/plugin-market-generator`, tag `dsh-v0.2.1-rc.2`,
https://github.com/deepseek-ai/deepseek-harness). Adapted files carry a header naming their
upstream source:

| File | Upstream source |
|---|---|
| `scripts/lib/package-files.mjs` | `apps/plugin-market-generator/src/files.ts` |
| `scripts/lib/manifest.mjs` | `apps/plugin-market-generator/src/packages.ts` (`isBundle`, `dshRange`) and `packages/boot/app-boot/src/plugin-compatibility.ts` (`evaluatePluginCompatibility`) |
| `scripts/lib/display.mjs` | `apps/plugin-market-generator/src/metadata.ts` |
| `scripts/lib/npm.mjs` | `apps/plugin-market-generator/src/fetchers.ts` (npm part) |
| `scripts/lib/index-doc.mjs` | `apps/plugin-market-generator/src/generate.ts` (`entryOf`, npm release selection) |

That code is used under the following license:

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## npm dependencies

Installed at build time, not redistributed in `dist/`:
`@deepseek-ai/dsh-plugin-market-index` (MIT, DeepSeek), `semver` (ISC), `yaml` (ISC),
`resolve.exports` (MIT).

## Listed plugins

`dist/index.json` republishes each listed plugin's own name, title, description, author,
keywords, links, and icon as its package publishes them, under that package's license.
Curator-written titles and descriptions in `plugins.yml` are covered by this repository's
MIT license.
