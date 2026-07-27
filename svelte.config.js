import adapter from '@sveltejs/adapter-cloudflare';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    kit: {
        adapter: adapter(),
        // src/params holds the route matchers plus the shared date helpers that
        // both the server and the client need. Routes are nested at varying
        // depths now, so an alias beats counting ../ segments.
        alias: {
            $params: 'src/params',
        },
    },
};

export default config;
