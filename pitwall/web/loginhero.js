/* Pitwall · carro da tela de login: o mesmo modelo próprio do editor de setup (models/pitwall_gt.glb), girando devagar.
   Carregado só quando a tela de login aparece; se o WebGL ou o modelo falhar, a tela segue só com o fundo em degradê. */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/RoomEnvironment.js";

export async function mountLoginHero(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);

  // luzes: principal branca de cima/frente, contra-luz verde e azul (identidade do app)
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 6, 5); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 24 }); key.shadow.bias = -0.0004; scene.add(key);
  const rimG = new THREE.DirectionalLight(0x2ee59d, 3.2); rimG.position.set(-5, 2.2, -4); scene.add(rimG);
  const rimB = new THREE.DirectionalLight(0x3b9cff, 2.2); rimB.position.set(5, 1.6, -5); scene.add(rimB);
  scene.add(new THREE.HemisphereLight(0x9ec5ff, 0x06110d, 0.35));

  // chão escuro que recebe a sombra (sem espelho: leve para ficar rodando o tempo todo)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.ShadowMaterial({ opacity: 0.55 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.55, 3.59, 120), new THREE.MeshBasicMaterial({ color: "#2ee59d", transparent: true, opacity: 0.28 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004; scene.add(ring);

  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync("/static/models/pitwall_gt.glb");
  const model = gltf.scene, car = new THREE.Group(), align = new THREE.Group();
  align.add(model); car.add(align); scene.add(car);
  model.updateMatrixWorld(true);
  const find = (rx) => { let r = null; model.traverse((o) => { if (!r && rx.test(o.name)) r = o; }); return r; };
  const ctr = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  const lf = find(/^WHEEL_LF/), rf = find(/^WHEEL_RF/), lr = find(/^WHEEL_LR/), rr = find(/^WHEEL_RR/);
  if (lf && rf && lr && rr) {     // alinha: frente em +x, cima em +y (mesma convenção do editor de setup)
    const c = { lf: ctr(lf), rf: ctr(rf), lr: ctr(lr), rr: ctr(rr) };
    const fwd = new THREE.Vector3().addVectors(c.lf, c.rf).sub(new THREE.Vector3().addVectors(c.lr, c.rr)).setY(0).normalize();
    const right = new THREE.Vector3().subVectors(c.rf, c.lf).setY(0).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    right.sub(fwd.clone().multiplyScalar(right.dot(fwd))).normalize();
    const mirrored = new THREE.Vector3().crossVectors(fwd, up).dot(right) < 0;
    align.applyMatrix4(new THREE.Matrix4().makeBasis(fwd, up, mirrored ? right.clone().negate() : right).transpose());
    if (mirrored) align.scale.z *= -1;
  }
  const box = new THREE.Box3().setFromObject(car), size = box.getSize(new THREE.Vector3());
  car.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const pivot = new THREE.Group(); scene.add(pivot); pivot.add(car);
  const L = Math.max(size.x, size.z);
  pivot.scale.setScalar(4.1 / L);
  pivot.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const k = 1.0 + Math.max(0, 1.5 - camera.aspect) * 0.5;       // janela estreita: afasta a câmera para o carro caber
    camera.position.set(5.2 * k, 1.35 * k, 4.6 * k);              // 3/4 pela frente
    camera.lookAt(-0.1, 0.55, 0); camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  let raf = 0, t0 = performance.now(), alive = true;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frame = (now) => {
    if (!alive) return;
    const t = (now - t0) / 1000;
    pivot.rotation.y = reduce ? 0 : Math.sin(t * 0.22) * 0.6;       // balanço lento de um lado para o outro
    ring.material.opacity = 0.2 + 0.1 * Math.sin(t * 1.4);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  host.classList.add("on");
  return () => {
    alive = false; cancelAnimationFrame(raf); ro.disconnect();
    scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); const m = o.material; (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose()); } });
    pm.dispose(); renderer.dispose(); renderer.domElement.remove();
  };
}
