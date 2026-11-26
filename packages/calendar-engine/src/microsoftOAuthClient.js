// Phase 4 Sprint 3 — Microsoft Graph OAuth client.
//
// Mirrors the shape of GoogleOAuthClient so the calendar service can treat both
// providers identically: constructor reads env vars, isConfigured(), getAuthUrl
// (state carries the tenantId so the callback stores tokens under the right
// tenant), exchangeCode, createClientForTokens.
//
// Microsoft identity platform notes:
//   - Auth endpoint:  https://login.microsoftonline.com/common/oauth2/v2.0/authorize
//   - Token endpoint: https://login.microsoftonline.com/common/oauth2/v2.0/token
//   - "common" tenant lets any MSA / Azure AD account sign in. For single-tenant
//     apps, replace with the tenant GUID.
//   - Scopes: Calendars.ReadWrite lets Nova create/patch/delete events on the
//     user's default calendar. offline_access gives a refresh token; the SDK
//     refreshes automatically when the access token (1h) expires.
//   - We use the standard authorization-code flow with PKCE-less confidential
//     client (a server-side secret). A future hardening sprint can add PKCE.
const crypto = require("crypto");

const AUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SCOPES = ["Calendars.ReadWrite", "offline_access", "User.Read"].join(" ");

class MicrosoftOAuthClient {
  constructor({ clientId = null, clientSecret = null, tenantId = null, redirectUri = null, logger = null } = {}) {
    this.clientId = clientId || process.env.MICROSOFT_CLIENT_ID || null;
    this.clientSecret = clientSecret || process.env.MICROSOFT_CLIENT_SECRET || null;
    this.tenantId = tenantId || process.env.MICROSOFT_TENANT_ID || "common";
    this.redirectUri = redirectUri || process.env.MICROSOFT_REDIRECT_URI || "http://localhost:3000/api/admin/calendar/microsoft/callback";
    this.logger = logger;
    this.configured = Boolean(this.clientId && this.clientSecret);
    if (this.configured) {
      this.logger?.info?.("microsoft_oauth.configured", { redirectUri: this.redirectUri, tenant: this.tenantId });
    } else {
      this.logger?.warn?.("microsoft_oauth.not_configured", { hint: "Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET env vars" });
    }
  }

  isConfigured() { return this.configured; }

  /** Build the consent URL. `state` carries the tenantId so the callback knows who initiated. */
  getAuthUrl(state = "") {
    if (!this.configured) throw new Error("Microsoft OAuth is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET env vars.");
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      response_mode: "query",
      scope: SCOPES,
      prompt: "consent",
    });
    if (state) {
      const safeState = crypto.createHash("sha256").update(state).digest("hex").slice(0, 16) + ":" + state;
      params.set("state", safeState);
    }
    const endpoint = this.tenantId === "common" ? AUTH_BASE : `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0`;
    return `${endpoint}/authorize?${params.toString()}`;
  }

  /** Exchange an authorization code for access + refresh tokens. */
  async exchangeCode(code) {
    if (!this.configured) throw new Error("Microsoft OAuth is not configured.");
    const endpoint = this.tenantId === "common" ? `${AUTH_BASE}/token` : `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
      grant_type: "authorization_code",
      scope: SCOPES,
    });
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Microsoft token exchange failed (${res.status}): ${text}`);
    }
    const tokens = await res.json();
    // Normalize to the same shape GoogleOAuthClient returns + our token repo expects.
    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
      scope: tokens.scope,
      token_type: tokens.token_type,
    };
  }

  /**
   * Refresh an expired access token using the stored refresh token.
   * @returns {{ access_token, refresh_token, expiry_date }} refreshed tokens.
   */
  async refresh(refreshToken) {
    if (!this.configured) throw new Error("Microsoft OAuth is not configured.");
    const endpoint = this.tenantId === "common" ? `${AUTH_BASE}/token` : `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: SCOPES,
    });
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Microsoft token refresh failed (${res.status}): ${text}`);
    }
    const tokens = await res.json();
    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || refreshToken, // MS sometimes omits on refresh
      expiry_date: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
    };
  }

  /**
   * Returns an object with a `request(path, init)` method that auto-attaches
   * the bearer token and auto-refreshes when the access token is expired.
   * Mirrors the GoogleOAuthClient.createClientForTokens return contract.
   */
  createClientForTokens(tokens, { onRefresh = null } = {}) {
    if (!this.configured) throw new Error("Microsoft OAuth is not configured.");
    const self = this;
    let current = { ...tokens };
    let refreshInFlight = null; // memo: concurrent requests share one refresh
    async function ensureFresh() {
      const expiry = current.expiry_date || current.expiryDate;
      if (expiry && Date.now() < expiry - 60000) return; // not yet expired (1m buffer)
      // If a refresh is already running, wait for it instead of firing a second
      // one. Microsoft rotates refresh tokens, so two concurrent refreshes can
      // invalidate each other and force a reconnect.
      if (refreshInFlight) return refreshInFlight;
      if (!current.refresh_token && !current.refreshToken) throw new Error("Microsoft access token expired and no refresh token available. Reconnect Microsoft Calendar.");
      refreshInFlight = (async () => {
        try {
          const refreshed = await self.refresh(current.refresh_token || current.refreshToken);
          current = { ...current, ...refreshed };
          if (onRefresh) try { await onRefresh(current); } catch (e) { self.logger?.warn?.("microsoft_oauth.on_refresh_failed", { error: e.message }); }
        } finally {
          refreshInFlight = null;
        }
      })();
      return refreshInFlight;
    }
    return {
      async request(path, init = {}) {
        await ensureFresh();
        const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
        const headers = { ...(init.headers || {}), Authorization: `Bearer ${current.access_token || current.accessToken}`, "Content-Type": "application/json" };
        const res = await fetch(url, { ...init, headers });
        return res;
      },
      // Expose current tokens for the onRefresh callback / persistence.
      get tokens() { return current; },
    };
  }
}

module.exports = { MicrosoftOAuthClient, GRAPH_BASE, SCOPES };
