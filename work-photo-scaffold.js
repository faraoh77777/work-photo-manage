// work-photo-scaffold.js
//
// "AI 비계 물량산출" 기능 전용 모듈. index.html/admin.html 등 기존 화면의 코드나 전역 변수를
// 참조하지 않고 완전히 독립적으로 동작한다 — 나중에 이 파일 하나만 새 저장소로 옮기면 된다.
//
// 이 파일이 제공하는 것: 사진/영상 위에 얹는 <canvas> 오버레이 컴포넌트 하나.
// - 4개 모서리 드래그 핸들 (bilinear 보간으로 내부 스팬/단 경계선 위치 계산 → 원근이 있어도 자연스러움)
// - 스팬(세로선)/단(가로선) 경계선: 드래그로 위치 조정, 두 선 사이(또는 가장자리~첫 선) 탭으로 추가,
//   기존 선 탭(또는 길게 눌러도 결과 동일 — 움직이지 않은 클릭이면 항상 삭제)으로 삭제
// - 칸수/단수/폭 숫자 입력과 캔버스가 양방향 동기화
// - 조작할 때마다 가로(m)/높이(m)/체적(㎥) 실시간 재계산
//
// "설치 후 실측"/"설치 예정 미리보기" 두 모드가 이 컴포넌트 하나를 공유해서 쓴다.

