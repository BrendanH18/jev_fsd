# Three.js runtime

Three.js **0.183.0** (upstream release r183), distributed under the MIT license in
[LICENSE](LICENSE). Copyright notices in the original files are preserved.

Source repository: https://github.com/mrdoob/three.js/tree/r183

Exact package source: https://registry.npmjs.org/three/-/three-0.183.0.tgz

Archive integrity (verified before extraction):

```
sha512-G6SH2jfefIVa2YI4JL2VbgQhrrbp1A8dRc7lr3PW827kdVyaX2RgH6M5FmjmdVFLgSHppyg3OYOZdTfWElle+g==
```

Downloaded on 2026-09-30. Files are unmodified upstream distribution files.
Only the simulator runtime dependency closure is included: the WebGL build and
its core, BufferGeometryUtils, and the dependencies of GTAO, bloom, output and
SMAA postprocessing passes. Import paths mirror the upstream package.

The simulator import map resolves `three` and `three/addons/` here, so bundled
maps can start without reaching a third-party CDN. No package installation or
build step is needed.
