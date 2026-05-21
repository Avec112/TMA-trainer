import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const DEG = Math.PI / 180;
const NM_PER_KT_PER_MIN = 1 / 60;
const SCENARIO_DURATION_MIN = 24;
const MAX_TRAINING_RANGE_NM = 18;
const MIN_TRAINING_RANGE_NM = 3;
const WORLD_LIMIT_NM = 16;
const MAX_BEARING_LINE_LENGTH_NM = 30;
const MIN_BEARING_SPREAD_DEG = 5;
const MAX_BEARING_SPREAD_DEG = 35;
const MIN_ABS_BEARING_RATE_DEG_PER_MIN = 0.18;

function norm360(d) {
  return ((d % 360) + 360) % 360;
}

function angleDiff(a, b) {
  let d = norm360(a - b);
  if (d > 180) d -= 360;
  return d;
}

function bearingDeg(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return norm360(Math.atan2(dx, dy) / DEG);
}

function move(pos, courseDeg, speedKt, minutes) {
  const d = speedKt * NM_PER_KT_PER_MIN * minutes;
  return pointAtBearingRange(pos, courseDeg, d);
}

function pointAtBearingRange(pos, bearingDegValue, rangeNm) {
  return {
    x: pos.x + Math.sin(bearingDegValue * DEG) * rangeNm,
    y: pos.y + Math.cos(bearingDegValue * DEG) * rangeNm,
  };
}

function projectPoint(p, scale, w, h) {
  return {
    x: w / 2 + p.x * scale,
    y: h / 2 - p.y * scale,
  };
}

function lineFromBearing(origin, bearing, length = 100) {
  return {
    a: origin,
    b: pointAtBearingRange(origin, bearing, length),
  };
}

function bearingLineIntersection(a, b) {
  const d1 = unitFromCourse(a.brg);
  const d2 = unitFromCourse(b.brg);
  const cross = d1.x * d2.y - d1.y * d2.x;

  if (Math.abs(cross) < 0.0001) return null;

  const dx = b.own.x - a.own.x;
  const dy = b.own.y - a.own.y;
  const t = (dx * d2.y - dy * d2.x) / cross;

  return {
    x: a.own.x + d1.x * t,
    y: a.own.y + d1.y * t,
  };
}

function add(p, v) {
  return { x: p.x + v.x, y: p.y + v.y };
}

function perpUnit(courseDeg) {
  return {
    x: Math.cos(courseDeg * DEG),
    y: -Math.sin(courseDeg * DEG),
  };
}

function unitFromCourse(courseDeg) {
  return {
    x: Math.sin(courseDeg * DEG),
    y: Math.cos(courseDeg * DEG),
  };
}

function ownshipAt(sc, ownStart, t, ownManeuver) {
  if (!ownManeuver || t <= 6) {
    return {
      own: move(ownStart, sc.ownCourse, sc.ownSpeed, t),
      ownCourse: sc.ownCourse,
    };
  }

  const maneuverCourse = norm360(sc.ownCourse + (sc.ownManeuverDelta ?? 55));
  const maneuverStart = move(ownStart, sc.ownCourse, sc.ownSpeed, 6);

  return {
    own: move(maneuverStart, maneuverCourse, sc.ownSpeed, t - 6),
    ownCourse: maneuverCourse,
  };
}

function classifyLOS(ownCourse, ownSpeed, tgtCourse, tgtSpeed, losBearing) {
  const los = losBearing * DEG;
  const acrossAxis = { x: Math.cos(los), y: -Math.sin(los) };
  const ownV = { x: Math.sin(ownCourse * DEG) * ownSpeed, y: Math.cos(ownCourse * DEG) * ownSpeed };
  const tgtV = { x: Math.sin(tgtCourse * DEG) * tgtSpeed, y: Math.cos(tgtCourse * DEG) * tgtSpeed };
  const ownAcross = ownV.x * acrossAxis.x + ownV.y * acrossAxis.y;
  const tgtAcross = tgtV.x * acrossAxis.x + tgtV.y * acrossAxis.y;

  if (Math.sign(ownAcross) !== Math.sign(tgtAcross)) return "LAG";
  if (Math.abs(ownAcross) > Math.abs(tgtAcross)) return "OVERLEAD";
  return "LEAD";
}

function makeRng(seed) {
  let value = (seed + 1) * 0x9e3779b1;

  return function rng() {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return ((value >>> 0) / 4294967296);
  };
}

