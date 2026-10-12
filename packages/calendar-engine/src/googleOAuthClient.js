/**
 * v31.0 — Google OAuth 2.0 client for Google Calendar Integration.
 *
 * Flow:
 *   1. Business owner clicks "Connect Google Calendar" in dashboard
 *   2. Nova generates an authorization URL and redirects owner to Google
 *   3. Owner grants Nova permission to read/write their primary calendar
 *   4. Google redirects back to /api/admin/calendar/callback with a code
 *   5. Nova exchanges the code for access + refresh tokens
 *   6. Nova stores the tokens (encrypted at rest via FileCalendarTokenRepository)
 *   7. On every calendar API call, Nova uses the refresh token to get a fresh
 *      access token (access tokens expire after 1 hour)
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID       — from Google Cloud Console > Credentials
 *   GOOGLE_CLIENT_SECRET   — from Google Cloud Console > Credentials
 *   GOOGLE_REDIRECT_URI    — https://your-nova.com/api/admin/calendar/callback
 *
 * Scopes:
 *   calendar.events  — read/write events on owner's calendar
 *   (we do NOT request calendar.readonly or contact info — minimal scope)
 */
const { google } = require('googleapis');
const crypto = require('crypto');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events'
];

class GoogleOAuthClient {
  constructor({ clientId = null, clientSecret = null, redirectUri = null, logger = null } = {}) {
    this.clientId = clientId || process.env.GOOGLE_CLIENT_ID || null;
    this.clientSecret = clientSecret || process.env.GOOGLE_CLIENT_SECRET || null;
    this.redirectUri = redirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/admin/calendar/callback';
    this.logger = logger;
    this.configured = Boolean(this.clientId && this.clientSecret);
    if (this.configured) {
      this.logger?.info?.('google_oauth.configured', { redirectUri: this.redirectUri });
    } else {
      this.logger?.warn?.('google_oauth.not_configured', { hint: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars' });
    }
  }

  isConfigured() { return this.configured; }

  getAuthUrl(state = '') {
    if (!this.configured) throw new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.');
    const oauth2 = new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
    // state is used to remember which tenant initiated the OAuth flow
    // so we can store the tokens under the correct tenant after callback
    const safeState = state ? crypto.createHash('sha256').update(state).digest('hex').slice(0, 16) + ':' + state : '';
    return oauth2.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // force consent so we always get a refresh_token
      state: safeState
    });
  }

  async exchangeCode(code) {
    if (!this.configured) throw new Error('Google OAuth is not configured.');
    const oauth2 = new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
    const { tokens } = await oauth2.getToken(code);
    return tokens; // { access_token, refresh_token, expiry_date, scope, token_type }
  }

  /**
   * Creates an authenticated OAuth2 client for a tenant using their stored
   * refresh token. Automatically refreshes the access token if expired.
   */
  createClientForTokens(tokens) {
    if (!this.configured) throw new Error('Google OAuth is not configured.');
    const oauth2 = new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
    oauth2.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiresAt ? new Date(tokens.expiresAt).getTime() : null
    });
    // OAuth2 client automatically refreshes when access_token is expired
    // and a refresh_token is set
    return oauth2;
  }

  /**
   * Tests whether the stored tokens are still valid by making a simple
   * API call. If the refresh token is invalid, the owner must re-authorize.
   */
  async verifyTokens(tokens) {
    try {
      const oauth2 = this.createClientForTokens(tokens);
      const calendar = google.calendar({ version: 'v3', auth: oauth2 });
      await calendar.calendarList.list({ maxResults: 1 });
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  getStatus() {
    return {
      configured: this.configured,
      clientId: this.clientId ? this.clientId.slice(0, 8) + '...' : null,
      redirectUri: this.redirectUri
    };
  }
}

module.exports = { GoogleOAuthClient, SCOPES };
