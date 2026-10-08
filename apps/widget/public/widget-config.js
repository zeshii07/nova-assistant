/* Nova Widget Config Helper — v28.0
 * Exposes NOVA_WIDGET_CONFIG constants for advanced embedders who want
 * to programmatically configure the widget before it auto-mounts.
 * Optional — most users just include /widget.js with data-tenant.
 *
 * Usage:
 *   <script src="/widget-config.js"></script>
 *   <script>
 *     window.NOVA_WIDGET_CONFIG.language = 'roman_urdu';
 *   </script>
 *   <script src="/widget.js" data-tenant="cleaning-demo" async></script>
 */
window.NOVA_WIDGET_CONFIG = window.NOVA_WIDGET_CONFIG || {
  language: 'auto',           // 'auto' | 'english' | 'roman_urdu'
  position: 'bottom-right',   // 'bottom-right' | 'bottom-left'
  themeColor: null,           // null = use tenant's configured color
  welcomeMessage: null,       // null = use tenant's configured welcome
  autoOpen: false,            // auto-open panel on first visit
  autoOpenDelayMs: 3000,      // delay before auto-opening
  enableSound: false,         // future: notification sound on new reply
  enableAnalytics: false,     // future: send widget events to analytics
  retryAttempts: 3,           // retries on network failure
  requestTimeoutMs: 15000     // per-request timeout
};
