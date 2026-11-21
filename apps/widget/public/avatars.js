/* ============================================================
   Nova Widget — Pre-built Agent Avatars (v29.0)
   10 professional SVG portraits. No image hosting needed.
   Avatars are selected by name; tenant config sets which one to use.
   ============================================================ */

window.NOVA_AVATARS = {
  // 1. Friendly female customer service rep
  'aria': {
    name: 'Aria',
    title: 'Customer Success',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-aria" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#ef4444"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-aria)"/>
      <circle cx="50" cy="38" r="16" fill="#fff" opacity="0.95"/>
      <path d="M 22 100 Q 22 60 50 60 Q 78 60 78 100 Z" fill="#fff" opacity="0.95"/>
      <circle cx="44" cy="36" r="2" fill="#1f2937"/>
      <circle cx="56" cy="36" r="2" fill="#1f2937"/>
      <path d="M 44 44 Q 50 48 56 44" stroke="#1f2937" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M 35 28 Q 50 18 65 28 Q 65 22 50 20 Q 35 22 35 28" fill="#1f2937"/>
    </svg>`
  },

  // 2. Professional male support agent
  'marcus': {
    name: 'Marcus',
    title: 'Support Specialist',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-marcus" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1e40af"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-marcus)"/>
      <circle cx="50" cy="38" r="16" fill="#fff" opacity="0.95"/>
      <path d="M 22 100 Q 22 60 50 60 Q 78 60 78 100 Z" fill="#fff" opacity="0.95"/>
      <circle cx="44" cy="36" r="2" fill="#1f2937"/>
      <circle cx="56" cy="36" r="2" fill="#1f2937"/>
      <path d="M 44 44 Q 50 46 56 44" stroke="#1f2937" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M 36 24 Q 50 14 64 24 L 64 32 L 36 32 Z" fill="#1f2937"/>
      <rect x="36" y="30" width="28" height="4" fill="#1f2937"/>
    </svg>`
  },

  // 3. Warm female booking agent
  'sophie': {
    name: 'Sophie',
    title: 'Booking Agent',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-sophie" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ec4899"/><stop offset="1" stop-color="#be185d"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-sophie)"/>
      <circle cx="50" cy="38" r="16" fill="#fff" opacity="0.95"/>
      <path d="M 22 100 Q 22 60 50 60 Q 78 60 78 100 Z" fill="#fff" opacity="0.95"/>
      <circle cx="44" cy="36" r="2" fill="#1f2937"/>
      <circle cx="56" cy="36" r="2" fill="#1f2937"/>
      <path d="M 44 44 Q 50 49 56 44" stroke="#1f2937" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M 32 28 Q 50 14 68 28 Q 68 35 50 32 Q 32 35 32 28" fill="#7c2d12"/>
      <path d="M 32 28 L 30 40 M 68 28 L 70 40" stroke="#7c2d12" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg>`
  },

  // 4. Friendly male concierge
  'david': {
    name: 'David',
    title: 'Concierge',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-david" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10b981"/><stop offset="1" stop-color="#047857"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-david)"/>
      <circle cx="50" cy="38" r="16" fill="#fff" opacity="0.95"/>
      <path d="M 22 100 Q 22 60 50 60 Q 78 60 78 100 Z" fill="#fff" opacity="0.95"/>
      <circle cx="44" cy="36" r="2" fill="#1f2937"/>
      <circle cx="56" cy="36" r="2" fill="#1f2937"/>
      <path d="M 44 44 Q 50 48 56 44" stroke="#1f2937" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M 34 26 Q 50 16 66 26 L 66 34 L 34 34 Z" fill="#1f2937"/>
      <path d="M 50 16 L 50 26" stroke="#1f2937" stroke-width="2"/>
    </svg>`
  },

  // 5. Professional female consultant
  'emma': {
    name: 'Emma',
    title: 'Consultant',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-emma" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#6d28d9"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-emma)"/>
      <circle cx="50" cy="38" r="16" fill="#fff" opacity="0.95"/>
      <path d="M 22 100 Q 22 60 50 60 Q 78 60 78 100 Z" fill="#fff" opacity="0.95"/>
      <circle cx="44" cy="36" r="2" fill="#1f2937"/>
      <circle cx="56" cy="36" r="2" fill="#1f2937"/>
      <path d="M 44 44 Q 50 47 56 44" stroke="#1f2937" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M 30 30 Q 50 18 70 30 Q 70 40 50 38 Q 30 40 30 30" fill="#1f2937"/>
      <path d="M 40 32 L 60 32" stroke="#fbbf24" stroke-width="2"/>
    </svg>`
  },

  // 6. Approachable male assistant
  'liam': {
    name: 'Liam',
    title: 'Assistant',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-liam" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06b6d4"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-liam)"/>
      <circle cx="50" cy="38" r="16" fill="#fff" opacity="0.95"/>
      <path d="M 22 100 Q 22 60 50 60 Q 78 60 78 100 Z" fill="#fff" opacity="0.95"/>
      <circle cx="44" cy="36" r="2" fill="#1f2937"/>
      <circle cx="56" cy="36" r="2" fill="#1f2937"/>
      <path d="M 44 44 Q 50 49 56 44" stroke="#1f2937" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M 36 26 Q 50 18 64 26 L 64 30 Q 50 28 36 30 Z" fill="#1f2937"/>
    </svg>`
  },

  // 7. Friendly female coordinator
  'natalie': {
    name: 'Natalie',
    title: 'Coordinator',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-natalie" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#c2410c"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-natalie)"/>
      <circle cx="50" cy="38" r="16" fill="#fff" opacity="0.95"/>
      <path d="M 22 100 Q 22 60 50 60 Q 78 60 78 100 Z" fill="#fff" opacity="0.95"/>
      <circle cx="44" cy="36" r="2" fill="#1f2937"/>
      <circle cx="56" cy="36" r="2" fill="#1f2937"/>
      <path d="M 44 44 Q 50 48 56 44" stroke="#1f2937" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M 28 28 Q 50 12 72 28 Q 72 38 50 36 Q 28 38 28 28" fill="#7c2d12"/>
      <path d="M 28 28 L 24 50 M 72 28 L 76 50" stroke="#7c2d12" stroke-width="4" fill="none" stroke-linecap="round"/>
    </svg>`
  },

  // 8. Professional male representative
  'james': {
    name: 'James',
    title: 'Representative',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-james" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#475569"/><stop offset="1" stop-color="#1e293b"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-james)"/>
      <circle cx="50" cy="38" r="16" fill="#fff" opacity="0.95"/>
      <path d="M 22 100 Q 22 60 50 60 Q 78 60 78 100 Z" fill="#fff" opacity="0.95"/>
      <circle cx="44" cy="36" r="2" fill="#1f2937"/>
      <circle cx="56" cy="36" r="2" fill="#1f2937"/>
      <path d="M 44 44 Q 50 46 56 44" stroke="#1f2937" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M 34 28 Q 50 18 66 28 L 66 32 L 34 32 Z" fill="#1f2937"/>
      <path d="M 42 50 L 42 60 L 58 60 L 58 50" stroke="#1e293b" stroke-width="2" fill="none"/>
    </svg>`
  },

  // 9. Warm female support
  'olivia': {
    name: 'Olivia',
    title: 'Support',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-olivia" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#84cc16"/><stop offset="1" stop-color="#4d7c0f"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-olivia)"/>
      <circle cx="50" cy="38" r="16" fill="#fff" opacity="0.95"/>
      <path d="M 22 100 Q 22 60 50 60 Q 78 60 78 100 Z" fill="#fff" opacity="0.95"/>
      <circle cx="44" cy="36" r="2" fill="#1f2937"/>
      <circle cx="56" cy="36" r="2" fill="#1f2937"/>
      <path d="M 44 44 Q 50 49 56 44" stroke="#1f2937" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M 32 26 Q 50 16 68 26 Q 68 36 50 34 Q 32 36 32 26" fill="#1f2937"/>
      <path d="M 40 32 Q 50 30 60 32" stroke="#fbbf24" stroke-width="2" fill="none"/>
    </svg>`
  },

  // 10. Friendly male guide
  'noah': {
    name: 'Noah',
    title: 'Guide',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-noah" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a855f7"/><stop offset="1" stop-color="#7e22ce"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-noah)"/>
      <circle cx="50" cy="38" r="16" fill="#fff" opacity="0.95"/>
      <path d="M 22 100 Q 22 60 50 60 Q 78 60 78 100 Z" fill="#fff" opacity="0.95"/>
      <circle cx="44" cy="36" r="2" fill="#1f2937"/>
      <circle cx="56" cy="36" r="2" fill="#1f2937"/>
      <path d="M 44 44 Q 50 48 56 44" stroke="#1f2937" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M 36 24 Q 50 14 64 24 L 64 34 L 36 34 Z" fill="#1f2937"/>
      <circle cx="50" cy="22" r="3" fill="#fbbf24"/>
    </svg>`
  },

  /* ============================================================
     Tech / AI-themed avatars (v29.1)
     Abstract tech icons instead of human faces — for AI assistants.
     ============================================================ */

  // 11. Spark / AI burst — a four-point AI spark on a deep indigo gradient.
  'spark': {
    name: 'Nova',
    title: 'AI Assistant',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-spark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#1e1b4b"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-spark)"/>
      <path d="M50 18 L56 44 L82 50 L56 56 L50 82 L44 56 L18 50 L44 44 Z" fill="#fff" opacity="0.95"/>
      <circle cx="50" cy="50" r="6" fill="#22d3ee"/>
      <circle cx="78" cy="28" r="3" fill="#fff" opacity="0.7"/>
      <circle cx="24" cy="74" r="2.5" fill="#fff" opacity="0.6"/>
    </svg>`
  },

  // 12. Neural network — nodes + connecting lines on a teal gradient.
  'neural': {
    name: 'Synapse',
    title: 'AI Assistant',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-neural" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06b6d4"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-neural)"/>
      <g stroke="#fff" stroke-width="1.2" opacity="0.55" fill="none">
        <line x1="26" y1="30" x2="50" y2="50"/><line x1="26" y1="70" x2="50" y2="50"/>
        <line x1="50" y1="50" x2="74" y2="30"/><line x1="50" y1="50" x2="74" y2="70"/>
        <line x1="26" y1="30" x2="50" y2="70"/><line x1="26" y1="70" x2="50" y2="30"/>
      </g>
      <g fill="#fff">
        <circle cx="26" cy="30" r="5"/><circle cx="26" cy="70" r="5"/>
        <circle cx="74" cy="30" r="5"/><circle cx="74" cy="70" r="5"/>
      </g>
      <circle cx="50" cy="50" r="8" fill="#22d3ee"/>
      <circle cx="50" cy="50" r="3" fill="#fff"/>
    </svg>`
  },

  // 13. Circuit chip — microchip with circuit traces on a green gradient.
  'circuit': {
    name: 'Core',
    title: 'AI Assistant',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-circuit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10b981"/><stop offset="1" stop-color="#064e3b"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-circuit)"/>
      <rect x="34" y="34" width="32" height="32" rx="5" fill="none" stroke="#fff" stroke-width="2.5"/>
      <rect x="44" y="44" width="12" height="12" rx="2" fill="#fff"/>
      <g stroke="#fff" stroke-width="2" stroke-linecap="round">
        <line x1="34" y1="42" x2="22" y2="42"/><line x1="34" y1="50" x2="22" y2="50"/><line x1="34" y1="58" x2="22" y2="58"/>
        <line x1="66" y1="42" x2="78" y2="42"/><line x1="66" y1="50" x2="78" y2="50"/><line x1="66" y1="58" x2="78" y2="58"/>
        <line x1="42" y1="34" x2="42" y2="22"/><line x1="50" y1="34" x2="50" y2="22"/><line x1="58" y1="34" x2="58" y2="22"/>
        <line x1="42" y1="66" x2="42" y2="78"/><line x1="50" y1="66" x2="50" y2="78"/><line x1="58" y1="66" x2="58" y2="78"/>
      </g>
      <circle cx="50" cy="50" r="2.5" fill="#10b981"/>
    </svg>`
  },

  // 14. AI orb — glowing concentric orb on a purple gradient.
  'orb': {
    name: 'Aura',
    title: 'AI Assistant',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg-orb" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#2e1065"/></radialGradient>
        <radialGradient id="core-orb" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff"/><stop offset="0.5" stop-color="#c4b5fd"/><stop offset="1" stop-color="#8b5cf6"/></radialGradient>
      </defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-orb)"/>
      <circle cx="50" cy="50" r="34" fill="none" stroke="#fff" stroke-width="1" opacity="0.25"/>
      <circle cx="50" cy="50" r="26" fill="none" stroke="#fff" stroke-width="1.5" opacity="0.4"/>
      <circle cx="50" cy="50" r="18" fill="url(#core-orb)"/>
      <circle cx="44" cy="44" r="5" fill="#fff" opacity="0.85"/>
    </svg>`
  },

  // 15. Robot — friendly minimalist robot face on a blue gradient.
  'bot': {
    name: 'Nova',
    title: 'AI Assistant',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-bot" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-bot)"/>
      <rect x="28" y="34" width="44" height="36" rx="8" fill="#fff"/>
      <rect x="44" y="22" width="12" height="12" fill="#fff"/>
      <circle cx="50" cy="22" r="4" fill="#fbbf24"/>
      <circle cx="40" cy="48" r="5" fill="#1e3a8a"/>
      <circle cx="60" cy="48" r="5" fill="#1e3a8a"/>
      <circle cx="41" cy="47" r="1.8" fill="#fff"/>
      <circle cx="61" cy="47" r="1.8" fill="#fff"/>
      <path d="M40 62 Q50 68 60 62" stroke="#1e3a8a" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <line x1="50" y1="70" x2="50" y2="74" stroke="#1e3a8a" stroke-width="2"/>
      <line x1="40" y1="74" x2="60" y2="74" stroke="#1e3a8a" stroke-width="2" stroke-linecap="round"/>
    </svg>`
  },

  // 16. Quantum — interlocking hexagons on a slate gradient.
  'quantum': {
    name: 'Quantum',
    title: 'AI Assistant',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg-quantum" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0ea5e9"/><stop offset="1" stop-color="#0c4a6e"/></linearGradient></defs>
      <rect width="100" height="100" rx="50" fill="url(#bg-quantum)"/>
      <g fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round">
        <polygon points="50,22 70,33 70,55 50,66 30,55 30,33" opacity="0.95"/>
        <polygon points="50,38 62,45 62,59 50,66 38,59 38,45" opacity="0.6"/>
      </g>
      <circle cx="50" cy="50" r="5" fill="#22d3ee"/>
      <circle cx="70" cy="33" r="2.5" fill="#fff"/>
      <circle cx="30" cy="55" r="2.5" fill="#fff"/>
    </svg>`
  }
};

// Helper: get avatar by key, fallback to 'spark' (the default tech/AI icon)
window.NOVA_AVATARS.get = function (key) {
  return this[key] || this['spark'];
};

// Helper: list all avatar keys (for dashboard picker)
window.NOVA_AVATARS.keys = function () {
  return Object.keys(this).filter(k => typeof this[k] === 'object' && this[k].svg);
};
