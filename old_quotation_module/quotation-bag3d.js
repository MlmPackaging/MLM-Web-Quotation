let scene, camera, renderer, controls;
let bagGroup;
let cameraTarget = null;
let cameraAnimationStart = null;
let textLabels = [];

const SCALE = 2.5;
const BLUE  = 0x2563eb;
const GREEN = 0x16a34a;
const RED   = 0xdc2626;

// ─── INIT ────────────────────────────────────────────────────────────────────

function init() {
  const container = document.getElementById('bag-container');
  if (!container) { console.warn('bag-container not found'); return; }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  const W = container.clientWidth || 800;
  const H = 480;

  camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 1000);
  camera.position.set(1, 1.2, 1.3);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(W, H);
  container.appendChild(renderer.domElement);

  // Try OrbitControls (may or may not be available depending on CDN load order)
  const OC = (typeof THREE !== 'undefined' && THREE.OrbitControls)
           ? THREE.OrbitControls
           : (typeof OrbitControls !== 'undefined' ? OrbitControls : null);

  if (OC) {
    controls = new OC(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom    = true;
    controls.enablePan     = true;
    controls.target.set(0, 0, 0);
    controls.update();
    controls.addEventListener('start', () => {
      cameraTarget         = null;
      cameraAnimationStart = null;
    });
    console.log('OrbitControls initialised');
  } else {
    // Fallback: manual mouse drag + scroll controls
    console.warn('OrbitControls not found — using built-in fallback controls');
    initFallbackControls(renderer.domElement);
  }

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 8, 4);
  scene.add(dirLight);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  bagGroup = new THREE.Group();
  scene.add(bagGroup);

  animate();
  updateFromForm();
}

// ─── FALLBACK CONTROLS ───────────────────────────────────────────────────────
// Simple spherical orbit + scroll-to-zoom when OrbitControls isn't available.

function initFallbackControls(el) {
  let isDragging = false;
  let lastX = 0, lastY = 0;

  // Spherical coords for the camera
  const spherical = { r: 1.95, theta: Math.atan2(1, 1.3), phi: Math.acos(1.2 / 1.95) };

  function updateCameraFromSpherical() {
    camera.position.set(
      spherical.r * Math.sin(spherical.phi) * Math.sin(spherical.theta),
      spherical.r * Math.cos(spherical.phi),
      spherical.r * Math.sin(spherical.phi) * Math.cos(spherical.theta)
    );
    camera.lookAt(0, 0, 0);
  }

  el.addEventListener('mousedown', e => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    // Cancel button animation on drag
    cameraTarget = null;
    cameraAnimationStart = null;
  });

  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    spherical.theta -= dx * 0.005;
    spherical.phi   = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi - dy * 0.005));
    updateCameraFromSpherical();
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  el.addEventListener('wheel', e => {
    e.preventDefault();
    spherical.r = Math.max(0.5, Math.min(8, spherical.r + e.deltaY * 0.002));
    updateCameraFromSpherical();
  }, { passive: false });

  // Touch support
  let lastTouchDist = null;
  el.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      isDragging = true;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
      cameraTarget = null;
      cameraAnimationStart = null;
    } else if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  });

  el.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging) {
      const dx = e.touches[0].clientX - lastX;
      const dy = e.touches[0].clientY - lastY;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
      spherical.theta -= dx * 0.005;
      spherical.phi   = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi - dy * 0.005));
      updateCameraFromSpherical();
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastTouchDist) {
        spherical.r = Math.max(0.5, Math.min(8, spherical.r - (dist - lastTouchDist) * 0.005));
        updateCameraFromSpherical();
      }
      lastTouchDist = dist;
    }
  }, { passive: false });

  el.addEventListener('touchend', () => { isDragging = false; lastTouchDist = null; });

  // Override setCameraView to update spherical coords too so button views work
  const _orig = setCameraView;
  window._updateSphericalFromCamera = function() {
    const p = camera.position;
    spherical.r     = p.length();
    spherical.phi   = Math.acos(Math.max(-1, Math.min(1, p.y / spherical.r)));
    spherical.theta = Math.atan2(p.x, p.z);
  };
}

