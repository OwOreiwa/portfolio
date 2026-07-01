import html2canvas from "html2canvas";
import * as THREE from "three";
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

const SCENE_BACKGROUND = 0xe8e8e8;

const CAMERA_FOV = 10;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 100;
const CAMERA_POSITION = { x: 0, y: 0, z: 25 } as const;

const CYLINDER_RADIUS = 1;
const CYLINDER_HEIGHT = 3;
const CYLINDER_RADIAL_SEGMENTS = 64;
const CYLINDER_COLOR = 0xffffff;

const CAN_POSITION_X = 0;
const CAN_POSITION_Y = 0;
const CAN_POSITION_Z = 0;
const CAN_SCALE_X = 1.01;
const CAN_SCALE_Y = 0.96;
const CAN_SCALE_Z = 1.01;

const BELT_HEIGHT_PX = 1080;
const BELT_WORLD_SCALE = CYLINDER_HEIGHT / BELT_HEIGHT_PX;
const BELT_SURFACE_OFFSET = 0.004;
const BELT_POSITION_X = 0;
const BELT_POSITION_Y = -0.05;
const BELT_POSITION_Z = 0;
const BELT_RADIAL_SEGMENTS_MIN = 48;
const BELT_RADIAL_SEGMENTS_PER_RADIAN = 48;

const ROTATION_X_MIN = -Math.PI / 8;
const ROTATION_X_MAX = Math.PI / 8;
const DRAG_ROTATION_SENSITIVITY = 0.01;
const DRAG_THRESHOLD_PX = 6;

const AMBIENT_LIGHT_COLOR = 0xffffff;
const AMBIENT_LIGHT_INTENSITY = 0.4;
const DIRECTIONAL_LIGHT_COLOR = 0xffffff;
const DIRECTIONAL_LIGHT_INTENSITY = 2;
const DIRECTIONAL_LIGHT_POSITION = { x: 3, y: 4, z: 5 } as const;

const MAX_DEVICE_PIXEL_RATIO = 2;
const CAPTURE_BACKGROUND = "#ffffff";
const LINKS_ROW_CAPTURE_ROTATE = "270deg";
const TOON_GRADIENT_MAP_URL = "public/maps/fiveTone.jpg";

const loadToonGradientMap = () => {
  const gradientMap = new THREE.TextureLoader().load(TOON_GRADIENT_MAP_URL);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  return gradientMap;
};

const createToonMaterial = (
  gradientMap: THREE.Texture,
  options: THREE.MeshToonMaterialParameters = {},
) =>
  new THREE.MeshToonMaterial({
    ...options,
    gradientMap,
  });

type HitTarget = {
  element: HTMLAnchorElement;
  left: number;
  top: number;
  width: number;
  height: number;
  href: string;
};

const BELT_FONT_SPECS = [
  '400 16px "Atkinson"',
  '700 16px "Atkinson"',
  '16px "Toppan BunkyuMidashiGoStd Eb"',
  '16px "Zen Kaku Gothic New Regular"',
  '48.82px "Atkinson"',
  '39.06px "Toppan BunkyuMidashiGoStd Eb"',
  '192px "Toppan BunkyuMidashiGoStd Eb"',
  '128px Arial',
  '96px Arial',
];

const waitForImage = (img: HTMLImageElement) =>
  new Promise<void>((resolve) => {
    const finish = () => resolve();
    if (img.complete) {
      finish();
      return;
    }
    img.addEventListener("load", finish, { once: true });
    img.addEventListener("error", finish, { once: true });
  });

const waitForBeltFonts = async () => {
  await document.fonts.ready;
  await Promise.all(
    BELT_FONT_SPECS.map((spec) => document.fonts.load(spec).catch(() => undefined)),
  );
  await document.fonts.ready;
};

const waitForBeltImages = async (root: HTMLElement) => {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map((img) => waitForImage(img)));
};

const waitForBeltAssets = async (root: HTMLElement) => {
  await waitForBeltFonts();
  await waitForBeltImages(root);
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
};

