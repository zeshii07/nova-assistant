/**
 * v30.1 — Fixes template files to use placeholders instead of business-specific names.
 * Replaces "SparkleCare" → "{{business_name}}", specific contact info, etc.
 * Idempotent: only replaces if placeholder isn't already present.
 */
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.resolve(__dirname, '../nova-assistant/tenants/_templates');

// Replacements per template (business-specific → placeholder)
const REPLACEMENTS = {
  'cleaning-template': {
    'SparkleCare Cleaning': '{{business_name}}',
    'SparkleCare': '{{business_name}}',
    'sparklecare.example': '{{business_website}}',
    'hello@sparklecare.example': '{{owner_email}}',
    '+971 4 555 0199': '{{owner_phone}}',
    'Dubai and nearby supported UAE areas': '{{business_location}}',
    'Monday to Saturday, 9 AM to 7 PM Gulf Standard Time': '{{business_hours}}'
  },
  'retail-template': {
    'Demo Store': '{{business_name}}',
    'demo store': '{{business_name}}',
    'Demo Store Assistant': '{{business_name}} Assistant',
    'support@example.com': '{{owner_email}}',
    'example.com': '{{business_website}}'
  },
  'salon-template': {
    'Glow Salon': '{{business_name}}',
    'Glow': '{{business_name}}',
    'glow@example.com': '{{owner_email}}'
  },
  'restaurant-template': {
    'Saj Restaurant': '{{business_name}}',
    'Saj': '{{business_name}}',
    'saj@example.com': '{{owner_email}}'
  }
};

let totalReplaced = 0;
for (const [templateId, replacements] of Object.entries(REPLACEMENTS)) {
  const templateDir = path.join(TEMPLATES_DIR, templateId);
  if (!fs.existsSync(templateDir)) { console.log(`⊘ ${templateId}: not found`); continue; }

  let templateReplacements = 0;
  function processDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) { processDir(fullPath); continue; }
      if (!entry.name.endsWith('.json') && !entry.name.endsWith('.md')) continue;
      try {
        let content = fs.readFileSync(fullPath, 'utf8');
        let changed = false;
        for (const [original, replacement] of Object.entries(replacements)) {
          if (content.includes(original)) {
            content = content.split(original).join(replacement);
            changed = true;
            templateReplacements++;
          }
        }
        if (changed) fs.writeFileSync(fullPath, content, 'utf8');
      } catch {}
    }
  }
  processDir(templateDir);
  console.log(`✓ ${templateId}: ${templateReplacements} replacements`);
  totalReplaced += templateReplacements;
}
console.log(`\n${totalReplaced} total replacements across all templates.`);
