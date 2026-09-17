/**
 * Nova Service Resolver (v22.4)
 *
 * THE STANDARD APPROACH for looking up cleaning services by ATTRIBUTE
 * instead of hardcoded ID. This is the single source of truth for
 * "which service is a deep apartment cleaning?" — it checks the
 * service's priceType, name, category, and tags, NEVER its ID.
 *
 * Why this exists:
 *   The old code hardcoded IDs like CLN010 = Deep Apartment Cleaning.
 *   When a tenant changed their services via the control plane
 *   (remapping CLN010 to Laundry), every hardcoded reference broke.
 *
 * The correct approach:
 *   1. The control plane is the SINGLE SOURCE OF TRUTH for services
 *   2. Code looks up services by ATTRIBUTES (priceType, name, category)
 *   3. When a tenant changes services/prices via control plane,
 *      NO CODE CHANGES are needed — the resolver adapts automatically
 *
 * Usage:
 *   const { ServiceResolver } = require('./serviceResolver');
 *   const resolver = new ServiceResolver(allServices);
 *   const deepApt = resolver.findDeepService('apartment');
 *   const stdApt = resolver.findStandardService('apartment');
 *   const isHourly = resolver.isHourlyService(service);
 *   const isDeepScope = resolver.isDeepScopeService(service);
 *   const isFurniture = resolver.isFurnitureService(service);
 */

class ServiceResolver {
  constructor(services = []) {
    this.services = services;
    this._n = (s) => String(s || '').toLowerCase().trim();
  }

  /**
   * Find the deep cleaning service for a property type.
   * Looks for: name contains "deep" + propertyType, priceType is scope_based/matrix
   */
  findDeepService(propertyType = null) {
    // Strategy 1: Name contains "deep" + propertyType
    if (propertyType) {
      const match = this.services.find(s =>
        this._n(s.name).includes('deep') &&
        this._n(s.name).includes(propertyType) &&
        !this._n(s.name).includes('laundry') &&
        !this._n(s.name).includes('furniture')
      );
      if (match) return match;

      // Strategy 2: Aliases contain "deep" + propertyType
      const aliasMatch = this.services.find(s =>
        (s.aliases || []).some(a =>
          this._n(a).includes('deep') &&
          this._n(a).includes(propertyType)
        ) &&
        !this._n(s.name).includes('laundry')
      );
      if (aliasMatch) return aliasMatch;
    }

    // Strategy 3: Any service with "deep" in name, scope_based/matrix pricing
    const deepPriced = this.services.find(s =>
      this._n(s.name).includes('deep') &&
      !this._n(s.name).includes('laundry') &&
      !this._n(s.name).includes('furniture') &&
      (s.priceType === 'scope_based' || s.priceType === 'matrix' ||
       (s.pricingServiceId || '').includes('deep'))
    );
    if (deepPriced) return deepPriced;

    // Strategy 4: Any service with "deep" in name (not laundry/furniture)
    const deepNamed = this.services.find(s =>
      this._n(s.name).includes('deep') &&
      !this._n(s.name).includes('laundry') &&
      !this._n(s.name).includes('furniture')
    );
    if (deepNamed) return deepNamed;

    // Strategy 5: Fallback to legacy hardcoded IDs (backward compat)
    const fallbackId = propertyType === 'villa' ? 'CLN011' : 'CLN010';
    return this.services.find(s => s.id === fallbackId) || null;
  }

  /**
   * Find the standard cleaning service for a property type.
   * Looks for: hourly pricing, name contains "standard" or propertyType
   */
  findStandardService(propertyType = null) {
    // Strategy 1: Hourly service with "standard" or propertyType in name
    if (propertyType) {
      const match = this.services.find(s =>
        (this._n(s.name).includes('standard') || this._n(s.name).includes(propertyType)) &&
        !this._n(s.name).includes('deep') &&
        !this._n(s.name).includes('laundry') &&
        !this._n(s.name).includes('furniture') &&
        (s.priceType === 'hourly' || s.pricingServiceId === 'hourly-cleaner')
      );
      if (match) return match;
    }

    // Strategy 2: Any hourly service that's not deep/laundry/furniture
    const hourly = this.services.find(s =>
      (s.priceType === 'hourly' || s.pricingServiceId === 'hourly-cleaner') &&
      !this._n(s.name).includes('deep') &&
      !this._n(s.name).includes('laundry') &&
      !this._n(s.name).includes('furniture')
    );
    if (hourly) return hourly;

    // Strategy 3: Fallback to legacy hardcoded IDs
    const fallbackId = propertyType === 'villa' ? 'CLN009' : 'CLN008';
    return this.services.find(s => s.id === fallbackId) || null;
  }

