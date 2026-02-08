/**
 * SuperTokens Auth Endpoints for Azure Functions
 * Handles all /api/auth/* routes
 */
const { middleware, PreParsedRequest, CollectingResponse } = require('supertokens-node/framework/custom');
const { initSuperTokens } = require('../supertokens');

// CORS headers - includes headers needed for header-based auth
const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.APP_WEBSITE_DOMAIN || 'https://ichinomiyamap.com',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, st-auth-mode, anti-csrf, rid, fdi-version, authorization, st-access-token, st-refresh-token',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Expose-Headers': 'front-token, id-refresh-token, anti-csrf, st-access-token, st-refresh-token, authorization',
  'Access-Control-Max-Age': '86400'
};

/**
 * Parse cookies from cookie header string
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const [name, ...rest] = cookie.trim().split('=');
      if (name && rest.length > 0) {
        cookies[name] = rest.join('=');
      }
    });
  }
  return cookies;
}

/**
 * Parse query string from URL
 */
function parseQuery(url) {
  const query = {};
  const queryStart = url.indexOf('?');
  if (queryStart !== -1) {
    const queryString = url.substring(queryStart + 1);
    queryString.split('&').forEach(param => {
      const [key, value] = param.split('=');
      if (key) {
        query[key] = decodeURIComponent(value || '');
      }
    });
  }
  return query;
}

/**
 * Create a Headers-like object that SuperTokens expects
 */
class HeadersWrapper {
  constructor(headers) {
    this._headers = {};
    // Normalize header keys to lowercase
    for (const [key, value] of Object.entries(headers || {})) {
      this._headers[key.toLowerCase()] = value;
    }
  }

  get(key) {
    return this._headers[key.toLowerCase()] || null;
  }
}

module.exports = async function (context, req) {
  context.log('Auth request:', req.method, req.url);

  try {
    // Initialize SuperTokens
    initSuperTokens();
  } catch (initError) {
    context.log.error('SuperTokens init error:', initError);
    context.res = {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Init error', message: initError.message })
    };
    return;
  }

  const { method } = req;

  // Handle preflight OPTIONS request
  if (method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: corsHeaders,
      body: ''
    };
    return;
  }

  try {
    // Get the full URL for SuperTokens
    // Azure Functions req.url might be just the path, we need the full URL
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['host'] || 'ichinomiyamap.com';
    const path = req.url.startsWith('http') ? new URL(req.url).pathname + (new URL(req.url).search || '') : req.url;
    const fullUrl = `${protocol}://${host}${path}`;

    context.log('Request URL:', req.url);
    context.log('Full URL:', fullUrl);
    context.log('Request body:', JSON.stringify(req.body));

    // Create request object matching SuperTokens PreParsedRequest expectations
    const requestInfo = {
      url: fullUrl,
      method: req.method,
      headers: new HeadersWrapper(req.headers),
      cookies: parseCookies(req.headers['cookie']),
      query: parseQuery(req.url),
      getJSONBody: async () => req.body || {},
      getFormBody: async () => req.body || {}
    };

    // Create a CollectingResponse to capture SuperTokens' response
    const stResponse = new CollectingResponse();

    // Use SuperTokens middleware with PreParsedRequest wrapper
    context.log('Calling SuperTokens middleware for:', req.url);
    const result = await middleware(
      (req) => new PreParsedRequest(req),
      (res) => res
    )(requestInfo, stResponse);

    context.log('Middleware result:', JSON.stringify(result));
    context.log('Response status:', stResponse.statusCode);
    context.log('Response body:', stResponse.body);

    if (result.handled) {
      // Build response headers from CollectingResponse
      const responseHeaders = { ...corsHeaders };

      // Copy headers from SuperTokens response
      const stHeaders = stResponse.headers;
      if (stHeaders && stHeaders.forEach) {
        stHeaders.forEach((value, key) => {
          responseHeaders[key] = value;
        });
      } else if (stHeaders && stHeaders.entries) {
        for (const [key, value] of stHeaders.entries()) {
          responseHeaders[key] = value;
        }
      }

      // Build Set-Cookie headers from cookies array
      // Azure Functions requires Set-Cookie to be an array for multiple cookies
      if (stResponse.cookies && stResponse.cookies.length > 0) {
        context.log('Cookies to set:', JSON.stringify(stResponse.cookies.map(c => ({
          key: c.key,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite,
          expires: c.expires,
          hasValue: !!c.value
        }))));

        const cookieStrings = stResponse.cookies.map(cookie => {
          let cookieStr = `${cookie.key}=${cookie.value}`;
          if (cookie.path) cookieStr += `; Path=${cookie.path}`;
          if (cookie.domain) cookieStr += `; Domain=${cookie.domain}`;
          if (cookie.secure) cookieStr += '; Secure';
          if (cookie.httpOnly) cookieStr += '; HttpOnly';
          if (cookie.sameSite) cookieStr += `; SameSite=${cookie.sameSite}`;
          // Handle expires - could be a number (timestamp) or Date object
          if (cookie.expires) {
            const expiresDate = typeof cookie.expires === 'number'
              ? new Date(cookie.expires)
              : cookie.expires;
            cookieStr += `; Expires=${expiresDate.toUTCString()}`;
          }
          return cookieStr;
        });

        // Azure Functions: Set-Cookie must be an array for multiple cookies
        responseHeaders['Set-Cookie'] = cookieStrings;
        context.log('Set-Cookie count:', cookieStrings.length);
      }

      context.log('Final response headers:', JSON.stringify(responseHeaders));

      context.res = {
        status: stResponse.statusCode,
        headers: responseHeaders,
        body: stResponse.body
      };
    } else {
      // Route not handled by SuperTokens
      context.res = {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Not found' })
      };
    }
  } catch (error) {
    context.log.error('Auth error:', error);
    context.res = {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error', message: error.message, stack: error.stack })
    };
  }
};
