/**
 * Minimal CORS proxy for he.chabad.org/dailystudy so dailystudy.html can
 * fetch an arbitrary date's page directly from the browser.
 *
 * Deploy: Cloudflare dashboard -> Workers & Pages -> Create -> paste this
 * file's contents -> Deploy. Then copy the *.workers.dev URL it gives you.
 *
 * Usage: GET <worker-url>/?tdate=7/10/2026  (tdate is optional, defaults to today)
 */
export default {
    async fetch(request) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders() });
        }

        const tdate = url.searchParams.get('tdate');
        const target = new URL('https://he.chabad.org/dailystudy/default.asp');
        if (tdate) target.searchParams.set('tdate', tdate);

        let upstream;
        try {
            upstream = await fetch(target.toString(), {
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                },
            });
        } catch (err) {
            return new Response(`Upstream fetch failed: ${err}`, { status: 502, headers: corsHeaders() });
        }

        const html = await upstream.text();
        return new Response(html, {
            status: upstream.status,
            headers: {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'public, max-age=1800',
                ...corsHeaders(),
            },
        });
    },
};

function corsHeaders() {
    return {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
    };
}
