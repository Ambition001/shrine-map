/**
 * SuperTokens Auth Endpoints for Azure Functions
 * Handles all /api/auth/* routes
 */
const supertokens = require('supertokens-node');
const { middleware } = require('supertokens-node/framework/custom');
const { initSuperTokens } = require('../supertokens');

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.APP_WEBSITE_DOMAIN || 'https://ichinomiyamap.com',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, st-auth-mode, anti-csrf, rid, fdi-version, authorization',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Expose-Headers': 'front-token, id-refresh-token, anti-csrf, st-access-token, st-refresh-token',
  'Access-Control-Max-Age': '86400'
};

module.exports = async function (context, req) {
  context.log('Auth request:', req.method, req.url);

  try {
    // Initialize SuperTokens
    initSuperTokens();
    context.log('SuperTokens initialized');
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
    // Create request/response wrappers for SuperTokens middleware
    const request = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      getHeader: (name) => req.headers[name.toLowerCase()],
      getOriginalURL: () => req.url,
      getFormData: async () => req.body,
      getJSONBody: async () => req.body,
      getCookieValue: (key) => {
        const cookies = (req.headers['cookie'] || '').split(';').reduce((acc, cookie) => {
          const [name, value] = cookie.trim().split('=');
          if (name && value) acc[name] = value;
          return acc;
        }, {});
        return cookies[key];
      }
    };

    let responseBody = null;
    let responseStatus = 200;
    let responseHeaders = { ...corsHeaders };

    // Track headers set by SuperTokens to ensure they're exposed
    const superTokensHeaders = [];

    const response = {
      setHeader: (name, value) => {
        responseHeaders[name] = value;
        // Track headers that SuperTokens sets so we can expose them
        if (!superTokensHeaders.includes(name.toLowerCase())) {
          superTokensHeaders.push(name.toLowerCase());
        }
      },
      setCookie: (key, value, domain, secure, httpOnly, expires, path, sameSite) => {
        const cookieStr = `${key}=${value}; Path=${path}; ${secure ? 'Secure;' : ''} ${httpOnly ? 'HttpOnly;' : ''} SameSite=${sameSite}${expires ? `; Expires=${expires.toUTCString()}` : ''}`;
        if (!responseHeaders['Set-Cookie']) {
          responseHeaders['Set-Cookie'] = [];
        }
        if (Array.isArray(responseHeaders['Set-Cookie'])) {
          responseHeaders['Set-Cookie'].push(cookieStr);
        } else {
          responseHeaders['Set-Cookie'] = [responseHeaders['Set-Cookie'], cookieStr];
        }
      },
      setStatusCode: (code) => {
        responseStatus = code;
      },
      sendJSONResponse: (content) => {
        responseBody = content;
        responseHeaders['Content-Type'] = 'application/json';
      },
      sendHTMLResponse: (html) => {
        responseBody = html;
        responseHeaders['Content-Type'] = 'text/html';
      }
    };

    // Use SuperTokens middleware
    context.log('Calling SuperTokens middleware for:', req.url);
    const middlewareResult = await middleware()(request, response);
    context.log('Middleware result:', middlewareResult, 'Status:', responseStatus, 'Body:', JSON.stringify(responseBody), 'SuperTokens headers:', superTokensHeaders);

    if (middlewareResult) {
      // Dynamically update Access-Control-Expose-Headers to include all headers set by SuperTokens
      if (superTokensHeaders.length > 0) {
        const existingExpose = responseHeaders['Access-Control-Expose-Headers'] || '';
        const existingHeaders = existingExpose.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
        const allHeaders = [...new Set([...existingHeaders, ...superTokensHeaders])];
        responseHeaders['Access-Control-Expose-Headers'] = allHeaders.join(', ');
      }

      context.log('Final response - Status:', responseStatus, 'Headers:', JSON.stringify(responseHeaders));

      context.res = {
        status: responseStatus,
        headers: responseHeaders,
        body: responseBody
      };
    } else {
      // Route not handled by SuperTokens
      context.res = {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: { error: 'Not found' }
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