function randomBetween(rng, min, max) {
  return min + rng() * (max - min);
}

function randomInt(rng, min, max) {
  return Math.floor(randomBetween(rng, min, max + 1));
}

function coursePointsInside(courseDeg, side) {
  const dir = unitFromCourse(courseDeg);

  switch (side) {
    case "bottom":
      return dir.y > 0;
    case "top":
      return dir.y < 0;
    case "left":
      return dir.x > 0;
    case "right":
      return dir.x < 0;
    default:
      return true;
  }
}

function randomEdgePosition(rng, side, margin = 0.35) {
  switch (side) {
    case "bottom":
      return { x: randomBetween(rng, -10, 10), y: -14 + margin };
    case "top":
      return { x: randomBetween(rng, -10, 10), y: 14 - margin };
    case "left":
      return { x: -14 + margin, y: randomBetween(rng, -10, 10) };
    case "right":
      return { x: 14 - margin, y: randomBetween(rng, -10, 10) };
    default:
      return { x: 0, y: 0 };
  }
}

function buildCandidateScenario(rng) {
  const ownSideOptions = ["bottom", "top", "left", "right"];
  const ownSide = ownSideOptions[randomInt(rng, 0, ownSideOptions.length - 1)];

  let ownCourse = randomInt(rng, 0, 359);
  while (!coursePointsInside(ownCourse, ownSide)) {
    ownCourse = randomInt(rng, 0, 359);
  }

  const ownSpeed = randomInt(rng, 8, 14);
  const ownStart = randomEdgePosition(rng, ownSide);

  // Create the contact from ownship's initial line of sight.
  // This keeps the target inside a realistic sonar-training range instead of
  // placing it randomly somewhere on the far world edge.
  const bearingToTarget = randomInt(rng, 0, 359);
  const initialRange = randomBetween(rng, MIN_TRAINING_RANGE_NM, MAX_TRAINING_RANGE_NM);
  const tgtStart = pointAtBearingRange(ownStart, bearingToTarget, initialRange);

  let tgtCourse = randomInt(rng, 0, 359);
  let guard = 0;
  while (guard < 100) {
    const projectedTgt = move(tgtStart, tgtCourse, 12, SCENARIO_DURATION_MIN);
    if (Math.abs(projectedTgt.x) <= WORLD_LIMIT_NM && Math.abs(projectedTgt.y) <= WORLD_LIMIT_NM) break;
    tgtCourse = randomInt(rng, 0, 359);
    guard += 1;
  }

  const tgtSpeed = randomInt(rng, 4, 14);
  const initialLos = classifyLOS(ownCourse, ownSpeed, tgtCourse, tgtSpeed, bearingToTarget);

  let ownManeuverDelta = 55;
  const crossingBias = angleDiff(tgtCourse, ownCourse);

  if (Math.abs(crossingBias) < 35) {
    ownManeuverDelta = crossingBias >= 0 ? 70 : -70;
  } else if (initialLos === "OVERLEAD") {
    ownManeuverDelta = crossingBias >= 0 ? -45 : 45;
  } else {
    ownManeuverDelta = crossingBias >= 0 ? 55 : -55;
  }

  return {
    name: "Generated sonar contact",
    ownSide,
    ownCourse,
    ownSpeed,
    ownManeuverDelta,
    tgtCourse,
    tgtSpeed,
    tgtStart,
    ownStart,
  };
}

function scenarioFitsWorld(sc) {
  const bearings = [];

  for (let t = 0; t <= SCENARIO_DURATION_MIN; t += 2) {
    const { own } = ownshipAt(sc, sc.ownStart, t, false);
    const tgt = move(sc.tgtStart, sc.tgtCourse, sc.tgtSpeed, t);
    const range = Math.hypot(tgt.x - own.x, tgt.y - own.y);

    if (Math.abs(own.x) > WORLD_LIMIT_NM || Math.abs(own.y) > WORLD_LIMIT_NM) return false;
    if (Math.abs(tgt.x) > WORLD_LIMIT_NM || Math.abs(tgt.y) > WORLD_LIMIT_NM) return false;
    if (range < MIN_TRAINING_RANGE_NM || range > MAX_TRAINING_RANGE_NM) return false;

    bearings.push(bearingDeg(own, tgt));
  }

  const firstLegBearings = bearings.slice(0, 7); // 0-12 minutes.
  const bearingSpread = Math.abs(angleDiff(firstLegBearings[firstLegBearings.length - 1], firstLegBearings[0]));
  const avgBearingRate = bearingSpread / 12;

  // Reject weak/near-parallel geometry and cartoonishly sharp fans.
  if (bearingSpread < MIN_BEARING_SPREAD_DEG) return false;
  if (bearingSpread > MAX_BEARING_SPREAD_DEG) return false;
  if (avgBearingRate < MIN_ABS_BEARING_RATE_DEG_PER_MIN) return false;

  return true;
}

