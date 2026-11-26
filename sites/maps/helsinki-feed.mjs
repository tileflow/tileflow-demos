// HSL's binary feeds do not send browser CORS headers. Only these two public feeds are relayed.
export const hslFeeds = {
  positions: 'https://realtime.hsl.fi/realtime/vehicle-positions/v2/hsl',
  arrivals: 'https://realtime.hsl.fi/realtime/trip-updates/v2/hsl',
};

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/helsinki-live/api/')) return env.ASSETS.fetch(request);
    const name = path.slice('/helsinki-live/api/'.length);
    if (!Object.hasOwn(hslFeeds, name)) return new Response(null, {status: 404});
    if (request.method !== 'GET') return new Response(null, {status: 405, headers: {Allow: 'GET'}});
    const ttl = name === 'positions' ? 2 : 10;
    try {
      const response = await fetch(hslFeeds[name], {
        cf: {cacheEverything: true, cacheTtl: ttl},
        signal: AbortSignal.timeout(9000),
      });
      if (response.ok)
        return new Response(response.body, {
          headers: {
            'Content-Type': 'application/x-protobuf',
            'Cache-Control': 'public, max-age=' + ttl,
          },
        });
    } catch {
      /* The client keeps the last timestamp and retries. */
    }
    return new Response(null, {status: 503, headers: {'Cache-Control': 'no-store'}});
  },
};
