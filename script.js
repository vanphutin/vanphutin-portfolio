// Force scroll to top on refresh/load to prevent layout overlap
if (history.scrollRestoration) {
  history.scrollRestoration = "manual";
}
window.scrollTo(0, 0);

const canvas = document.querySelector("#heartCanvas");
const ctx = canvas.getContext("2d", { alpha: true });
const cursorLight = document.querySelector(".cursor-light");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let mouseActive = false;

let width = 0;
let height = 0;
let dpr = 1;
let particles = [];
let sparks = [];
let rafId = 0;

const palette = [
  [103, 247, 255], // cyan
  [115, 167, 255], // blue
  [255, 255, 255], // white
  [198, 167, 255], // violet
  [255, 79, 145], // pink
];

// GSAP Animatable Heart parameters
const heartParams = {
  scaleMultiplier: 1.0,
  opacityMultiplier: 1.0,
  centerXOffset: 0, // 0 (center) to 1 (right 0.62)
  centerYOffset: 0,
  blurGlow: 0 // extra blur factor
};

// Pre-rendered offscreen canvases for glow particles
let glowSprites = [];

function preRenderGlows() {
  glowSprites = palette.map(([r, g, b]) => {
    const size = 64;
    const offscreen = document.createElement("canvas");
    offscreen.width = size;
    offscreen.height = size;
    const oCtx = offscreen.getContext("2d");
    
    const grad = oCtx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
    grad.addColorStop(0.12, `rgba(${r}, ${g}, ${b}, 0.9)`);
    grad.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, 0.3)`);
    grad.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.08)`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    
    oCtx.fillStyle = grad;
    oCtx.beginPath();
    oCtx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    oCtx.fill();
    
    return offscreen;
  });
}

function heartPoint(t) {
  const x = 16 * Math.sin(t) ** 3;
  const y =
    13 * Math.cos(t) -
    5 * Math.cos(2 * t) -
    2 * Math.cos(3 * t) -
    Math.cos(4 * t);

  return { x, y: -y };
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  createParticles();
}

function createParticles() {
  const isMobile = width < 920;
  const count = Math.floor(Math.min(isMobile ? 1200 : 2600, Math.max(800, width * height * 0.0016)));
  const scale = Math.min(width, height) * (width < 720 ? 0.012 : 0.016);
  
  // Set reference center (always centered at creation, dynamically offset in rendering)
  const centerX = width * 0.5;
  const centerY = height * (width < 920 ? 0.46 : 0.44);
  const depthScale = width < 720 ? 0.74 : 1;

  particles = Array.from({ length: count }, (_, index) => {
    const isDust = Math.random() < 0.16;
    const t = randomBetween(0, Math.PI * 2);
    const heart = heartPoint(t);
    const fill = Math.random() ** 0.56;
    const sidePush = randomBetween(-0.46, 0.46);
    const depth = randomBetween(-1, 1) * depthScale;
    const colorIndex = Math.floor(Math.random() * palette.length);
    const drift = randomBetween(0.25, 1.15);
    const targetX = centerX + heart.x * scale * fill + depth * 34 + sidePush * 18;
    const targetY = centerY + heart.y * scale * fill + depth * 18 + randomBetween(-7, 7);
    const startRadius = randomBetween(58, 118);

    return {
      index,
      isDust,
      startX: isDust ? randomBetween(0, width) : centerX + Math.cos(t) * startRadius,
      startY: isDust ? randomBetween(0, height) : height * 0.85 + Math.sin(t) * 22 + randomBetween(-18, 18),
      targetX: isDust ? 0 : targetX,
      targetY: isDust ? 0 : targetY,
      baseX: isDust ? 0 : targetX,
      baseY: isDust ? 0 : targetY,
      colorIndex,
      depth,
      phase: randomBetween(0, Math.PI * 2),
      orbit: randomBetween(0.8, 4.8),
      drift,
      size: (isDust ? randomBetween(0.3, 0.9) : randomBetween(0.58, 1.62)) + Math.abs(depth) * 0.34,
      opacity: isDust ? randomBetween(0.12, 0.38) : randomBetween(0.35, 0.95),
      delay: isDust ? 0 : (index / count) * 0.72 + Math.random() * 0.22,
      twinkle: randomBetween(0.4, 1.6),
      speedX: randomBetween(-0.08, 0.08),
      speedY: randomBetween(-0.05, -0.22),
    };
  });
}

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
}

