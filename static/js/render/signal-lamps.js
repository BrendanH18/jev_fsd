import * as THREE from "three";
import { glowTexture } from "./textures.js";

const signalAttributes = `
  attribute vec3 signalColor;
  attribute float signalStrength;
  varying vec3 vSignalColor;
`;

export function signalLensMaterial({ texturedFace = false, colorLens = false, texture = null, ...surface }) {
  const material = new THREE.MeshStandardMaterial({
    ...surface,
    map: texturedFace ? texture : null,
    emissiveMap: texture,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `${signalAttributes}
      varying float vSignalStrength;
      ${shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vSignalColor = signalColor;
        vSignalStrength = signalStrength;`,
      )}`;
    shader.fragmentShader = `
      varying vec3 vSignalColor;
      varying float vSignalStrength;
      ${shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `totalEmissiveRadiance = vSignalColor * vSignalStrength;
        #include <emissivemap_fragment>`,
      )}`;
    if (colorLens) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        if (vSignalStrength > 1.0) diffuseColor.rgb = vSignalColor;`,
      );
    }
    if (texturedFace) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        if (vSignalStrength < 0.0) discard;`,
      );
    }
  };
  material.customProgramCacheKey = () =>
    colorLens ? "colored-signal-lens" : texturedFace ? "pedestrian-signal-face" : "signal-arrow";
  return material;
}

export function signalGlowMaterial() {
  const material = new THREE.MeshBasicMaterial({
    map: glowTexture(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.9,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `${signalAttributes}
      ${shader.vertexShader.replace(
        "#include <project_vertex>",
        `// Place each quad in camera space so it faces the main and reflection cameras.
        vec4 mvPosition = modelViewMatrix * instanceMatrix[3];
        mvPosition.xy += position.xy * length(instanceMatrix[0].xyz);
        gl_Position = signalStrength > 0.0 ? projectionMatrix * mvPosition : vec4(2.0, 2.0, 2.0, 1.0);
        vSignalColor = signalColor;`,
      )}`;
    shader.fragmentShader = `
      varying vec3 vSignalColor;
      ${shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb *= vSignalColor;`,
      )}`;
  };
  return material;
}

export class SignalBatch {
  constructor(name, geometry, material) {
    this.name = name;
    this.geometry = geometry;
    this.material = material;
    this.instances = [];
  }

  add(matrix, color, strength) {
    return this.instances.push({ matrix, color, strength }) - 1;
  }

  mount(group, receiveShadow = true) {
    const count = this.instances.length;
    if (!count) {
      this.geometry.dispose();
      this.material.dispose();
      return;
    }
    const colors = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.strengths = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("signalColor", colors);
    this.geometry.setAttribute("signalStrength", this.strengths);
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    const tint = new THREE.Color();
    this.instances.forEach(({ matrix, color, strength }, index) => {
      mesh.setMatrixAt(index, matrix);
      tint.setHex(color);
      colors.setXYZ(index, tint.r, tint.g, tint.b);
      this.strengths.setX(index, strength);
    });
    this.instances.length = 0;
    mesh.name = this.name;
    mesh.receiveShadow = receiveShadow;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    return mesh;
  }

  setStrength(index, strength) {
    this.strengths.setX(index, strength);
    this.strengths.needsUpdate = true;
  }
}
