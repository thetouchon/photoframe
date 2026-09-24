(() => {
  "use strict";

  // Native px geometry. Each slot covers a transparent photo hole, padded under its soft edges.
  const FRAMES = [
    // square hole spans 110,1157 – 2690,3737
    { src: "assets/frame-1.png", w: 2801, h: 3834, slots: [{ x: 108, y: 1155, w: 2585, h: 2585 }] },
    // irregular torn hole spans 1141,1248 – 2527,2347
    { src: "assets/frame-2.png", w: 2988, h: 3834, slots: [{ x: 1139, y: 1246, w: 1391, h: 1104 }] },
    // oval face hole spans 968,1086 – 1354,1628
    { src: "assets/frame-3.png", w: 2341, h: 2483, slots: [{ x: 966, y: 1084, w: 391, h: 547 }] },
    // feathered oval spans 1260,619 – 1557,1032
    { src: "assets/frame-4.png", w: 2799, h: 1306, slots: [{ x: 1258, y: 617, w: 302, h: 418 }] },
    // 4-cut strips: holes span x 86–1502 (frame 6: 87–1503), y 524–1303 / 1369–2148 / 2215–2993 / 3060–3839
    {
      src: "assets/frame-5.png", w: 1589, h: 3910,
      slots: [
        { x: 85, y: 523, w: 1419, h: 782 },
        { x: 85, y: 1368, w: 1419, h: 782 },
        { x: 85, y: 2214, w: 1419, h: 781 },
        { x: 85, y: 3059, w: 1419, h: 782 },
      ],
    },
    {
      src: "assets/frame-6.png", w: 1590, h: 3910,
      slots: [
        { x: 86, y: 523, w: 1419, h: 782 },
        { x: 86, y: 1368, w: 1419, h: 782 },
        { x: 86, y: 2214, w: 1419, h: 781 },
        { x: 86, y: 3059, w: 1419, h: 782 },
      ],
    },
  ];

  const PREVIEW_W = 1000;
  const MAX_SCALE = 4;
  // vertical space kept free for padding, gap and two rows of buttons
  const RESERVED_H = 220;

  const screenSelect = document.getElementById("screen-select");
  const screenCamera = document.getElementById("screen-camera");
  const editor = document.getElementById("editor");
  const slotsRoot = document.getElementById("slots");
  const video = document.getElementById("camera-video");
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
  let slotViews = []; // { el, canvas, ctx } per slot
  let shots = []; // { photo, pw, ph, base, scale, left, top } per slot, null until taken
  let current = 0; // slot being shot
  let done = false;
  let stream = null;

  const pct = (v, total) => `${(v / total) * 100}%`;

  function placeIn(el, s) {
    el.style.left = pct(s.x, frame.w);
    el.style.top = pct(s.y, frame.h);
    el.style.width = pct(s.w, frame.w);
    el.style.height = pct(s.h, frame.h);
  }

  // ---- Frame selection ----
  function useFrame(index) {
    frameIndex = index;
    frame = FRAMES[index];
    const ratio = frame.w / frame.h;
    frameImage.src = frame.src;
    editor.style.aspectRatio = `${frame.w} / ${frame.h}`;
    editor.style.width = `min(100%, 361px, calc((100vh - ${RESERVED_H}px) * ${ratio}))`;
    editor.style.width = `min(100%, 361px, calc((100dvh - ${RESERVED_H}px) * ${ratio}))`;

    slotsRoot.replaceChildren();
    slotViews = frame.slots.map((s) => {
      const el = document.createElement("div");
      el.className = "photo-slot";
      placeIn(el, s);
      const canvas = document.createElement("canvas");
      canvas.width = PREVIEW_W;
      canvas.height = Math.round((PREVIEW_W * s.h) / s.w);
      canvas.hidden = true;
      el.appendChild(canvas);
      slotsRoot.appendChild(el);
      return { el, canvas, ctx: canvas.getContext("2d") };
    });
  }

  document.querySelectorAll(".frame-choice").forEach((btn) => {
    btn.addEventListener("click", () => {
      useFrame(Number(btn.dataset.frame));
      screenSelect.hidden = true;
      screenCamera.hidden = false;
      startSequence();
    });
  });

  // ---- Shooting sequence ----
  function startSequence() {
    shots = frame.slots.map(() => null);
    slotViews.forEach((v) => (v.canvas.hidden = true));
    pointers.clear();
    gesture = null;
    done = false;
    current = 0;
    placeIn(video, frame.slots[0]);
    video.hidden = false;
    actionsCaptured.hidden = true;
    actionsLive.hidden = false;
    startCamera();
  }

  function takeShot(source, w, h) {
    const s = frame.slots[current];
    const base = Math.max(s.w / w, s.h / h);
    shots[current] = {
      photo: source, pw: w, ph: h, base, scale: 1,
      left: (s.w - w * base) / 2,
      top: (s.h - h * base) / 2,
    };
    slotViews[current].canvas.hidden = false;
    draw(current);

    if (current < frame.slots.length - 1) {
      current += 1;
      placeIn(video, frame.slots[current]);
      return;
    }
    done = true;
    stopCamera();
    video.hidden = true;
    actionsLive.hidden = true;
    actionsCaptured.hidden = false;
  }

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
    if (done) return;
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
    takeShot(c, w, h);
  }

  fileInputCamera.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      takeShot(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
    fileInputCamera.value = "";
  });

  // ---- Photo positioning (per slot) ----
  function size(shot) {
    return { dw: shot.pw * shot.base * shot.scale, dh: shot.ph * shot.base * shot.scale };
  }

  function clamp(i) {
    const s = frame.slots[i];
    const shot = shots[i];
    const { dw, dh } = size(shot);
    shot.left = Math.max(s.w - dw, Math.min(0, shot.left));
    shot.top = Math.max(s.h - dh, Math.min(0, shot.top));
  }

  function draw(i) {
    const { canvas, ctx } = slotViews[i];
    const shot = shots[i];
    const k = canvas.width / frame.slots[i].w;
    const { dw, dh } = size(shot);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(shot.photo, shot.left * k, shot.top * k, dw * k, dh * k);
  }

  // client px -> native frame px
  function toFrame(clientX, clientY) {
    const r = editor.getBoundingClientRect();
    const n = frame.w / r.width;
    return { x: (clientX - r.left) * n, y: (clientY - r.top) * n, n };
  }

  // slot under the point, else the nearest one
  function slotAt(p) {
    let best = 0;
    let bestD = Infinity;
    frame.slots.forEach((s, i) => {
      const dx = Math.max(s.x - p.x, 0, p.x - (s.x + s.w));
      const dy = Math.max(s.y - p.y, 0, p.y - (s.y + s.h));
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  // ---- Touch / pointer: one finger pans, two fingers pinch ----
  const pointers = new Map();
  let gesture = null;
  let activeSlot = 0;

  function beginGesture() {
    const pts = [...pointers.values()];
    if (!pts.length) {
      gesture = null;
      return;
    }
    const shot = shots[activeSlot];
    if (pts.length === 1) {
      gesture = { type: "pan", x: pts[0].x, y: pts[0].y, left: shot.left, top: shot.top };
      return;
    }
    const [a, b] = pts;
    const s = frame.slots[activeSlot];
    const mid = toFrame((a.x + b.x) / 2, (a.y + b.y) / 2);
    gesture = {
      type: "pinch",
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      scale: shot.scale,
      left: shot.left,
      top: shot.top,
      midX: mid.x - s.x,
      midY: mid.y - s.y,
      clientMidX: (a.x + b.x) / 2,
      clientMidY: (a.y + b.y) / 2,
    };
  }

  editor.addEventListener("pointerdown", (e) => {
    if (!done) return;
    if (!pointers.size) activeSlot = slotAt(toFrame(e.clientX, e.clientY));
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { editor.setPointerCapture(e.pointerId); } catch (_) {}
    beginGesture();
  });

  editor.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const n = frame.w / editor.getBoundingClientRect().width;
    const shot = shots[activeSlot];

    if (gesture.type === "pan" && pointers.size === 1) {
      shot.left = gesture.left + (e.clientX - gesture.x) * n;
      shot.top = gesture.top + (e.clientY - gesture.y) * n;
    } else if (gesture.type === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const next = Math.max(1, Math.min(MAX_SCALE, gesture.scale * (dist / gesture.dist)));
      const ratio = next / gesture.scale;
      shot.scale = next;
      shot.left = gesture.midX - (gesture.midX - gesture.left) * ratio + ((a.x + b.x) / 2 - gesture.clientMidX) * n;
      shot.top = gesture.midY - (gesture.midY - gesture.top) * ratio + ((a.y + b.y) / 2 - gesture.clientMidY) * n;
    } else {
      return;
    }
    clamp(activeSlot);
    draw(activeSlot);
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
      if (!done) return;
      e.preventDefault();
      const p = toFrame(e.clientX, e.clientY);
      const i = slotAt(p);
      const s = frame.slots[i];
      const shot = shots[i];
      const next = Math.max(1, Math.min(MAX_SCALE, shot.scale * Math.exp(-e.deltaY * 0.002)));
      const ratio = next / shot.scale;
      const ax = p.x - s.x;
      const ay = p.y - s.y;
      shot.left = ax - (ax - shot.left) * ratio;
      shot.top = ay - (ay - shot.top) * ratio;
      shot.scale = next;
      clamp(i);
      draw(i);
    },
    { passive: false }
  );

  // ---- Export ----
  function download() {
    const c = document.createElement("canvas");
    c.width = frame.w;
    c.height = frame.h;
    const ctx = c.getContext("2d");

    frame.slots.forEach((s, i) => {
      const shot = shots[i];
      if (!shot) return;
      const { dw, dh } = size(shot);
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.x, s.y, s.w, s.h);
      ctx.clip();
      ctx.drawImage(shot.photo, s.x + shot.left, s.y + shot.top, dw, dh);
      ctx.restore();
    });
    ctx.drawImage(frameImage, 0, 0, frame.w, frame.h);

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
  btnRetake.addEventListener("click", startSequence);
  btnDownload.addEventListener("click", download);
  btnOtherFrame.addEventListener("click", () => {
    stopCamera();
    screenCamera.hidden = true;
    screenSelect.hidden = false;
  });
})();
