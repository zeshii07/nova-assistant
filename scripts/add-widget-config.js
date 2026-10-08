/**
 * v28.0 — Adds a `widget` block to each tenant's profile.json
 * based on their existing branding + business description.
 * Idempotent: skips tenants that already have a widget block.
 */
const fs = require('fs');
const path = require('path');

const TENANTS_DIR = path.resolve(__dirname, '../nova-assistant/tenants');

const SUGGESTIONS = {
  'cleaning-demo': [
    'What cleaning services do you offer?',
    'I need a deep cleaning quote',
    'Book a cleaning for tomorrow'
  ],
  'default': [
    'What products do you have?',
    'Show me running shoes',
    'Track my order'
  ],
  'driving-school-demo': [
    'What courses do you offer?',
    'Book a driving lesson',
    'What are your fees?'
  ],
  'education-demo': [
    'Tell me about your programs',
    'What is the admission process?',
    'Book a consultation'
  ],
  'healthcare-demo': [
    'What services do you offer?',
    'Book an appointment',
    'What are your hours?'
  ],
  'restaurant-demo': [
    'Show me the menu',
    'Book a table for 2',
    'What are today\'s specials?'
  ],
  'salon-demo': [
    'What services do you offer?',
    'Book a haircut',
    'What are your rates?'
  ],
  'tutor-demo': [
    'What subjects do you teach?',
    'Book a tutoring session',
    'What are your fees?'
  ]
};

const THEMES = {
  'cleaning-demo': '#10b981',   // emerald green
  'default': '#2d5bd1',          // nova blue
  'driving-school-demo': '#f59e0b', // amber
  'education-demo': '#8b5cf6',   // violet
  'healthcare-demo': '#ef4444',  // red
  'restaurant-demo': '#f97316',  // orange
  'salon-demo': '#ec4899',       // pink
  'tutor-demo': '#06b6d4'        // cyan
};

let modified = 0;
for (const tenantId of fs.readdirSync(TENANTS_DIR).sort()) {
  const profilePath = path.join(TENANTS_DIR, tenantId, 'profile.json');
  if (!fs.existsSync(profilePath)) continue;
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  if (profile.widget && profile.widget.enabled !== undefined) continue;

  profile.widget = {
    enabled: true,
    position: 'bottom-right',
    themeColor: THEMES[tenantId] || '#2d5bd1',
    language: 'auto',
    welcomeMessage: profile.branding?.welcomeMessage || 'Hi! How can I help you today?',
    welcomeMessageRomanUrdu: profile.branding?.welcomeMessageRomanUrdu || 'Salam! Main aap ki kaise madad kar sakta hoon?',
    suggestions: SUGGESTIONS[tenantId] || ['What services do you offer?', 'Book an appointment']
  };

  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
  modified += 1;
  console.log(`✓ ${tenantId}: widget block added (theme=${profile.widget.themeColor})`);
}
console.log(`\n${modified} tenant profiles updated.`);
