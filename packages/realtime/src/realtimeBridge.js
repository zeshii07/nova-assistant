/**
 * v73.1 — Realtime bridge: EventBus → WebSocket clients.
 *
 * Why this exists:
 *   Before v73.1, the business dashboard had to be manually refreshed to see
 *   new messages, and the customer widget polled /api/chat/poll every few
 *   seconds during takeover. This module opens a single persistent WebSocket
 *   per client and pushes events as they happen — driven by the in-process
 *   EventBus that the execution engine already publishes to.
 *
 * Architecture:
 *   - One WebSocketServer attached to the SAME http.Server as the REST API
 *     (no extra port — Render only exposes one port, and `ws` can attach to an
 *     existing http.Server via { server }).
 *   - Clients authenticate on connect by sending an `auth` message with either
 *     a business-owner JWT (for the dashboard) or a customer session token
 *     (for the widget). Until auth completes, no events are pushed.
 *   - Each authenticated client is tagged with { role, tenantId, customerId? }.
 *   - A wildcard EventBus subscription receives EVERY event, then filters by
 *     tenant before pushing to subscribed clients. This keeps the broadcast
 *     loop O(clients) per event, not O(clients × events).
 *   - Events are namespaced: message.received.v1, message.processed.v1,
 *     handoff.requested.v1, owner.reply.v1, takeover.changed.v1,
 *     stats.refresh.v1. Clients switch on event.name.
 *
 * Scaling note:
 *   This is a single-process WS server. With cluster.js forking N workers,
 *   each worker has its own EventBus + WS server. A client connected to
 *   worker A won't see events that fire on worker B. For now this is fine
 *   because (a) NOVA_WORKERS=1 in the render.yaml default, and (b) HTTP
 *   sticky-session routing isn't available on Render free tier anyway.
 *   For true multi-worker fan-out, swap the in-process EventBus subscription
 *   for a Redis pub/sub subscriber (the REDIS_URL is already configured).
 */

const { WebSocketServer, WebSocket } = require('ws');

class RealtimeBridge {
  constructor({ server, eventBus, logger = null, businessOwnerAuthService = null }) {
    this.eventBus = eventBus;
    this.logger = logger;
    this.businessOwnerAuthService = businessOwnerAuthService;
    // Set of connected client sockets, each decorated with .novaMeta = { authed, role, tenantId, customerId? }
    this.clients = new Set();

    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => this._onConnection(ws, req));

    // Subscribe to ALL events via the wildcard. Filter per-tenant at broadcast time.
    if (this.eventBus) {
      this.eventBus.subscribe('*', (event) => this._onEvent(event));
    }