const REQUIRED_FONT_SPECS = [
  '400 16px "Atkinson"',
  '16px "Toppan BunkyuMidashiGoStd Eb"',
  '16px "Zen Kaku Gothic New Regular"',
];

const areBeltAssetsReady = (root: HTMLElement) => {
  const images = Array.from(root.querySelectorAll("img"));
  const imagesReady = images.every((img) => img.complete);
  const fontsReady = REQUIRED_FONT_SPECS.every((spec) => document.fonts.check(spec));
  return imagesReady && fontsReady && root.offsetWidth > 0 && root.offsetHeight > 0;
};

const IMAGE_FALLBACK_CLASS = "img-cors-fallback";
const imageCanvasSafeCache = new Map<string, boolean>();

const stableColorFromSrc = (src: string) => {
  let hash = 0;
  for (let i = 0; i < src.length; i++) {
    hash = (hash * 31 + src.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const sat = 45 + (Math.abs(hash >> 8) % 25);
  const light = 45 + (Math.abs(hash >> 16) % 15);
  return `hsl(${hue} ${sat}% ${light}%)`;
};

const testImageCanvasSafe = (src: string) =>
  new Promise<boolean>((resolve) => {
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(false);
        return;
      }
      try {
        ctx.drawImage(probe, 0, 0, 2, 2);
        ctx.getImageData(0, 0, 1, 1);
        resolve(true);
      } catch {
        resolve(false);
      }
    };
    probe.onerror = () => resolve(false);
    probe.src = src;
  });

const prepareBeltImagesForCapture = async (root: HTMLElement) => {
  const images = Array.from(root.querySelectorAll("a > img"));
  await Promise.all(
    images.map(async (img) => {
      if (!(img instanceof HTMLImageElement)) {
        return;
      }
      const anchor = img.parentElement;
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      let canvasSafe = imageCanvasSafeCache.get(img.src);
      if (canvasSafe === undefined) {
        if (!img.complete || img.naturalWidth === 0) {
          canvasSafe = false;
        } else {
          canvasSafe = await testImageCanvasSafe(img.src);
        }
        imageCanvasSafeCache.set(img.src, canvasSafe);
      }

      if (!canvasSafe) {
        anchor.classList.add(IMAGE_FALLBACK_CLASS);
        anchor.style.backgroundColor = stableColorFromSrc(img.src);
        img.style.visibility = "hidden";
        return;
      }

      anchor.classList.remove(IMAGE_FALLBACK_CLASS);
      anchor.style.backgroundColor = "";
      img.style.visibility = "";
    }),
  );
};

const copyTextStyles = (liveNode: HTMLElement, cloneNode: HTMLElement) => {
  const style = getComputedStyle(liveNode);
  cloneNode.style.fontFamily = style.fontFamily;
  cloneNode.style.fontSize = style.fontSize;
  cloneNode.style.fontWeight = style.fontWeight;
  cloneNode.style.color = style.color;
  cloneNode.style.letterSpacing = style.letterSpacing;
  cloneNode.style.lineHeight = style.lineHeight;
  cloneNode.style.whiteSpace = "nowrap";
  cloneNode.style.display = "inline-block";
};