function drawParticle(particle, time, progress, pulse, rotation) {
  let x, y, alpha;
  const isMobile = width < 920;

  // Calculate dynamic scroll offsets based on GSAP parameters
  // Desktop: heart drifts right. Mobile: heart stays centered
  const scrollOffsetX = isMobile ? 0 : (width * heartParams.centerXOffset * 0.12);
  const scrollOffsetY = isMobile ? 0 : (height * heartParams.centerYOffset * 0.02);

  if (particle.isDust) {
    x = particle.startX + particle.speedX * time * 50;
    y = particle.startY + particle.speedY * time * 50;
    x = (x % width + width) % width;
    y = (y % height + height) % height;

    const twinkle = 0.5 + Math.sin(time * particle.twinkle * 1.5 + particle.phase) * 0.5;
    alpha = particle.opacity * twinkle * heartParams.opacityMultiplier;
  } else {
    const appear = Math.max(0, Math.min(1, (progress - particle.delay) / 0.3));
    const eased = easeOutCubic(appear);
    
    // Scale heart geometry dynamically
    const currentScale = heartParams.scaleMultiplier;
    
    const rotateCenter = width * 0.5;
    const rotateX = (particle.baseX - rotateCenter) * currentScale;
    const rotateY = (particle.baseY - (height * (isMobile ? 0.46 : 0.44))) * currentScale;
    
    const zPush = Math.sin(rotation + particle.depth) * 30;
    
    const finalX =
      rotateCenter +
      rotateX * Math.cos(rotation) +
      zPush +
      Math.cos(time * 0.7 + particle.phase) * particle.orbit +
      scrollOffsetX;
      
    const finalY =
      (height * (isMobile ? 0.46 : 0.44)) +
      rotateY +
      Math.sin(time * 0.9 + particle.phase) * particle.orbit * 0.78 -
      pulse * 10 +
      scrollOffsetY;

    const startX = particle.startX + Math.cos(particle.phase + time * 2.8) * 18;
    const startY = particle.startY + Math.sin(particle.phase + time * 2.1) * 10;

    x = startX + (finalX - startX) * eased;
    y = startY + (finalY - startY) * eased;

    // Mouse Interaction
    if (mouseActive && progress > 0.45) {
      const dx = x - pointer.x;
      const dy = y - pointer.y;
      const dist = Math.hypot(dx, dy);
      const maxDist = isMobile ? 80 : 140;
      if (dist < maxDist) {
        const force = (maxDist - dist) / maxDist;
        const push = force * force * 28 * eased;
        x += (dx / dist) * push;
        y += (dy / dist) * push;
      }
    }

    const twinkle = 0.64 + Math.sin(time * particle.twinkle * 2.2 + particle.phase) * 0.36;
    alpha = particle.opacity * eased * twinkle * heartParams.opacityMultiplier;
  }

  const sprite = glowSprites[particle.colorIndex];
  if (!sprite) return;
  
  const sizeMultiplier = (particle.isDust ? 3.0 : (4.5 + pulse * 3.5)) * (1 + heartParams.blurGlow * 1.5);
  const drawSize = particle.size * sizeMultiplier * (particle.isDust ? 1.0 : heartParams.scaleMultiplier);

  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, x - drawSize / 2, y - drawSize / 2, drawSize, drawSize);
}

