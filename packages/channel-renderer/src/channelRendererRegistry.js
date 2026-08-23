class ChannelRendererRegistry {
  constructor() { this.renderers = new Map(); }
  register(channel, renderer) { this.renderers.set(channel, renderer); return this; }
  render(channel, input) { return (this.renderers.get(channel) || this.renderers.get("default")).render(input); }
}
module.exports = { ChannelRendererRegistry };
