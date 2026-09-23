// Physics-model expected curve vs sensor channel, plus residual.
// Pure SVG, no chart library needed.
// Props:
//   physics: API `physics` object {expected, residual, limit, flagged_cycles}
//   sensorData: API `sensor_data` (cycles x features)
//   channelIndex: API meta.thermal_channel_index
//   channelName: name of that channel
//   currentCycle: (optional) draws a marker
const W = 520, H = 170, PAD = 24;

function z(arr) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const s = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length) || 1;
  return arr.map((v) => (v - m) / s);
}

function path(values, min, max) {
  const n = values.length;
  return values
    .map((v, i) => {
      const x = PAD + (i / (n - 1)) * (W - 2 * PAD);
      const y = H - PAD - ((v - min) / (max - min || 1)) * (H - 2 * PAD);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function PhysicsChart({
  physics,
  sensorData,
  channelIndex = 0,
  channelName = "Thermal channel",
  currentCycle,
}) {
  if (!physics || !sensorData?.length) return null;

  const sensor = z(sensorData.map((row) => row[channelIndex]));
  const expected = z(physics.expected);
  const all = [...sensor, ...expected];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const n = sensor.length;

  const rMax = Math.max(...physics.residual.map(Math.abs), physics.limit) || 1;
  const markerX =
    currentCycle != null ? PAD + (currentCycle / (n - 1)) * (W - 2 * PAD) : null;

  return (
    <div className="chart-panel">
      <h2>Physics model vs {channelName}</h2>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
        <path d={path(expected, min, max)} fill="none" stroke="#7c8b98" strokeWidth="1.5" strokeDasharray="5 4" />
        <path d={path(sensor, min, max)} fill="none" stroke="var(--accent-cyan)" strokeWidth="2" />
        {markerX != null && (
          <line x1={markerX} x2={markerX} y1={PAD} y2={H - PAD} stroke="#e7eaee" strokeOpacity="0.4" />
        )}
      </svg>
      <div className="mono physics-legend">
        <span style={{ color: "#7c8b98" }}>- - physics expected</span>
        <span style={{ color: "var(--accent-cyan)" }}>—— live sensor</span>
      </div>

      <h2 style={{ marginTop: 12 }}>Residual (sensor − physics)</h2>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
        <path
          d={path(physics.residual, -rMax, rMax)}
          fill="none"
          stroke="var(--status-watch)"
          strokeWidth="2"
        />
        {[physics.limit, -physics.limit].map((lim, i) => {
          const y = H - PAD - ((lim + rMax) / (2 * rMax)) * (H - 2 * PAD);
          return (
            <line key={i} x1={PAD} x2={W - PAD} y1={y} y2={y}
              stroke="var(--status-critical)" strokeDasharray="4 4" strokeOpacity="0.7" />
          );
        })}
        {markerX != null && (
          <line x1={markerX} x2={markerX} y1={PAD} y2={H - PAD} stroke="#e7eaee" strokeOpacity="0.4" />
        )}
      </svg>
      <p className="section-hint" style={{ margin: "0 8px 10px" }}>
        Crossing the red dashed lines means reality disagrees with physics, which is evidence of a developing fault.
      </p>
    </div>
  );
}