const syncLinksCloneLayout = (liveBelt: HTMLElement, cloneBelt: HTMLElement) => {
  const liveLinks = liveBelt.querySelector(".links");
  const cloneLinks = cloneBelt.querySelector(".links");
  if (!(liveLinks instanceof HTMLElement) || !(cloneLinks instanceof HTMLElement)) {
    return;
  }

  const beltRect = liveBelt.getBoundingClientRect();
  const linksRect = liveLinks.getBoundingClientRect();
  const liveLinksStyle = getComputedStyle(liveLinks);

  cloneLinks.style.writingMode = "horizontal-tb";
  cloneLinks.style.textOrientation = "mixed";
  cloneLinks.style.transform = "none";
  cloneLinks.style.display = "block";
  cloneLinks.style.position = "absolute";
  cloneLinks.style.left = `${linksRect.left - beltRect.left}px`;
  cloneLinks.style.top = `${linksRect.top - beltRect.top}px`;
  cloneLinks.style.width = `${linksRect.width}px`;
  cloneLinks.style.height = `${linksRect.height}px`;
  cloneLinks.style.margin = "0";
  cloneLinks.style.padding = "0";
  cloneLinks.style.fontSize = liveLinksStyle.fontSize;
  cloneLinks.style.letterSpacing = liveLinksStyle.letterSpacing;
  cloneLinks.style.boxSizing = "border-box";
  cloneLinks.style.overflow = "visible";

  const liveRows = liveLinks.querySelectorAll(":scope > div");
  const cloneRows = cloneLinks.querySelectorAll(":scope > div");

  liveRows.forEach((liveRow, index) => {
    const cloneRow = cloneRows[index];
    if (!(liveRow instanceof HTMLElement) || !(cloneRow instanceof HTMLElement)) {
      return;
    }

    const rowRect = liveRow.getBoundingClientRect();
    const isName = liveRow.classList.contains("name");
    const centerX = rowRect.left + rowRect.width / 2 - linksRect.left;
    const centerY = rowRect.top + rowRect.height / 2 - linksRect.top;

    cloneRow.style.position = "absolute";
    cloneRow.style.left = `${centerX}px`;
    cloneRow.style.top = `${centerY}px`;
    cloneRow.style.width = `${rowRect.height}px`;
    cloneRow.style.height = `${rowRect.width}px`;
    cloneRow.style.margin = "0";
    cloneRow.style.padding = "0";
    cloneRow.style.boxSizing = "border-box";
    cloneRow.style.overflow = "visible";
    cloneRow.style.writingMode = "horizontal-tb";
    cloneRow.style.textOrientation = "mixed";
    cloneRow.style.display = "flex";
    cloneRow.style.flexDirection = "row";
    cloneRow.style.flexWrap = "nowrap";
    cloneRow.style.justifyContent = "flex-start";
    cloneRow.style.alignItems = isName ? "flex-end" : "flex-start";
    cloneRow.style.transform = `translate(-50%, -50%) rotate(${LINKS_ROW_CAPTURE_ROTATE})`;
    cloneRow.style.transformOrigin = "center center";

    if (isName) {
      const liveNameChildren = liveRow.querySelectorAll<HTMLElement>(".first, .aka");
      const cloneNameChildren = cloneRow.querySelectorAll<HTMLElement>(".first, .aka");
      liveNameChildren.forEach((liveChild, childIndex) => {
        const cloneChild = cloneNameChildren[childIndex];
        if (cloneChild) {
          copyTextStyles(liveChild, cloneChild);
        }
      });
    }

    const liveLink = liveRow.querySelector("a");
    const cloneLink = cloneRow.querySelector("a");
    if (liveLink instanceof HTMLElement && cloneLink instanceof HTMLElement) {
      copyTextStyles(liveLink, cloneLink);
      const linkStyle = getComputedStyle(liveLink);
      cloneLink.style.paddingLeft = linkStyle.paddingLeft;
      cloneLink.style.textDecoration = linkStyle.textDecoration;
    }
  });
};

const prepareBeltCloneForCapture = (liveBelt: HTMLElement, element: HTMLElement) => {
  element.style.visibility = "visible";
  element.style.opacity = "1";
  element.style.position = "fixed";
  element.style.left = "0";
  element.style.top = "0";
  element.style.zIndex = "-1";
  element.style.pointerEvents = "none";

  element.style.fontSize = "20px";
  element.style.width = `${liveBelt.offsetWidth}px`;
  element.style.height = `${liveBelt.offsetHeight}px`;
  element.style.boxSizing = "border-box";

  element.querySelectorAll("h2").forEach((heading) => {
    if (heading instanceof HTMLElement) {
      heading.style.lineHeight = "1.2";
      heading.style.color = "rgb(8, 8, 8)";
      heading.style.fontSize = "48.82px";
      heading.style.fontFamily = '"Atkinson", "Toppan BunkyuMidashiGoStd Eb", sans-serif';
    }
  });

  element.querySelectorAll("h3").forEach((heading) => {
    if (heading instanceof HTMLElement) {
      heading.style.lineHeight = "1.2";
      heading.style.color = "rgb(8, 8, 8)";
      heading.style.fontSize = "39.06px";
      heading.style.fontFamily = '"Atkinson", "Toppan BunkyuMidashiGoStd Eb", sans-serif';
    }
  });

  syncLinksCloneLayout(liveBelt, element);
};

