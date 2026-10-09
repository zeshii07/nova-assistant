/**
 * v30.1 — Extract templates from existing demo tenants.
 * Creates tenants/_templates/{cleaning,retail,salon,restaurant}/ with:
 *   - template.json (metadata + capabilities + wizard defaults)
 *   - All config files copied from the demo tenant (services, pricing, knowledge, etc.)
 *   - profile.json with placeholder branding ({{business_name}}, {{owner_email}}, etc.)
 *
 * Templates are "frozen" starting points. When a new tenant is created:
 *   1. Template files are cloned into tenants/{newTenantId}/
 *   2. Placeholders in profile.json are replaced with actual business details
 *   3. Services/prices can be overridden via the onboarding wizard
 *
 * Idempotent: skips templates that already exist.
 */
const fs = require('fs');
const path = require('path');

const TENANTS_DIR = path.resolve(__dirname, '../nova-assistant/tenants');
const TEMPLATES_DIR = path.join(TENANTS_DIR, '_templates');

const TEMPLATES = [
  {
    id: 'cleaning-template',
    label: 'Cleaning Business',
    description: 'Residential, commercial, deep, furniture, office, laundry cleaning services with booking',
    sourceTenant: 'cleaning-demo',
    capabilities: ['assistant', 'crm', 'cleaning', 'pricing', 'availability'],
    domain: 'cleaning',
    icon: '🧹',
    defaultServices: [
      { name: 'Standard Home Cleaning', priceType: 'hourly', price: 40, currency: 'AED', unit: 'per hour per cleaner' },
      { name: 'Deep Home Cleaning', priceType: 'fixed', price: 200, currency: 'AED', unit: 'per visit' },
      { name: 'Sofa Cleaning', priceType: 'fixed', price: 120, currency: 'AED', unit: 'per sofa' }
    ]
  },
  {
    id: 'retail-template',
    label: 'Retail Store',
    description: 'Product catalog, browsing, cart, checkout, order tracking',
    sourceTenant: 'default',
    capabilities: ['assistant', 'crm', 'catalog', 'commerce'],
    domain: 'retail',
    icon: '🛍️',
    defaultServices: []
  },
  {
    id: 'salon-template',
    label: 'Salon / Spa',
    description: 'Bookable services: haircuts, treatments, appointments with time slots',
    sourceTenant: 'salon-demo',
    capabilities: ['assistant', 'crm', 'offering', 'booking'],
    domain: 'salon',
    icon: '💇',
    defaultServices: [
      { name: 'Haircut & Style', priceType: 'fixed', price: 150, currency: 'AED', unit: 'per service' },
      { name: 'Hair Color', priceType: 'fixed', price: 300, currency: 'AED', unit: 'per service' },
      { name: 'Manicure', priceType: 'fixed', price: 80, currency: 'AED', unit: 'per service' }
    ]
  },
  {
    id: 'restaurant-template',
    label: 'Restaurant',
    description: 'Menu browsing, table reservations, takeout orders',
    sourceTenant: 'restaurant-demo',
    capabilities: ['assistant', 'crm', 'offering', 'booking'],
    domain: 'restaurant',
    icon: '🍽️',
    defaultServices: []
  }
];

function copyDirRecursive(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(srcPath, dstPath);
    else fs.copyFileSync(srcPath, dstPath);
  }
}

