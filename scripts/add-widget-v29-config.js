/**
 * v29.0 — Updates each tenant's widget config with agent persona,
 * pre-chat form, and proactive greeting settings.
 * Idempotent: preserves existing fields, only adds new ones if missing.
 */
const fs = require('fs');
const path = require('path');

const TENANTS_DIR = path.resolve(__dirname, '../nova-assistant/tenants');

const AGENTS = {
  'cleaning-demo':      { avatar: 'david',    name: 'David',    title: 'Booking Agent' },
  'default':            { avatar: 'marcus',   name: 'Marcus',   title: 'Store Assistant' },
  'driving-school-demo':{ avatar: 'liam',     name: 'Liam',     title: 'Course Advisor' },
  'education-demo':     { avatar: 'emma',     name: 'Emma',     title: 'Admissions Consultant' },
  'healthcare-demo':    { avatar: 'aria',     name: 'Aria',     title: 'Patient Coordinator' },
  'restaurant-demo':    { avatar: 'natalie',  name: 'Natalie',  title: 'Reservation Desk' },
  'salon-demo':         { avatar: 'sophie',   name: 'Sophie',   title: 'Appointment Agent' },
  'tutor-demo':         { avatar: 'olivia',   name: 'Olivia',   title: 'Tutoring Coordinator' }
};

const PROACTIVE_GREETINGS = {
  'cleaning-demo': {
    enabled: true,
    delaySeconds: 5,
    message: "Hi! 👋 I'm David, your booking agent. Need a cleaning quote or want to schedule a service? I'm here to help.",
    pageRules: []
  },
  'default': {
    enabled: true,
    delaySeconds: 5,
    message: "Hi! 👋 I'm Marcus. Looking for something specific? I can help you find products, track orders, or answer questions.",
    pageRules: []
  },
  'healthcare-demo': {
    enabled: true,
    delaySeconds: 5,
    message: "Hi! 👋 I'm Aria, your patient coordinator. I can help you book an appointment or answer questions about our services.",
    pageRules: []
  },
  'salon-demo': {
    enabled: true,
    delaySeconds: 5,
    message: "Hi! 👋 I'm Sophie. Want to book a haircut or check available slots? I'm here to help.",
    pageRules: []
  },
  'restaurant-demo': {
    enabled: true,
    delaySeconds: 5,
    message: "Hi! 👋 I'm Natalie. I can help you reserve a table or tell you about today's specials.",
    pageRules: []
  },
  'education-demo': {
    enabled: true,
    delaySeconds: 5,
    message: "Hi! 👋 I'm Emma, your admissions consultant. I can guide you through our programs and the enrollment process.",
    pageRules: []
  },
  'tutor-demo': {
    enabled: true,
    delaySeconds: 5,
    message: "Hi! 👋 I'm Olivia. Need a tutoring session? I can help you pick a subject and schedule a class.",
    pageRules: []
  },
  'driving-school-demo': {
    enabled: true,
    delaySeconds: 5,
    message: "Hi! 👋 I'm Liam. I can help you choose a course, check schedules, or book a driving lesson.",
    pageRules: []
  }
};

let modified = 0;
for (const tenantId of fs.readdirSync(TENANTS_DIR).sort()) {
  const profilePath = path.join(TENANTS_DIR, tenantId, 'profile.json');
  if (!fs.existsSync(profilePath)) continue;
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  if (!profile.widget) continue;

  const agent = AGENTS[tenantId] || AGENTS['default'];
  const greeting = PROACTIVE_GREETINGS[tenantId] || PROACTIVE_GREETINGS['default'];

  // Only add new fields if missing (idempotent)
  if (!profile.widget.agentAvatar) profile.widget.agentAvatar = agent.avatar;
  if (!profile.widget.agentName) profile.widget.agentName = agent.name;
  if (!profile.widget.agentTitle) profile.widget.agentTitle = agent.title;

  // Pre-chat form: enabled for all tenants, asking name + phone
  if (!profile.widget.preChatForm) {
    profile.widget.preChatForm = {
      enabled: true,
      fields: [
        { id: 'name', label: 'Your name', type: 'text', required: true, placeholder: 'John Doe' },
        { id: 'phone', label: 'Phone (optional)', type: 'tel', required: false, placeholder: '+971 50 123 4567' }
      ]
    };
  }

  // Proactive greeting
  if (!profile.widget.proactiveGreeting) {
    profile.widget.proactiveGreeting = greeting;
  }

  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
  modified += 1;
  console.log(`✓ ${tenantId}: agent=${agent.name} (${agent.avatar}), pre-chat form, proactive greeting`);
}
console.log(`\n${modified} tenant profiles updated.`);
