const { ValidationError } = require("../../shared/src/errors");
class PluginManager {
  constructor({ logger }) { this.logger = logger; this.plugins = new Map(); }
  register(plugin) {
    if (!plugin || typeof plugin.id !== "string" || typeof plugin.canHandle !== "function" || typeof plugin.execute !== "function") {
      throw new ValidationError("Plugin must expose id, canHandle(context), and execute(context)");
    }
    if (this.plugins.has(plugin.id)) throw new ValidationError(`Plugin '${plugin.id}' is already registered`);
    this.plugins.set(plugin.id, plugin);
    this.logger?.info("plugin.registered", { pluginId: plugin.id });
    return this;
  }
  getEnabledPlugins(tenant) { return [...this.plugins.values()].filter((plugin) => tenant.capabilities.includes(plugin.id)); }
  async resolve(context) {
    for (const plugin of this.getEnabledPlugins(context.tenant)) {
      if (await plugin.canHandle(context)) return plugin;
    }
    return null;
  }
}
module.exports = { PluginManager };
