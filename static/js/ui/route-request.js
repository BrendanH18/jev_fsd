// The map, Explore and the Lab share one pending route selection, so only the latest can win.
export class RouteRequest {
  constructor({ request, payload, install, show, canInstall = () => true }) {
    Object.assign(this, { request, payload, install, show, canInstall });
    this.pending = null;
  }

  cancel() {
    this.pending?.abort();
    this.pending = null;
    this.show("");
  }

  async lookup(load, select) {
    if (!this.canInstall()) return false;
    this.cancel();
    const current = (this.pending = new AbortController());
    try {
      const result = await load(current.signal);
      if (this.pending !== current || !this.canInstall()) return false;
      return select(result);
    } catch (error) {
      if (this.pending === current) throw error;
      return false;
    } finally {
      if (this.pending === current) this.pending = null;
    }
  }

  async choose(point, { route, title, check = true } = {}) {
    if (!this.canInstall()) return false;
    this.cancel();
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
      this.show("Choose a valid destination.");
      return false;
    }
    const current = (this.pending = new AbortController());
    const suggested = Boolean(route);
    try {
      if (!route || check) {
        this.show("Finding route…", true);
        const result = await this.request("/api/route", this.payload(point), { signal: current.signal });
        if (this.pending !== current) return false;
        if (!this.canInstall()) {
          this.cancel();
          return false;
        }
        if (!Array.isArray(result?.routes)) throw new Error("The server returned an invalid route list.");
        if (!result.routes.length) {
          this.show("No route here. Choose another street.");
          return false;
        }
        route = result.routes[0];
      }
      if (!Array.isArray(route?.polyline) || route.polyline.length < 2 || !Array.isArray(route.edges))
        throw new Error("The route geometry is incomplete.");
      const endpoint = route.polyline.at(-1);
      if (!Array.isArray(endpoint) || endpoint.length !== 2 || !endpoint.every(Number.isFinite))
        throw new Error("The route destination is invalid.");
      if (this.pending !== current || !this.canInstall()) return false;
      this.install(route, suggested ? point : endpoint, title);
      this.show("");
      return true;
    } catch (error) {
      if (this.pending === current) this.show(`Routing failed. ${error?.message || "Try another destination."}`);
      return false;
    } finally {
      if (this.pending === current) this.pending = null;
    }
  }
}