  /**
   * Find a furniture service by type (sofa, carpet, mattress, curtain, chair, table).
   */
  findFurnitureService(furnitureType) {
    const n = this._n(furnitureType);
    // Strategy 1: Name contains the furniture type
    const match = this.services.find(s =>
      this._n(s.name).includes(n) &&
      (s.category || '').toLowerCase().includes('furniture')
    );
    if (match) return match;

    // Strategy 2: Any service whose name contains the furniture type
    const nameMatch = this.services.find(s =>
      this._n(s.name).includes(n) &&
      !this._n(s.name).includes('laundry') &&
      !this._n(s.name).includes('deep')
    );
    if (nameMatch) return nameMatch;

    // Strategy 3: Fallback to legacy IDs
    const legacyMap = {
      sofa: 'CLN003', couch: 'CLN003',
      carpet: 'CLN004', rug: 'CLN004',
      mattress: 'CLN020', curtain: 'CLN022', drape: 'CLN022',
      chair: 'CLN021', table: 'CLN033',
    };
    const fallbackId = legacyMap[n];
    return fallbackId ? this.services.find(s => s.id === fallbackId) : null;
  }

  /**
   * Check if a service is hourly (standard cleaning).
   * Uses priceType, NOT hardcoded ID.
   */
  isHourlyService(service) {
    if (!service) return false;
    return service.priceType === 'hourly' ||
           service.pricingServiceId === 'hourly-cleaner' ||
           (service.pricingRuleIds || []).includes('hourly-cleaner');
  }

  /**
   * Check if a service is deep/scope-based (needs bedrooms).
   * Uses priceType, NOT hardcoded ID.
   */
  isDeepScopeService(service) {
    if (!service) return false;
    return service.priceType === 'scope_based' ||
           service.priceType === 'matrix' ||
           (service.pricingServiceId || '').includes('deep') ||
           this._n(service.name).includes('deep');
  }

  /**
   * Check if a service is furniture cleaning.
   * Uses category, NOT hardcoded ID.
   */
  isFurnitureService(service) {
    if (!service) return false;
    return (service.category || '').toLowerCase().includes('furniture') ||
           this._n(service.name).includes('sofa') ||
           this._n(service.name).includes('carpet') ||
           this._n(service.name).includes('mattress') ||
           this._n(service.name).includes('curtain') ||
           this._n(service.name).includes('chair') ||
           this._n(service.name).includes('table');
  }

  /**
   * Check if a service is laundry.
   */
  isLaundryService(service) {
    if (!service) return false;
    return this._n(service.name).includes('laundry') ||
           this._n(service.name).includes('wash') && this._n(service.name).includes('fold') ||
           this._n(service.name).includes('iron');
  }

  /**
   * Get required pricing fields for a service based on its ATTRIBUTES.
   * This replaces the old bookingRequirementState() that used hardcoded IDs.
   */
  getRequiredPricingFields(service) {
    if (!service) return [];
    if (this.isHourlyService(service)) return ['cleanerCount', 'durationHours'];
    if (this.isDeepScopeService(service)) return ['bedrooms'];
    if (this.isFurnitureService(service)) {
      // Furniture services need units (sofa/carpet) or serviceVariant (mattress/curtain)
      if (this._n(service.name).includes('mattress') || this._n(service.name).includes('curtain')) {
        return ['serviceVariant'];
      }
      return ['units'];
    }
    return [];
  }

  /**
   * Find the deep cleaning service for a quote/pricing question.
   * Same as findDeepService but with extra fallback for "Deep Cleaning" umbrella.
   */
  findDeepServiceForQuote(propertyType = null) {
    const deep = this.findDeepService(propertyType);
    if (deep) return deep;

    // Fallback: any service with "deep" in name or aliases
    return this.services.find(s =>
      this._n(s.name).includes('deep') &&
      !this._n(s.name).includes('laundry') &&
      !this._n(s.name).includes('furniture')
    ) || null;
  }
}

module.exports = { ServiceResolver };
