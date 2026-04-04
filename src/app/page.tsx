"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type SatCard = {
  name: string;
  noradId: string;
  version: string;
  spaceXId: string;
  intldes: string;
  launchDate: string;
  decayDate: string | null;
  inclination: number;
  eccentricity: number;
  meanMotion: number;
  period: number;
  apoapsis: number;
  periapsis: number;
  bstar: number;
  revAtEpoch: number;
  epoch: string;
};

type LiveData = {
  lat: number;
  lng: number;
  altKm: number;
  speed: number;
};

function fmt(n: number, decimals: number, unit: string): string {
  return isNaN(n) ? "—" : `${n.toFixed(decimals)} ${unit}`;
}

function fmtCoord(n: number, pos: string, neg: string): string {
  if (isNaN(n)) return "—";
  return `${Math.abs(n).toFixed(4)}° ${n >= 0 ? pos : neg}`;
}

function Row({
  label,
  value,
  live,
}: {
  label: string;
  value: string;
  live?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline gap-4">
      <span className="text-gray-500 text-xs shrink-0">{label}</span>
      <span
        className={`text-xs font-mono truncate ${
          live ? "text-green-300" : "text-gray-200"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default function Page() {
  const containerRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  // Animation loop refs — readable by Three.js without triggering re-renders
  const hoveredSatRef = useRef<string | null>(null);
  const selectedSatRef = useRef<string | null>(null);
  const liveDataRef = useRef<LiveData | null>(null);
  const pausedRef = useRef(false);
  const autoRotatingRef = useRef(true);
  const versionFilterRef = useRef<string>("all");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);

  const [satCards, setSatCards] = useState<SatCard[]>([]);
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const [selectedSat, setSelectedSat] = useState<SatCard | null>(null);
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [paused, setPaused] = useState(false);
  const [versionFilter, setVersionFilter] = useState("all");

  function handlePauseToggle() {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
  }

  function handleReset() {
    controlsRef.current?.reset();
    autoRotatingRef.current = true;
    setSelectedSat(null);
    setLiveData(null);
    liveDataRef.current = null;
    selectedSatRef.current = null;
  }

  useEffect(() => {
    let renderer: THREE.WebGLRenderer;
    let animationFrame: number;
    let cleanupResize: (() => void) | undefined;
    let cleanupInterval: (() => void) | undefined;

    async function init() {
      const ThreeGlobe = (await import("three-globe")).default;
      const satellite = await import("satellite.js");
      const { TrackballControls } = await import(
        "three/examples/jsm/controls/TrackballControls.js"
      );

      const EARTH_RADIUS_KM = 6371;
      const GLOBE_RADIUS = 100;
      const SAT_SURFACE_OFFSET = 0.5;
      const FOLLOW_DIST = 200;
      const TIME_STEP = 1.5 * 1000;
      const AUTO_ROTATE_SPEED = 0.0015; // rad/frame

      function satToVec(lat: number, lng: number): THREE.Vector3 {
        const r = GLOBE_RADIUS + SAT_SURFACE_OFFSET;
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lng + 180) * (Math.PI / 180);
        return new THREE.Vector3(
          -r * Math.sin(phi) * Math.cos(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.sin(theta)
        );
      }

      // Globe imagery
      const Globe = new ThreeGlobe().globeImageUrl(
        "//cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg"
      );

      // Fetch TLE + metadata
      const json: any[] = await fetch("https://api.spacexdata.com/v4/starlink").then(
        (r) => r.json()
      );

      const tleData = json
        .filter((s) => s.spaceTrack?.TLE_LINE1 && s.spaceTrack?.TLE_LINE2)
        .map((s) => ({
          name: s.spaceTrack.OBJECT_NAME as string,
          line1: s.spaceTrack.TLE_LINE1 as string,
          line2: s.spaceTrack.TLE_LINE2 as string,
          noradId: String(s.spaceTrack.NORAD_CAT_ID ?? ""),
          version: (s.version as string) ?? "",
          spaceXId: (s.id as string) ?? "",
          intldes: (s.spaceTrack.INTLDES as string) ?? "",
          launchDate: (s.spaceTrack.LAUNCH_DATE as string) ?? "",
          decayDate: (s.spaceTrack.DECAY_DATE as string | null) ?? null,
          inclination: Number(s.spaceTrack.INCLINATION),
          eccentricity: Number(s.spaceTrack.ECCENTRICITY),
          meanMotion: Number(s.spaceTrack.MEAN_MOTION),
          period: Number(s.spaceTrack.PERIOD),
          apoapsis: Number(s.spaceTrack.APOAPSIS),
          periapsis: Number(s.spaceTrack.PERIAPSIS),
          bstar: Number(s.spaceTrack.BSTAR),
          revAtEpoch: Number(s.spaceTrack.REV_AT_EPOCH),
          epoch: (s.spaceTrack.EPOCH as string) ?? "",
        }));

      const satData = tleData
        .map((d) => ({
          ...d,
          satrec: satellite.twoline2satrec(d.line1, d.line2),
          lat: NaN,
          lng: NaN,
          alt: NaN,
          altKm: NaN,
          speed: NaN,
        }))
        .filter((d) => !!satellite.propagate(d.satrec, new Date())?.position);

      setSatCards(
        satData.map(
          ({
            name, noradId, version, spaceXId, intldes, launchDate, decayDate,
            inclination, eccentricity, meanMotion, period, apoapsis, periapsis,
            bstar, revAtEpoch, epoch,
          }) => ({
            name, noradId, version, spaceXId, intldes, launchDate, decayDate,
            inclination, eccentricity, meanMotion, period, apoapsis, periapsis,
            bstar, revAtEpoch, epoch,
          })
        )
      );

      // Renderer
      renderer = new THREE.WebGLRenderer({ antialias: true });
      const width = containerRef.current!.clientWidth;
      const height = containerRef.current!.clientHeight;
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      containerRef.current!.appendChild(renderer.domElement);

      // Scene
      const scene = new THREE.Scene();
      scene.add(Globe as unknown as THREE.Object3D);
      scene.add(new THREE.AmbientLight(0xcccccc, Math.PI));
      scene.add(new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI));

      // Starfield — random points on a large sphere surrounding the scene
      const STAR_COUNT = 6000;
      const starPositions = new Float32Array(STAR_COUNT * 3);
      for (let i = 0; i < STAR_COUNT; i++) {
        const theta = Math.random() * 2 * Math.PI;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 900;
        starPositions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
        starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        starPositions[i * 3 + 2] = r * Math.cos(phi);
      }
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
      const starMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 1.8,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
      });
      scene.add(new THREE.Points(starGeo, starMat));

      // All-satellite point cloud — buffer updated in-place each frame
      const allPositions = new Float32Array(satData.length * 3);
      const allGeo = new THREE.BufferGeometry();
      allGeo.setAttribute("position", new THREE.BufferAttribute(allPositions, 3));
      const allMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.0, sizeAttenuation: true });
      const allPoints = new THREE.Points(allGeo, allMat);
      scene.add(allPoints);

      // Focused satellite — billboard sprite using the sat-icon texture
      const satTexture = new THREE.TextureLoader().load("/sat-icon.png");
      const spriteMat = new THREE.SpriteMaterial({
        map: satTexture,
        transparent: true,
        depthWrite: false,
      });
      const satSprite = new THREE.Sprite(spriteMat);
      satSprite.scale.set(7, 7, 1);
      satSprite.visible = false;
      scene.add(satSprite);

      // Camera
      const camera = new THREE.PerspectiveCamera();
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      camera.position.z = 400;
      cameraRef.current = camera;

      // Resize — ResizeObserver reacts to panel appearing/disappearing too
      function onResize() {
        const w = containerRef.current?.clientWidth || window.innerWidth;
        const h = containerRef.current?.clientHeight || window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      }
      const ro = new ResizeObserver(onResize);
      ro.observe(containerRef.current!);
      cleanupResize = () => ro.disconnect();

      // Controls
      const controls = new TrackballControls(camera, renderer.domElement);
      controls.minDistance = 101;
      controls.rotateSpeed = 5;
      controls.zoomSpeed = 0.8;
      controlsRef.current = controls;

      // Stop auto-rotate the first time the user drags
      controls.addEventListener("start", () => {
        autoRotatingRef.current = false;
      });

      let time = new Date();

      function updateFrame() {
        animationFrame = requestAnimationFrame(updateFrame);

        // Advance simulation time only when not paused
        if (!pausedRef.current) {
          time = new Date(+time + TIME_STEP);
        }

        if (timeRef.current) timeRef.current.innerText = time.toString();

        const gmst = satellite.gstime(time);

        satData.forEach((d, i) => {
          const eci = satellite.propagate(d.satrec, time);
          if (eci?.position) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const geo = satellite.eciToGeodetic(eci.position as any, gmst);
            d.lat = satellite.radiansToDegrees(geo.latitude);
            d.lng = satellite.radiansToDegrees(geo.longitude);
            d.altKm = geo.height;
            d.alt = geo.height / EARTH_RADIUS_KM;
            if (eci.velocity) {
              const vel = eci.velocity as { x: number; y: number; z: number };
              d.speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);
            }
          } else {
            d.lat = d.lng = d.alt = d.altKm = d.speed = NaN;
          }

          const vf = versionFilterRef.current;
          const valid =
            !isNaN(d.lat) &&
            !isNaN(d.lng) &&
            (vf === "all" || d.version === vf);
          const v = valid ? satToVec(d.lat, d.lng) : new THREE.Vector3();
          allPositions[i * 3] = v.x;
          allPositions[i * 3 + 1] = v.y;
          allPositions[i * 3 + 2] = v.z;
        });
        allGeo.attributes.position.needsUpdate = true;

        // Publish live data for detail panel
        const selName = selectedSatRef.current;
        if (selName) {
          const s = satData.find((d) => d.name === selName && !isNaN(d.lat));
          if (s)
            liveDataRef.current = {
              lat: s.lat,
              lng: s.lng,
              altKm: s.altKm,
              speed: s.speed,
            };
        }

        // Hovered card takes priority; fall back to selected satellite so
        // tracking continues when the mouse moves into the globe area.
        const focused = hoveredSatRef.current ?? selectedSatRef.current;

        if (focused) {
          // Isolate satellite + smooth camera follow
          const s = satData.find(
            (d) => d.name === focused && !isNaN(d.lat) && !isNaN(d.lng)
          );
          if (s) {
            const v = satToVec(s.lat, s.lng);
            satSprite.position.set(v.x, v.y, v.z);
            controls.enabled = false;
            camera.position.lerp(
              v.clone().normalize().multiplyScalar(FOLLOW_DIST),
              0.04
            );
            camera.lookAt(0, 0, 0);
          }
          allPoints.visible = false;
          satSprite.visible = true;
        } else {
          allPoints.visible = true;
          satSprite.visible = false;
          controls.enabled = true;

          // Auto-rotate on initial load (until user drags or hovers)
          if (autoRotatingRef.current) {
            const a = AUTO_ROTATE_SPEED;
            const x = camera.position.x;
            const z = camera.position.z;
            camera.position.x = x * Math.cos(a) - z * Math.sin(a);
            camera.position.z = x * Math.sin(a) + z * Math.cos(a);
            camera.lookAt(0, 0, 0);
          }
        }

        controls.update();
        renderer.render(scene, camera);
      }

      updateFrame();

      // Push live telemetry into React state at ~4 Hz
      const iv = setInterval(() => {
        if (liveDataRef.current) setLiveData({ ...liveDataRef.current });
      }, 250);
      cleanupInterval = () => clearInterval(iv);
    }

    init();

    return () => {
      cleanupResize?.();
      cleanupInterval?.();
      cancelAnimationFrame(animationFrame);
      renderer?.dispose();
    };
  }, []);

  function selectSat(sat: SatCard) {
    if (selectedSat?.name === sat.name) {
      setSelectedSat(null);
      setLiveData(null);
      liveDataRef.current = null;
      selectedSatRef.current = null;
    } else {
      setSelectedSat(sat);
      setLiveData(null);
      liveDataRef.current = null;
      selectedSatRef.current = sat.name;
    }
  }

  const detailPanel = selectedSat && (
    <div className="shrink-0 h-64 md:h-auto md:w-96 bg-gray-950 border-t md:border-t-0 md:border-l border-gray-800 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-gray-800 sticky top-0 bg-gray-950 z-10">
        <div>
          <h2 className="text-white font-bold text-sm">{selectedSat.name}</h2>
          <p className="text-gray-400 text-xs mt-0.5">
            NORAD #{selectedSat.noradId}
          </p>
        </div>
        <button
          onClick={() => {
            setSelectedSat(null);
            setLiveData(null);
            liveDataRef.current = null;
            selectedSatRef.current = null;
            controlsRef.current?.reset();
            autoRotatingRef.current = true;
          }}
          className="text-gray-500 hover:text-white text-xl leading-none ml-4 transition-colors"
        >
          ×
        </button>
      </div>

      {/* Live telemetry */}
      <div className="p-4 border-b border-gray-800">
        <h3 className="text-green-400 text-xs font-semibold uppercase tracking-widest mb-3">
          Position
        </h3>
        <div className="space-y-2.5">
          <Row
            label="Latitude"
            value={liveData ? fmtCoord(liveData.lat, "N", "S") : "acquiring…"}
            live
          />
          <Row
            label="Longitude"
            value={liveData ? fmtCoord(liveData.lng, "E", "W") : "acquiring…"}
            live
          />
          <Row
            label="Altitude"
            value={liveData ? fmt(liveData.altKm, 1, "km") : "acquiring…"}
            live
          />
          <Row
            label="Speed"
            value={liveData ? fmt(liveData.speed, 2, "km/s") : "acquiring…"}
            live
          />
        </div>
      </div>

      {/* Orbital elements */}
      <div className="p-4 border-b border-gray-800">
        <h3 className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-3">
          Orbital Elements
        </h3>
        <div className="space-y-2.5">
          <Row label="Inclination" value={fmt(selectedSat.inclination, 4, "°")} />
          <Row
            label="Eccentricity"
            value={
              isNaN(selectedSat.eccentricity)
                ? "—"
                : selectedSat.eccentricity.toExponential(4)
            }
          />
          <Row label="Mean Motion" value={fmt(selectedSat.meanMotion, 4, "rev/day")} />
          <Row label="Period" value={fmt(selectedSat.period, 2, "min")} />
          <Row label="Apoapsis" value={fmt(selectedSat.apoapsis, 0, "km")} />
          <Row label="Periapsis" value={fmt(selectedSat.periapsis, 0, "km")} />
          <Row
            label="BSTAR drag"
            value={
              isNaN(selectedSat.bstar)
                ? "—"
                : selectedSat.bstar.toExponential(4)
            }
          />
        </div>
      </div>

      {/* Identity */}
      <div className="p-4">
        <h3 className="text-purple-400 text-xs font-semibold uppercase tracking-widest mb-3">
          Identity
        </h3>
        <div className="space-y-2.5">
          <Row label="Version" value={selectedSat.version || "—"} />
          <Row label="Intl. Designator" value={selectedSat.intldes || "—"} />
          <Row label="Launch Date" value={selectedSat.launchDate || "—"} />
          {selectedSat.decayDate && (
            <Row label="Decay Date" value={selectedSat.decayDate} />
          )}
          <Row
            label="Rev. at Epoch"
            value={
              isNaN(selectedSat.revAtEpoch)
                ? "—"
                : selectedSat.revAtEpoch.toLocaleString()
            }
          />
          <Row
            label="TLE Epoch"
            value={selectedSat.epoch ? selectedSat.epoch.split("T")[0] : "—"}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-black">
      {/* Nav bar */}
      <nav className="shrink-0 flex items-center gap-3 px-4 h-12 bg-gray-950/90 backdrop-blur border-b border-gray-800 z-20">
        <span className="text-white font-bold text-sm tracking-wide mr-2">
          Starlink Visualizer
        </span>

        <button
          onClick={handlePauseToggle}
          className={[
            "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors",
            paused
              ? "bg-yellow-900/40 border-yellow-700 text-yellow-300 hover:bg-yellow-900/60"
              : "bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700",
          ].join(" ")}
        >
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>

        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700 transition-colors"
        >
          ⟳ Reset View
        </button>

        {/* Version filter */}
        {satCards.length > 0 && (
          <select
            value={versionFilter}
            onChange={(e) => {
              setVersionFilter(e.target.value);
              versionFilterRef.current = e.target.value;
            }}
            className="ml-2 px-3 py-1.5 text-xs rounded border bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700 transition-colors cursor-pointer focus:outline-none focus:border-gray-500"
          >
            <option value="all">All Versions</option>
            {[...new Set(satCards.map((s) => s.version))]
              .filter(Boolean)
              .sort()
              .map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
          </select>
        )}
      </nav>

      {/* Globe + detail panel (side-by-side on desktop, stacked on mobile) */}
      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <div ref={containerRef} className="relative flex-1 min-w-0 min-h-0">
          <div
            ref={timeRef}
            className="absolute bottom-2 right-2 text-xs font-mono p-1 rounded bg-[rgba(200,200,200,0.1)] text-purple-200"
          />
        </div>

        {/* On desktop: panel is a column to the right; on mobile: panel is a row below the globe */}
        {detailPanel}
      </div>

      {/* Satellite cards row */}
      <div
        className="h-44 shrink-0 border-t border-gray-800 bg-gray-950 flex items-center gap-3 px-4 py-3 overflow-x-auto [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-gray-900 [&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded-full"
        onMouseLeave={() => {
          // Only reset when leaving the section entirely and no satellite is selected
          if (!selectedSatRef.current) {
            controlsRef.current?.reset();
            autoRotatingRef.current = true;
          }
        }}
      >
        {satCards.length === 0 ? (
          <p className="text-gray-500 text-sm">Loading satellites…</p>
        ) : (
          satCards
            .filter((s) => versionFilter === "all" || s.version === versionFilter)
            .map((sat) => (
            <div
              key={sat.name}
              onClick={() => selectSat(sat)}
              onMouseEnter={() => {
                hoveredSatRef.current = sat.name;
                setHoveredName(sat.name);
                autoRotatingRef.current = false;
              }}
              onMouseLeave={() => {
                hoveredSatRef.current = null;
                setHoveredName(null);
              }}
              className={[
                "shrink-0 w-44 h-32 rounded-lg border p-3 cursor-pointer",
                "transition-all duration-150 flex flex-col justify-between",
                selectedSat?.name === sat.name
                  ? "border-blue-500 bg-blue-900/20 shadow-lg shadow-blue-500/20"
                  : hoveredName === sat.name
                  ? "border-purple-500 bg-purple-900/30 shadow-lg shadow-purple-500/20"
                  : "border-gray-700 bg-gray-900 hover:border-gray-500",
              ].join(" ")}
            >
              <div>
                <p className="text-white text-xs font-semibold truncate">
                  {sat.name}
                </p>
                <p className="text-gray-400 text-xs mt-1">
                  NORAD #{sat.noradId}
                </p>
              </div>
              <span className="self-start text-xs text-purple-300 bg-purple-900/50 px-2 py-0.5 rounded-full">
                {sat.version || "v?"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