export const initIndexCylinder = () => {
  const container = document.querySelector(".cylinder-view");
  const belt = document.querySelector(".belt");
  if (!(container instanceof HTMLElement) || !(belt instanceof HTMLElement)) {
    return;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_BACKGROUND);

  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    1,
    CAMERA_NEAR,
    CAMERA_FAR,
  );
  camera.position.set(
    CAMERA_POSITION.x,
    CAMERA_POSITION.y,
    CAMERA_POSITION.z,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO),
  );
  container.appendChild(renderer.domElement);

  const toonGradientMap = loadToonGradientMap();

  const rotGroup = new THREE.Group();
  scene.add(rotGroup);

  /*
  const cylinderGeometry = new THREE.CylinderGeometry(
    CYLINDER_RADIUS,
    CYLINDER_RADIUS,
    CYLINDER_HEIGHT,
    CYLINDER_RADIAL_SEGMENTS,
  );
  const cylinderMaterial = createToonMaterial(toonGradientMap, {
    color: CYLINDER_COLOR,
    depthWrite: true,
  });
  const cylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial);
  rotGroup.add(cylinder);
  */

  const objLoader = new OBJLoader();
  objLoader.load(
    'public/models/can.obj',
    function (mesh: THREE.Mesh) {
      mesh.traverse(function(child: THREE.Mesh) {
        if (child instanceof THREE.Mesh) {
          const canMaterial = createToonMaterial(toonGradientMap, {
            side: THREE.FrontSide,
            depthWrite: true,
          });
          child.material = canMaterial;
        }
      });

      mesh.position.set(CAN_POSITION_X, CAN_POSITION_Y, CAN_POSITION_Z);
      mesh.scale.set(CAN_SCALE_X, CAN_SCALE_Y, CAN_SCALE_Z);

      rotGroup.add(mesh);
    },
  );

  const ambientLight = new THREE.AmbientLight(
    AMBIENT_LIGHT_COLOR,
    AMBIENT_LIGHT_INTENSITY,
  );
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(
    DIRECTIONAL_LIGHT_COLOR,
    DIRECTIONAL_LIGHT_INTENSITY,
  );
  directionalLight.position.set(
    DIRECTIONAL_LIGHT_POSITION.x,
    DIRECTIONAL_LIGHT_POSITION.y,
    DIRECTIONAL_LIGHT_POSITION.z,
  );
  scene.add(directionalLight);

  let beltMesh: THREE.Mesh | null = null;
  let beltMaterial: THREE.MeshToonMaterial | null = null;
  let beltTexture: THREE.CanvasTexture | null = null;

  let beltWidthPx = 0;
  let beltHeightPx = 0;
  let hitTargets: HitTarget[] = [];
  let isCapturing = false;
  let beltImagesPrepared = false;
  let beltCaptureReady = false;
  let recapturePending = false;

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  let viewportWidth = window.innerWidth;
  let viewportHeight = window.innerHeight;

  const collectHitTargets = () => {
    const beltRect = belt.getBoundingClientRect();
    hitTargets = Array.from(belt.querySelectorAll("a"))
      .filter((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement)
      .map((anchor) => {
        const rect = anchor.getBoundingClientRect();
        return {
          element: anchor,
          left: rect.left - beltRect.left,
          top: rect.top - beltRect.top,
          width: rect.width,
          height: rect.height,
          href: anchor.href,
        };
      });
  };

  const captureBeltTexture = async () => {
    if (isCapturing) {
      return;
    }
    isCapturing = true;

    beltWidthPx = belt.offsetWidth;
    beltHeightPx = belt.offsetHeight;
    if (beltWidthPx === 0 || beltHeightPx === 0) {
      isCapturing = false;
      return;
    }

    const captureScale = Math.min(
      window.devicePixelRatio,
      MAX_DEVICE_PIXEL_RATIO,
    );
    const canvas = await html2canvas(belt, {
      backgroundColor: CAPTURE_BACKGROUND,
      scale: captureScale,
      useCORS: true,
      allowTaint: true,
      logging: false,
      onclone: (_doc, clone) => {
        if (clone instanceof HTMLElement) {
          prepareBeltCloneForCapture(belt, clone);
        }
      },
    });

    beltTexture?.dispose();
    beltTexture = new THREE.CanvasTexture(canvas);
    beltTexture.colorSpace = THREE.SRGBColorSpace;
    beltTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    beltTexture.needsUpdate = true;

    if (!beltMaterial) {
      beltMaterial = createToonMaterial(toonGradientMap, {
        side: THREE.FrontSide,
        depthWrite: true,
      });
    }
    beltMaterial.map = beltTexture;
    beltMaterial.needsUpdate = true;

    collectHitTargets();
    isCapturing = false;
  };

  const getBeltScale = () => BELT_WORLD_SCALE;

  const rebuildBeltMesh = (beltScale: number) => {
    if (!beltMaterial || beltWidthPx === 0 || beltHeightPx === 0) {
      return;
    }

    const surfaceRadius = CYLINDER_RADIUS + BELT_SURFACE_OFFSET;
    const worldWidth = beltWidthPx * beltScale;
    const worldHeight = beltHeightPx * beltScale;
    const arcAngle = worldWidth / surfaceRadius;
    const thetaStart = -arcAngle / 2;
    const radialSegments = Math.max(
      BELT_RADIAL_SEGMENTS_MIN,
      Math.ceil(arcAngle * BELT_RADIAL_SEGMENTS_PER_RADIAN),
    );

    if (beltMesh) {
      rotGroup.remove(beltMesh);
      beltMesh.geometry.dispose();
    }

    const beltGeometry = new THREE.CylinderGeometry(
      surfaceRadius,
      surfaceRadius,
      worldHeight,
      radialSegments,
      1,
      true,
      thetaStart,
      arcAngle,
    );

    beltMesh = new THREE.Mesh(beltGeometry, beltMaterial);
    beltMesh.position.set(BELT_POSITION_X, BELT_POSITION_Y, BELT_POSITION_Z);
    beltMesh.renderOrder = 1;
    rotGroup.add(beltMesh);
  };

  const layoutScene = () => {
    if (viewportHeight === 0) {
      return;
    }

    rebuildBeltMesh(getBeltScale());
  };

  const updatePointerNdc = (clientX: number, clientY: number) => {
    pointerNdc.x = (clientX / viewportWidth) * 2 - 1;
    pointerNdc.y = -(clientY / viewportHeight) * 2 + 1;
  };

  const hitTestFromUv = (uv: THREE.Vector2) => {
    const x = uv.x * beltWidthPx;
    const y = (1 - uv.y) * beltHeightPx;
    for (const target of hitTargets) {
      if (
        x >= target.left &&
        x <= target.left + target.width &&
        y >= target.top &&
        y <= target.top + target.height
      ) {
        return target;
      }
    }
    return null;
  };

  const raycastBelt = () => {
    if (!beltMesh || beltWidthPx === 0) {
      return null;
    }
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObject(beltMesh, false);
    const hit = hits[0];
    if (!hit?.uv) {
      return null;
    }
    return hitTestFromUv(hit.uv);
  };

  let isDragging = false;
  let isPointerDown = false;
  let didDrag = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let pendingHref: string | null = null;

  const render = () => {
    renderer.render(scene, camera);
  };

  const syncViewport = () => {
    viewportWidth = container.clientWidth || window.innerWidth;
    viewportHeight = container.clientHeight || window.innerHeight;
    if (viewportWidth === 0 || viewportHeight === 0) {
      return false;
    }
    camera.aspect = viewportWidth / viewportHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO),
    );
    renderer.setSize(viewportWidth, viewportHeight, false);
    return true;
  };

  const tryCaptureBelt = async () => {
    if (!syncViewport()) {
      return false;
    }

    await waitForBeltAssets(belt);
    if (!areBeltAssetsReady(belt)) {
      layoutScene();
      render();
      return false;
    }

    beltCaptureReady = true;
    if (!beltImagesPrepared) {
      await prepareBeltImagesForCapture(belt);
      beltImagesPrepared = true;
    }
    await captureBeltTexture();
    layoutScene();
    render();
    return true;
  };

  const scheduleRecapture = () => {
    if (recapturePending) {
      return;
    }
    recapturePending = true;
    requestAnimationFrame(async () => {
      recapturePending = false;
      await tryCaptureBelt();
    });
  };

  const bindAssetLoadRecapture = () => {
    const onAssetsUpdated = () => {
      scheduleRecapture();
    };
    belt.querySelectorAll("img").forEach((img) => {
      img.addEventListener("load", onAssetsUpdated);
      img.addEventListener("error", onAssetsUpdated);
    });
    document.fonts.addEventListener("loadingdone", onAssetsUpdated);
    window.addEventListener("load", onAssetsUpdated);
  };

  const resize = async () => {
    if (!syncViewport()) {
      return;
    }
    if (beltCaptureReady) {
      await captureBeltTexture();
    }
    layoutScene();
    render();
  };

  const boot = async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    if (!syncViewport()) {
      return;
    }
    await tryCaptureBelt();
  };

  const updateInteraction = (event: PointerEvent) => {
    updatePointerNdc(event.clientX, event.clientY);
    const target = raycastBelt();
    container.style.cursor = target ? "pointer" : isDragging ? "grabbing" : "grab";
  };

  const onPointerDown = (event: PointerEvent) => {
    isPointerDown = true;
    didDrag = false;
    pointerDownX = event.clientX;
    pointerDownY = event.clientY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;

    updatePointerNdc(event.clientX, event.clientY);
    const target = raycastBelt();
    pendingHref = target?.href ?? null;

    if (!pendingHref) {
      isDragging = true;
      container.classList.add("is-dragging");
      container.setPointerCapture(event.pointerId);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (isDragging) {
      const deltaX = event.clientX - lastPointerX;
      const deltaY = event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      rotGroup.rotation.y += deltaX * DRAG_ROTATION_SENSITIVITY;
      rotGroup.rotation.x = THREE.MathUtils.clamp(
        rotGroup.rotation.x + deltaY * DRAG_ROTATION_SENSITIVITY,
        ROTATION_X_MIN,
        ROTATION_X_MAX,
      );
      render();
      return;
    }

    if (
      isPointerDown &&
      Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) >=
        DRAG_THRESHOLD_PX
    ) {
      didDrag = true;
      pendingHref = null;
      isDragging = true;
      container.classList.add("is-dragging");
      container.setPointerCapture(event.pointerId);
      return;
    }

    if (!isPointerDown) {
      updateInteraction(event);
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (pendingHref && !didDrag) {
      window.open(pendingHref, "_blank", "noopener,noreferrer");
    }

    isPointerDown = false;
    isDragging = false;
    didDrag = false;
    pendingHref = null;
    container.classList.remove("is-dragging");
    if (container.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }
    updateInteraction(event);
  };

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerUp);
  container.addEventListener("pointerleave", () => {
    container.style.cursor = "grab";
  });
  window.addEventListener("resize", () => {
    void resize();
  });

  bindAssetLoadRecapture();
  void boot();
  window.addEventListener("load", () => {
    void boot();
  });

  window.addEventListener("beforeunload", () => {
    beltTexture?.dispose();
    beltMaterial?.dispose();
    beltMesh?.geometry.dispose();
    toonGradientMap.dispose();
    /*
    cylinderGeometry.dispose();
    cylinderMaterial.dispose();
    */
    renderer.dispose();
  });
};
