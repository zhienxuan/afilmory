import { readFileSync } from 'node:fs'

import type { Plugin } from 'vite'

import { MANIFEST_PATH } from './__internal__/constants'

/**
 * 给图片存储域名做 preconnect。
 *
 * 图片域名不是固定值：它来自 S3_CUSTOM_DOMAIN，且后端部署时还会在运行时
 * 换掉整份 manifest。所以这里两条腿走路：
 *   1. 构建期：从 env + 当前 manifest 里推出静态 <link>，让 HTML 首字节就带上；
 *   2. 运行时：插一段内联脚本，按 window.__MANIFEST__ 里真实出现的图片域名补 link，
 *      覆盖「manifest 由服务端注入」的情况。
 */
const PRECONNECT_ATTR = 'data-preconnect'
const PRECONNECT_MARKER = `${PRECONNECT_ATTR}="photos"`

function toOrigin(value: string | undefined | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`).origin
  } catch {
    return null
  }
}

function collectBuildTimeOrigins(): string[] {
  const origins = new Set<string>()

  for (const candidate of [process.env.S3_CUSTOM_DOMAIN, process.env.ASSET_CUSTOM_DOMAIN]) {
    const origin = toOrigin(candidate)
    if (origin) origins.add(origin)
  }

  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
      data?: Array<{ thumbnailUrl?: string; originalUrl?: string }>
    }
    for (const item of manifest.data ?? []) {
      for (const url of [item.thumbnailUrl, item.originalUrl]) {
        if (!url || !/^https?:\/\//.test(url)) continue
        const origin = toOrigin(url)
        if (origin) origins.add(origin)
      }
    }
  } catch {
    // manifest 缺失是常态（CI 里只有 stub），忽略即可
  }

  return [...origins]
}

function buildTags(origins: string[]): string {
  return origins
    .map(
      (origin) =>
        `<link rel="preconnect" href="${origin}" crossorigin ${PRECONNECT_MARKER} />` +
        `<link rel="dns-prefetch" href="${origin}" />`,
    )
    .join('')
}

const RUNTIME_SCRIPT = `<script ${PRECONNECT_MARKER}>
(function () {
  var manifest = window.__MANIFEST__;
  if (!manifest || !manifest.data) return;
  var seen = {};
  var links = document.querySelectorAll('link[${PRECONNECT_MARKER}]');
  for (var i = 0; i < links.length; i++) seen[links[i].getAttribute('href')] = true;
  var added = 0;
  for (var j = 0; j < manifest.data.length && added < 2; j++) {
    var item = manifest.data[j];
    var raw = item.thumbnailUrl || item.originalUrl;
    if (!raw || raw.charAt(0) === '/') continue;
    var origin;
    try { origin = new URL(raw, location.href).origin; } catch (e) { continue; }
    if (origin === location.origin || seen[origin]) continue;
    seen[origin] = true;
    added++;
    var link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = origin;
    link.crossOrigin = '';
    link.setAttribute('${PRECONNECT_ATTR}', 'photos');
    document.head.appendChild(link);
  }
})();
</script>`

export function preconnectPlugin(): Plugin {
  return {
    name: 'afilmory-preconnect',
    transformIndexHtml(html) {
      const tags = buildTags(collectBuildTimeOrigins())
      // preconnect 越早越好，紧跟在 charset/viewport 之后插
      const anchor = '<meta name="viewport"'
      const insertAt = html.indexOf(anchor)
      if (insertAt === -1) {
        return html.replace('</head>', `${tags}${RUNTIME_SCRIPT}</head>`)
      }
      const anchorEnd = html.indexOf('>', insertAt) + 1
      return html.slice(0, anchorEnd) + tags + html.slice(anchorEnd).replace('</head>', `${RUNTIME_SCRIPT}</head>`)
    },
  }
}
