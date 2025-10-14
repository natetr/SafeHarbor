import db, { safeDbGet } from '../database/init.js';

/**
 * Captive Portal Middleware
 *
 * Detects captive portal detection requests from various operating systems
 * and redirects users to the configured landing page when in hotspot mode.
 *
 * Common captive portal detection endpoints:
 * - iOS/macOS: /hotspot-detect.html, /library/test/success.html
 * - Android: /generate_204
 * - Windows: /connecttest.txt, /ncsi.txt
 * - Firefox: /success.txt
 */

// Known captive portal detection paths
const CAPTIVE_PORTAL_PATHS = [
  '/hotspot-detect.html',
  '/library/test/success.html',
  '/generate_204',
  '/gen_204',
  '/connecttest.txt',
  '/ncsi.txt',
  '/success.txt',
  '/redirect'
];

// User agents commonly used for captive portal detection
const CAPTIVE_PORTAL_USER_AGENTS = [
  'CaptiveNetworkSupport',
  'wispr',
  'ConnectivityCheck'
];

export default async function captivePortalMiddleware(req, res, next) {
  try {
    // Check if this is a captive portal detection request
    const isCaptivePortalPath = CAPTIVE_PORTAL_PATHS.some(path => req.path === path);
    const isCaptivePortalUserAgent = CAPTIVE_PORTAL_USER_AGENTS.some(
      agent => req.headers['user-agent']?.includes(agent)
    );

    if (!isCaptivePortalPath && !isCaptivePortalUserAgent) {
      // Not a captive portal request, continue normally
      return next();
    }

    // Get network configuration
    const config = await safeDbGet(
      'SELECT mode, landing_url FROM network_config ORDER BY id DESC LIMIT 1',
      []
    );

    // Only redirect if in hotspot mode
    if (!config || config.mode !== 'hotspot') {
      return next();
    }

    const landingUrl = config.landing_url || '/';
    const host = req.headers.host || 'localhost:3000';
    const protocol = req.secure ? 'https' : 'http';
    const redirectUrl = `${protocol}://${host}${landingUrl}`;

    console.log(`🔗 Captive portal detected: ${req.path} -> ${redirectUrl}`);

    // For generate_204 endpoints, return 302 redirect instead of 204
    if (req.path.includes('204')) {
      return res.redirect(302, redirectUrl);
    }

    // For other endpoints, return an HTML page with meta redirect
    // This ensures maximum compatibility across different devices
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="refresh" content="0;url=${landingUrl}">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to SafeHarbor</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
          }
          .container {
            max-width: 500px;
            background: rgba(255, 255, 255, 0.1);
            padding: 2rem;
            border-radius: 20px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
          }
          h1 {
            margin: 0 0 1rem 0;
            font-size: 2rem;
          }
          p {
            margin: 0 0 1.5rem 0;
            opacity: 0.9;
          }
          a {
            display: inline-block;
            padding: 12px 30px;
            background: white;
            color: #667eea;
            text-decoration: none;
            border-radius: 25px;
            font-weight: 600;
            transition: transform 0.2s;
          }
          a:hover {
            transform: scale(1.05);
          }
          .spinner {
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top: 3px solid white;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 1rem auto;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Welcome to SafeHarbor</h1>
          <div class="spinner"></div>
          <p>Redirecting you to the portal...</p>
          <p><a href="${landingUrl}">Click here if you are not redirected automatically</a></p>
        </div>
        <script>
          // Fallback JavaScript redirect
          setTimeout(() => {
            window.location.href = '${landingUrl}';
          }, 100);
        </script>
      </body>
      </html>
    `);

  } catch (err) {
    console.error('Captive portal middleware error:', err);
    return next();
  }
}
