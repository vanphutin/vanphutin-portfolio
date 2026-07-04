// Force scroll to top on refresh/load
if (history.scrollRestoration) {
  history.scrollRestoration = "manual";
}
window.scrollTo(0, 0);

const canvas = document.querySelector("#heartCanvas");
const cursorLight = document.querySelector(".cursor-light");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const pointer = { x: 0, y: 0 };
let targetRotationX = 0;
let targetRotationY = 0;
let gyroRotationX = 0;
let gyroRotationY = 0;

let width = window.innerWidth;
let height = window.innerHeight;

// --- Three.js Setup ---
let scene, camera, renderer, heartPoints, material, clock;
let orbitGroup;

const palette = [
  new THREE.Color(0.40, 0.97, 1.00), // cyan #67f7ff
  new THREE.Color(0.45, 0.65, 1.00), // blue #73a7ff
  new THREE.Color(0.76, 0.94, 1.00), // soft ice #c2f0ff
  new THREE.Color(0.78, 0.65, 1.00), // violet #c6a7ff
  new THREE.Color(1.00, 0.31, 0.57), // pink #ff4f91
];

// GSAP Animatable parameters
const heartParams = {
  scale: 1.0,
  opacity: 1.0,
  assemble: prefersReducedMotion ? 1.0 : 0.0,
  xOffset: 0,
  yOffset: 0,
  rotationY: 0
};

// ---------- Vertex Shader ----------
const vertexShader = `
  uniform float uTime;
  uniform float uSizeMultiplier;
  uniform float uScale;
  uniform float uAssembleProgress;
  uniform vec2 uPointer;
  uniform float uHoverActive;
  attribute float aSize;
  attribute vec3 aStartPosition;
  attribute float aDelay;
  attribute float aStream;
  attribute float aTurbulence;
  varying vec3 vColor;
  varying float vTwinkle;
  varying float vFlowAlpha;
  varying float vGlow;

  void main() {
    vColor = color;

    float activeWindow = max(0.22, 1.0 - aDelay);
    float progress = clamp((uAssembleProgress - aDelay) / activeWindow, 0.0, 1.0);
    float easedProgress = progress * progress * (3.0 - 2.0 * progress);

    vec3 flowPosition = mix(aStartPosition, position, easedProgress);

    // Interactive mouse repulsion in 3D space
    if (uHoverActive > 0.5 && easedProgress > 0.1) {
      // Map WebGL normalized mouse to 3D heart coordinate region
      vec3 mouse3D = vec3(uPointer.x * 18.0, uPointer.y * 11.0, 0.0);
      float distToMouse = distance(flowPosition, mouse3D);
      if (distToMouse < 6.8) {
        float force = (6.8 - distToMouse) / 6.8;
        vec3 pushDir = normalize(flowPosition - mouse3D);
        // Push particles slightly outwards
        flowPosition += pushDir * force * 1.8 * uHoverActive * easedProgress;
      }
    }

    float drift = 1.0 - easedProgress;
    float sprayAngle = aStream * 6.2831853;
    float sprayPower = 0.6 + 0.4 * sin(aStream * 24.0);
    float fountainArc = sin(progress * 3.1415926);
    float launchWindow = smoothstep(0.01, 0.12, progress) * (1.0 - smoothstep(0.55, 0.92, progress));
    float jetPulse = 0.8 + 0.2 * sin(uTime * 14.0 + aStream * 22.0);

    flowPosition.x += cos(sprayAngle) * fountainArc * launchWindow * (2.6 + sprayPower * 3.8) * aTurbulence;
    flowPosition.y += fountainArc * launchWindow * jetPulse * (6.4 + sprayPower * 5.6);
    flowPosition.z += sin(sprayAngle) * fountainArc * launchWindow * (1.8 + sprayPower * 2.8) * aTurbulence;

    float turbFreq = aTurbulence * 1.2;
    flowPosition.x += sin(uTime * 3.2 + aStream * 11.0) * 0.9 * drift * turbFreq;
    flowPosition.y += sin(uTime * 4.8 + aStream * 15.0) * 0.35 * drift * turbFreq;
    flowPosition.z += cos(uTime * 2.8 + aStream * 9.0) * 0.7 * drift * turbFreq;

    vTwinkle = 0.65 + 0.35 * sin(uTime * 2.8 + position.x * 0.3 + position.y * 0.22);

    float lockGlow = smoothstep(0.75, 1.0, easedProgress);
    vGlow = 1.0 + lockGlow * 0.6;

    vFlowAlpha = mix(0.55, 1.0, easedProgress) + launchWindow * 0.22;

    vec4 mvPosition = modelViewMatrix * vec4(flowPosition, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uSizeMultiplier * (360.0 / -mvPosition.z) * (0.78 + 0.22 * vTwinkle) * uScale * vGlow;
  }
`;

