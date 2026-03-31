const PROXY_PREFIX_BY_HOST = {
  "metadata.j7tracker.com": "/__md-j7",
  "metadata.j7tracker.io": "/__md-j7-io",
  "metadata.rapidlaunch.io": "/__md-rapidlaunch",
  "drilled.live": "/__md-drilled",
  "ipfs.launchblitz.ai": "/__md-launchblitz",
  "kimjongnuked.com": "/__md-kimjongnuked",
  "ipfs2.extraction.live": "/__md-extraction",
  "13.222.185.152:4141": "/__md-asset-ip",
};

export function proxyUrl(originalUrl) {
  if (!originalUrl || typeof originalUrl !== "string") return originalUrl;
  try {
    const parsed = new URL(originalUrl);
    const prefix = PROXY_PREFIX_BY_HOST[parsed.host] || PROXY_PREFIX_BY_HOST[parsed.hostname];
    if (!prefix) return originalUrl;
    return `${prefix}${parsed.pathname}${parsed.search}`;
  } catch {
    return originalUrl;
  }
}

