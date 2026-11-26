// Phase 4 Sprint 2 — Self-serve onboarding package entry point.
const { INDUSTRY_TEMPLATES, getTemplate, listTemplates } = require("./industryTemplates");
const { SelfServeSignupService } = require("./signupService");
const { OnboardingWizardService } = require("./onboardingWizardService");

module.exports = {
  INDUSTRY_TEMPLATES, getTemplate, listTemplates,
  SelfServeSignupService,
  OnboardingWizardService,
};