function spawnSpark(time) {
  if (sparks.length > 80 || Math.random() > 0.55) return;
  const isMobile = width < 920;

  const centerX = width * 0.5 + (isMobile ? 0 : (width * heartParams.centerXOffset * 0.12));
  const centerY = height * (isMobile ? 0.46 : 0.44) + (isMobile ? 0 : (height * heartParams.centerYOffset * 0.02));
  const colorIndex = Math.floor(Math.random() * palette.length);

  sparks.push({
    x: centerX + randomBetween(-150, 150) * heartParams.scaleMultiplier,
    y: centerY + randomBetween(-140, 110) * heartParams.scaleMultiplier,
    vx: randomBetween(-0.18, 0.18),
    vy: randomBetween(0.45, 1.4),
    life: randomBetween(0.6, 1.35),
    born: time,
    colorIndex,
    size: randomBetween(0.9, 2.2),
  });
}

function drawSparks(time) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  sparks = sparks.filter((spark) => {
    const age = time - spark.born;
    const life = 1 - age / spark.life;

    if (life <= 0) return false;

    spark.x += spark.vx;
    spark.y += spark.vy;

    const sprite = glowSprites[spark.colorIndex];
    if (sprite) {
      const drawSize = spark.size * life * 7 * (1 + heartParams.blurGlow * 1.2);
      ctx.globalAlpha = life * 0.72 * heartParams.opacityMultiplier;
      ctx.drawImage(sprite, spark.x - drawSize / 2, spark.y - drawSize / 2, drawSize, drawSize);
    }

    return true;
  });

  ctx.restore();
}

function render(now) {
  const time = now * 0.001;
  const introLength = prefersReducedMotion ? 0.01 : 2.8;
  const progress = Math.min(time / introLength, 1);
  const heartbeat = Math.max(0, Math.sin(time * 3.6)) ** 18;
  const slowPulse = Math.sin(time * 1.35) * 0.5 + 0.5;
  const pulse = (heartbeat * 1.2 + slowPulse * 0.08) * heartParams.scaleMultiplier;
  const rotation = Math.sin(time * 0.48) * 0.82;

  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";

  // Draw particles
  for (let i = 0; i < particles.length; i++) {
    drawParticle(particles[i], time, progress, pulse, rotation);
  }

  spawnSpark(time);
  drawSparks(time);

  rafId = requestAnimationFrame(render);
}

function moveCursor(event) {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  cursorLight.style.left = `${pointer.x}px`;
  cursorLight.style.top = `${pointer.y}px`;
  cursorLight.style.opacity = "1";
  mouseActive = true;
}

// Window resizing
window.addEventListener("resize", resize);
window.addEventListener("pointermove", moveCursor);
window.addEventListener("pointerleave", () => {
  cursorLight.style.opacity = "0";
  mouseActive = false;
});

