// A throwaway feature for scripts/test_feature_exit.mjs: street lanterns, with everything a feature
// declares in this one file. The test registers it with one import and one FEATURES entry, applied to
// the registry's source as it loads, and checks that every part of the app the registry feeds picks it
// up. It is never registered in the app.
export const seen = { steps: 0, senses: 0, frames: 0 };

export default {
  key: "lanterns",
  seen: "lanternsSeen",
  calls: "lanternCalls",
  snapshot: { lantern_ahead: null },
  build: (_world, { enabled }) => ({ enabled: !!enabled, lit: 0 }),
  metric: {
    at: "streetHazards",
    name: "lanterns_knocked",
    failure: "knocked over a street lantern",
    label: "Knocked over a street lantern",
    category: "observation",
  },
  stepAfterTraffic(world) {
    if (!world.lanterns.enabled) return;
    world.lanterns.lit++;
    seen.steps++;
  },
  sense: {
    at: "streetHazards",
    run(world, snap) {
      if (!world.lanterns.enabled) return;
      snap.lantern_ahead = { gap_m: 40 };
      seen.senses++;
    },
  },
  prompt: { at: "streetHazards", text: "A street lantern stands at the kerb: leave it standing." },
  notice: {
    at: "end",
    order: 900,
    duration: 2000,
    style: "safety",
    read: (world) => (world.lanterns?.enabled ? { key: "lanterns", text: "LANTERNS AHEAD" } : null),
  },
  eventBadges: { lantern_knocked: "KNOCKED OVER A LANTERN" },
  eventBadge: (event) => (event.type === "stop_sign" && event.lantern ? "NO STOP AT THE LANTERN" : null),
  // (a real feature keeps this in a render module of its own: view: () => import("../../render/<feature>.js"))
  view: async () => {
    const THREE = await import("three");
    const named = (name) => {
      const group = new THREE.Group();
      group.name = name;
      return group;
    };
    return {
      view: {
        scenery: { order: 900, build: () => named("lantern-posts") },
        mount: {
          order: 900,
          run({ scene, world }) {
            if (!world.lanterns?.enabled) return null;
            const group = named("lanterns");
            scene.add(group);
            return { group };
          },
          frame() {
            seen.frames++;
          },
        },
        vehicles: {
          lantern_cart: {
            create: (vehicle) => named(`lantern-cart-${vehicle.id}`),
            sync(mesh, pose) {
              mesh.position.set(pose.x, 0, -pose.y);
            },
            minimap: "transit",
          },
        },
        parked: {
          order: 900,
          flag: "lanternStall",
          create(car) {
            const mesh = named(`lantern-stall-${car.id}`);
            mesh.position.set(car.x, 0, -car.y);
            return mesh;
          },
        },
        car: {
          order: 900,
          effect(world, mesh) {
            mesh.userData.lanternLit = !!world.lanterns?.enabled;
          },
        },
        person: {
          order: 900,
          mount(mesh, person) {
            if (person.lanternBearer) mesh.userData.lantern = true;
          },
          sync() {},
        },
        transientPeople: ["lantern_"],
      },
    };
  },
};