// ---------- Fragment Shader ----------
const fragmentShader = `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vTwinkle;
  varying float vFlowAlpha;
  varying float vGlow;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    if (dist > 0.5) discard;

    float core = smoothstep(0.5, 0.08, dist);
    float halo = smoothstep(0.5, 0.0, dist) * 0.4;
    float alpha = core + halo;

    gl_FragColor = vec4(vColor * vGlow, alpha * vTwinkle * vFlowAlpha * uOpacity * 0.48);
  }
`;

// ---------- Ring Shaders ----------
const ringVertexShader = `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSizeMultiplier;
  attribute float aAngle;
  varying vec3 vColor;
  uniform vec3 uColor;

  void main() {
    vColor = uColor;
    vec3 pos = position;
    
    // Wave displacement based on time and angle
    pos.y += sin(uTime * 2.2 + aAngle * 4.0) * 0.8;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSizeMultiplier * (300.0 / -mvPosition.z);
  }
`;

const ringFragmentShader = `
  uniform float uOpacity;
  varying vec3 vColor;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    if (dist > 0.5) discard;
    
    float intensity = smoothstep(0.5, 0.05, dist);
    gl_FragColor = vec4(vColor, intensity * uOpacity * 0.7);
  }
`;

function getCameraDistance() {
  return width < 768 ? 64 : 44;
}

function getHeartShapeScale() {
  return width < 768 ? 0.46 : 0.64;
}

function getHeartYOffset() {
  return width < 768 ? 6.5 : 4.4;
}

function getPointSizeMultiplier(dpr) {
  if (width < 768) {
    return dpr > 1 ? 3.8 : 5.2;
  }
  return dpr > 1 ? 3.4 : 4.8;
}