    this.logger?.info?.('realtime.bridge.started', { path: '/ws' });
  }

  _onConnection(ws, req) {
    ws.novaMeta = { authed: false, role: null, tenantId: null, customerId: null, subscriptions: new Set() };
    this.clients.add(ws);
    this.logger?.info?.('realtime.client.connected', { total: this.clients.size });

    // Heartbeat: client must respond to 'ping' frames. Dead connections are
    // pruned on the next heartbeat tick (every 30s).
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => this._onClientMessage(ws, raw));

    ws.on('close', () => {
      this.clients.delete(ws);
      this.logger?.info?.('realtime.client.disconnected', { total: this.clients.size });
    });

    ws.on('error', (err) => {
      this.logger?.error?.('realtime.client.error', { error: err.message });
    });
  }

  /**
   * Handle inbound messages from the client (auth + subscribe commands).
   * Protocol: client sends JSON { type: 'auth', token: '...' } first.
   *           Optionally { type: 'subscribe', events: ['message.received.v1', ...] }.
   */
  _onClientMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return this._send(ws, { type: 'error', error: 'Invalid JSON' }); }

    if (msg.type === 'auth') {
      this._authenticate(ws, msg).catch(err => {
        this._send(ws, { type: 'auth', ok: false, error: err.message });
      });
      return;
    }

    if (msg.type === 'subscribe' && ws.novaMeta.authed) {
      const events = Array.isArray(msg.events) ? msg.events : [];
      ws.novaMeta.subscriptions = new Set(events);
      this._send(ws, { type: 'subscribe', ok: true, events });
      return;
    }

    if (msg.type === 'ping') {
      this._send(ws, { type: 'pong', t: Date.now() });
      return;
    }
  }

  async _authenticate(ws, msg) {
    const { token, role } = msg;
    if (!token) throw new Error('token is required');

    // role=business: verify JWT, extract tenantId
    if (role === 'business' || !role) {
      if (!this.businessOwnerAuthService) throw new Error('business auth not configured');
      const owner = await this.businessOwnerAuthService.verifyToken(token).catch(() => null);
      if (!owner) throw new Error('invalid business token');
      ws.novaMeta = { ...ws.novaMeta, authed: true, role: 'business', tenantId: owner.tenantId, subscriptions: new Set() };
      this._send(ws, { type: 'auth', ok: true, role: 'business', tenantId: owner.tenantId });
      return;
    }

    // role=customer: token is the customerId (widget sessions are anonymous).
    // The customer only receives events for their own conversation, filtered
    // server-side by tenantId + customerId.
    if (role === 'customer') {
      const tenantId = msg.tenantId || 'default';
      const customerId = String(token);
      if (!customerId) throw new Error('customerId is required for customer auth');
      ws.novaMeta = { ...ws.novaMeta, authed: true, role: 'customer', tenantId, customerId, subscriptions: new Set() };
      this._send(ws, { type: 'auth', ok: true, role: 'customer', tenantId, customerId });
      return;
    }

    throw new Error(`unknown role: ${role}`);
  }

  /**
   * EventBus wildcard handler. Filters + broadcasts to interested clients.
   */
  _onEvent(event) {
    if (this.clients.size === 0) return;

    const { name, payload, metadata } = event;
    const tenantId = payload?.tenantId || metadata?.tenantId;
    const conversationId = payload?.conversationId || metadata?.conversationId;
    const customerId = payload?.customerId || payload?.message?.customerId;

    for (const ws of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (!ws.novaMeta?.authed) continue;

      const meta = ws.novaMeta;

      // Tenant isolation: business clients only see their own tenant's events.
      if (meta.tenantId && tenantId && meta.tenantId !== tenantId) continue;

      // Customer clients only see events for their OWN conversation.
      if (meta.role === 'customer') {
        if (customerId && meta.customerId !== customerId) continue;
        if (conversationId && !conversationId.endsWith(`:${meta.customerId}`)) continue;
      }

      // Optional client-side event filtering (subscriptions).
      if (meta.subscriptions.size > 0 && !meta.subscriptions.has(name) && !meta.subscriptions.has('*')) continue;

      this._send(ws, {
        type: 'event',
        name,
        payload,
        metadata,
        occurredAt: event.occurredAt
      });
    }
  }

  /**
   * Push a synthetic event to a single business tenant's clients (e.g. owner
   * reply delivered). Used when the EventBus doesn't naturally carry the event.
   */
  broadcastToTenant(tenantId, name, payload) {
    for (const ws of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (!ws.novaMeta?.authed) continue;
      if (ws.novaMeta.tenantId !== tenantId) continue;
      this._send(ws, { type: 'event', name, payload, occurredAt: new Date().toISOString() });
    }
  }

  /**
   * Push to a specific customer (used for owner-reply delivery over WS).
   */
  broadcastToCustomer(tenantId, customerId, name, payload) {
    for (const ws of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (!ws.novaMeta?.authed) continue;
      if (ws.novaMeta.role !== 'customer') continue;
      if (ws.novaMeta.tenantId !== tenantId) continue;
      if (ws.novaMeta.customerId !== customerId) continue;
      this._send(ws, { type: 'event', name, payload, occurredAt: new Date().toISOString() });
    }
  }

  _send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  /**
   * Heartbeat: every 30s, send a ping to every client. Clients that don't
   * respond with a pong (the ws lib auto-responds) are terminated.
   */
  startHeartbeat(intervalMs = 30000) {
    this._heartbeatTimer = setInterval(() => {
      for (const ws of this.clients) {
        if (ws.isAlive === false) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* socket already dead */ }
      }
    }, intervalMs);
    // Don't keep the process alive just for the heartbeat.
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
  }

  close() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    for (const ws of this.clients) {
      try { ws.close(1001, 'server shutting down'); } catch { /* */ }
    }
    this.wss.close();
  }

  get stats() {
    let authed = 0, business = 0, customer = 0;
    for (const ws of this.clients) {
      if (!ws.novaMeta?.authed) continue;
      authed++;
      if (ws.novaMeta.role === 'business') business++;
      else if (ws.novaMeta.role === 'customer') customer++;
    }
    return { connected: this.clients.size, authed, business, customer };
  }
}

module.exports = { RealtimeBridge };
