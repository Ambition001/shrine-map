/**
 * tokenValidation.js
 *
 * Runtime startup check for required REACT_APP_* environment variables.
 * In development, also warns when the Mapbox public token appears unrestricted.
 */

const REQUIRED_VARS = [
  'REACT_APP_MAPBOX_TOKEN',
  'REACT_APP_FIREBASE_API_KEY',
  'REACT_APP_FIREBASE_AUTH_DOMAIN',
  'REACT_APP_FIREBASE_PROJECT_ID',
  'REACT_APP_FIREBASE_STORAGE_BUCKET',
  'REACT_APP_FIREBASE_MESSAGING_SENDER_ID',
  'REACT_APP_FIREBASE_APP_ID',
];

/**
 * Validate that all required REACT_APP_* env vars are present and non-empty.
 * In development, warn loudly when the Mapbox token starts with "pk." as a
 * reminder that domain restrictions must be configured in the Mapbox console.
 *
 * @returns {{ valid: boolean, missing: string[], warnings: string[] }}
 */
export function validateEnvConfig() {
  const missing = REQUIRED_VARS.filter(
    (key) => !process.env[key] || process.env[key].trim() === ''
  );

  const warnings = [];

  if (process.env.NODE_ENV === 'development') {
    const mapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;
    if (mapboxToken && mapboxToken.startsWith('pk.')) {
      const message =
        '[shrine-map] REACT_APP_MAPBOX_TOKEN starts with "pk." (public token). ' +
        'Ensure domain restrictions are configured in the Mapbox console to ' +
        'prevent unauthorized usage of your quota.';
      warnings.push(message);
      console.warn(message);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}
