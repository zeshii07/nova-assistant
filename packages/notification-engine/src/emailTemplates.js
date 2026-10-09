/**
 * v30.0 — Email Templates
 * HTML + plain-text templates for each business notification event.
 * All templates use inline CSS (email clients strip <style> tags).
 * Variables are replaced via simple {{var}} substitution.
 */

const BASE_STYLES = 'font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f4f6fa; color: #1f2937;';
const CARD_STYLES = 'background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,.06); margin-bottom: 16px;';
const HEADER_STYLES = 'background: #2d5bd1; color: #fff; padding: 20px 24px; border-radius: 12px; margin-bottom: 16px;';
const STATS_STYLES = 'background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin: 12px 0;';
const BUTTON_STYLES = 'display: inline-block; background: #2d5bd1; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 12px;';
const FOOTER_STYLES = 'text-align: center; color: #6b7280; font-size: 12px; padding: 16px 0;';

function wrap(content, tenantName) {
  return `<!doctype html><html><body style="${BASE_STYLES}">
    <div style="${HEADER_STYLES}">
      <div style="font-size: 18px; font-weight: 700;">${escapeHtml(tenantName || 'Nova')}</div>
      <div style="font-size: 12px; opacity: .85; margin-top: 4px;">Business Notification</div>
    </div>
    ${content}
    <div style="${FOOTER_STYLES}">
      Sent by Nova Assistant · <a href="https://nova-saas-test.onrender.com/admin" style="color: #2d5bd1;">Open Dashboard</a>
    </div>
  </body></html>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function line(s) { return `<div style="margin: 8px 0; line-height: 1.6;">${escapeHtml(s)}</div>`; }
function stat(label, value) {
  return `<div style="display: inline-block; margin-right: 16px;"><div style="font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .04em;">${escapeHtml(label)}</div><div style="font-size: 16px; font-weight: 600; margin-top: 2px;">${escapeHtml(String(value))}</div></div>`;
}

const templates = {
  booking_confirmed: {
    subject: (data) => `📅 New Booking Confirmed — ${data.customerName || 'Customer'} — ${data.serviceName || 'Service'}`,
    html: (data) => wrap(`
      <div style="${CARD_STYLES}">
        <div style="font-size: 22px; font-weight: 700; color: #059669; margin-bottom: 8px;">📅 New Booking Confirmed</div>
        ${line(`A booking has been confirmed via Nova for ${data.tenantName || 'your business'}.`)}
        <div style="${STATS_STYLES}">
          ${stat('Customer', data.customerName || '—')}
          ${stat('Service', data.serviceName || '—')}
          ${stat('Date', data.date || '—')}
          ${stat('Time', data.time || '—')}
          ${stat('Price', data.price ? `${data.currency || 'AED'} ${data.price}` : '—')}
          ${stat('Customer ID', data.customerId || '—')}
        </div>
        ${data.customerPhone ? line(`📞 Customer phone: ${data.customerPhone}`) : ''}
        ${data.customerEmail ? line(`✉️ Customer email: ${data.customerEmail}`) : ''}
        ${data.address ? line(`📍 Service address: ${data.address}`) : ''}
        ${data.notes ? `<div style="margin-top: 12px; padding: 12px; background: #fef3c7; border-radius: 8px;"><strong>Notes:</strong> ${escapeHtml(data.notes)}</div>` : ''}
      </div>
      <a href="https://nova-saas-test.onrender.com/admin" style="${BUTTON_STYLES}">View in Dashboard</a>
    `, data.tenantName),
    text: (data) => `New Booking Confirmed\n\nCustomer: ${data.customerName || '—'}\nService: ${data.serviceName || '—'}\nDate: ${data.date || '—'}\nTime: ${data.time || '—'}\nPrice: ${data.price ? `${data.currency || 'AED'} ${data.price}` : '—'}\nCustomer ID: ${data.customerId || '—'}\n${data.customerPhone ? `Phone: ${data.customerPhone}\n` : ''}${data.address ? `Address: ${data.address}\n` : ''}\nView in dashboard: https://nova-saas-test.onrender.com/admin`
  },

  order_placed: {
    subject: (data) => `🛒 New Order Placed — ${data.customerName || 'Customer'} — ${data.itemName || 'Item'}`,
    html: (data) => wrap(`
      <div style="${CARD_STYLES}">
        <div style="font-size: 22px; font-weight: 700; color: #2d5bd1; margin-bottom: 8px;">🛒 New Order Placed</div>
        ${line(`A new order was placed via Nova for ${data.tenantName || 'your business'}.`)}
        <div style="${STATS_STYLES}">
          ${stat('Customer', data.customerName || '—')}
          ${stat('Item', data.itemName || '—')}
          ${stat('Quantity', data.quantity || 1)}
          ${stat('Total', data.total ? `${data.currency || 'PKR'} ${data.total}` : '—')}
          ${stat('Order ID', data.orderId || '—')}
          ${stat('Customer ID', data.customerId || '—')}
        </div>
        ${data.customerPhone ? line(`📞 Customer phone: ${data.customerPhone}`) : ''}
        ${data.deliveryAddress ? line(`📍 Delivery address: ${data.deliveryAddress}`) : ''}
      </div>
      <a href="https://nova-saas-test.onrender.com/admin" style="${BUTTON_STYLES}">View in Dashboard</a>
    `, data.tenantName),
    text: (data) => `New Order Placed\n\nCustomer: ${data.customerName || '—'}\nItem: ${data.itemName || '—'}\nQuantity: ${data.quantity || 1}\nTotal: ${data.total ? `${data.currency || 'PKR'} ${data.total}` : '—'}\nOrder ID: ${data.orderId || '—'}\n${data.customerPhone ? `Phone: ${data.customerPhone}\n` : ''}${data.deliveryAddress ? `Address: ${data.deliveryAddress}\n` : ''}\nView in dashboard: https://nova-saas-test.onrender.com/admin`
  },

  lead_captured: {
    subject: (data) => `🎯 New Lead Captured — ${data.customerName || 'Anonymous'} — Score: ${data.score || 0}`,
    html: (data) => wrap(`
      <div style="${CARD_STYLES}">
        <div style="font-size: 22px; font-weight: 700; color: #f59e0b; margin-bottom: 8px;">🎯 New Lead Captured</div>
        ${line(`Nova captured a new lead for ${data.tenantName || 'your business'}.`)}
        <div style="${STATS_STYLES}">
          ${stat('Customer', data.customerName || 'Anonymous')}
          ${stat('Lead Score', data.score || 0)}
          ${stat('Grade', data.grade || '—')}
          ${stat('Lead ID', data.leadId || '—')}
          ${stat('Source Channel', data.channel || 'widget')}
        </div>
        ${data.interests ? `<div style="margin-top: 12px;"><strong>Interested in:</strong> ${escapeHtml(data.interests)}</div>` : ''}
        ${data.customerPhone ? line(`📞 Phone: ${data.customerPhone}`) : ''}
        ${data.customerEmail ? line(`✉️ Email: ${data.customerEmail}`) : ''}
        ${data.message ? `<div style="margin-top: 12px; padding: 12px; background: #f9fafb; border-radius: 8px;"><strong>First message:</strong> "${escapeHtml(data.message)}"</div>` : ''}
      </div>
      <a href="https://nova-saas-test.onrender.com/admin" style="${BUTTON_STYLES}">View in Dashboard</a>
    `, data.tenantName),
    text: (data) => `New Lead Captured\n\nCustomer: ${data.customerName || 'Anonymous'}\nLead Score: ${data.score || 0}\nGrade: ${data.grade || '—'}\nLead ID: ${data.leadId || '—'}\nChannel: ${data.channel || 'widget'}\n${data.interests ? `Interested in: ${data.interests}\n` : ''}${data.customerPhone ? `Phone: ${data.customerPhone}\n` : ''}${data.message ? `First message: "${data.message}"\n` : ''}\nView in dashboard: https://nova-saas-test.onrender.com/admin`
  },

  handoff_requested: {
    subject: (data) => `🤝 Customer Requesting Human Assistance — ${data.customerId || 'Customer'}`,
    html: (data) => wrap(`
      <div style="${CARD_STYLES}">
        <div style="font-size: 22px; font-weight: 700; color: #ef4444; margin-bottom: 8px;">🤝 Human Handoff Requested</div>
        ${line(`A customer is waiting for human assistance via Nova.`)}
        <div style="${STATS_STYLES}">
          ${stat('Customer ID', data.customerId || '—')}
          ${stat('Conversation ID', data.conversationId || '—')}
          ${stat('Reason', data.reason || 'customer_requested')}
          ${stat('Tenant', data.tenantId || '—')}
        </div>
        ${data.context ? `<div style="margin-top: 12px; padding: 12px; background: #fef3c7; border-radius: 8px;"><strong>Context:</strong> ${escapeHtml(typeof data.context === 'string' ? data.context : JSON.stringify(data.context))}</div>` : ''}
        <div style="margin-top: 16px; padding: 12px; background: #fee2e2; border-radius: 8px; border-left: 4px solid #ef4444;">
          <strong>⚠️ Action needed:</strong> Reply to this customer from the dashboard inbox.
        </div>
      </div>
      <a href="https://nova-saas-test.onrender.com/admin" style="${BUTTON_STYLES}">Open Dashboard Inbox</a>
    `, data.tenantName),
    text: (data) => `Human Handoff Requested\n\nCustomer ID: ${data.customerId || '—'}\nConversation ID: ${data.conversationId || '—'}\nReason: ${data.reason || 'customer_requested'}\nTenant: ${data.tenantId || '—'}\n${data.context ? `Context: ${typeof data.context === 'string' ? data.context : JSON.stringify(data.context)}\n` : ''}\nAction needed: Reply to this customer from the dashboard.\nOpen: https://nova-saas-test.onrender.com/admin`
  },

  nova_failed: {
    subject: (data) => `⚠️ Nova Couldn't Help — ${data.customerId || 'Customer'} — Review Needed`,
    html: (data) => wrap(`
      <div style="${CARD_STYLES}">
        <div style="font-size: 22px; font-weight: 700; color: #f59e0b; margin-bottom: 8px;">⚠️ Conversation Flagged for Review</div>
        ${line(`Nova couldn't resolve a customer's request and flagged it for follow-up.`)}
        <div style="${STATS_STYLES}">
          ${stat('Customer ID', data.customerId || '—')}
          ${stat('Tenant', data.tenantId || '—')}
          ${stat('Last Message', (data.message || '').slice(0, 80) + (data.message && data.message.length > 80 ? '…' : '') || '—')}
        </div>
        <div style="margin-top: 12px; padding: 12px; background: #fef3c7; border-radius: 8px;">
          <strong>Suggested action:</strong> Review the conversation in the dashboard and follow up directly.
        </div>
      </div>
      <a href="https://nova-saas-test.onrender.com/admin" style="${BUTTON_STYLES}">Review Conversation</a>
    `, data.tenantName),
    text: (data) => `Conversation Flagged for Review\n\nCustomer ID: ${data.customerId || '—'}\nTenant: ${data.tenantId || '—'}\nLast message: ${(data.message || '').slice(0, 100)}\n\nSuggested action: Review the conversation in the dashboard.\nOpen: https://nova-saas-test.onrender.com/admin`
  }
};

function getTemplate(eventType) {
  return templates[eventType] || null;
}

function listEventTypes() {
  return Object.keys(templates);
}

module.exports = { getTemplate, listEventTypes };