function makePlaceholderProfile(template) {
  return {
    id: '{{tenant_id}}',
    name: '{{business_name}}',
    status: 'active',
    defaultLanguage: 'english',
    capabilities: template.capabilities,
    domain: template.domain,
    branding: {
      assistantName: '{{business_name}} Assistant',
      welcomeMessage: 'Hi! 👋 Welcome to {{business_name}}. How can I help you today?',
      welcomeMessageRomanUrdu: 'Assalam-o-alaikum! 👋 {{business_name}} mein khush aamdeed. Main aap ki kaise madad kar sakta hoon?'
    },
    business: {
      description: '{{business_description}}',
      contact: '{{owner_phone}}',
      email: '{{owner_email}}',
      hours: '{{business_hours}}',
      location: '{{business_location}}'
    },
    features: { llmFallback: true },
    permissions: [
      'knowledge.read', 'memory.read:assistant', 'memory.write:assistant',
      'crm.customer.read:assistant', 'crm.customer.write:assistant',
      'crm.activity.write:assistant'
    ],
    widget: {
      enabled: true,
      position: 'bottom-right',
      themeColor: '{{theme_color}}',
      language: 'auto',
      welcomeMessage: 'Hi! 👋 Welcome to {{business_name}}. How can I help you today?',
      agentAvatar: 'marcus',
      agentName: '{{agent_name}}',
      agentTitle: 'Assistant',
      suggestions: ['What services do you offer?', 'Book an appointment', 'What are your hours?'],
      preChatForm: {
        enabled: true,
        fields: [
          { id: 'name', label: 'Your name', type: 'text', required: true, placeholder: 'John Doe' },
          { id: 'phone', label: 'Phone (optional)', type: 'tel', required: false, placeholder: '+971 50 123 4567' }
        ]
      },
      proactiveGreeting: {
        enabled: true,
        delaySeconds: 5,
        message: "Hi! 👋 I'm {{agent_name}}. How can I help you today?",
        pageRules: []
      }
    },
    notifications: {
      enabled: true,
      recipientEmails: ['{{owner_email}}'],
      events: {
        booking_confirmed: true,
        order_placed: true,
        lead_captured: true,
        handoff_requested: true,
        nova_failed: true
      },
      quietHours: { enabled: false, start: '22:00', end: '07:00', timezone: 'UTC' },
      dailyDigest: { enabled: false, sendAt: '09:00' }
    },
    _template: {
      isTemplate: true,
      templateId: template.id,
      sourceTenant: template.sourceTenant,
      createdAt: new Date().toISOString()
    }
  };
}

let created = 0;
fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

for (const template of TEMPLATES) {
  const templateDir = path.join(TEMPLATES_DIR, template.id);
  if (fs.existsSync(path.join(templateDir, 'template.json'))) {
    console.log(`⊘ ${template.id}: already exists, skipping`);
    continue;
  }

  fs.mkdirSync(templateDir, { recursive: true });

  // Write template.json (metadata)
  fs.writeFileSync(
    path.join(templateDir, 'template.json'),
    JSON.stringify({
      id: template.id,
      label: template.label,
      description: template.description,
      icon: template.icon,
      domain: template.domain,
      capabilities: template.capabilities,
      defaultServices: template.defaultServices,
      sourceTenant: template.sourceTenant,
      createdAt: new Date().toISOString()
    }, null, 2) + '\n',
    'utf8'
  );

  // Copy all config files from source tenant (except profile.json which we'll templatize)
  const sourceDir = path.join(TENANTS_DIR, template.sourceTenant);
  copyDirRecursive(sourceDir, templateDir);

  // Overwrite profile.json with placeholder version
  fs.writeFileSync(
    path.join(templateDir, 'profile.json'),
    JSON.stringify(makePlaceholderProfile(template), null, 2) + '\n',
    'utf8'
  );

  // Remove the _template marker from the copied profile (we already added it above)
  // Also remove any tenant-specific data files (CRM, bookings, etc.) that shouldn't be in a template
  const dataDirsToRemove = ['crm', 'bookings', 'orders', '.nova-notifications', '.nova-feedback', 'replays'];
  for (const dir of dataDirsToRemove) {
    const dataDir = path.join(templateDir, dir);
    if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  }

  created += 1;
  console.log(`✓ ${template.id}: created from ${template.sourceTenant} (${template.capabilities.length} capabilities, ${template.defaultServices.length} default services)`);
}

console.log(`\n${created} templates created in ${TEMPLATES_DIR}`);
console.log('\nTemplate structure:');
for (const template of TEMPLATES) {
  const dir = path.join(TEMPLATES_DIR, template.id);
  const files = [];
  function walk(d, prefix='') {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(d, entry.name), rel);
      else files.push(rel);
    }
  }
  walk(dir);
  console.log(`\n${template.id}/`);
  files.forEach(f => console.log(`  ${f}`));
}
