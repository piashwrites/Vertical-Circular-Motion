/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Power, Volume2, VolumeX, Moon, Sun, Activity, Settings, Info } from 'lucide-react';

export default function App() {
  // --- STATE ---
  const [mode, setMode] = useState<'string' | 'rod'>('string');
  const [v0, setV0] = useState<number>(5.2);
  const [vInputMode, setVInputMode] = useState<'direct' | 'formula'>('direct');
  const [nFactor, setNFactor] = useState<number>(2.76); // n in v0 = √(n*g*L)
  const [theta0, setTheta0] = useState<number>(0); // Initial release angle in degrees (0° = bottom)
  const [initialDir, setInitialDir] = useState<'anticlockwise' | 'clockwise'>('anticlockwise');
  const [L, setL] = useState<number>(1.0);
  const [m, setM] = useState<number>(1.0);
  const [g, setG] = useState<number>(9.81);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isSlowMo, setIsSlowMo] = useState<boolean>(false);
  const [simSpeed, setSimSpeed] = useState<number>(1.0);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [scrubAngle, setScrubAngle] = useState<number>(0);

  const [showVectors, setShowVectors] = useState<boolean>(true);
  const [showAccelerations, setShowAccelerations] = useState<boolean>(true);
  const [showComponents, setShowComponents] = useState<boolean>(true);
  const [showTrace, setShowTrace] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);

  // Live telemetry state for React UI
  const [telemetry, setTelemetry] = useState({
    thetaDeg: 0,
    thetaRad: 0,
    speed: 5.2,
    ac: 27.04,
    at: 0,
    aTotal: 27.04,
    tension: 36.85,
    isSlackened: false,
    ke: 13.52,
    pe: 0,
    totalE: 13.52,
    thetaS: "104.6°",
    isUnreachable: false,
    unreachableMsg: ""
  });

  // Dynamic simulation physics refs
  const simState = useRef({
    theta: 0,
    omega: 5.2 / 1.0,
    v: 5.2,
    dir: 1,
    isSlackened: false,
    projX: 0,
    projY: 0,
    projVx: 0,
    projVy: 0,
    trace: [] as { x: number; y: number; slackened: boolean }[],
    shockwaves: [] as { x: number; y: number; radius: number; alpha: number }[]
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const humOscRef = useRef<OscillatorNode | null>(null);
  const humGainRef = useRef<GainNode | null>(null);

  // Audio initialization
  const initAudio = () => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        humOscRef.current = osc;
        humGainRef.current = gain;
      }
    }
  };

  const playSound = (type: 'slack' | 'impact') => {
    if (!soundEnabled) return;
    initAudio();
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (type === 'slack') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.15);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (type === 'impact') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  };

  const resetSim = () => {
    const startRad = (theta0 * Math.PI) / 180;
    const dir = initialDir === 'anticlockwise' ? 1 : -1;
    simState.current = {
      theta: startRad,
      omega: (v0 * dir) / L,
      v: v0,
      dir: dir,
      isSlackened: false,
      projX: 0,
      projY: 0,
      projVx: 0,
      projVy: 0,
      trace: [],
      shockwaves: []
    };
    updateTelemetry();
  };

  useEffect(() => {
    resetSim();
  }, [v0, theta0, initialDir, L, m, g, mode]);

  // Telemetry update
  const updateTelemetry = () => {
    const st = simState.current;
    let deg = ((st.theta * 180 / Math.PI) % 360 + 360) % 360;
    let rad = st.theta;

    const curY = st.isSlackened ? st.projY : -L * Math.cos(st.theta);
    const height = curY + L;
    const curSpeed = st.isSlackened ? Math.sqrt(st.projVx * st.projVx + st.projVy * st.projVy) : st.v;

    let tension = 0;
    let ac = 0;
    let at = 0;
    let aTotal = 0;

    if (!st.isSlackened) {
      ac = (curSpeed * curSpeed) / L;
      at = -g * Math.sin(st.theta);
      aTotal = Math.sqrt(ac * ac + at * at);
      tension = m * ac + m * g * Math.cos(st.theta);
    }

    const ke = 0.5 * m * curSpeed * curSpeed;
    const pe = m * g * height;
    const totalE = ke + pe;

    // Calculate theoretical slack angle from release angle theta0 & initial speed v0
    const theta0Rad = (theta0 * Math.PI) / 180;
    const cosTheta0 = Math.cos(theta0Rad);
    const v0Square = v0 * v0;
    const gL = g * L;

    // cos(theta_s) = (2 * gL * cos(theta0) - v0^2) / (3 * gL)
    let cosThetaS = (2 * gL * cosTheta0 - v0Square) / (3 * gL);
    let thetaSDeg = "N/A";
    if (cosThetaS >= -1 && cosThetaS <= 1) {
      let rawDeg = Math.acos(cosThetaS) * 180 / Math.PI;
      thetaSDeg = rawDeg.toFixed(1) + "°";
    }

    setTelemetry({
      thetaDeg: deg,
      thetaRad: rad,
      speed: curSpeed,
      ac,
      at: Math.abs(at),
      aTotal,
      tension: st.isSlackened ? 0 : Math.max(0, tension),
      isSlackened: st.isSlackened,
      ke,
      pe,
      totalE,
      thetaS: thetaSDeg,
      isUnreachable: false,
      unreachableMsg: ""
    });
  };

  const getInspectData = (deg: number) => {
    const theta0Rad = (theta0 * Math.PI) / 180;
    const testRad = (deg * Math.PI) / 180;
    const gL = g * L;
    const v0Square = v0 * v0;

    // 1. Energy turning angle: v^2 = v0^2 + 2gL(cos(theta) - cos(theta0)) = 0
    const cosTurn = Math.cos(theta0Rad) - v0Square / (2 * gL);
    let turnRad = Math.PI;
    if (cosTurn > -1 && cosTurn <= 1) {
      turnRad = Math.acos(cosTurn);
    }

    // 2. Slackening angle in string mode: T = 0 => cos(theta_s) = (2gL cos(theta0) - v0^2) / (3gL)
    let cosSlack = (2 * gL * Math.cos(theta0Rad) - v0Square) / (3 * gL);
    let hasSlack = mode === 'string' && cosSlack > -1 && cosSlack < 0;
    let slackRad = hasSlack ? Math.acos(cosSlack) : Math.PI;

    let maxReachableRad = Math.PI;
    let unreachableType: 'slack' | 'energy' | 'none' = 'none';

    if (hasSlack && slackRad <= turnRad) {
      maxReachableRad = slackRad;
      unreachableType = 'slack';
    } else if (cosTurn > -1) {
      maxReachableRad = turnRad;
      unreachableType = 'energy';
    }

    let effRad = testRad <= Math.PI ? testRad : (2 * Math.PI - testRad);

    if (effRad > maxReachableRad + 1e-4) {
      const maxDeg = (maxReachableRad * 180 / Math.PI).toFixed(1);
      const msg = unreachableType === 'slack'
        ? `Unreachable! String slackens at θₛ = ${maxDeg}°`
        : `Unreachable! Max oscillation angle = ${maxDeg}°`;
      const curY = -L * Math.cos(maxReachableRad);
      const height = curY + L;
      const pe = m * g * height;

      return {
        isUnreachable: true,
        msg,
        speed: 0,
        tension: 0,
        ac: 0,
        at: 0,
        aTotal: 0,
        ke: 0,
        pe,
        totalE: pe
      };
    } else {
      const vSq = v0Square + 2 * gL * (Math.cos(testRad) - Math.cos(theta0Rad));
      const calcV = vSq >= 0 ? Math.sqrt(vSq) : 0;
      const tensionVal = m * (calcV * calcV / L + g * Math.cos(testRad));
      const acVal = (calcV * calcV) / L;
      const atVal = Math.abs(-g * Math.sin(testRad));
      const aTot = Math.sqrt(acVal * acVal + atVal * atVal);
      const keVal = 0.5 * m * calcV * calcV;
      const curY = -L * Math.cos(testRad);
      const height = curY + L;
      const peVal = m * g * height;

      return {
        isUnreachable: false,
        msg: '',
        speed: calcV,
        tension: Math.max(0, tensionVal),
        ac: acVal,
        at: atVal,
        aTotal: aTot,
        ke: keVal,
        pe: peVal,
        totalE: keVal + peVal
      };
    }
  };

  const inspectData = getInspectData(scrubAngle);

  // Main Loop
  useEffect(() => {
    let animId: number;

    const integrate = (dt: number) => {
      const st = simState.current;
      const slow = isSlowMo ? 0.25 : 1.0;
      const effectiveDt = dt * simSpeed * slow;
      const subSteps = 10;
      const h = effectiveDt / subSteps;

      for (let s = 0; s < subSteps; s++) {
        if (!st.isSlackened) {
          const alpha = - (g / L) * Math.sin(st.theta);
          st.omega += alpha * h;
          st.theta += st.omega * h;
          st.v = Math.abs(st.omega * L);
          st.dir = st.omega >= 0 ? 1 : -1;

          const x = L * Math.sin(st.theta);
          const y = -L * Math.cos(st.theta);
          const tension = (m * st.v * st.v / L) + (m * g * Math.cos(st.theta));

          if (mode === 'string' && tension <= 0 && y > 0) {
            st.isSlackened = true;
            st.projX = x;
            st.projY = y;
            st.projVx = st.v * Math.cos(st.theta) * st.dir;
            st.projVy = st.v * Math.sin(st.theta) * st.dir;
            playSound('slack');
            st.shockwaves.push({ x, y, radius: 0.1, alpha: 1.0 });
            break;
          }
        } else {
          st.projVy += -g * h;
          st.projX += st.projVx * h;
          st.projY += st.projVy * h;

          const r = Math.sqrt(st.projX * st.projX + st.projY * st.projY);
          if (r >= L) {
            const reAngle = Math.atan2(st.projX, -st.projY);
            st.theta = reAngle;

            const uRx = st.projX / r;
            const uRy = st.projY / r;
            const uTx = -uRy;
            const uTy = uRx;

            const vProjTangential = st.projVx * uTx + st.projVy * uTy;
            st.omega = vProjTangential / L;
            st.v = Math.abs(vProjTangential);
            st.dir = st.omega >= 0 ? 1 : -1;
            st.isSlackened = false;

            playSound('impact');
            st.shockwaves.push({
              x: L * Math.sin(reAngle),
              y: -L * Math.cos(reAngle),
              radius: 0.15,
              alpha: 1.0
            });
            break;
          }
        }
      }

      const curX = st.isSlackened ? st.projX : L * Math.sin(st.theta);
      const curY = st.isSlackened ? st.projY : -L * Math.cos(st.theta);
      st.trace.push({ x: curX, y: curY, slackened: st.isSlackened });
      if (st.trace.length > 200) st.trace.shift();

      updateTelemetry();
    };

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }

      const width = rect.width;
      const height = rect.height;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const scale = Math.min(width, height) * 0.26 / Math.max(1, L);

      const st = simState.current;

      // Protractor & Grid
      if (showGrid) {
        ctx.strokeStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.12)';
        ctx.lineWidth = 1;

        // Circle outline
        ctx.beginPath();
        ctx.arc(centerX, centerY, L * scale, 0, Math.PI * 2);
        ctx.setLineDash([4, 4]);
        ctx.stroke();

        // Crosshairs (Vertical 0°-180° & Horizontal 90°-270°)
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - L * scale - 15);
        ctx.lineTo(centerX, centerY + L * scale + 15);
        ctx.moveTo(centerX - L * scale - 15, centerY);
        ctx.lineTo(centerX + L * scale + 15, centerY);
        ctx.strokeStyle = theme === 'dark' ? 'rgba(0, 242, 254, 0.2)' : 'rgba(2, 132, 199, 0.25)';
        ctx.stroke();
        ctx.setLineDash([]);

        // Protractor ticks & angle numbers starting from Bottom = 0° moving anticlockwise
        for (let thetaDeg = 0; thetaDeg < 360; thetaDeg += 30) {
          const rad = thetaDeg * Math.PI / 180;
          const sinT = Math.sin(rad);
          const cosT = Math.cos(rad);

          const innerR = L * scale - 8;
          const outerR = L * scale + 8;
          const labelR = L * scale + 24;

          const x1 = centerX + innerR * sinT;
          const y1 = centerY + innerR * cosT; // +cosT puts 0° at bottom (centerY + R)
          const x2 = centerX + outerR * sinT;
          const y2 = centerY + outerR * cosT;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.25)';
          ctx.stroke();

          ctx.fillStyle = theme === 'dark' ? '#E2E8F0' : '#0F172A';
          ctx.font = '700 11px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const lx = centerX + labelR * sinT;
          const ly = centerY + labelR * cosT;
          ctx.fillText(thetaDeg + '°', lx, ly);
        }
      }

      // Starting position reference marker (theta0)
      if (showGrid) {
        const startRad = (theta0 * Math.PI) / 180;
        const startX = centerX + L * scale * Math.sin(startRad);
        const startY = centerY + L * scale * Math.cos(startRad);

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(startX, startY);
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.4)';
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(startX, startY, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(234, 179, 8, 0.3)';
        ctx.fill();
        ctx.strokeStyle = '#EAB308';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = theme === 'dark' ? '#FDE047' : '#D97706';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`θ₀=${theta0}°`, startX, startY - 10);
      }

      // Trace
      if (showTrace && st.trace.length > 1) {
        ctx.beginPath();
        ctx.moveTo(centerX + st.trace[0].x * scale, centerY - st.trace[0].y * scale);
        for (let i = 1; i < st.trace.length; i++) {
          ctx.lineTo(centerX + st.trace[i].x * scale, centerY - st.trace[i].y * scale);
        }
        ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Projectile dotted arc preview
      if (st.isSlackened) {
        ctx.beginPath();
        let simX = st.projX;
        let simY = st.projY;
        let simVx = st.projVx;
        let simVy = st.projVy;
        const dtSim = 0.02;
        ctx.moveTo(centerX + simX * scale, centerY - simY * scale);
        for (let i = 0; i < 100; i++) {
          simVy -= g * dtSim;
          simX += simVx * dtSim;
          simY += simVy * dtSim;
          ctx.lineTo(centerX + simX * scale, centerY - simY * scale);
          if (Math.sqrt(simX * simX + simY * simY) >= L) break;
        }
        ctx.strokeStyle = '#F59E0B';
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const bobX = st.isSlackened ? st.projX : L * Math.sin(st.theta);
      const bobY = st.isSlackened ? st.projY : -L * Math.cos(st.theta);
      const canvasBobX = centerX + bobX * scale;
      const canvasBobY = centerY - bobY * scale;

      // String / Rod
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(canvasBobX, canvasBobY);
      if (mode === 'rod') {
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 6;
        ctx.stroke();
      } else {
        if (st.isSlackened) {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 2;
        } else {
          ctx.strokeStyle = '#0284C7';
          ctx.lineWidth = 3;
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Pivot
      ctx.beginPath();
      ctx.arc(centerX, centerY, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#334155';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00F2FE';
      ctx.stroke();

      // Bob
      const bobRadius = Math.max(12, 10 + Math.cbrt(m) * 6);
      ctx.beginPath();
      ctx.arc(canvasBobX, canvasBobY, bobRadius, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(
        canvasBobX - bobRadius * 0.3, canvasBobY - bobRadius * 0.3, bobRadius * 0.1,
        canvasBobX, canvasBobY, bobRadius
      );
      if (st.isSlackened) {
        grad.addColorStop(0, '#FCA5A5');
        grad.addColorStop(1, '#EF4444');
      } else {
        grad.addColorStop(0, '#67E8F9');
        grad.addColorStop(1, '#0284C7');
      }
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 10px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.toFixed(1) + 'kg', canvasBobX, canvasBobY);

      // Vectors (Primary & Components)
      if (showVectors) {
        const vecScale = 8;
        let vx = st.isSlackened ? st.projVx : st.v * Math.cos(st.theta) * st.dir;
        let vy = st.isSlackened ? st.projVy : st.v * Math.sin(st.theta) * st.dir;
        drawArrow(ctx, canvasBobX, canvasBobY, canvasBobX + vx * vecScale * 2, canvasBobY - vy * vecScale * 2, '#00F2FE', 'v');

        const mgLen = m * g * vecScale * 0.6;
        drawArrow(ctx, canvasBobX, canvasBobY, canvasBobX, canvasBobY + mgLen, '#EF4444', 'mg');

        if (!st.isSlackened) {
          const tension = (m * st.v * st.v / L) + (m * g * Math.cos(st.theta));
          if (tension > 0) {
            const tLen = tension * vecScale * 0.4;
            const ux = (centerX - canvasBobX) / (L * scale);
            const uy = (centerY - canvasBobY) / (L * scale);
            drawArrow(ctx, canvasBobX, canvasBobY, canvasBobX + ux * tLen, canvasBobY + uy * tLen, '#0284C7', 'T');
          }
        }

        if (showComponents && !st.isSlackened) {
          const cosVal = Math.cos(st.theta);
          const radialMg = m * g * cosVal * vecScale * 0.6;
          const uOutX = Math.sin(st.theta);
          const uOutY = -Math.cos(st.theta);
          drawArrow(ctx, canvasBobX, canvasBobY, canvasBobX + uOutX * radialMg, canvasBobY - uOutY * radialMg, '#A855F7', 'mg cosθ');

          const sinVal = Math.sin(st.theta);
          const tangMg = m * g * sinVal * vecScale * 0.6;
          const uTanX = -Math.cos(st.theta);
          const uTanY = -Math.sin(st.theta);
          drawArrow(ctx, canvasBobX, canvasBobY, canvasBobX + uTanX * tangMg, canvasBobY - uTanY * tangMg, '#F59E0B', 'mg sinθ');
        }
      }

      // Acceleration Vectors (a_c, a_t) - Independent of showVectors
      if (showAccelerations && !st.isSlackened) {
        const acVal = (st.v * st.v) / L;
        const acLen = Math.min(60, acVal * 2.5);
        const uInX = (centerX - canvasBobX) / (L * scale);
        const uInY = (centerY - canvasBobY) / (L * scale);
        drawArrow(ctx, canvasBobX, canvasBobY, canvasBobX + uInX * acLen, canvasBobY + uInY * acLen, '#EAB308', 'a_c');

        const atVal = -g * Math.sin(st.theta);
        const atLen = Math.abs(atVal) * 3;
        const uTanDirX = Math.cos(st.theta) * Math.sign(atVal || 1);
        const uTanDirY = Math.sin(st.theta) * Math.sign(atVal || 1);
        drawArrow(ctx, canvasBobX, canvasBobY, canvasBobX + uTanDirX * atLen, canvasBobY - uTanDirY * atLen, '#EC4899', 'a_t');
      }

      // Shockwaves
      for (let i = st.shockwaves.length - 1; i >= 0; i--) {
        const sw = st.shockwaves[i];
        sw.radius += 0.05;
        sw.alpha -= 0.03;
        if (sw.alpha <= 0) {
          st.shockwaves.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(centerX + sw.x * scale, centerY - sw.y * scale, sw.radius * scale, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 242, 254, ${sw.alpha})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.restore();
    };

    const drawArrow = (ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, color: string, label: string) => {
      const headLen = 10;
      const dx = toX - fromX;
      const dy = toY - fromY;
      const angle = Math.atan2(dy, dx);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 3) return;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();

      ctx.font = 'bold 11px JetBrains Mono';
      ctx.fillStyle = color;
      ctx.fillText(label, toX + Math.cos(angle) * 12, toY + Math.sin(angle) * 12);
      ctx.restore();
    };

    const tick = () => {
      if (isPlaying) {
        integrate(0.016);
      }
      draw();
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, isSlowMo, simSpeed, v0, L, m, g, mode, showVectors, showComponents, showTrace, showGrid, theme]);

  const theta0Rad = (theta0 * Math.PI) / 180;
  const cosTheta0 = Math.cos(theta0Rad);
  const vOscMax = Math.sqrt(Math.max(0, 2 * g * L * cosTheta0));
  const vLoopMin = mode === 'string'
    ? Math.sqrt(Math.max(0, g * L * (3 + 2 * cosTheta0)))
    : Math.sqrt(Math.max(0, 2 * g * L * (1 + cosTheta0)));

  const updateV0Direct = (newV0: number) => {
    setV0(newV0);
    const n = (newV0 * newV0) / (g * L);
    setNFactor(parseFloat(n.toFixed(2)));
  };

  const updateNFactor = (newN: number) => {
    setNFactor(newN);
    const computed = Math.sqrt(Math.max(0, newN * g * L));
    setV0(parseFloat(computed.toFixed(2)));
  };

  const handleLChange = (newL: number) => {
    setL(newL);
    if (vInputMode === 'formula') {
      const computed = Math.sqrt(Math.max(0, nFactor * g * newL));
      setV0(parseFloat(computed.toFixed(2)));
    } else {
      setNFactor(parseFloat(((v0 * v0) / (g * newL)).toFixed(2)));
    }
  };

  const handleGChange = (newG: number) => {
    setG(newG);
    if (vInputMode === 'formula') {
      const computed = Math.sqrt(Math.max(0, nFactor * newG * L));
      setV0(parseFloat(computed.toFixed(2)));
    } else {
      setNFactor(parseFloat(((v0 * v0) / (newG * L)).toFixed(2)));
    }
  };

  const loadPreset = (preset: 'osc' | 'slack' | 'loop' | 'critical') => {
    setMode('string');
    setTheta0(0);
    setInitialDir('anticlockwise');
    let targetN = 1.2;
    if (preset === 'osc') targetN = 1.2;
    else if (preset === 'slack') targetN = 3.5;
    else if (preset === 'loop') targetN = 6.0;
    else if (preset === 'critical') targetN = 5.0;

    setNFactor(targetN);
    setV0(parseFloat(Math.sqrt(targetN * g * L).toFixed(2)));
    setIsPlaying(true);
  };

  return (
    <div className={`h-screen w-screen flex font-sans overflow-hidden transition-colors duration-200 ${theme === 'dark' ? 'bg-[#0B0F17] text-slate-100' : 'bg-[#edf2f7] text-slate-800'}`}>
      
      {/* SIDEBAR (340px) */}
      <aside className={`w-[340px] border-r flex flex-col p-5 space-y-5 overflow-y-auto shrink-0 z-10 ${theme === 'dark' ? 'bg-[#161B26] border-gray-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800 shadow-sm'}`}>
        
        {/* BRANDING & HEADER BLOCK (IN SIDEBAR) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded flex items-center justify-center font-bold text-xl shadow-md ${theme === 'dark' ? 'bg-[#00F2FE] text-[#0B0F17] shadow-cyan-500/20' : 'bg-[#0284c7] text-white shadow-sky-500/20'}`}>U</div>
              <div>
                <h1 className="text-xs font-bold tracking-tight leading-tight">
                  VERTICAL CIRCLE <span className={theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}>&amp; PROJECTILE LAB</span>
                </h1>
                <div className={`text-[9px] uppercase tracking-widest font-semibold ${theme === 'dark' ? 'text-gray-400' : 'text-slate-500'}`}>UDVASH ACADEMIC</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`p-1.5 rounded-lg border transition ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700 text-gray-200 hover:text-[#00F2FE]' : 'bg-slate-100 border-slate-300 text-slate-700 hover:text-[#0284c7]'}`}
                title="Toggle Sound"
              >
                {soundEnabled ? <Volume2 className={`w-4 h-4 ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`} /> : <VolumeX className="w-4 h-4 text-red-500" />}
              </button>
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className={`p-1.5 rounded-lg border text-xs font-bold transition flex items-center justify-center ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700 text-cyan-400 hover:border-cyan-400' : 'bg-slate-100 border-slate-300 text-slate-700 hover:border-sky-500'}`}
                title="Toggle Theme"
              >
                {theme === 'dark' ? <Moon className="w-4 h-4 text-cyan-400" /> : <Sun className="w-4 h-4 text-amber-500" />}
              </button>
            </div>
          </div>

          {/* Mode Selector */}
          <div className={`flex rounded-lg p-1 border ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700' : 'bg-slate-100 border-slate-300'}`}>
            <button
              onClick={() => setMode('string')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded transition-all text-center ${mode === 'string' ? (theme === 'dark' ? 'bg-[#00F2FE] text-[#0B0F17] shadow-sm' : 'bg-[#0284c7] text-white shadow-sm') : (theme === 'dark' ? 'text-gray-300 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}
            >
              String Mode
            </button>
            <button
              onClick={() => setMode('rod')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded transition-all text-center ${mode === 'rod' ? (theme === 'dark' ? 'bg-[#00F2FE] text-[#0B0F17] shadow-sm' : 'bg-[#0284c7] text-white shadow-sm') : (theme === 'dark' ? 'text-gray-300 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}
            >
              Rigid Rod Mode
            </button>
          </div>
        </div>

        <hr className={theme === 'dark' ? 'border-gray-800' : 'border-slate-200'} />
          
          {/* PRESETS SECTION */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className={`text-[11px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`}>Preset Scenarios</h3>
              <span className={`text-[10px] font-mono font-medium ${theme === 'dark' ? 'text-gray-300' : 'text-slate-600'}`}>Auto-calculate</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => loadPreset('osc')}
                className={`py-2.5 px-3 border rounded text-left transition group ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700 hover:border-[#00F2FE]' : 'bg-slate-50 border-slate-200 hover:border-[#0284c7]'}`}
              >
                <div className="text-xs font-bold text-[#00FF8C] group-hover:underline">Oscillation</div>
                <div className={`text-[10px] font-mono font-semibold ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>v₀ = {Math.sqrt(1.2 * g * L).toFixed(2)} m/s</div>
              </button>
              <button
                onClick={() => loadPreset('slack')}
                className={`py-2.5 px-3 border rounded text-left transition group ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700 hover:border-[#00F2FE]' : 'bg-slate-50 border-slate-200 hover:border-[#0284c7]'}`}
              >
                <div className="text-xs font-bold text-amber-500 group-hover:underline">Slackening</div>
                <div className={`text-[10px] font-mono font-semibold ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>v₀ = {Math.sqrt(3.5 * g * L).toFixed(2)} m/s</div>
              </button>
              <button
                onClick={() => loadPreset('loop')}
                className={`py-2.5 px-3 border rounded text-left transition group ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700 hover:border-[#00F2FE]' : 'bg-slate-50 border-slate-200 hover:border-[#0284c7]'}`}
              >
                <div className={`text-xs font-bold group-hover:underline ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`}>Full Loop</div>
                <div className={`text-[10px] font-mono font-semibold ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>v₀ = {Math.sqrt(6.0 * g * L).toFixed(2)} m/s</div>
              </button>
              <button
                onClick={() => loadPreset('critical')}
                className={`py-2.5 px-3 border rounded text-left transition group ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700 hover:border-[#00F2FE]' : 'bg-slate-50 border-slate-200 hover:border-[#0284c7]'}`}
              >
                <div className="text-xs font-bold text-purple-600 dark:text-purple-400 group-hover:underline">Critical Boundary</div>
                <div className={`text-[10px] font-mono font-semibold ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>v₀ = {vLoopMin.toFixed(2)} m/s</div>
              </button>
            </div>
          </section>

          <hr className={theme === 'dark' ? 'border-gray-800' : 'border-slate-200'} />

          {/* INPUT PARAMETERS SECTION */}
          <section className="space-y-4">
            <h3 className={`text-[11px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`}>Input Parameters</h3>

            {/* Initial Release Angle Slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium">
                <span className={theme === 'dark' ? 'text-slate-200' : 'text-slate-800 font-semibold'}>Initial Release Angle (θ₀)</span>
                <span className={`font-mono font-bold ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`}>{theta0.toFixed(1)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={theta0}
                onChange={(e) => setTheta0(parseFloat(e.target.value))}
                className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${theme === 'dark' ? 'bg-[#0B0F17] accent-[#00F2FE]' : 'bg-slate-200 accent-[#0284c7]'}`}
              />
              <div className="grid grid-cols-5 gap-1 pt-1">
                <button onClick={() => setTheta0(0)} className={`py-1 text-[9px] font-bold rounded border ${theta0 === 0 ? (theme === 'dark' ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : 'border-[#0284c7] text-[#0284c7] bg-sky-50') : (theme === 'dark' ? 'border-gray-700 text-slate-300' : 'border-slate-300 text-slate-700 bg-white hover:border-slate-400')}`}>0° (Bot)</button>
                <button onClick={() => setTheta0(60)} className={`py-1 text-[9px] font-bold rounded border ${theta0 === 60 ? (theme === 'dark' ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : 'border-[#0284c7] text-[#0284c7] bg-sky-50') : (theme === 'dark' ? 'border-gray-700 text-slate-300' : 'border-slate-300 text-slate-700 bg-white hover:border-slate-400')}`}>60°</button>
                <button onClick={() => setTheta0(90)} className={`py-1 text-[9px] font-bold rounded border ${theta0 === 90 ? (theme === 'dark' ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : 'border-[#0284c7] text-[#0284c7] bg-sky-50') : (theme === 'dark' ? 'border-gray-700 text-slate-300' : 'border-slate-300 text-slate-700 bg-white hover:border-slate-400')}`}>90° (Hor)</button>
                <button onClick={() => setTheta0(120)} className={`py-1 text-[9px] font-bold rounded border ${theta0 === 120 ? (theme === 'dark' ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : 'border-[#0284c7] text-[#0284c7] bg-sky-50') : (theme === 'dark' ? 'border-gray-700 text-slate-300' : 'border-slate-300 text-slate-700 bg-white hover:border-slate-400')}`}>120°</button>
                <button onClick={() => setTheta0(180)} className={`py-1 text-[9px] font-bold rounded border ${theta0 === 180 ? (theme === 'dark' ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : 'border-[#0284c7] text-[#0284c7] bg-sky-50') : (theme === 'dark' ? 'border-gray-700 text-slate-300' : 'border-slate-300 text-slate-700 bg-white hover:border-slate-400')}`}>180° (Top)</button>
              </div>
            </div>

            {/* Launch Direction Toggle */}
            <div className="space-y-1.5">
              <div className={`text-xs font-semibold ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>Initial Direction</div>
              <div className={`flex rounded-lg p-1 border ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700' : 'bg-slate-100 border-slate-300'}`}>
                <button
                  onClick={() => setInitialDir('anticlockwise')}
                  className={`flex-1 py-1 text-[10px] font-bold rounded transition-all text-center ${initialDir === 'anticlockwise' ? (theme === 'dark' ? 'bg-[#00F2FE] text-[#0B0F17]' : 'bg-[#0284c7] text-white') : (theme === 'dark' ? 'text-gray-300' : 'text-slate-700 hover:text-slate-900')}`}
                >
                  Anticlockwise (↺)
                </button>
                <button
                  onClick={() => setInitialDir('clockwise')}
                  className={`flex-1 py-1 text-[10px] font-bold rounded transition-all text-center ${initialDir === 'clockwise' ? (theme === 'dark' ? 'bg-[#00F2FE] text-[#0B0F17]' : 'bg-[#0284c7] text-white') : (theme === 'dark' ? 'text-gray-300' : 'text-slate-700 hover:text-slate-900')}`}
                >
                  Clockwise (↻)
                </button>
              </div>
            </div>

            {/* Initial Velocity v0 Controls (Direct m/s vs √(n g L) Formula) */}
            <div className="space-y-2.5">
              <div className="flex justify-between items-center text-xs font-medium">
                <span className={theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}>Initial Velocity (v₀)</span>
                <div className={`flex rounded p-0.5 border text-[10px] font-bold ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700' : 'bg-slate-100 border-slate-300'}`}>
                  <button
                    onClick={() => setVInputMode('direct')}
                    className={`px-2.5 py-0.5 rounded transition ${vInputMode === 'direct' ? (theme === 'dark' ? 'bg-[#00F2FE] text-[#0B0F17]' : 'bg-[#0284c7] text-white') : (theme === 'dark' ? 'text-gray-400' : 'text-slate-600')}`}
                  >
                    m/s
                  </button>
                  <button
                    onClick={() => setVInputMode('formula')}
                    className={`px-2.5 py-0.5 rounded transition ${vInputMode === 'formula' ? (theme === 'dark' ? 'bg-[#00F2FE] text-[#0B0F17]' : 'bg-[#0284c7] text-white') : (theme === 'dark' ? 'text-gray-400' : 'text-slate-600')}`}
                  >
                    &radic;(n·g·L)
                  </button>
                </div>
              </div>

              {vInputMode === 'direct' ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-mono">
                    <span className={theme === 'dark' ? 'text-gray-300 font-semibold' : 'text-slate-700 font-semibold'}>Velocity (v₀):</span>
                    <span className={`font-bold ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`}>{v0.toFixed(2)} m/s</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="0.1"
                    value={v0}
                    onChange={(e) => updateV0Direct(parseFloat(e.target.value))}
                    className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${theme === 'dark' ? 'bg-[#0B0F17] accent-[#00F2FE]' : 'bg-slate-200 accent-[#0284c7]'}`}
                  />
                  
                  {/* Factor n Slider for 0 to 10 in m/s mode as well */}
                  <div className={`p-2 rounded-lg border space-y-1.5 ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-800' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex justify-between items-center text-[11px] font-mono">
                      <span className={theme === 'dark' ? 'text-gray-300 font-semibold' : 'text-slate-700 font-semibold'}>Equivalent Factor n (0 - 10):</span>
                      <span className="font-bold text-emerald-600 dark:text-[#00FF8C]">n = {nFactor.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="0.05"
                      value={Math.min(10, Math.max(0, nFactor))}
                      onChange={(e) => updateNFactor(parseFloat(e.target.value))}
                      className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer ${theme === 'dark' ? 'bg-[#161B26] accent-[#00FF8C]' : 'bg-slate-200 accent-emerald-600'}`}
                    />
                    <div className={`text-[10px] font-mono font-medium text-center ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>
                      v₀ = &radic;({nFactor.toFixed(2)} × {g} × {L}) = {v0.toFixed(2)} m/s
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className={theme === 'dark' ? 'text-gray-300 font-semibold' : 'text-slate-700 font-semibold'}>Factor n (0 to 10):</span>
                    <span className={`font-bold ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`}>n = {nFactor.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.05"
                    value={Math.min(10, Math.max(0, nFactor))}
                    onChange={(e) => updateNFactor(parseFloat(e.target.value))}
                    className={`w-full h-2.5 rounded-lg appearance-none cursor-pointer ${theme === 'dark' ? 'bg-[#0B0F17] accent-[#00F2FE]' : 'bg-slate-200 accent-[#0284c7]'}`}
                  />

                  <div className={`text-[11px] font-mono px-2.5 py-1.5 rounded-lg border flex justify-between items-center ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-800 text-gray-200' : 'bg-slate-50 border-slate-200 text-slate-800 font-medium'}`}>
                    <span>Calculated Velocity v₀:</span>
                    <span className="font-bold text-[#0284c7] dark:text-[#00F2FE] text-sm">&radic;({nFactor.toFixed(2)}gL) = {v0.toFixed(2)} m/s</span>
                  </div>

                  {/* Quick n Factor Buttons */}
                  <div className="grid grid-cols-5 gap-1 pt-1">
                    <button onClick={() => updateNFactor(1.0)} className={`py-1 text-[9px] font-mono font-bold rounded border ${nFactor === 1.0 ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : (theme === 'dark' ? 'border-gray-700 text-slate-300' : 'border-slate-300 text-slate-700 bg-white hover:border-slate-400')}`}>n = 1</button>
                    <button onClick={() => updateNFactor(2.0)} className={`py-1 text-[9px] font-mono font-bold rounded border ${nFactor === 2.0 ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : (theme === 'dark' ? 'border-gray-700 text-emerald-400' : 'border-slate-300 text-emerald-700 bg-white hover:border-slate-400')}`}>n = 2 (&radic;2gL)</button>
                    <button onClick={() => updateNFactor(3.5)} className={`py-1 text-[9px] font-mono font-bold rounded border ${nFactor === 3.5 ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : (theme === 'dark' ? 'border-gray-700 text-amber-400' : 'border-slate-300 text-amber-700 bg-white hover:border-slate-400')}`}>n = 3.5</button>
                    <button onClick={() => updateNFactor(5.0)} className={`py-1 text-[9px] font-mono font-bold rounded border ${nFactor === 5.0 ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : (theme === 'dark' ? 'border-gray-700 text-cyan-400' : 'border-slate-300 text-sky-700 bg-white hover:border-slate-400')}`}>n = 5 (&radic;5gL)</button>
                    <button onClick={() => updateNFactor(10.0)} className={`py-1 text-[9px] font-mono font-bold rounded border ${nFactor === 10.0 ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : (theme === 'dark' ? 'border-gray-700 text-purple-400' : 'border-slate-300 text-purple-700 bg-white hover:border-slate-400')}`}>n = 10</button>
                  </div>
                </div>
              )}
            </div>

            {/* Length L */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium">
                <span className={theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}>String Length (L)</span>
                <span className={`font-mono font-bold ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`}>{L.toFixed(2)} m</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="5.0"
                step="0.1"
                value={L}
                onChange={(e) => handleLChange(parseFloat(e.target.value))}
                className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${theme === 'dark' ? 'bg-[#0B0F17] accent-[#00F2FE]' : 'bg-slate-200 accent-[#0284c7]'}`}
              />
            </div>

            {/* Mass m */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium">
                <span className={theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}>Mass (m)</span>
                <span className={`font-mono font-bold ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`}>{m.toFixed(2)} kg</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="10.0"
                step="0.1"
                value={m}
                onChange={(e) => setM(parseFloat(e.target.value))}
                className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${theme === 'dark' ? 'bg-[#0B0F17] accent-[#00F2FE]' : 'bg-slate-200 accent-[#0284c7]'}`}
              />
            </div>

            {/* Gravity Presets */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium">
                <span className={theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}>Gravity Acceleration (g)</span>
                <span className={`font-mono font-bold ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`}>{g.toFixed(2)} m/s²</span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  onClick={() => handleGChange(9.81)}
                  className={`py-2 rounded text-[10px] uppercase font-bold transition border ${g === 9.81 ? (theme === 'dark' ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : 'border-[#0284c7] text-[#0284c7] bg-sky-50') : (theme === 'dark' ? 'border-gray-700 text-slate-300 bg-[#0B0F17]' : 'border-slate-200 text-slate-700 bg-slate-50 hover:border-slate-400')}`}
                >
                  Earth (9.81)
                </button>
                <button
                  onClick={() => handleGChange(1.62)}
                  className={`py-2 rounded text-[10px] uppercase font-bold transition border ${g === 1.62 ? (theme === 'dark' ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : 'border-[#0284c7] text-[#0284c7] bg-sky-50') : (theme === 'dark' ? 'border-gray-700 text-slate-300 bg-[#0B0F17]' : 'border-slate-200 text-slate-700 bg-slate-50 hover:border-slate-400')}`}
                >
                  Moon (1.62)
                </button>
                <button
                  onClick={() => handleGChange(3.71)}
                  className={`py-2 rounded text-[10px] uppercase font-bold transition border ${g === 3.71 ? (theme === 'dark' ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : 'border-[#0284c7] text-[#0284c7] bg-sky-50') : (theme === 'dark' ? 'border-gray-700 text-slate-300 bg-[#0B0F17]' : 'border-slate-200 text-slate-700 bg-slate-50 hover:border-slate-400')}`}
                >
                  Mars (3.71)
                </button>
                <button
                  onClick={() => handleGChange(24.79)}
                  className={`py-2 rounded text-[10px] uppercase font-bold transition border ${g === 24.79 ? (theme === 'dark' ? 'border-[#00F2FE] text-[#00F2FE] bg-[#0B0F17]' : 'border-[#0284c7] text-[#0284c7] bg-sky-50') : (theme === 'dark' ? 'border-gray-700 text-slate-300 bg-[#0B0F17]' : 'border-slate-200 text-slate-700 bg-slate-50 hover:border-slate-400')}`}
                >
                  Jupiter (24.79)
                </button>
              </div>
            </div>
          </section>

          <hr className={theme === 'dark' ? 'border-gray-800' : 'border-slate-200'} />

          {/* SIMULATION CONTROLS SECTION */}
          <section className="space-y-4">
            <h3 className={`text-[11px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`}>Simulation Controls</h3>
            
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className={`flex items-center justify-center gap-2 py-3 rounded font-bold text-xs uppercase transition shadow-md ${theme === 'dark' ? 'bg-[#00F2FE] text-[#0B0F17] shadow-cyan-500/20 hover:bg-[#00d8e4]' : 'bg-[#0284c7] text-white shadow-sky-500/20 hover:bg-[#0369a1]'}`}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                onClick={resetSim}
                className={`flex items-center justify-center gap-2 py-3 rounded font-bold text-xs uppercase transition ${theme === 'dark' ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-slate-200 text-slate-800 hover:bg-slate-300'}`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setIsPlaying(false);
                  resetSim();
                }}
                className={`py-2.5 border rounded font-bold text-xs uppercase transition flex items-center justify-center gap-1.5 ${theme === 'dark' ? 'bg-[#0B0F17] border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500' : 'bg-rose-50 border-rose-300 text-rose-600 hover:bg-rose-100 hover:border-rose-400'}`}
                title="Turn Off Simulation"
              >
                <Power className="w-3.5 h-3.5" /> Turn Off
              </button>
              <button
                onClick={() => setIsSlowMo(!isSlowMo)}
                className={`py-2.5 border rounded font-bold text-xs uppercase transition ${isSlowMo ? 'border-amber-500 text-amber-500 bg-amber-500/10' : (theme === 'dark' ? 'bg-[#0B0F17] border-gray-700 text-slate-200 hover:border-gray-500' : 'bg-slate-50 border-slate-300 text-slate-700 hover:border-slate-400')}`}
              >
                Slow-Mo (0.25x)
              </button>
            </div>

            <div className="space-y-2.5 pt-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showVectors}
                  onChange={(e) => setShowVectors(e.target.checked)}
                  className={`w-4 h-4 rounded cursor-pointer ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700 accent-[#00F2FE]' : 'bg-slate-100 border-slate-300 accent-[#0284c7]'}`}
                />
                <span className={`text-xs ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>Show Primary Vectors (v, T, mg)</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAccelerations}
                  onChange={(e) => setShowAccelerations(e.target.checked)}
                  className={`w-4 h-4 rounded cursor-pointer ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700 accent-[#00F2FE]' : 'bg-slate-100 border-slate-300 accent-[#0284c7]'}`}
                />
                <span className={`text-xs ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>Show Accelerations (a_c, a_t)</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showComponents}
                  onChange={(e) => setShowComponents(e.target.checked)}
                  className={`w-4 h-4 rounded cursor-pointer ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700 accent-[#00F2FE]' : 'bg-slate-100 border-slate-300 accent-[#0284c7]'}`}
                />
                <span className={`text-xs ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>Show Force Components</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showTrace}
                  onChange={(e) => setShowTrace(e.target.checked)}
                  className={`w-4 h-4 rounded cursor-pointer ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700 accent-[#00F2FE]' : 'bg-slate-100 border-slate-300 accent-[#0284c7]'}`}
                />
                <span className={`text-xs ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>Show Motion Trajectory</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(e) => setShowGrid(e.target.checked)}
                  className={`w-4 h-4 rounded cursor-pointer ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-700 accent-[#00F2FE]' : 'bg-slate-100 border-slate-300 accent-[#0284c7]'}`}
                />
                <span className={`text-xs ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>Show Angle Grid &amp; Reference</span>
              </label>
            </div>
          </section>

        </aside>

        {/* MAIN CANVAS AREA */}
        <main className={`flex-1 relative flex items-center justify-center overflow-hidden transition-colors ${theme === 'dark' ? 'bg-[#0B0F17]' : 'bg-[#eaf2fb]'}`}>
          
          {/* Radial grid overlay background pattern */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: theme === 'dark' 
                ? 'radial-gradient(circle at 1px 1px, #1a202c 1px, transparent 0)' 
                : 'radial-gradient(circle at 1px 1px, #cbd5e1 1px, transparent 0)',
              backgroundSize: '40px 40px',
              opacity: theme === 'dark' ? 0.5 : 0.6
            }}
          />

          <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair relative z-0" />

          {/* ANGLE INSPECTOR OVERLAY CARD (TOP-LEFT) */}
          <div className={`absolute top-6 left-6 w-80 border rounded-xl p-4 shadow-2xl z-20 backdrop-blur-md transition-colors ${theme === 'dark' ? 'bg-[#161B26]/90 border-gray-700 text-white' : 'bg-white/95 border-slate-200 text-slate-800 shadow-slate-300/50'}`}>
            <div className="flex justify-between items-center mb-2">
              <span className={`text-[10px] font-black tracking-[0.2em] uppercase ${theme === 'dark' ? 'text-[#00FF8C]' : 'text-emerald-600'}`}>
                Angle Inspector (&theta;)
              </span>
              <span className={`font-mono font-bold text-xs ${inspectData.isUnreachable ? 'text-rose-500' : (theme === 'dark' ? 'text-[#00FF8C]' : 'text-emerald-600')}`}>
                &theta; = {scrubAngle.toFixed(1)}°
              </span>
            </div>

            <input
              type="range"
              min="0"
              max="360"
              step="0.5"
              value={scrubAngle}
              onChange={(e) => setScrubAngle(parseFloat(e.target.value))}
              className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${theme === 'dark' ? 'bg-[#0B0F17] accent-[#00FF8C]' : 'bg-slate-200 accent-emerald-600'}`}
            />

            <div className="grid grid-cols-4 gap-1 my-2">
              <button onClick={() => setScrubAngle(0)} className={`py-1 text-[9px] font-mono font-bold rounded border ${theme === 'dark' ? 'border-gray-700 text-slate-300 hover:border-gray-500 bg-[#0B0F17]' : 'border-slate-300 text-slate-700 hover:border-slate-400 bg-slate-50'}`}>0° (Bot)</button>
              <button onClick={() => setScrubAngle(90)} className={`py-1 text-[9px] font-mono font-bold rounded border ${theme === 'dark' ? 'border-gray-700 text-slate-300 hover:border-gray-500 bg-[#0B0F17]' : 'border-slate-300 text-slate-700 hover:border-slate-400 bg-slate-50'}`}>90° (Right)</button>
              <button onClick={() => setScrubAngle(180)} className={`py-1 text-[9px] font-mono font-bold rounded border ${theme === 'dark' ? 'border-gray-700 text-slate-300 hover:border-gray-500 bg-[#0B0F17]' : 'border-slate-300 text-slate-700 hover:border-slate-400 bg-slate-50'}`}>180° (Top)</button>
              <button onClick={() => setScrubAngle(270)} className={`py-1 text-[9px] font-mono font-bold rounded border ${theme === 'dark' ? 'border-gray-700 text-slate-300 hover:border-gray-500 bg-[#0B0F17]' : 'border-slate-300 text-slate-700 hover:border-slate-400 bg-slate-50'}`}>270° (Left)</button>
            </div>

            {inspectData.isUnreachable ? (
              <div className="p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-[10px] font-mono font-semibold">
                ⚠️ {inspectData.msg}
              </div>
            ) : (
              <div className="space-y-1.5 pt-2 text-[11px] font-mono border-t border-slate-200 dark:border-gray-700/40">
                <div className="flex justify-between items-center">
                  <span className={theme === 'dark' ? 'text-gray-200 font-medium' : 'text-slate-800 font-semibold'}>Speed at &theta;:</span>
                  <span className={`font-bold ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-slate-900'}`}>{inspectData.speed.toFixed(2)} m/s</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={theme === 'dark' ? 'text-gray-200 font-medium' : 'text-slate-800 font-semibold'}>Tension at &theta;:</span>
                  <span className={`font-bold ${theme === 'dark' ? 'text-[#00FF8C]' : 'text-slate-900'}`}>{inspectData.tension.toFixed(2)} N</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-0.5">
                  <div className={`p-1.5 rounded flex justify-between border ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-800' : 'bg-slate-100 border-slate-200'}`}>
                    <span className={`font-sans font-bold ${theme === 'dark' ? 'text-amber-400' : 'text-amber-800'}`}>a_c:</span>
                    <span className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{inspectData.ac.toFixed(2)} m/s²</span>
                  </div>
                  <div className={`p-1.5 rounded flex justify-between border ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-800' : 'bg-slate-100 border-slate-200'}`}>
                    <span className={`font-sans font-bold ${theme === 'dark' ? 'text-pink-400' : 'text-pink-800'}`}>a_t:</span>
                    <span className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{inspectData.at.toFixed(2)} m/s²</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  <div className={`p-1.5 rounded flex justify-between border ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-800' : 'bg-slate-100 border-slate-200'}`}>
                    <span className={`font-sans font-bold ${theme === 'dark' ? 'text-cyan-400' : 'text-sky-800'}`}>KE:</span>
                    <span className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{inspectData.ke.toFixed(1)} J</span>
                  </div>
                  <div className={`p-1.5 rounded flex justify-between border ${theme === 'dark' ? 'bg-[#0B0F17] border-gray-800' : 'bg-slate-100 border-slate-200'}`}>
                    <span className={`font-sans font-bold ${theme === 'dark' ? 'text-cyan-400' : 'text-sky-800'}`}>PE:</span>
                    <span className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{inspectData.pe.toFixed(1)} J</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* TOP-MIDDLE MOTION CONDITION PILL */}
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <div className={`px-4 py-1.5 rounded-full text-xs font-bold font-mono tracking-wide shadow-xl border backdrop-blur-md flex items-center gap-2 ${
              v0 >= vLoopMin
                ? (theme === 'dark' ? 'bg-cyan-950/80 border-cyan-500/50 text-[#00F2FE]' : 'bg-sky-50/95 border-sky-300 text-sky-800 shadow-sky-200/50')
                : mode === 'string' && v0 > vOscMax
                ? (telemetry.isSlackened
                    ? 'bg-rose-950/80 border-rose-500/50 text-rose-400'
                    : 'bg-amber-950/80 border-amber-500/50 text-amber-400')
                : (theme === 'dark' ? 'bg-emerald-950/80 border-emerald-500/50 text-[#00FF8C]' : 'bg-emerald-50/95 border-emerald-300 text-emerald-800 shadow-emerald-200/50')
            }`}>
              <span className={`w-2 h-2 rounded-full animate-pulse ${
                v0 >= vLoopMin ? 'bg-[#00F2FE]' : mode === 'string' && v0 > vOscMax ? 'bg-rose-400' : 'bg-[#00FF8C]'
              }`} />
              <span>
                {v0 >= vLoopMin
                  ? 'Full Vertical Loop (Complete Circle)'
                  : mode === 'string' && v0 > vOscMax
                  ? (telemetry.isSlackened ? 'Slackening Condition (String Slackens)' : 'Slackening Condition')
                  : 'Stable Condition (Pure Oscillation)'}
              </span>
            </div>
          </div>

          {/* EQUATION & DYNAMICS CALCULATION OVERLAY CARD (TOP-RIGHT) */}
          <div className={`absolute top-6 right-6 w-80 border rounded-xl p-5 shadow-2xl z-20 backdrop-blur-md transition-colors ${theme === 'dark' ? 'bg-[#161B26]/90 border-gray-700 text-white' : 'bg-white/95 border-slate-200 text-slate-800 shadow-slate-300/50'}`}>
            <div className="flex justify-between items-center mb-4">
              <span className={`text-[10px] font-black tracking-[0.2em] uppercase ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`}>Dynamics Engine</span>
              <div className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono tracking-wide ${
                v0 >= vLoopMin ? (theme === 'dark' ? 'bg-cyan-500/20 text-[#00F2FE]' : 'bg-sky-100 text-[#0284c7] border border-sky-300') :
                mode === 'string' && v0 > vOscMax ? (telemetry.isSlackened ? 'bg-orange-500/20 text-orange-400' : 'bg-amber-500/20 text-amber-500') :
                (theme === 'dark' ? 'bg-emerald-500/20 text-[#00FF8C]' : 'bg-emerald-100 text-emerald-700 border border-emerald-300')
              }`}>
                {v0 >= vLoopMin ? 'FULL LOOP' : mode === 'string' && v0 > vOscMax ? (telemetry.isSlackened ? 'SLACKENED' : 'CRITICAL') : 'OSCILLATING'}
              </div>
            </div>

            <div className="space-y-4 font-mono text-xs">
              <div className="space-y-1">
                <div className={`text-[10px] uppercase font-sans font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>1. Energy Conservation</div>
                <div className={`text-sm font-bold ${theme === 'dark' ? 'text-cyan-50' : 'text-slate-900'}`}>v² = v₀² - 2gL(1 - cos θ)</div>
                <div className="text-xs mt-0.5 flex justify-between">
                  <span className={`font-sans ${theme === 'dark' ? 'text-gray-200' : 'text-slate-700 font-medium'}`}>Current Speed v:</span>
                  <span className={`font-bold ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`}>{telemetry.speed.toFixed(2)} m/s</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className={`text-[10px] uppercase font-sans font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>2. String Tension</div>
                <div className={`text-sm font-bold ${theme === 'dark' ? 'text-cyan-50' : 'text-slate-900'}`}>T = m(v²/L + g cos θ)</div>
                <div className="text-xs mt-0.5 flex justify-between">
                  <span className={`font-sans ${theme === 'dark' ? 'text-gray-200' : 'text-slate-700 font-medium'}`}>Current Tension T:</span>
                  <span className={`font-bold ${theme === 'dark' ? 'text-[#00F2FE]' : 'text-[#0284c7]'}`}>{telemetry.isSlackened ? "0.00 N (SLACK)" : telemetry.tension.toFixed(2) + " N"}</span>
                </div>
              </div>

              <div className={`pt-2 border-t space-y-1 ${theme === 'dark' ? 'border-gray-700' : 'border-slate-200'}`}>
                <div className={`text-[10px] uppercase font-sans font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>3. Critical Boundary</div>
                <div className={`text-xs italic mt-1 font-semibold ${theme === 'dark' ? 'text-gray-100' : 'text-slate-800'}`}>
                  {mode === 'string' ? `Slack Angle θₛ = ${telemetry.thetaS}` : 'Rigid Rod: Continuous Circle'}
                </div>
              </div>
            </div>
          </div>

          {/* TELEMETRY PROBE (BOTTOM-RIGHT) */}
          <div className={`absolute bottom-6 right-6 w-88 grid grid-cols-3 gap-px rounded-lg overflow-hidden shadow-2xl z-20 font-mono border ${theme === 'dark' ? 'bg-gray-800 border-gray-800' : 'bg-slate-300 border-slate-300 shadow-slate-300/50'}`}>
            <div className={`p-2.5 ${theme === 'dark' ? 'bg-[#161B26]' : 'bg-white'}`}>
              <div className={`text-[9px] uppercase font-sans font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>Angle (θ)</div>
              <div className={`text-base font-bold ${theme === 'dark' ? 'text-[#00FF8C]' : 'text-[#0284c7]'}`}>{telemetry.thetaDeg.toFixed(1)}°</div>
            </div>
            <div className={`p-2.5 ${theme === 'dark' ? 'bg-[#161B26]' : 'bg-white'}`}>
              <div className={`text-[9px] uppercase font-sans font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>Speed (v)</div>
              <div className={`text-base font-bold ${theme === 'dark' ? 'text-[#00FF8C]' : 'text-[#0284c7]'}`}>{telemetry.speed.toFixed(2)} m/s</div>
            </div>
            <div className={`p-2.5 ${theme === 'dark' ? 'bg-[#161B26]' : 'bg-white'}`}>
              <div className={`text-[9px] uppercase font-sans font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>Tension (T)</div>
              <div className={`text-base font-bold ${telemetry.isSlackened ? 'text-rose-400' : (theme === 'dark' ? 'text-[#00FF8C]' : 'text-[#0284c7]')}`}>{telemetry.isSlackened ? 'SLACK' : telemetry.tension.toFixed(1) + ' N'}</div>
            </div>

            {showAccelerations && (
              <>
                <div className={`p-2.5 ${theme === 'dark' ? 'bg-[#161B26]' : 'bg-white'}`}>
                  <div className={`text-[9px] uppercase font-sans font-bold text-amber-700 dark:text-amber-500`}>Centripetal a_c</div>
                  <div className={`text-sm font-bold ${theme === 'dark' ? 'text-amber-400' : 'text-amber-700'}`}>{telemetry.ac.toFixed(2)} m/s²</div>
                </div>
                <div className={`p-2.5 ${theme === 'dark' ? 'bg-[#161B26]' : 'bg-white'}`}>
                  <div className={`text-[9px] uppercase font-sans font-bold text-pink-700 dark:text-pink-500`}>Tangential a_t</div>
                  <div className={`text-sm font-bold ${theme === 'dark' ? 'text-pink-400' : 'text-pink-700'}`}>{telemetry.at.toFixed(2)} m/s²</div>
                </div>
                <div className={`p-2.5 ${theme === 'dark' ? 'bg-[#161B26]' : 'bg-white'}`}>
                  <div className={`text-[9px] uppercase font-sans font-bold text-purple-700 dark:text-purple-400`}>Total Accel a</div>
                  <div className={`text-sm font-bold ${theme === 'dark' ? 'text-purple-300' : 'text-purple-800'}`}>{telemetry.aTotal.toFixed(2)} m/s²</div>
                </div>
              </>
            )}

            <div className={`p-2.5 ${theme === 'dark' ? 'bg-[#161B26]' : 'bg-white'}`}>
              <div className={`text-[9px] uppercase font-sans font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>Kinetic E.</div>
              <div className={`text-sm font-bold ${theme === 'dark' ? 'text-cyan-400' : 'text-sky-800'}`}>{telemetry.ke.toFixed(1)} J</div>
            </div>
            <div className={`p-2.5 ${theme === 'dark' ? 'bg-[#161B26]' : 'bg-white'}`}>
              <div className={`text-[9px] uppercase font-sans font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>Potential E.</div>
              <div className={`text-sm font-bold ${theme === 'dark' ? 'text-cyan-400' : 'text-sky-800'}`}>{telemetry.pe.toFixed(1)} J</div>
            </div>
            <div className={`p-2.5 ${theme === 'dark' ? 'bg-[#161B26]' : 'bg-white'}`}>
              <div className={`text-[9px] uppercase font-sans font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}`}>Total E.</div>
              <div className={`text-sm font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{telemetry.totalE.toFixed(1)} J</div>
            </div>
          </div>

          {/* OVERLAY LABELS (BOTTOM-LEFT) */}
          <div className="absolute bottom-6 left-6 flex items-center gap-4 z-20">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${theme === 'dark' ? 'bg-[#00F2FE]' : 'bg-[#0284c7]'}`}></div>
              <span className={`text-[10px] uppercase font-bold tracking-widest ${theme === 'dark' ? 'text-gray-300' : 'text-slate-600'}`}>Real-time Simulation</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#00FF8C]"></div>
              <span className={`text-[10px] uppercase font-bold tracking-widest ${theme === 'dark' ? 'text-gray-300' : 'text-slate-600'}`}>Stable 60 FPS</span>
            </div>
          </div>

        </main>

    </div>
  );
}
