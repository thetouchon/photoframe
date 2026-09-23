(() => {
  "use strict";

  // frame.png geometry (native px)
  const FRAME_W = 2801;
  const FRAME_H = 3834;
  const BOX_X = 110;
  const BOX_Y = 1157;
  const BOX_SIZE = 2580;

  const PREVIEW_RES = 1000;
  const MAX_SCALE = 4;

  const editor = document.getElementById("editor");
  const video = document.getElementById("camera-video");
  const photoCanvas = document.getElementById("photo-canvas");
  const photoCtx = photoCanvas.getContext("2d");
  const frameImage = editor.querySelector(".frame-image");
  const fileInputCamera = document.getElementById("file-input-camera");

  const actionsLive = document.getElementById("actions-live");
  const actionsCaptured = document.getElementById("actions-captured");
  const btnSnap = document.getElementById("btn-snap");
  const btnRetake = document.getElementById("btn-retake");
  const btnDownload = document.getElementById("btn-download");

  let stream = null;
  let photo = null; // HTMLCanvasElement or HTMLImageElement
  let photoW = 0;
  let photoH = 0;
  let baseScale = 1;
  let userScale = 1;
  let photoLeft = 0; // native box px, <= 0
  let photoTop = 0;

  // ---- Camera ----
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
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

  // ---- Photo positioning ----
  function setPhoto(source, w, h) {
    photo = source;
    photoW = w;
    photoH = h;
    baseScale = Math.max(BOX_SIZE / w, BOX_SIZE / h);
    userScale = 1;
    const { dw, dh } = drawSize();
    photoLeft = (BOX_SIZE - dw) / 2;
    photoTop = (BOX_SIZE - dh) / 2;

    photoCanvas.width = PREVIEW_RES;
    photoCanvas.height = PREVIEW_RES;
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
    const { dw, dh } = drawSize();
    photoLeft = Math.max(BOX_SIZE - dw, Math.min(0, photoLeft));
    photoTop = Math.max(BOX_SIZE - dh, Math.min(0, photoTop));
  }

  function setScale(next, anchorX = BOX_SIZE / 2, anchorY = BOX_SIZE / 2) {
    next = Math.max(1, Math.min(MAX_SCALE, next));
    const ratio = next / userScale;
    photoLeft = anchorX - (anchorX - photoLeft) * ratio;
    photoTop = anchorY - (anchorY - photoTop) * ratio;
    userScale = next;
    clamp();
    draw();
  }

  function draw() {
    const k = PREVIEW_RES / BOX_SIZE;
    const { dw, dh } = drawSize();
    photoCtx.clearRect(0, 0, PREVIEW_RES, PREVIEW_RES);
    photoCtx.drawImage(photo, photoLeft * k, photoTop * k, dw * k, dh * k);
  }

  // client px -> native box px
  function toBox(clientX, clientY) {
    const r = editor.getBoundingClientRect();
    const n = FRAME_W / r.width;
    return { x: (clientX - r.left) * n - BOX_X, y: (clientY - r.top) * n - BOX_Y, n };
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
    if (!photo || photoCanvas.hidden) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { editor.setPointerCapture(e.pointerId); } catch (_) {}
    beginGesture();
  });

  editor.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const n = FRAME_W / editor.getBoundingClientRect().width;

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
      if (!photo || photoCanvas.hidden) return;
      e.preventDefault();
      const p = toBox(e.clientX, e.clientY);
      setScale(userScale * Math.exp(-e.deltaY * 0.002), p.x, p.y);
    },
    { passive: false }
  );

  // ---- Export ----
  function download() {
    const c = document.createElement("canvas");
    c.width = FRAME_W;
    c.height = FRAME_H;
    const ctx = c.getContext("2d");
    const { dw, dh } = drawSize();
    ctx.drawImage(photo, BOX_X + photoLeft, BOX_Y + photoTop, dw, dh);
    ctx.drawImage(frameImage, 0, 0, FRAME_W, FRAME_H);

    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "photoframe.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, "image/png");
  }

  function retake() {
    photo = null;
    pointers.clear();
    gesture = null;
    photoCanvas.hidden = true;
    video.hidden = false;
    actionsCaptured.hidden = true;
    actionsLive.hidden = false;
    startCamera();
  }

  btnSnap.addEventListener("click", snap);
  btnRetake.addEventListener("click", retake);
  btnDownload.addEventListener("click", download);

  startCamera();
})();