function initThree() {
  clock = new THREE.Clock();
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.z = getCameraDistance();

  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance"
  });

  updateRendererSize();

  const particleCount = width < 768 ? 1600 : 4200;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const startPositions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const delays = new Float32Array(particleCount);
  const streams = new Float32Array(particleCount);
  const turbulences = new Float32Array(particleCount);
  const shapeScale = getHeartShapeScale();
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < particleCount; i++) {
    const theta = Math.random() * Math.PI;
    const phi = Math.random() * Math.PI * 2;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const rx = 16 * (sinTheta ** 3);
    const ry = 13 * cosTheta - 5 * Math.cos(2 * theta) - 2 * Math.cos(3 * theta) - Math.cos(4 * theta);
    const r = 0.58 + 0.42 * Math.pow(Math.random(), 0.5);

    let x = rx * Math.cos(phi) * r * shapeScale;
    let z = rx * Math.sin(phi) * r * 0.58 * shapeScale;
    let y = (ry * r + 2.5) * shapeScale;

    const notchStrength = Math.max(0, cosTheta) * (1.0 - Math.abs(Math.cos(phi))) * 1.2;
    y += notchStrength * shapeScale;

    x += (Math.random() - 0.5) * 0.38;
    y += (Math.random() - 0.5) * 0.38;
    z += (Math.random() - 0.5) * 0.38;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    const color = palette[Math.floor(Math.random() * palette.length)];
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    sizes[i] = Math.random() * 0.38 + 0.14;
    streams[i] = Math.random();
    turbulences[i] = 0.6 + Math.random() * 0.8;
  }

  const flowFloor = minY - (width < 768 ? 34 : 30);
  const yRange = Math.max(1, maxY - minY);
  const spawnSpreadX = width < 768 ? 3.2 : 5.0;
  const spawnSpreadZ = width < 768 ? 2.0 : 3.5;

  for (let i = 0; i < particleCount; i++) {
    const y = positions[i * 3 + 1];
    const verticalProgress = (y - minY) / yRange;
    const streamVal = streams[i];

    const angle = streamVal * Math.PI * 2;
    const radius = Math.pow(Math.random(), 0.7) * spawnSpreadX;
    startPositions[i * 3] = Math.cos(angle) * radius;
    startPositions[i * 3 + 1] = flowFloor - Math.random() * 12 - verticalProgress * 5;
    startPositions[i * 3 + 2] = Math.sin(angle) * radius * (spawnSpreadZ / spawnSpreadX);

    delays[i] = Math.min(0.82, verticalProgress * 0.62 + Math.random() * 0.16);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aStartPosition', new THREE.BufferAttribute(startPositions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aDelay', new THREE.BufferAttribute(delays, 1));
  geometry.setAttribute('aStream', new THREE.BufferAttribute(streams, 1));
  geometry.setAttribute('aTurbulence', new THREE.BufferAttribute(turbulences, 1));

  material = new THREE.ShaderMaterial({
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1.0 },
      uSizeMultiplier: { value: getPointSizeMultiplier(Math.min(window.devicePixelRatio || 1, 2)) },
      uScale: { value: 1.0 },
      uAssembleProgress: { value: heartParams.assemble },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uHoverActive: { value: 0.0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true
  });

  heartPoints = new THREE.Points(geometry, material);
  scene.add(heartPoints);

  // Tech orbit rings (particle-based)
  orbitGroup = new THREE.Group();
  
  const ring1Geom = new THREE.BufferGeometry();
  const ring2Geom = new THREE.BufferGeometry();
  
  const ring1ParticlesCount = width < 768 ? 150 : 350;
  const ring2ParticlesCount = width < 768 ? 120 : 280;
  
  const ring1Positions = new Float32Array(ring1ParticlesCount * 3);
  const ring2Positions = new Float32Array(ring2ParticlesCount * 3);
  const ring1Angles = new Float32Array(ring1ParticlesCount);
  const ring2Angles = new Float32Array(ring2ParticlesCount);
  
  const ringRadius = 15.0;
  
  for (let i = 0; i < ring1ParticlesCount; i++) {
    const angle = (i / ring1ParticlesCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.02;
    ring1Angles[i] = angle;
    const jitterRadius = ringRadius + (Math.random() - 0.5) * 0.8;
    const x = Math.cos(angle) * jitterRadius;
    const z = Math.sin(angle) * jitterRadius;
    const y = (Math.random() - 0.5) * 0.4;
    ring1Positions[i * 3] = x;
    ring1Positions[i * 3 + 1] = y;
    ring1Positions[i * 3 + 2] = z;
  }
  
  for (let i = 0; i < ring2ParticlesCount; i++) {
    const angle = (i / ring2ParticlesCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.02;
    ring2Angles[i] = angle;
    const jitterRadius = ringRadius + (Math.random() - 0.5) * 0.8;
    const x = Math.cos(angle) * jitterRadius;
    const z = Math.sin(angle) * jitterRadius;
    const y = (Math.random() - 0.5) * 0.4;
    ring2Positions[i * 3] = x;
    ring2Positions[i * 3 + 1] = y;
    ring2Positions[i * 3 + 2] = z;
  }
  
  ring1Geom.setAttribute('position', new THREE.BufferAttribute(ring1Positions, 3));
  ring2Geom.setAttribute('position', new THREE.BufferAttribute(ring2Positions, 3));
  ring1Geom.setAttribute('aAngle', new THREE.BufferAttribute(ring1Angles, 1));
  ring2Geom.setAttribute('aAngle', new THREE.BufferAttribute(ring2Angles, 1));
  
  const ring1Mat = new THREE.ShaderMaterial({
    vertexShader: ringVertexShader,
    fragmentShader: ringFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.0 },
      uColor: { value: new THREE.Color(0x22d3ee) },
      uSizeMultiplier: { value: width < 768 ? 2.2 : 3.2 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  ring1Mat.userData.baseOpacity = width < 768 ? 0.08 : 0.15;
  
  const ring2Mat = new THREE.ShaderMaterial({
    vertexShader: ringVertexShader,
    fragmentShader: ringFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.0 },
      uColor: { value: new THREE.Color(0xec4899) },
      uSizeMultiplier: { value: width < 768 ? 2.2 : 3.2 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  ring2Mat.userData.baseOpacity = width < 768 ? 0.06 : 0.12;
  
  const ring1Points = new THREE.Points(ring1Geom, ring1Mat);
  ring1Points.rotation.x = Math.PI / 2.3;
  ring1Points.rotation.y = 0.2;
  orbitGroup.add(ring1Points);
  
  const ring2Points = new THREE.Points(ring2Geom, ring2Mat);
  ring2Points.rotation.x = Math.PI / -2.4;
  ring2Points.rotation.y = -0.3;
  orbitGroup.add(ring2Points);
  
  scene.add(orbitGroup);
  animate();
}

function updateRendererSize() {
  width = window.innerWidth;
  height = window.innerHeight;
  camera.aspect = width / height;
  camera.position.z = getCameraDistance();
  camera.updateProjectionMatrix();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setSize(width, height);
  renderer.setPixelRatio(dpr);
  if (material) {
    material.uniforms.uSizeMultiplier.value = getPointSizeMultiplier(dpr);
  }
  if (orbitGroup) {
    orbitGroup.children.forEach((points) => {
      if (points.material && points.material.uniforms) {
        points.material.uniforms.uSizeMultiplier.value = width < 768 ? 2.2 : 3.2;
      }
    });
  }
}

function animate() {
  requestAnimationFrame(animate);
  const time = clock.getElapsedTime();

  // Subtle heartbeat pulse
  const pulseScale = heartParams.scale * (1.0 + Math.sin(time * 2.8) * 0.015);

  if (material) {
    material.uniforms.uTime.value = time;
    material.uniforms.uOpacity.value = heartParams.opacity;
    material.uniforms.uScale.value = pulseScale;
    material.uniforms.uAssembleProgress.value = heartParams.assemble;
  }

  if (heartPoints) {
    const targetYRot = time * 0.14 + targetRotationY + gyroRotationY + heartParams.rotationY;
    const targetXRot = Math.sin(time * 0.22) * 0.08 + targetRotationX + gyroRotationX;
    heartPoints.rotation.y += (targetYRot - heartPoints.rotation.y) * 0.05;
    heartPoints.rotation.x += (targetXRot - heartPoints.rotation.x) * 0.05;
    heartPoints.position.x = heartParams.xOffset;
    heartPoints.position.y = heartParams.yOffset + getHeartYOffset();
  }

  if (orbitGroup) {
    const ringReveal = Math.max(0, Math.min(1, (heartParams.assemble - 0.72) / 0.28));
    orbitGroup.children.forEach((points) => {
      if (points.material && points.material.uniforms) {
        points.material.uniforms.uTime.value = time;
        points.material.uniforms.uOpacity.value = points.material.userData.baseOpacity * ringReveal * heartParams.opacity;
      }
    });
    orbitGroup.rotation.z = time * 0.06;
    orbitGroup.rotation.y = Math.sin(time * 0.1) * 0.2;
    orbitGroup.position.x = heartPoints.position.x;
    orbitGroup.position.y = heartPoints.position.y;
    orbitGroup.scale.setScalar(pulseScale);
  }

  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  updateRendererSize();
  resizeDustCanvas();
});

// Pointer light tracking, interactive tilting, 3D repulsion, and spotlight mask
window.addEventListener("pointermove", (event) => {
  pointer.x = event.clientX;
  pointer.y = event.clientY;

  if (cursorLight) {
    cursorLight.style.left = `${pointer.x}px`;
    cursorLight.style.top = `${pointer.y}px`;
    cursorLight.style.opacity = "1";
  }

  // Update spotlight reveal overlay
  const revealMask = document.querySelector(".reveal-mask");
  if (revealMask) {
    revealMask.style.setProperty("--mouse-x", `${pointer.x}px`);
    revealMask.style.setProperty("--mouse-y", `${pointer.y}px`);
    revealMask.style.opacity = "1";
  }

  const nx = (pointer.x / width) - 0.5;
  const ny = (pointer.y / height) - 0.5;
  targetRotationY = nx * 0.35;
  targetRotationX = ny * 0.25;

  if (material) {
    // Map screen cursor coords to WebGL coordinates (-1 to 1)
    const webglX = (pointer.x / width) * 2 - 1;
    const webglY = -(pointer.y / height) * 2 + 1;
    material.uniforms.uPointer.value.set(webglX, webglY);
    material.uniforms.uHoverActive.value = 1.0;
  }
});

window.addEventListener("pointerleave", () => {
  if (cursorLight) {
    cursorLight.style.opacity = "0";
  }
  
  const revealMask = document.querySelector(".reveal-mask");
  if (revealMask) {
    revealMask.style.opacity = "0";
  }

  targetRotationX = 0;
  targetRotationY = 0;

  if (material) {
    material.uniforms.uHoverActive.value = 0.0;
  }
});

// =============================================
// Text Scramble Effect
// =============================================
class TextScramble {
  constructor(el, speedMultiplier = 1) {
    this.el = el;
    this.chars = '!<>-_\\/[]{}—=+*^?#________';
    this.speedMultiplier = speedMultiplier;
    this.update = this.update.bind(this);
  }
  setText(newText) {
    const oldText = this.el.innerText;
    const length = Math.max(oldText.length, newText.length);
    const promise = new Promise((resolve) => this.resolve = resolve);
    this.queue = [];
    for (let i = 0; i < length; i++) {
      const from = oldText[i] || '';
      const to = newText[i] || '';
      const start = Math.floor(Math.random() * 15 * this.speedMultiplier);
      const end = start + Math.floor(Math.random() * 15 * this.speedMultiplier);
      this.queue.push({ from, to, start, end });
    }
    cancelAnimationFrame(this.frameRequest);
    this.frame = 0;
    this.update();
    return promise;
  }
  update() {
    let output = '';
    let complete = 0;
    for (let i = 0, n = this.queue.length; i < n; i++) {
      let { from, to, start, end, char } = this.queue[i];
      if (this.frame >= end) {
        complete++;
        output += to;
      } else if (this.frame >= start) {
        if (!char || Math.random() < 0.28) {
          char = this.randomChar();
          this.queue[i].char = char;
        }
        output += `<span style="opacity: 0.55; color: var(--cyan);">${char}</span>`;
      } else {
        output += from;
      }
    }
    this.el.innerHTML = output;
    if (complete === this.queue.length) {
      this.resolve();
    } else {
      this.frameRequest = requestAnimationFrame(this.update);
      this.frame++;
    }
  }
  randomChar() {
    return this.chars[Math.floor(Math.random() * this.chars.length)];
  }
}

// =============================================
// Role Rotator — Text Scramble Cycle
// =============================================
const roles = [
  "Fullstack Software Engineer"
];

let currentRoleIndex = 0;
let roleRotatorStarted = false;
let scramblerInstance = null;
let titleScramblerInstance = null;

function getTitleScrambler() {
  const titleEl = document.querySelector(".cinematic-title");
  if (!titleEl) return null;
  if (!titleScramblerInstance) {
    titleScramblerInstance = new TextScramble(titleEl);
  }
  return titleScramblerInstance;
}

function initRoleRotator() {
  const roleEl = document.querySelector(".role-text");
  if (!roleEl) return;

  roleRotatorStarted = true;
  scramblerInstance = new TextScramble(roleEl);

  if (roles.length > 1) {
    // Cycle roles every 3.5 seconds with text scramble decoding
    setInterval(() => {
      currentRoleIndex = (currentRoleIndex + 1) % roles.length;
      scramblerInstance.setText(roles[currentRoleIndex]);
    }, 3500);
  }
}

// =============================================
// Looping Animation (Heart and Text)
// =============================================
function startLoopingAnimation() {
  const loopTl = gsap.timeline({ repeat: -1, repeatDelay: 6 }); // loops infinitely with a 6-second delay between cycles

  // 1. Disassemble the heart (melt back into flowing streams)
  loopTl.to(heartParams, {
    assemble: 0,
    opacity: 0.22,
    scale: 0.85,
    duration: 1.5,
    ease: "power2.inOut",
    onStart: () => {
      const scrambler = getTitleScrambler();
      if (scrambler) {
        scrambler.speedMultiplier = 0.4;
        scrambler.setText("_______ __ _________");
      }
    }
  });

  // Pause in disassembled state
  loopTl.to({}, { duration: 1.0 });

  // 2. Reassemble the heart
  loopTl.to(heartParams, {
    assemble: 1,
    opacity: 0.78,
    scale: 0.90,
    duration: 1.8,
    ease: "power2.out",
    onStart: () => {
      const scrambler = getTitleScrambler();
      if (scrambler) {
        scrambler.speedMultiplier = 0.5;
        scrambler.setText("Welcome to VanPhuTin");
      }
    }
  });
}

// =============================================
// Entrance Animation
// =============================================
function runEntranceAnimation() {
  if (typeof gsap === "undefined") return;

  const tl = gsap.timeline();

  // Hide elements initially
  gsap.set([".cinematic-title", ".role-rotator", ".intro-subtext"], { opacity: 0 });
  gsap.set(".intro-actions a", { opacity: 0, y: 20 });

  if (prefersReducedMotion) {
    gsap.set(heartParams, { assemble: 1, opacity: 0.66, scale: 0.82 });
    gsap.set(".ambient-glow", { opacity: 0.12, scale: 1 });
    gsap.set([".cinematic-title", ".role-rotator", ".intro-subtext"], { opacity: 1, y: 0 });
    gsap.set(".intro-actions a", { opacity: 1, y: 0 });
    initRoleRotator();
    return;
  }

  gsap.set(heartParams, { assemble: 0, opacity: 0.22, scale: 0.85 });

  // 1. Background glow
  tl.fromTo(".ambient-glow",
    { opacity: 0, scale: 0.8 },
    { opacity: 0.15, scale: 1, duration: 1.2, ease: "power2.out" }
  );

  // 2. Heart waterfall assembly (Sped up from 4.0s to 1.8s)
  tl.to(heartParams, {
    assemble: 1,
    opacity: 0.78,
    scale: 0.90,
    duration: 1.8,
    ease: "power2.out"
  }, 0.1);

  // 3. Title reveal with decode text scramble reveal (Sped up)
  tl.fromTo(".cinematic-title",
    { y: 60, opacity: 0 },
    { 
      y: 0, 
      opacity: 1, 
      duration: 0.8, 
      ease: "power3.out",
      onStart: () => {
        const scrambler = getTitleScrambler();
        if (scrambler) {
          scrambler.speedMultiplier = 0.5;
          scrambler.setText("Welcome to VanPhuTin");
        }
      }
    },
    "-=1.2"
  );

  // 4. Role rotator reveal
  tl.fromTo(".role-rotator",
    { y: 30, opacity: 0 },
    {
      y: 0, opacity: 1, duration: 0.6, ease: "power2.out",
      onComplete: () => {
        if (!roleRotatorStarted) initRoleRotator();
      }
    },
    "-=0.5"
  );

  // 5. Subtext reveal
  tl.fromTo(".intro-subtext",
    { y: 20, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.5, ease: "power2.out" },
    "-=0.4"
  );

  // 6. Action buttons staggered reveal
  tl.fromTo(".intro-actions a",
    { y: 20, opacity: 0 },
    { 
      y: 0, 
      opacity: 1, 
      stagger: 0.1, 
      duration: 0.5, 
      ease: "power2.out",
      onComplete: () => {
        startLoopingAnimation();
      }
    },
    "-=0.3"
  );
}

// =============================================
// Preloader with Text Scramble Loop
// =============================================
let preloaderInterval = null;
function startPreloader() {
  const preloader = document.getElementById("preloader");
  const loaderText = document.querySelector(".loader-text");

  if (!preloader) {
    runEntranceAnimation();
    return;
  }

  // Scramble the preloader loading text dynamically and quickly
  if (loaderText) {
    const loaderScrambler = new TextScramble(loaderText, 0.4);
    let count = 0;
    const phrases = [
      "vanphutin loading... 🌸",
      "vanphutin loading... 💫",
      "vanphutin loading... ✨",
      "vanphutin loading... 🚀"
    ];
    preloaderInterval = setInterval(() => {
      count = (count + 1) % phrases.length;
      loaderScrambler.setText(phrases[count]);
    }, 350);
  }

  // Fade out loading screen quickly after a short delay (fast load, reduced delay from 1.4s to 1.0s)
  gsap.to(preloader, {
    opacity: 0,
    duration: 0.4,
    delay: 1.0,
    ease: "power2.out",
    onComplete: () => {
      if (preloaderInterval) clearInterval(preloaderInterval);
      preloader.style.visibility = "hidden";
      runEntranceAnimation();
    }
  });
}

// =============================================
// Parallax 2D Dust Layer
// =============================================
let dustCanvas, dustCtx;
let dustParticles = [];
const maxDust = 50;

function initDustCanvas() {
  dustCanvas = document.getElementById("dustCanvas");
  if (!dustCanvas) return;
  dustCtx = dustCanvas.getContext("2d");
  resizeDustCanvas();

  dustParticles = [];
  for (let i = 0; i < maxDust; i++) {
    dustParticles.push({
      x: Math.random() * dustCanvas.width,
      y: Math.random() * dustCanvas.height,
      size: Math.random() * 1.6 + 0.6,
      speedX: (Math.random() - 0.5) * 0.16,
      speedY: (Math.random() - 0.5) * 0.16 - 0.08, // Slow drift up
      alpha: Math.random() * 0.45 + 0.12,
      depth: Math.random() * 0.68 + 0.32
    });
  }

  animateDust();
}

function resizeDustCanvas() {
  if (dustCanvas) {
    dustCanvas.width = window.innerWidth;
    dustCanvas.height = window.innerHeight;
  }
}

function animateDust() {
  if (!dustCanvas || !dustCtx) return;
  requestAnimationFrame(animateDust);

  dustCtx.clearRect(0, 0, dustCanvas.width, dustCanvas.height);

  // Parallax calculations based on pointer offset or gyroscope tilt
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const hasFinePointer = window.matchMedia("(pointer: fine)").matches;
  
  let offsetX, offsetY;
  if (hasFinePointer) {
    offsetX = (pointer.x - centerX) * 0.022;
    offsetY = (pointer.y - centerY) * 0.022;
  } else {
    // Gyroscope tilt parallax for mobile
    offsetX = gyroRotationY * 30.0;
    offsetY = gyroRotationX * 30.0;
  }

  dustParticles.forEach((p) => {
    p.x += p.speedX;
    p.y += p.speedY;

    if (p.x < 0) p.x = dustCanvas.width;
    if (p.x > dustCanvas.width) p.x = 0;
    if (p.y < 0) p.y = dustCanvas.height;
    if (p.y > dustCanvas.height) p.y = dustCanvas.height;

    const renderX = p.x + offsetX * p.depth;
    const renderY = p.y + offsetY * p.depth;

    dustCtx.beginPath();
    dustCtx.arc(renderX, renderY, p.size, 0, Math.PI * 2);
    dustCtx.fillStyle = `rgba(34, 211, 238, ${p.alpha})`; // Cyan soft tint
    dustCtx.shadowBlur = 4;
    dustCtx.shadowColor = "#22d3ee";
    dustCtx.fill();
    dustCtx.shadowBlur = 0; // Reset shadow for draw call performance
  });
}

// =============================================
// Custom Cursor Tracker (Dot + Ring)
// =============================================
function initCustomCursor() {
  const hasFinePointer = window.matchMedia("(pointer: fine)").matches;
  if (!hasFinePointer) return;

  const dot = document.querySelector(".custom-cursor-dot");
  const ring = document.querySelector(".custom-cursor-ring");
  if (!dot || !ring) return;

  // Initial offscreen state
  gsap.set([dot, ring], { xPercent: -50, yPercent: -50, x: -100, y: -100 });

  // Use quickTo for sub-pixel precision and buttery smooth performance
  const dotX = gsap.quickTo(dot, "x", { duration: 0.08, ease: "power3.out" });
  const dotY = gsap.quickTo(dot, "y", { duration: 0.08, ease: "power3.out" });
  const ringX = gsap.quickTo(ring, "x", { duration: 0.35, ease: "power2.out" });
  const ringY = gsap.quickTo(ring, "y", { duration: 0.35, ease: "power2.out" });

  window.addEventListener("mousemove", (e) => {
    dotX(e.clientX);
    dotY(e.clientY);
    ringX(e.clientX);
    ringY(e.clientY);
  });

  // Attach hover styles to links and interactive components
  const hoverables = document.querySelectorAll("a, button, [role='button'], .primary-action, .secondary-action, .cta-action");
  hoverables.forEach((el) => {
    el.addEventListener("mouseenter", () => ring.classList.add("hovered"));
    el.addEventListener("mouseleave", () => ring.classList.remove("hovered"));
  });

  // Active click scaling
  window.addEventListener("mousedown", () => ring.classList.add("clicked"));
  window.addEventListener("mouseup", () => ring.classList.remove("clicked"));
}

// --- Boot ---
initThree();

window.addEventListener("load", () => {
  initDustCanvas();
  initCustomCursor();
  startPreloader();
});

// Gyroscope orientation tracking for mobile 3D tilt effect
window.addEventListener("deviceorientation", (event) => {
  if (event.beta !== null && event.gamma !== null) {
    // Standard holding tilt ranges
    const betaBias = 50; 
    const deltaBeta = event.beta - betaBias;
    const deltaGamma = event.gamma;

    // Clamp values to prevent extreme rotations
    const clampBeta = Math.min(Math.max(deltaBeta, -25), 25);
    const clampGamma = Math.min(Math.max(deltaGamma, -25), 25);

    // Scale down for a subtle parallax effect
    const targetGyroX = clampBeta * 0.005;
    const targetGyroY = clampGamma * 0.005;

    // Smooth lerp interpolation
    gyroRotationX += (targetGyroX - gyroRotationX) * 0.08;
    gyroRotationY += (targetGyroY - gyroRotationY) * 0.08;
  }
});
