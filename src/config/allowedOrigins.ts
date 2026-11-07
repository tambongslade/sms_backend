// Web addresses whose pages may call this API from the browser (CORS), for the HTTP API and the realtime socket.
//
// The list comes from ALLOWED_ORIGINS (comma separated). The school site is reached both as ssiccmr.com and
// www.ssiccmr.com, so both are always allowed: a login from the one missing in ALLOWED_ORIGINS was blocked by
// the browser ("No 'Access-Control-Allow-Origin' header").

const SITE_ORIGINS = ['https://ssiccmr.com', 'https://www.ssiccmr.com'];

const DEFAULT_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://sms.sniperbuisnesscenter.com',
];

/** Read when called, not at import: .env is loaded by dotenv.config() after the imports have run. */
export function getAllowedOrigins(): string[] {
    const fromEnv = (process.env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((o) => o.trim().replace(/\/+$/, ''))
        .filter(Boolean);
    return [...new Set([...(fromEnv.length ? fromEnv : DEFAULT_ORIGINS), ...SITE_ORIGINS])];
}
