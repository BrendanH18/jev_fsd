// Reflections on a wet road. When it rains, the scene is rendered a second time, at half
// or quarter resolution, from a camera mirrored below the road surface; the road and its markings then show
// that image, smeared along the view direction the way a wet road stretches lights into streaks,
// and sharp in puddles. Weighted by the Fresnel term, so the road mirrors most at grazing angles.
//
// Ground layers face up, so the mirrored camera (below the ground, looking up) never sees them:
// nothing needs hiding for the reflection pass.

import * as THREE from "three";
import { lighting } from "./atmosphere.js";
import { macroTexture } from "./textures.js";

export const reflection = {
  texture: { value: null },
  matrix: { value: new THREE.Matrix4() },
  strength: { value: 0 },
};

export class GroundReflection {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
    this.mirror = new THREE.PerspectiveCamera();
    this.enabled = true;
    this.resolutionScale = 0.25;
    reflection.texture.value = this.rt.texture;
    this._v = new THREE.Vector3();
    this._clipPlane = new THREE.Plane();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
  }

  setSize(w, h) { this.rt.setSize(Math.max(2, Math.ceil(w * this.resolutionScale)), Math.max(2, Math.ceil(h * this.resolutionScale))); }

  render() {
    const strength = this.enabled ? lighting.wet.value : 0;
    reflection.strength.value = strength;
    if (strength <= 0) return false;
    const cam = this.camera, m = this.mirror;
    cam.updateMatrixWorld();
    // mirror the camera's position, view target, and up vector in the plane y = 0
    const pos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const dir = cam.getWorldDirection(this._v);
    const target = pos.clone().add(dir);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    pos.y = -pos.y; target.y = -target.y; up.y = -up.y;
    m.position.copy(pos);
    m.up.copy(up);
    m.lookAt(target);
    m.fov = cam.fov; m.aspect = cam.aspect; m.near = cam.near; m.far = cam.far;
    m.updateProjectionMatrix();
    m.updateMatrixWorld();
    reflection.matrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(m.projectionMatrix).multiply(m.matrixWorldInverse);
    // Clip away geometry below the reflecting road, including the underside of curbs and light
    // pools. Use the same oblique near-plane construction as Three.js's Reflector.
    this._clipPlane.normal.set(0, 1, 0);
    this._clipPlane.constant = 0;
    this._clipPlane.applyMatrix4(m.matrixWorldInverse);
    const plane = this._clipPlane, clip = this._clip, q = this._q, projection = m.projectionMatrix.elements;
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    q.set((Math.sign(clip.x) + projection[8]) / projection[0],
      (Math.sign(clip.y) + projection[9]) / projection[5], -1, (1 + projection[10]) / projection[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    projection[2] = clip.x; projection[6] = clip.y; projection[10] = clip.z + 1; projection[14] = clip.w;
    m.projectionMatrixInverse.copy(m.projectionMatrix).invert();
    const r = this.renderer;
    const prevTarget = r.getRenderTarget(), prevTexture = reflection.texture.value;
    reflection.strength.value = 0;   // the road does not reflect itself
    // A zero-strength shader branch still leaves its sampler bound. WebGL rejects drawing into
    // an attached texture that is also bound as input, so unbind it for the entire mirror pass.
    reflection.texture.value = null;
    try {
      r.setRenderTarget(this.rt);
      r.clear();
      r.render(this.scene, m);
    } finally {
      reflection.strength.value = strength;
      reflection.texture.value = prevTexture;
      r.setRenderTarget(prevTarget);
    }
    return true;
  }

  dispose() { this.rt.dispose(); }
}

// Make a road material show the reflection when wet. `gloss` scales it (paint reflects a little
// less than asphalt, concrete much less).
export function wetReflective(material, gloss = 1) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.tReflect = reflection.texture;
    shader.uniforms.reflMatrix = reflection.matrix;
    shader.uniforms.reflStrength = reflection.strength;
    shader.uniforms.puddleMap = { value: macroTexture() };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 reflMatrix;\nvarying vec4 vReflUv;\nvarying vec2 vGroundXZ;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vec4 reflWorld = modelMatrix * vec4( transformed, 1.0 );
        vReflUv = reflMatrix * reflWorld;
        vGroundXZ = reflWorld.xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D tReflect;\nuniform sampler2D puddleMap;\nuniform float reflStrength;\nvarying vec4 vReflUv;\nvarying vec2 vGroundXZ;")
      .replace("#include <opaque_fragment>", `
        if ( reflStrength > 0.0 && vReflUv.w > 0.0 ) {
          vec2 ruv = vReflUv.xy / vReflUv.w;
          // Fade out at the texture border instead of stretching clamped edge pixels into streaks.
          float edge = min( min( ruv.x, 1.0 - ruv.x ), min( ruv.y, 1.0 - ruv.y ) );
          float border = smoothstep( 0.0, 0.04, edge );
          float puddle = smoothstep( 0.55, 0.62, texture2D( puddleMap, vGroundXZ * 0.021 ).r * 0.7 + texture2D( puddleMap, vGroundXZ * 0.093 + 0.37 ).r * 0.3 );
          // a wet road smears reflections toward the viewer; a puddle is a clean mirror
          float smear = ( 1.0 - puddle ) * 0.01;
          // Dither in road coordinates, so the blur follows the road instead of crawling with
          // screen pixels. Eight taps avoid discrete repeated bars around reflected tail lamps.
          float jitter = fract( sin( dot( floor( vGroundXZ * 32.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
          vec3 refl = vec3( 0.0 );
          for ( int k = 0; k < 8; k++ ) refl += texture2D( tReflect, clamp( ruv + vec2( 0.0, ( float( k ) + jitter - 4.0 ) * smear ), vec2( 0.0 ), vec2( 1.0 ) ) ).rgb;
          refl /= 8.0;
          float ndv = clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );
          float fres = 0.03 + 0.97 * pow( 1.0 - ndv, 5.0 );
          float k = border * reflStrength * ${gloss.toFixed(2)} * clamp( fres * ( 0.55 + 0.9 * puddle ) + 0.12 * puddle, 0.0, 0.92 );
          outgoingLight = mix( outgoingLight, refl, k );
        }
        #include <opaque_fragment>`);
  };
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => "";
  material.customProgramCacheKey = () => `wet-${gloss}-${prevKey()}`;
  return material;
}