function generateScenario(seed) {
  const rng = makeRng(seed);

  for (let i = 0; i < 80; i += 1) {
    const candidate = buildCandidateScenario(rng);
    if (scenarioFitsWorld(candidate)) {
      return candidate;
    }
  }

  return {
    name: "Fallback sonar contact",
    ownSide: "bottom",
    tgtSide: "top",
    ownCourse: 25,
    ownSpeed: 10,
    ownManeuverDelta: 60,
    tgtCourse: 205,
    tgtSpeed: 8,
    ownStart: { x: -5, y: -12 },
    tgtStart: { x: 7, y: 12 },
  };
}

function scenario(seed) {
  return generateScenario(seed);
}

export default function TMATrainer() {
  const [seed, setSeed] = useState(0);
  const [historyMinutes, setHistoryMinutes] = useState(12);
  const [ownManeuver, setOwnManeuver] = useState(false);
  const [showTruth, setShowTruth] = useState(false);
  const [rangeGuess, setRangeGuess] = useState(8);
  const [courseGuess, setCourseGuess] = useState(180);
  const [speedGuess, setSpeedGuess] = useState(8);
  const [zoom, setZoom] = useState(32);
  const MIN_ZOOM = 16;
  const MAX_ZOOM = 76;
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ active: false, startX: 0, startY: 0, startPan: { x: 0, y: 0 } });
  const plotRef = useRef(null);
  const solutionPanelRef = useRef(null);

  const sc = useMemo(() => scenario(seed), [seed]);
  const ownStart = sc.ownStart;

  const allData = useMemo(() => {
    const rows = [];

    for (let t = 0; t <= SCENARIO_DURATION_MIN; t += 2) {
      const { own, ownCourse } = ownshipAt(sc, ownStart, t, ownManeuver);
      const tgt = move(sc.tgtStart, sc.tgtCourse, sc.tgtSpeed, t);
      const brg = bearingDeg(own, tgt);
      const range = Math.hypot(tgt.x - own.x, tgt.y - own.y);
      rows.push({ t, own, tgt, brg, range, ownCourse });
    }

    return rows;
  }, [sc, ownManeuver]);

  const data = useMemo(() => {
    return allData.filter((r) => r.t <= historyMinutes);
  }, [allData, historyMinutes]);

  const latest = data[data.length - 1];

  const los = classifyLOS(latest.ownCourse, sc.ownSpeed, sc.tgtCourse, sc.tgtSpeed, latest.brg);
  const bearingRate = data.length > 1 ? angleDiff(data[data.length - 1].brg, data[data.length - 2].brg) / 2 : 0;

  // The solution is anchored to the latest visible ownship position.
  // Increasing time adds new bearing lines and moves ownship forward.
  const guessCurrent = pointAtBearingRange(latest.own, latest.brg, rangeGuess);

  const guessTrack = data.map((r) => {
    const dt = latest.t - r.t;
    return move(guessCurrent, norm360(courseGuess + 180), speedGuess, dt);
  });

  const bearingResiduals = data.map((r, i) => Math.abs(angleDiff(bearingDeg(r.own, guessTrack[i]), r.brg)));
  const meanBearingError = bearingResiduals.reduce((a, b) => a + b, 0) / Math.max(1, bearingResiduals.length);

  const rulerDir = unitFromCourse(courseGuess);
  const rulerPerp = perpUnit(courseGuess);
  const rulerStart = guessTrack[0];
  const rulerEnd = guessTrack[guessTrack.length - 1];
  const rulerArrowBase = add(rulerEnd, { x: rulerDir.x * 0.75, y: rulerDir.y * 0.75 });
  const rulerArrowTip = add(rulerEnd, { x: rulerDir.x * 1.2, y: rulerDir.y * 1.2 });
  const tickHalfWidthNm = 0.22;

  const truthTrack = data.map((r) => r.tgt);
  const truthDir = unitFromCourse(sc.tgtCourse);
  const truthPerp = perpUnit(sc.tgtCourse);
  const truthStart = truthTrack[0];
  const truthEnd = truthTrack[truthTrack.length - 1];
  const truthArrowBase = add(truthEnd, { x: truthDir.x * 0.75, y: truthDir.y * 0.75 });
  const truthArrowTip = add(truthEnd, { x: truthDir.x * 1.2, y: truthDir.y * 1.2 });

  const W = 1000;
  const H = 760;
  const scale = zoom;

  const displayEntrySide = useMemo(() => {
    if (data.length < 2) return sc.ownSide;

    const first = data[0].own;
    const second = data[1].own;
    const dx = second.x - first.x;
    const dy = second.y - first.y;

    if (Math.abs(dy) >= Math.abs(dx)) {
      return dy >= 0 ? "bottom" : "top";
    }

    return dx >= 0 ? "left" : "right";
  }, [data, sc.ownSide]);

  const safePlotArea = {
    left: 285,
    right: W - 92,
    top: 96,
    bottom: H - 108,
  };

  function calculatePlotCenter(scaleValue) {
    // Display rule:
    // Place latest ownship close to the inner plotting edge, with the current LOS
    // projecting through the plotter center. Then nudge the view just enough to keep
    // every ownship plot inside the inner padding boundary.
    const latestOwnship = latest.own;
    const centerScreen = { x: W / 2, y: H / 2 };

    const bearingScreenDir = {
      x: Math.sin(latest.brg * DEG),
      y: -Math.cos(latest.brg * DEG),
    };

    const outwardDir = {
      x: -bearingScreenDir.x,
      y: -bearingScreenDir.y,
    };

    const edgePaddingPx = 76;
    const inner = {
      left: edgePaddingPx,
      right: W - edgePaddingPx,
      top: edgePaddingPx,
      bottom: H - edgePaddingPx,
    };

    const candidates = [];

    if (outwardDir.x < -0.0001) {
      candidates.push((inner.left - centerScreen.x) / outwardDir.x);
    }
    if (outwardDir.x > 0.0001) {
      candidates.push((inner.right - centerScreen.x) / outwardDir.x);
    }
    if (outwardDir.y < -0.0001) {
      candidates.push((inner.top - centerScreen.y) / outwardDir.y);
    }
    if (outwardDir.y > 0.0001) {
      candidates.push((inner.bottom - centerScreen.y) / outwardDir.y);
    }

    const edgeDistance = Math.max(0, Math.min(...candidates.filter((v) => Number.isFinite(v) && v > 0)));
    const desiredDistance = Math.max(0, edgeDistance - 10);

    const desiredOwnshipScreen = {
      x: centerScreen.x + outwardDir.x * desiredDistance,
      y: centerScreen.y + outwardDir.y * desiredDistance,
    };

    let centerX = latestOwnship.x - (desiredOwnshipScreen.x - W / 2) / scaleValue;
    let centerY = latestOwnship.y + (desiredOwnshipScreen.y - H / 2) / scaleValue;

    const ownScreens = data.map((r) => projectPoint({ x: r.own.x - centerX, y: r.own.y - centerY }, scaleValue, W, H));
    const minScreenX = Math.min(...ownScreens.map((p) => p.x));
    const maxScreenX = Math.max(...ownScreens.map((p) => p.x));
    const minScreenY = Math.min(...ownScreens.map((p) => p.y));
    const maxScreenY = Math.max(...ownScreens.map((p) => p.y));

    if (minScreenX < inner.left) centerX -= (inner.left - minScreenX) / scaleValue;
    if (maxScreenX > inner.right) centerX += (maxScreenX - inner.right) / scaleValue;
    if (minScreenY < inner.top) centerY += (inner.top - minScreenY) / scaleValue;
    if (maxScreenY > inner.bottom) centerY -= (maxScreenY - inner.bottom) / scaleValue;

    return { x: centerX, y: centerY };
  }

  const plotCenter = useMemo(() => calculatePlotCenter(scale), [data, scale, displayEntrySide]);

  const truthErrNm = Math.hypot(guessCurrent.x - latest.tgt.x, guessCurrent.y - latest.tgt.y);
  const courseErr = Math.abs(angleDiff(courseGuess, sc.tgtCourse));
  const speedErr = Math.abs(speedGuess - sc.tgtSpeed);
  const score = Math.max(0, 100 - truthErrNm * 12 - courseErr * 0.8 - speedErr * 5);

  const pp = (p) => {
    const projected = projectPoint({ x: p.x - plotCenter.x, y: p.y - plotCenter.y }, scale, W, H);
    return {
      x: projected.x + pan.x,
      y: projected.y + pan.y,
    };
  };
  const ownshipReference = pp(latest.own);

  function nextScenario() {
    setSeed((current) => current + 1);
    setShowTruth(false);
    setRangeGuess(8);
    setCourseGuess(180);
    setSpeedGuess(8);
    setPan({ x: 0, y: 0 });
  }

  function movePan(dx, dy) {
    setPan((current) => ({
      x: current.x + dx,
      y: current.y + dy,
    }));
  }

  function startDrag(event) {
    if (event.button !== 0) return;
    dragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      startPan: pan,
    };
  }

  function dragPlot(event) {
    if (!dragRef.current.active) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    setPan({
      x: dragRef.current.startPan.x + dx,
      y: dragRef.current.startPan.y + dy,
    });
  }

  function stopDrag() {
    dragRef.current.active = false;
  }

  function resetView() {
    setPan({ x: 0, y: 0 });
    setZoom(32);
  }

  useEffect(() => {
    const solutionPanel = solutionPanelRef.current;

    if (solutionPanel) {
      const sliderMap = [
        {
          selector: '[data-slider="time"]',
          min: 4,
          max: 24,
          step: 2,
          getter: () => historyMinutes,
          setter: setHistoryMinutes,
        },
        {
          selector: '[data-slider="range"]',
          min: 1,
          max: 25,
          step: 0.1,
          getter: () => rangeGuess,
          setter: setRangeGuess,
        },
        {
          selector: '[data-slider="course"]',
          min: 0,
          max: 359,
          step: 1,
          getter: () => courseGuess,
          setter: setCourseGuess,
        },
        {
          selector: '[data-slider="speed"]',
          min: 1,
          max: 25,
          step: 1,
          getter: () => speedGuess,
          setter: setSpeedGuess,
        },
      ];

      const cleanupSliders = sliderMap.map((cfg) => {
        const el = solutionPanel.querySelector(cfg.selector);
        if (!el) return () => {};

        const handler = (event) => {
          event.preventDefault();
          event.stopPropagation();
          const direction = event.deltaY < 0 ? cfg.step : -cfg.step;
          const next = Math.min(cfg.max, Math.max(cfg.min, cfg.getter() + direction));
          cfg.setter(Number(next.toFixed(2)));
        };

        el.addEventListener("wheel", handler, { passive: false });

        return () => el.removeEventListener("wheel", handler);
      });

      return () => cleanupSliders.forEach((fn) => fn());
    }
  }, [historyMinutes, rangeGuess, courseGuess, speedGuess]);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return undefined;

    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const rect = plot.getBoundingClientRect();
      const mouseX = ((event.clientX - rect.left) / rect.width) * W;
      const mouseY = ((event.clientY - rect.top) / rect.height) * H;

      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + (event.deltaY < 0 ? 4 : -4)));
      if (nextZoom === zoom) return;

      const worldUnderMouse = {
        x: plotCenter.x + (mouseX - W / 2 - pan.x) / scale,
        y: plotCenter.y - (mouseY - H / 2 - pan.y) / scale,
      };

      const nextPlotCenter = calculatePlotCenter(nextZoom);

      setPan({
        x: mouseX - (W / 2 + (worldUnderMouse.x - nextPlotCenter.x) * nextZoom),
        y: mouseY - (H / 2 - (worldUnderMouse.y - nextPlotCenter.y) * nextZoom),
      });
      setZoom(nextZoom);
    };

    plot.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      plot.removeEventListener("wheel", handleWheel);
    };
  }, [zoom, scale, pan, plotCenter, data]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const tagName = event.target?.tagName?.toLowerCase();
      if (["input", "textarea", "select"].includes(tagName)) return;

      const panStep = 32;
      const zoomStep = 4;

      switch (event.key) {
        case "ArrowUp":
        case "w":
        case "W":
          event.preventDefault();
          movePan(0, -panStep);
          break;
        case "ArrowDown":
        case "s":
        case "S":
          event.preventDefault();
          movePan(0, panStep);
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          event.preventDefault();
          movePan(-panStep, 0);
          break;
        case "ArrowRight":
        case "d":
        case "D":
          event.preventDefault();
          movePan(panStep, 0);
          break;
        case "+":
        case "=":
          event.preventDefault();
          setZoom((current) => Math.min(MAX_ZOOM, current + zoomStep));
          break;
        case "-":
        case "_":
          event.preventDefault();
          setZoom((current) => Math.max(MIN_ZOOM, current - zoomStep));
          break;
        case " ":
          event.preventDefault();
          resetView();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 p-6 overflow-x-hidden" style={{ backgroundColor: 'rgb(2,6,23)' }}>
      <div className="w-full max-w-none space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="text-3xl font-bold tracking-tight">TMA Trainer</h1>
              <span className="text-slate-400">(Build: 59)</span>
            </div>
            <p className="text-slate-400 mt-1">Practice bearing lines, LOS classification, range/course/speed estimation.</p>
          </div>
          
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_330px] gap-4">
          <Card className="bg-slate-900 border-slate-800 shadow-xl">
            <CardContent className="p-4">
              <div className="relative">
              {/* Plotter */}
              <svg
                preserveAspectRatio="xMidYMid meet"
                ref={plotRef}
                viewBox={`0 0 ${W} ${H}`}
                className="w-full h-[70vh] min-h-[620px] rounded-2xl bg-slate-950 border border-slate-800 cursor-grab active:cursor-grabbing select-none overscroll-contain"
                onMouseDown={startDrag}
                onMouseMove={dragPlot}
                onMouseUp={stopDrag}
                onMouseLeave={stopDrag}
              >
                <rect width={W} height={H} fill="rgb(2,6,23)" />
                {data.map((r, i) => {
                  const ln = lineFromBearing(r.own, r.brg, MAX_BEARING_LINE_LENGTH_NM);
                  const a = pp(ln.a);
                  const b = pp(ln.b);
                  return (
                    <line
                      key={`bearing-${i}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="rgba(217,70,239,0.72)"
                      strokeWidth="2"
                    />
                  );
                })}

                <polyline
                  points={data
                    .map((r) => {
                      const p = pp(r.own);
                      return `${p.x},${p.y}`;
                    })
                    .join(" ")}
                  fill="none"
                  stroke="rgb(56,189,248)"
                  strokeWidth="2"
                />

                {showTruth && (
                  <>
                    {(() => {
                      const a = pp(truthStart);
                      const b = pp(truthArrowTip);
                      return (
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke="rgb(248,113,113)"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      );
                    })()}

                    {truthTrack.map((g, i) => {
                      const left = add(g, { x: truthPerp.x * tickHalfWidthNm, y: truthPerp.y * tickHalfWidthNm });
                      const right = add(g, { x: -truthPerp.x * tickHalfWidthNm, y: -truthPerp.y * tickHalfWidthNm });
                      const a = pp(left);
                      const b = pp(right);
                      return (
                        <line
                          key={`truth-tick-${i}`}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke="rgb(248,113,113)"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      );
                    })}

                    {(() => {
                      const p = pp(truthArrowTip);
                      const q1 = pp(add(truthArrowBase, { x: truthPerp.x * 0.18, y: truthPerp.y * 0.18 }));
                      const q2 = pp(add(truthArrowBase, { x: -truthPerp.x * 0.18, y: -truthPerp.y * 0.18 }));
                      return (
                        <>
                          <line
                            x1={p.x}
                            y1={p.y}
                            x2={q1.x}
                            y2={q1.y}
                            stroke="rgb(248,113,113)"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                          <line
                            x1={p.x}
                            y1={p.y}
                            x2={q2.x}
                            y2={q2.y}
                            stroke="rgb(248,113,113)"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </>
                      );
                    })()}
                  </>
                )}

                {data.slice(0, -1).map((r, i) => {
                  const p = pp(r.own);
                  return <circle key={`own-${i}`} cx={p.x} cy={p.y} r="4" fill="rgb(56,189,248)" />;
                })}

                {(() => {
                  const p = pp(latest.own);
                  const symbolRadius = 7;

                  return (
                    <g>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={symbolRadius}
                        fill="none"
                        stroke="rgb(96,165,250)"
                        strokeWidth="2"
                      />
                      <line
                        x1={p.x - symbolRadius}
                        y1={p.y}
                        x2={p.x + symbolRadius}
                        y2={p.y}
                        stroke="rgb(96,165,250)"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <line
                        x1={p.x}
                        y1={p.y - symbolRadius}
                        x2={p.x}
                        y2={p.y + symbolRadius}
                        stroke="rgb(96,165,250)"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </g>
                  );
                })()}

                

                {/* Candidate solution ruler */}
                {(() => {
                  const a = pp(rulerStart);
                  const b = pp(rulerArrowTip);
                  return (
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="rgb(250,204,21)"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  );
                })()}

                {guessTrack.map((g, i) => {
                  const left = add(g, { x: rulerPerp.x * tickHalfWidthNm, y: rulerPerp.y * tickHalfWidthNm });
                  const right = add(g, { x: -rulerPerp.x * tickHalfWidthNm, y: -rulerPerp.y * tickHalfWidthNm });
                  const a = pp(left);
                  const b = pp(right);
                  return (
                    <line
                      key={`tick-${i}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="rgb(250,204,21)"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  );
                })}

                {(() => {
                  const p = pp(rulerArrowTip);
                  const q1 = pp(add(rulerArrowBase, { x: rulerPerp.x * 0.18, y: rulerPerp.y * 0.18 }));
                  const q2 = pp(add(rulerArrowBase, { x: -rulerPerp.x * 0.18, y: -rulerPerp.y * 0.18 }));
                  return (
                    <>
                      <line
                        x1={p.x}
                        y1={p.y}
                        x2={q1.x}
                        y2={q1.y}
                        stroke="rgb(250,204,21)"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <line
                        x1={p.x}
                        y1={p.y}
                        x2={q2.x}
                        y2={q2.y}
                        stroke="rgb(250,204,21)"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </>
                  );
                })()}
              </svg>

              <div className="absolute top-4 left-4 rounded-xl border border-slate-700/70 bg-slate-900/90 px-4 py-3 text-sm leading-5 shadow-lg">
                <div className="text-sky-400">Ownship track = blue</div>
                <div className="text-fuchsia-500">Bearing lines = magenta</div>
                <div className="text-yellow-400">Guess = yellow</div>
                {showTruth && <div className="text-red-300">Truth target track = red</div>}
              </div>

              <div className="absolute top-4 right-20 flex flex-col items-center text-green-400 text-sm leading-none">
                <div>4 NM</div>
                <div className="mt-2 flex items-center" style={{ width: `${4 * zoom}px` }}>
                  <div className="h-4 border-l-2 border-green-400" />
                  <div className="h-0.5 flex-1 bg-green-400" />
                  <div className="h-4 border-l-2 border-green-400" />
                </div>
              </div>

              <div className="absolute top-4 right-4 flex flex-col items-center text-slate-300 text-sm font-semibold leading-none">
                <div className="relative h-8 w-5">
                  <div className="absolute left-1/2 top-0 h-7 -translate-x-1/2 border-l-2 border-slate-300" />
                  <div className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rotate-45 border-l-2 border-t-2 border-slate-300" />
                </div>
                <div>N</div>
              </div>

              <div className="absolute bottom-4 right-4 flex flex-col gap-2">
                <button
                  className="w-10 h-10 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-100 text-xl hover:bg-slate-800"
                  onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 4))}
                >
                  +
                </button>
                <button
                  className="w-10 h-10 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-100 text-xl hover:bg-slate-800"
                  onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 4))}
                >
                  −
                </button>
              </div>

              <div className="absolute bottom-4 left-4 grid grid-cols-3 gap-1">
                <div />
                <button
                  className="w-9 h-9 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-100 hover:bg-slate-800"
                  onClick={() => movePan(0, -32)}
                >
                  ↑
                </button>
                <div />
                <button
                  className="w-9 h-9 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-100 hover:bg-slate-800"
                  onClick={() => movePan(-32, 0)}
                >
                  ←
                </button>
                <button
                  className="w-9 h-9 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-100 text-xs hover:bg-slate-800"
                  onClick={resetView}
                >
                  C
                </button>
                <button
                  className="w-9 h-9 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-100 hover:bg-slate-800"
                  onClick={() => movePan(32, 0)}
                >
                  →
                </button>
                <div />
                <button
                  className="w-9 h-9 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-100 hover:bg-slate-800"
                  onClick={() => movePan(0, 32)}
                >
                  ↓
                </button>
                <div />
              </div>
            </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4 space-y-3">
                <h2 className="text-xl font-semibold text-slate-100">Scenario</h2>
                <div className="text-sm text-slate-300 space-y-1">
                  <div><span className="text-slate-500">Case:</span> {sc.name}</div>
                  <div><span className="text-slate-500">Current time:</span> {historyMinutes} min</div>
                  <div><span className="text-slate-500">Bearing lines:</span> {data.length}</div>
                  <div><span className="text-slate-500">Latest bearing:</span> {latest.brg.toFixed(1)}°</div>
                  <div><span className="text-slate-500">Bearing rate:</span> {bearingRate.toFixed(2)}°/min</div>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={ownManeuver} onChange={(e) => setOwnManeuver(e.target.checked)} />
                  Ownship course change after 6 min
                </label>
                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1 bg-white text-black hover:bg-slate-200"
                    onClick={nextScenario}
                  >
                    New scenario
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4 text-sm text-slate-300 space-y-3">
                <h2 className="text-xl font-semibold text-slate-100">Truth</h2>

                <Button
                  className={`w-full text-white ${
                    showTruth
                      ? "bg-red-700 hover:bg-red-600"
                      : "bg-red-900 hover:bg-red-800"
                  }`}
                  onClick={() => setShowTruth(!showTruth)}
                >
                  {showTruth ? "Hide truth" : "Show truth"}
                </Button>

                {showTruth && (
                  <div className="space-y-1 pt-1">
                    <div><span className="text-slate-500">LOS:</span> <span className="font-bold">{los}</span></div>
                    <div><span className="text-slate-500">Target speed:</span> {sc.tgtSpeed} kt</div>
                    <div><span className="text-slate-500">Bearing fit:</span> <span className="font-bold">{meanBearingError.toFixed(2)}° avg error</span></div>
                    <div><span className="text-slate-500">Truth range error:</span> <span className="font-bold">{truthErrNm.toFixed(2)} NM</span></div>
                    <div><span className="text-slate-500">Score:</span> <span className="font-bold">{score.toFixed(0)}</span>/100</div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800">
              <CardContent ref={solutionPanelRef} className="p-4 space-y-4">
                <h2 className="text-xl font-semibold text-slate-100">Your solution</h2>
                <div>
                  <label className="text-sm text-slate-400">Time: {historyMinutes} min</label>
                  <input data-slider="time" className="w-full" type="range" min="4" max="24" step="2" value={historyMinutes} onChange={(e) => setHistoryMinutes(Number(e.target.value))} />
                </div>
                <div>
                  <label className="text-sm text-slate-400">Range guess: {rangeGuess.toFixed(1)} NM</label>
                  <input data-slider="range" className="w-full" type="range" min="1" max="25" step="0.1" value={rangeGuess} onChange={(e) => setRangeGuess(Number(e.target.value))} />
                </div>
                <div>
                  <label className="text-sm text-slate-400">Course guess: {courseGuess}°</label>
                  <input data-slider="course" className="w-full" type="range" min="0" max="359" step="1" value={courseGuess} onChange={(e) => setCourseGuess(Number(e.target.value))} />
                </div>
                <div>
                  <label className="text-sm text-slate-400">Speed guess: {speedGuess} kt</label>
                  <input data-slider="speed" className="w-full" type="range" min="1" max="25" step="1" value={speedGuess} onChange={(e) => setSpeedGuess(Number(e.target.value))} />
                </div>
                
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4 text-sm text-slate-300 space-y-2">
                <h2 className="text-xl font-semibold text-slate-100">Drill</h2>
                <p>1. Hide truth.</p>
                <p>2. Classify LOS from the bearing fan.</p>
                <p>3. Adjust range, course, and speed until the yellow ruler ticks sit on the bearing lines.</p>
                <p>4. Add more time and bearing lines. Ownship should advance to the newest plot.</p>

                </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4 text-sm text-slate-400 space-y-1">
                <h2 className="text-xl font-semibold text-slate-100 mb-2">Controls</h2>

                <div><span className="text-slate-200 font-semibold">Mouse:</span> Drag to pan</div>
                <div><span className="text-slate-200 font-semibold">Mouse wheel:</span> Zoom</div>
                <div><span className="text-slate-200 font-semibold">Movement:</span> WASD or Arrow Keys</div>
                <div><span className="text-slate-200 font-semibold">Zoom:</span> + and -</div>
                <div><span className="text-slate-200 font-semibold">Reset view:</span> Space</div>
              </CardContent>
            </Card>

            
          </div>
        </div>
      </div>
    </div>
  );
}
