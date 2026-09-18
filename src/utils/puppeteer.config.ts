/**
 * Puppeteer configuration options to ensure compatibility in both development and production environments
 * 
 * In production (such as on Render), this will use the system-installed Chromium
 * In development, it will use the version bundled with Puppeteer
 */
export const getPuppeteerConfig = (): Record<string, any> => {
    // Base configuration
    const config: Record<string, any> = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
        ],
    };

    // Honor an explicit PUPPETEER_EXECUTABLE_PATH whenever it's set, regardless
    // of NODE_ENV. This matters on Windows in particular: pm2 there can run the
    // process as a service account (e.g. NT AUTHORITY\SYSTEM) whose Puppeteer
    // cache dir (%SystemRoot%\system32\config\systemprofile\.cache\puppeteer)
    // is completely separate from whatever user account ran `npm install` and
    // downloaded the Chrome build during deploy -- so the auto-detected cache
    // path silently never has a browser in it. An explicit path sidesteps that
    // per-account cache resolution entirely.
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        config.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    return config;
};

export default getPuppeteerConfig; 