// ─── RENDER LOOP ─────────────────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);

  if (cameraTarget && cameraAnimationStart) {
    const elapsed  = Date.now() - cameraAnimationStart.time;
    const t        = Math.min(elapsed / 600, 1);
    const ease     = t * t * (3 - 2 * t);

    camera.position.lerpVectors(cameraAnimationStart.startPos, cameraTarget, ease);
    camera.lookAt(0, 0, 0);

    if (t >= 1) {
      camera.position.copy(cameraTarget);
      camera.lookAt(0, 0, 0);
      if (controls) { controls.target.set(0, 0, 0); controls.update(); }
      // Sync fallback spherical coords so drag continues from new position
      if (window._updateSphericalFromCamera) window._updateSphericalFromCamera();
      cameraTarget         = null;
      cameraAnimationStart = null;
    }
  }

  // Billboard — copy camera quaternion so labels always face viewer, always upright
  textLabels.forEach(label => label.quaternion.copy(camera.quaternion));

  if (controls) controls.update();
  renderer.render(scene, camera);
}

// ─── GEOMETRY HELPERS ────────────────────────────────────────────────────────

function createWireBox(W, H, G) {
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, G));
  return new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: BLUE }));
}

function createDimensionLine(size, axis, color) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(
      axis === 'x' ? size : 0.002,
      axis === 'y' ? size : 0.002,
      axis === 'z' ? size : 0.002
    ),
    new THREE.MeshBasicMaterial({ color })
  );
}

function createTextSprite(text, hexColor) {
  const cw = 300, ch = 60;
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  ctx.font         = 'Bold 22px Arial';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  // White halo stroke for legibility
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth   = 5;
  ctx.lineJoin    = 'round';
  ctx.strokeText(text, cw / 2, ch / 2);
  ctx.fillStyle = hexColor;
  ctx.fillText(text, cw / 2, ch / 2);
  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.22),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
  );
}

// ─── BAG BUILDER ─────────────────────────────────────────────────────────────