// --- Initialize Lenis & GSAP Cinematic scroll animations ---
function initScroll() {
  if (typeof Lenis === "undefined" || typeof gsap === "undefined") {
    console.warn("Lenis or GSAP not loaded yet, retrying...");
    setTimeout(initScroll, 100);
    return;
  }

  // 1. Initialize Lenis Smooth Scroll
  const lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    wheelMultiplier: 1.0,
  });

  // Force scroll to top immediately on init
  lenis.scrollTo(0, { immediate: true });

  lenis.on('scroll', ScrollTrigger.update);

  gsap.ticker.add((time) => {
    lenis.raf(time * 1000);
  });

  gsap.ticker.lagSmoothing(0);

  // Allow clicking on scroll indicator to scroll down
  const indicator = document.querySelector("#scroll-indicator");
  if (indicator) {
    indicator.addEventListener("click", () => {
      lenis.scrollTo("#profile");
    });
  }

  // 2. Setup GSAP ScrollTrigger Animations
  // Register ScrollTrigger plugin
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.clearScrollMemory();

  // Transition timeline for Intro Page Scroll
  const introTL = gsap.timeline({
    scrollTrigger: {
      trigger: "#intro",
      start: "top top",
      end: "bottom top",
      scrub: true,
      pin: true,
      pinSpacing: true,
    }
  });

  // Animate Heart canvas scaling, opacity and blur
  introTL.to(heartParams, {
    scaleMultiplier: 0.72,
    opacityMultiplier: 0.45,
    centerXOffset: 1.0, // Slide right on desktop
    centerYOffset: 0.1,
    blurGlow: 0.5,
    ease: "none"
  }, 0);

  // Fade out welcome content
  introTL.to(".intro-content", {
    y: -80,
    opacity: 0,
    ease: "none"
  }, 0);

  // Fade out scroll indicator
  introTL.to("#scroll-indicator", {
    opacity: 0,
    y: 20,
    ease: "none"
  }, 0);

  // Reveal Profile Content
  gsap.fromTo(".profile-left > *", 
    { y: 60, opacity: 0 },
    {
      y: 0,
      opacity: 1,
      stagger: 0.12,
      duration: 0.8,
      ease: "power2.out",
      scrollTrigger: {
        trigger: "#profile",
        start: "top 75%",
        toggleActions: "play none none reverse"
      }
    }
  );

  gsap.fromTo(".status-card", 
    { y: 80, opacity: 0 },
    {
      y: 0,
      opacity: 1,
      duration: 0.8,
      ease: "power2.out",
      scrollTrigger: {
        trigger: "#profile",
        start: "top 70%",
        toggleActions: "play none none reverse"
      }
    }
  );

  gsap.fromTo(".skill-card", 
    { y: 40, opacity: 0 },
    {
      y: 0,
      opacity: 1,
      stagger: 0.08,
      duration: 0.7,
      ease: "power2.out",
      scrollTrigger: {
        trigger: ".cards-grid",
        start: "top 80%",
        toggleActions: "play none none reverse"
      }
    }
  );

  gsap.fromTo(".project-card", 
    { y: 50, opacity: 0 },
    {
      y: 0,
      opacity: 1,
      stagger: 0.1,
      duration: 0.8,
      ease: "power2.out",
      scrollTrigger: {
        trigger: "#projects",
        start: "top 85%",
        toggleActions: "play none none reverse"
      }
    }
  );
}

// --- Entrance Animation on Load ---
function runEntranceAnimation() {
  if (typeof gsap === "undefined") return;

  const tl = gsap.timeline();

  // Hide initially
  gsap.set([".cinematic-title", ".intro-subtext", "#scroll-indicator"], { opacity: 0 });

  // Fade in background glow first
  tl.fromTo(".ambient-glow", 
    { opacity: 0, scale: 0.8 }, 
    { opacity: 0.15, scale: 1, duration: 1.8, ease: "power2.out" }
  );

  // Heart Canvas scales up nicely
  tl.fromTo(heartParams, 
    { scaleMultiplier: 0.1, opacityMultiplier: 0 },
    { scaleMultiplier: 1.0, opacityMultiplier: 1.0, duration: 1.6, ease: "power3.out" },
    "-=1.4"
  );

  // Title cinematic reveal
  tl.fromTo(".cinematic-title",
    { y: 50, opacity: 0 },
    { y: 0, opacity: 1, duration: 1.2, ease: "power3.out" },
    "-=0.8"
  );

  // Subtitle reveal
  tl.fromTo(".intro-subtext",
    { y: 20, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.8, ease: "power2.out" },
    "-=0.6"
  );

  // Scroll indicator fade in
  tl.fromTo("#scroll-indicator",
    { opacity: 0 },
    { opacity: 1, duration: 0.6 },
    "-=0.2"
  );
}

// --- Initial boot ---
preRenderGlows();
resize();
cancelAnimationFrame(rafId);
rafId = requestAnimationFrame(render);

window.addEventListener("load", () => {
  initScroll();
  runEntranceAnimation();
});