(function (global) {
  'use strict';

  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

  function lerpPoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  // 사각형(tl,tr,bl,br) 안에서 (u,v)∈[0,1]² 위치의 픽셀 좌표 (bilinear 보간)
  function bilinear(pc, u, v) {
    var top = lerpPoint(pc.tl, pc.tr, u);
    var bottom = lerpPoint(pc.bl, pc.br, u);
    return lerpPoint(top, bottom, v);
  }

  // bilinear의 역변환: 픽셀 좌표 point가 사각형 안에서 어느 (u,v)인지 뉴턴법으로 추정
  function inverseBilinear(pc, point) {
    var p00 = pc.tl, p10 = pc.tr, p01 = pc.bl, p11 = pc.br;
    var e = { x: p10.x - p00.x, y: p10.y - p00.y };
    var f = { x: p01.x - p00.x, y: p01.y - p00.y };
    var g = { x: p11.x - p10.x - p01.x + p00.x, y: p11.y - p10.y - p01.y + p00.y };
    var u = 0.5, v = 0.5;
    for (var i = 0; i < 8; i++) {
      var px = p00.x + u * e.x + v * f.x + u * v * g.x - point.x;
      var py = p00.y + u * e.y + v * f.y + u * v * g.y - point.y;
      var dudx = e.x + v * g.x, dvdx = f.x + u * g.x;
      var dudy = e.y + v * g.y, dvdy = f.y + u * g.y;
      var det = dudx * dvdy - dvdx * dudy;
      if (Math.abs(det) < 1e-9) break;
      var du = (px * dvdy - dvdx * py) / det;
      var dv = (dudx * py - px * dudy) / det;
      u -= du; v -= dv;
      if (!isFinite(u) || !isFinite(v)) { u = 0.5; v = 0.5; break; }
    }
    return { u: clamp(u, 0, 1), v: clamp(v, 0, 1) };
  }

  function distToSegment(p, a, b) {
    var abx = b.x - a.x, aby = b.y - a.y;
    var len2 = abx * abx + aby * aby;
    var t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
    t = clamp(t, 0, 1);
    var projx = a.x + abx * t, projy = a.y + aby * t;
    var dx = p.x - projx, dy = p.y - projy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function crossSign(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }

  function pointInQuad(p, pc) {
    var pts = [pc.tl, pc.tr, pc.br, pc.bl];
    var sign = null;
    for (var i = 0; i < 4; i++) {
      var a = pts[i], b = pts[(i + 1) % 4];
      var cr = crossSign(a, b, p);
      var s = cr > 0 ? 1 : (cr < 0 ? -1 : 0);
      if (s === 0) continue;
      if (sign === null) sign = s; else if (sign !== s) return false;
    }
    return true;
  }

  function evenLines(count) {
    var lines = [];
    for (var i = 1; i < count; i++) lines.push(i / count);
    return lines;
  }

  function defaultCorners() {
    return {
      tl: { x: 0.15, y: 0.15 }, tr: { x: 0.85, y: 0.15 },
      bl: { x: 0.15, y: 0.85 }, br: { x: 0.85, y: 0.85 },
    };
  }

  var HANDLE_HIT_R = 22;
  var LINE_HIT_R = 14;
  var LINE_MARGIN = 0.02; // 경계선끼리 너무 붙지 않도록 최소 간격(t 단위)

  function create(opts) {
    opts = opts || {};
    var canvas = opts.canvas;
    if (!canvas) throw new Error('ScaffoldOverlay.create: canvas가 필요합니다');
    var ctx = canvas.getContext('2d');
    canvas.style.touchAction = 'none';

    var presets = {
      spanLengthM: (opts.presets && opts.presets.spanLengthM) || 1.8,
      levelHeightM: (opts.presets && opts.presets.levelHeightM) || 1.8,
    };
    var widthM = (opts.presets && opts.presets.widthM) || 0.4;

    var corners = defaultCorners();
    var spanLines = [];   // 세로 경계선(스팬 나누는 선) t값 목록, 0<t<1
    var levelLines = [];  // 가로 경계선(단 나누는 선) t값 목록, 0<t<1

    var drag = null;       // {type:'corner',key} | {type:'spanLine',index} | {type:'levelLine',index}
    var dragStartPt = null;
    var dragMoved = false;

    var inputs = {};

    function toPx(ratioPoint) {
      return { x: ratioPoint.x * canvas.width, y: ratioPoint.y * canvas.height };
    }
    function cornersPx() {
      return { tl: toPx(corners.tl), tr: toPx(corners.tr), bl: toPx(corners.bl), br: toPx(corners.br) };
    }
    function toRatio(pxPoint) {
      return { x: clamp(pxPoint.x / canvas.width, 0, 1), y: clamp(pxPoint.y / canvas.height, 0, 1) };
    }

    function round(n, d) { var m = Math.pow(10, d); return Math.round(n * m) / m; }

    function computeState() {
      var spanCount = spanLines.length + 1;
      var levelCount = levelLines.length + 1;
      var lengthM = round(spanCount * presets.spanLengthM, 2);
      var heightM = round(levelCount * presets.levelHeightM, 2);
      var volumeM3 = round(lengthM * widthM * heightM, 3);
      return {
        corners: { tl: { x: corners.tl.x, y: corners.tl.y }, tr: { x: corners.tr.x, y: corners.tr.y },
                   bl: { x: corners.bl.x, y: corners.bl.y }, br: { x: corners.br.x, y: corners.br.y } },
        spanLines: spanLines.slice(), levelLines: levelLines.slice(),
        spanCount: spanCount, levelCount: levelCount,
        widthM: widthM, lengthM: lengthM, heightM: heightM, volumeM3: volumeM3,
      };
    }

    function setInputValueIfIdle(el, value) {
      if (!el) return;
      if (document.activeElement === el) return; // 사용자가 지금 타이핑 중이면 덮어쓰지 않음
      if ('value' in el) el.value = value; else el.textContent = value;
    }

    function fireChange() {
      var state = computeState();
      setInputValueIfIdle(inputs.spanCountInput, state.spanCount);
      setInputValueIfIdle(inputs.levelCountInput, state.levelCount);
      setInputValueIfIdle(inputs.widthInput, state.widthM);
      if (inputs.lengthOutput) setInputValueIfIdle(inputs.lengthOutput, state.lengthM.toFixed(2));
      if (inputs.heightOutput) setInputValueIfIdle(inputs.heightOutput, state.heightM.toFixed(2));
      if (inputs.volumeOutput) setInputValueIfIdle(inputs.volumeOutput, state.volumeM3.toFixed(3));
      if (typeof opts.onChange === 'function') opts.onChange(state);
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var pc = cornersPx();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pc.tl.x, pc.tl.y); ctx.lineTo(pc.tr.x, pc.tr.y);
      ctx.lineTo(pc.br.x, pc.br.y); ctx.lineTo(pc.bl.x, pc.bl.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,212,0,0.10)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#FFD400';
      ctx.stroke();

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,212,0,0.85)';
      spanLines.forEach(function (t) {
        var a = bilinear(pc, t, 0), b = bilinear(pc, t, 1);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });
      levelLines.forEach(function (t) {
        var a = bilinear(pc, 0, t), b = bilinear(pc, 1, t);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });

      [pc.tl, pc.tr, pc.bl, pc.br].forEach(function (p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#2E5F9E';
        ctx.stroke();
      });
      ctx.restore();
    }

    function canvasToLocal(evt) {
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      var clientX = evt.clientX, clientY = evt.clientY;
      return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }

    function hitTestCorner(pt) {
      var pc = cornersPx();
      var keys = ['tl', 'tr', 'bl', 'br'];
      var best = null, bestD = HANDLE_HIT_R;
      keys.forEach(function (k) {
        var d = Math.hypot(pt.x - pc[k].x, pt.y - pc[k].y);
        if (d < bestD) { bestD = d; best = k; }
      });
      return best;
    }

    function hitTestSpanLine(pt) {
      var pc = cornersPx();
      var best = -1, bestD = LINE_HIT_R;
      spanLines.forEach(function (t, i) {
        var a = bilinear(pc, t, 0), b = bilinear(pc, t, 1);
        var d = distToSegment(pt, a, b);
        if (d < bestD) { bestD = d; best = i; }
      });
      return { index: best, dist: bestD };
    }

    function hitTestLevelLine(pt) {
      var pc = cornersPx();
      var best = -1, bestD = LINE_HIT_R;
      levelLines.forEach(function (t, i) {
        var a = bilinear(pc, 0, t), b = bilinear(pc, 1, t);
        var d = distToSegment(pt, a, b);
        if (d < bestD) { bestD = d; best = i; }
      });
      return { index: best, dist: bestD };
    }

    function lineBounds(lines, index) {
      var lower = index > 0 ? lines[index - 1] + LINE_MARGIN : LINE_MARGIN;
      var upper = index < lines.length - 1 ? lines[index + 1] - LINE_MARGIN : 1 - LINE_MARGIN;
      return { lower: lower, upper: upper };
    }

    function addLineAtTap(pt) {
      var pc = cornersPx();
      if (!pointInQuad(pt, pc)) return;
      var inv = inverseBilinear(pc, pt);

      var spanBoundaries = [0].concat(spanLines.slice().sort(function (a, b) { return a - b; }), [1]);
      var levelBoundaries = [0].concat(levelLines.slice().sort(function (a, b) { return a - b; }), [1]);

      var si = 0;
      for (; si < spanBoundaries.length - 1; si++) {
        if (inv.u >= spanBoundaries[si] && inv.u <= spanBoundaries[si + 1]) break;
      }
      var li = 0;
      for (; li < levelBoundaries.length - 1; li++) {
        if (inv.v >= levelBoundaries[li] && inv.v <= levelBoundaries[li + 1]) break;
      }

      var sCenter = (spanBoundaries[si] + spanBoundaries[si + 1]) / 2;
      var sHalf = (spanBoundaries[si + 1] - spanBoundaries[si]) / 2;
      var relU = sHalf > 0 ? Math.abs(inv.u - sCenter) / sHalf : 1;

      var lCenter = (levelBoundaries[li] + levelBoundaries[li + 1]) / 2;
      var lHalf = (levelBoundaries[li + 1] - levelBoundaries[li]) / 2;
      var relV = lHalf > 0 ? Math.abs(inv.v - lCenter) / lHalf : 1;

      if (relU <= relV) {
        spanLines.push(sCenter);
        spanLines.sort(function (a, b) { return a - b; });
      } else {
        levelLines.push(lCenter);
        levelLines.sort(function (a, b) { return a - b; });
      }
    }

    function onPointerDown(evt) {
      evt.preventDefault();
      var pt = canvasToLocal(evt);
      dragStartPt = pt; dragMoved = false;
      var cornerHit = hitTestCorner(pt);
      if (cornerHit) {
        drag = { type: 'corner', key: cornerHit };
      } else {
        var spanHit = hitTestSpanLine(pt);
        var levelHit = hitTestLevelLine(pt);
        if (spanHit.index >= 0 && spanHit.dist <= levelHit.dist) {
          drag = { type: 'spanLine', index: spanHit.index };
        } else if (levelHit.index >= 0) {
          drag = { type: 'levelLine', index: levelHit.index };
        } else {
          drag = null;
        }
      }
      try { canvas.setPointerCapture(evt.pointerId); } catch (e) {}
    }

    function onPointerMove(evt) {
      if (!dragStartPt) return;
      var pt = canvasToLocal(evt);
      if (Math.hypot(pt.x - dragStartPt.x, pt.y - dragStartPt.y) > 4) dragMoved = true;
      if (!drag) return;
      evt.preventDefault();

      if (drag.type === 'corner') {
        corners[drag.key] = toRatio(pt);
      } else if (drag.type === 'spanLine') {
        var pc = cornersPx();
        var inv = inverseBilinear(pc, pt);
        var b1 = lineBounds(spanLines, drag.index);
        spanLines[drag.index] = clamp(inv.u, b1.lower, b1.upper);
      } else if (drag.type === 'levelLine') {
        var pc2 = cornersPx();
        var inv2 = inverseBilinear(pc2, pt);
        var b2 = lineBounds(levelLines, drag.index);
        levelLines[drag.index] = clamp(inv2.v, b2.lower, b2.upper);
      }
      draw();
      fireChange();
    }

    function onPointerUp(evt) {
      if (!dragStartPt) return;
      var pt = canvasToLocal(evt);
      if (!dragMoved) {
        // 움직이지 않은 탭/길게 누름 → 기존 선이면 삭제, 빈 칸이면 추가
        if (drag && drag.type === 'spanLine') {
          spanLines.splice(drag.index, 1);
        } else if (drag && drag.type === 'levelLine') {
          levelLines.splice(drag.index, 1);
        } else if (!drag) {
          addLineAtTap(pt);
        }
      }
      drag = null; dragStartPt = null; dragMoved = false;
      try { canvas.releasePointerCapture(evt.pointerId); } catch (e) {}
      draw();
      fireChange();
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    function bindNumberInput(el, onCommit) {
      if (!el) return;
      var handler = function () { onCommit(el.value); };
      el.addEventListener('change', handler);
      el.addEventListener('blur', handler);
    }

    var instance = {
      setCorners: function (c) {
        corners = { tl: { x: c.tl.x, y: c.tl.y }, tr: { x: c.tr.x, y: c.tr.y },
                    bl: { x: c.bl.x, y: c.bl.y }, br: { x: c.br.x, y: c.br.y } };
        draw(); fireChange();
      },
      setGrid: function (spanCount, levelCount) {
        spanCount = clamp(Math.round(spanCount) || 1, 1, opts.maxSpans || 40);
        levelCount = clamp(Math.round(levelCount) || 1, 1, opts.maxLevels || 40);
        spanLines = evenLines(spanCount);
        levelLines = evenLines(levelCount);
        draw(); fireChange();
      },
      setWidthM: function (w) {
        w = parseFloat(w);
        if (isFinite(w) && w > 0) widthM = w;
        fireChange();
      },
      setPresets: function (p) {
        if (p.spanLengthM) presets.spanLengthM = p.spanLengthM;
        if (p.levelHeightM) presets.levelHeightM = p.levelHeightM;
        if (p.widthM) widthM = p.widthM;
        fireChange();
      },
      getState: computeState,
      reset: function () {
        corners = defaultCorners();
        spanLines = [];
        levelLines = [];
        draw(); fireChange();
      },
      resize: function (w, h) {
        canvas.width = w; canvas.height = h;
        draw();
      },
      bindInputs: function (b) {
        inputs = b || {};
        bindNumberInput(inputs.spanCountInput, function (v) { instance.setGrid(parseInt(v, 10) || 1, levelLines.length + 1); });
        bindNumberInput(inputs.levelCountInput, function (v) { instance.setGrid(spanLines.length + 1, parseInt(v, 10) || 1); });
        bindNumberInput(inputs.widthInput, function (v) { instance.setWidthM(v); });
        fireChange();
      },
      redraw: draw,
      destroy: function () {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
      },
    };

    instance.setGrid(1, 1); // "빈 기본 격자" — 외곽 사각형만 있는 1x1 상태로 시작
    return instance;
  }

  global.ScaffoldOverlay = { create: create };
})(window);
