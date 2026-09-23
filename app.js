(() => {
  "use strict";

  // Native px geometry. `box` covers each frame's transparent photo hole, padded under its soft edges.
  const FRAMES = [
    // square hole spans 110,1157 – 2690,3737
    { src: "assets/frame-1.png", w: 2801, h: 3834, box: { x: 108, y: 1155, w: 2585, h: 2585 } },
    // irregular torn hole spans 1241,1270 – 2526,2339; padded so soft edges stay covered
    { src: "assets/frame-2.png", w: 2988, h: 3834, box: { x: 1225, y: 1254, w: 1318, h: 1102 } },
  ];

  const PREVIEW_W = 1000;
  const MAX_SCALE = 4;

  const screenSelect = document.getElementById("screen-select");
  const screenCamera = document.getElementById("screen-camera");
  const editor = document.getElementById("editor");
  const slot = document.getElementById("photo-slot");
  const video = document.getElementById("camera-video");
  const photoCanvas = document.getElementById("photo-canvas");
  const photoCtx = photoCanvas.getContext("2d");
  const frameImage = document.getElementById("frame-image");
  const fileInputCamera = document.getElementById("file-input-camera");

  const actionsLive = document.getElementById("actions-live");
  const actionsCaptured = document.getElementById("actions-captured");
  const btnSnap = document.getElementById("btn-snap");
  const btnRetake = document.getElementById("btn-retake");
  const btnDownload = document.getElementById("btn-download");
  const btnOtherFrame = document.getElementById("btn-other-frame");

  let frameIndex = 0;
  let frame = FRAMES[0];
  let stream = null;
  let photo = null; // HTMLCanvasElement or HTMLImageElement
  let photoW = 0;
  let photoH = 0;
  let baseScale = 1;
  let userScale = 1;
  let photoLeft = 0; // native px relative to box, <= 0
  let photoTop = 0;

  // ---- Frame selection ----
  function useFrame(index) {
    frameIndex = index;
    frame = FRAMES[index];
    const { w, h, box } = frame;
    frameImage.src = frame.src;
    editor.style.aspectRatio = `${w} / ${h}`;
    slot.style.left = `${(box.x / w) * 100}%`;
    slot.style.top = `${(box.y / h) * 100}%`;
    slot.style.width = `${(box.w / w) * 100}%`;
    slot.style.height = `${(box.h / h) * 100}%`;
    photoCanvas.width = PREVIEW_W;
    photoCanvas.height = Math.round((PREVIEW_W * box.h) / box.w);
  }

  document.querySelectorAll(".frame-choice").forEach((btn) => {
    btn.addEventListener("click", () => {
      useFrame(Number(btn.dataset.frame));
      screenSelect.hidden = true;
      screenCamera.hidden = false;
      showLive();
    });
  });

  // ---- Camera ----
  async function startCamera() {
    if (stream || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      });
      video.srcObject = stream;
    } catch (err) {
      stream = null;
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.srcObject = null;
  }

  function snap() {
    if (!stream || !video.videoWidth) {
      fileInputCamera.click();
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    // match the mirrored live preview
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    stopCamera();
    setPhoto(c, w, h);
  }

  fileInputCamera.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      setPhoto(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
    fileInputCamera.value = "";
  });

  function showLive() {
    photo = null;
    pointers.clear();
    gesture = null;
    photoCanvas.hidden = true;
    video.hidden = false;
    actionsCaptured.hidden = true;
    actionsLive.hidden = false;
    startCamera();
  }

  // ---- Photo positioning ----
  function setPhoto(source, w, h) {
    const { box } = frame;
    photo = source;
    photoW = w;
    photoH = h;
    baseScale = Math.max(box.w / w, box.h / h);
    userScale = 1;
    const { dw, dh } = drawSize();
    photoLeft = (box.w - dw) / 2;
    photoTop = (box.h - dh) / 2;

    video.hidden = true;
    photoCanvas.hidden = false;
    actionsLive.hidden = true;
    actionsCaptured.hidden = false;
    draw();
  }

  function drawSize() {
    return { dw: photoW * baseScale * userScale, dh: photoH * baseScale * userScale };
  }

  function clamp() {
    const { box } = frame;
    const { dw, dh } = drawSize();
    photoLeft = Math.max(box.w - dw, Math.min(0, photoLeft));
    photoTop = Math.max(box.h - dh, Math.min(0, photoTop));
  }

  function setScale(next, anchorX, anchorY) {
    next = Math.max(1, Math.min(MAX_SCALE, next));
    const ratio = next / userScale;
    photoLeft = anchorX - (anchorX - photoLeft) * ratio;
    photoTop = anchorY - (anchorY - photoTop) * ratio;
    userScale = next;
    clamp();
    draw();
  }

  function draw() {
    const k = photoCanvas.width / frame.box.w;
    const { dw, dh } = drawSize();
    photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
    photoCtx.drawImage(photo, photoLeft * k, photoTop * k, dw * k, dh * k);
  }

  function nativePerCssPx() {
    return frame.w / editor.getBoundingClientRect().width;
  }

  // client px -> native box px
  function toBox(clientX, clientY) {
    const r = editor.getBoundingClientRect();
    const n = frame.w / r.width;
    return { x: (clientX - r.left) * n - frame.box.x, y: (clientY - r.top) * n - frame.box.y };
  }

  // ---- Touch / pointer: one finger pans, two fingers pinch ----
  const pointers = new Map();
  let gesture = null;

  function beginGesture() {
    const pts = [...pointers.values()];
    if (pts.length === 1) {
      gesture = { type: "pan", x: pts[0].x, y: pts[0].y, left: photoLeft, top: photoTop };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      const mid = toBox((a.x + b.x) / 2, (a.y + b.y) / 2);
      gesture = {
        type: "pinch",
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: userScale,
        left: photoLeft,
        top: photoTop,
        midX: mid.x,
        midY: mid.y,
        clientMidX: (a.x + b.x) / 2,
        clientMidY: (a.y + b.y) / 2,
      };
    } else {
      gesture = null;
    }
  }

  editor.addEventListener("pointerdown", (e) => {
    if (!photo) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { editor.setPointerCapture(e.pointerId); } catch (_) {}
    beginGesture();
  });

  editor.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const n = nativePerCssPx();

    if (gesture.type === "pan" && pointers.size === 1) {
      photoLeft = gesture.left + (e.clientX - gesture.x) * n;
      photoTop = gesture.top + (e.clientY - gesture.y) * n;
      clamp();
      draw();
    } else if (gesture.type === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const next = Math.max(1, Math.min(MAX_SCALE, gesture.scale * (dist / gesture.dist)));
      const ratio = next / gesture.scale;
      const panX = ((a.x + b.x) / 2 - gesture.clientMidX) * n;
      const panY = ((a.y + b.y) / 2 - gesture.clientMidY) * n;
      userScale = next;
      photoLeft = gesture.midX - (gesture.midX - gesture.left) * ratio + panX;
      photoTop = gesture.midY - (gesture.midY - gesture.top) * ratio + panY;
      clamp();
      draw();
    }
  });

  function endPointer(e) {
    if (!pointers.delete(e.pointerId)) return;
    beginGesture();
  }
  editor.addEventListener("pointerup", endPointer);
  editor.addEventListener("pointercancel", endPointer);

  editor.addEventListener(
    "wheel",
    (e) => {
      if (!photo) return;
      e.preventDefault();
      const p = toBox(e.clientX, e.clientY);
      setScale(userScale * Math.exp(-e.deltaY * 0.002), p.x, p.y);
    },
    { passive: false }
  );

  // ---- Export ----
  function download() {
    const { w, h, box } = frame;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);

    const { dw, dh } = drawSize();
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.drawImage(photo, box.x + photoLeft, box.y + photoTop, dw, dh);
    ctx.restore();
    ctx.drawImage(frameImage, 0, 0, w, h);

    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `photoframe-${frameIndex + 1}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, "image/png");
  }

  btnSnap.addEventListener("click", snap);
  btnRetake.addEventListener("click", showLive);
  btnDownload.addEventListener("click", download);
  btnOtherFrame.addEventListener("click", () => {
    useFrame((frameIndex + 1) % FRAMES.length);
    showLive();
  });
})();