function updateBag(form) {
  while (bagGroup.children.length) bagGroup.remove(bagGroup.children[0]);
  textLabels = [];

  const W = (form.width  || 150) / 1000;
  const H = (form.height || 250) / 1000;
  const G = (form.gusset || 100) / 1000;

  const box = createWireBox(W, H, G);
  box.scale.setScalar(SCALE);
  bagGroup.add(box);

  if (form.foilEnabled) {
    const foil = new THREE.Mesh(
      new THREE.PlaneGeometry((form.foilWidth || 50) / 1000, (form.foilHeight || 30) / 1000),
      new THREE.MeshBasicMaterial({ color: BLUE, wireframe: true })
    );
    foil.position.set(
      ((form.foilOffsetX || 0) / 1000) * SCALE,
      ((form.foilOffsetY || 0) / 1000) * SCALE,
      (G / 2 + 0.001) * SCALE
    );
    bagGroup.add(foil);
  }

  if (form.handlesEnabled !== false) {
    const hr = W * 0.22, ht = W * 0.035;
    const handleMat = new THREE.MeshBasicMaterial({ color: BLUE });

    // TorusGeometry with arc=PI is a semicircle in the XY plane by default:
    // the arch curves upward (+Y) and the two open ends sit at bottom-left
    // and bottom-right. This is EXACTLY the right shape when viewed from the
    // front — no rotation needed for orientation. We just rotate around Z by
    // PI so the open ends point downward (into the bag top) and the peak goes up.

    // Front handle — on the +Z face, arch faces viewer
    const frontHandle = new THREE.Mesh(new THREE.TorusGeometry(hr, ht, 16, 60, Math.PI), handleMat);
    frontHandle.position.set(0, (H / 2) * SCALE, (G / 2 + 0.002) * SCALE);
    frontHandle.rotation.set(0, 0, 0); // default orientation: arch curves upward
    bagGroup.add(frontHandle);

    // Back handle — on the -Z face, same orientation
    const backHandle = new THREE.Mesh(new THREE.TorusGeometry(hr, ht, 16, 60, Math.PI), handleMat);
    backHandle.position.set(0, (H / 2) * SCALE, (-G / 2 - 0.002) * SCALE);
    backHandle.rotation.set(0, 0, 0); // same: arch curves upward
    bagGroup.add(backHandle);
  }

  function addDim(size, axis, color, hex, lp, tp, labelText) {
    const line = createDimensionLine(size * SCALE, axis, color);
    line.position.set(lp[0] * SCALE, lp[1] * SCALE, lp[2] * SCALE);
    bagGroup.add(line);
    const lbl = createTextSprite(labelText, hex);
    lbl.position.set(tp[0] * SCALE, tp[1] * SCALE, tp[2] * SCALE);
    lbl.scale.setScalar(0.6);
    bagGroup.add(lbl);
    textLabels.push(lbl);
  }

  addDim(W,'x',BLUE, '#2563eb',[0,         -H/2-0.015, G/2],[0,         -H/2-0.08,  G/2],`Width (${form.width||150}mm)`);
  addDim(H,'y',GREEN,'#16a34a',[W/2+0.02,  0,          G/2],[W/2+0.12,  0,          G/2],`Height (${form.height||250}mm)`);
  addDim(G,'z',RED,  '#dc2626',[W/2+0.02, -H/2-0.015,  0  ],[W/2+0.12, -H/2-0.08,   0  ],`Gusset (${form.gusset||100}mm)`);
}

// ─── CAMERA VIEWS ────────────────────────────────────────────────────────────

function setCameraView(x, y, z) {
  cameraTarget = new THREE.Vector3(x, y, z);
  cameraAnimationStart = { time: Date.now(), startPos: camera.position.clone() };
}

// ─── FORM SYNC ───────────────────────────────────────────────────────────────

function updateFromForm() {
  updateBag({
    width:          Number(document.getElementById('width').value),
    height:         Number(document.getElementById('height').value),
    gusset:         Number(document.getElementById('gusset').value),
    foilEnabled:    document.getElementById('foil').checked,
    foilWidth:      Number(document.getElementById('foilWidth').value),
    foilHeight:     Number(document.getElementById('foilHeight').value),
    foilOffsetX:    Number(document.getElementById('foilOffsetX').value),
    foilOffsetY:    Number(document.getElementById('foilOffsetY').value),
    handlesEnabled: document.getElementById('handles').checked,
  });
}

// ─── BOOTSTRAP ───────────────────────────────────────────────────────────────

let _inited = false;

function tryInit() {
  if (_inited) return;
  const el = document.getElementById('bag-container');
  if (el && el.offsetParent !== null && el.clientWidth > 0) {
    _inited = true;
    init();
    attachListeners();
  } else {
    setTimeout(tryInit, 50);
  }
}

function attachListeners() {
  ['width','height','gusset','foilWidth','foilHeight','foilOffsetX','foilOffsetY']
    .forEach(id => document.getElementById(id).addEventListener('input', updateFromForm));
  ['foil','handles']
    .forEach(id => document.getElementById(id).addEventListener('change', updateFromForm));

  document.getElementById('btn-3d')   .addEventListener('click', () => setCameraView(1,   1.2, 1.3));
  document.getElementById('btn-top')  .addEventListener('click', () => setCameraView(0,   2,   0.01));
  document.getElementById('btn-front').addEventListener('click', () => setCameraView(0,   1,   2.3));
  document.getElementById('btn-side') .addEventListener('click', () => setCameraView(2.3, 1,   0));
}

document.addEventListener('DOMContentLoaded', tryInit);