import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// Reads the live value of a CSS custom property so the 3D scene stays in
// sync with the dashboard's color theme (defined in App.css) without
// hardcoding hex values in two places.
function readCssColor(varName, fallback) {
  if (typeof window === 'undefined') return fallback
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return val || fallback
}

const N_CYLINDERS = 4
const PARTICLE_COUNT = 36

/**
 * Animated 3D "digital twin" of an inline piston engine.
 *
 * - Pistons stroke up/down and the crankshaft/flywheel spin continuously;
 *   RPM scales with `riskScore` (idle when healthy, redlining near failure).
 * - Cylinder-head glow + point light color track `status`
 *   (normal / watch / critical), matching the CSS status colors.
 * - A light vibration shake and rising heat-haze particles kick in as risk
 *   climbs, becoming most intense in the critical state.
 *
 * Built with vanilla three.js (already a project dependency) rather than a
 * React renderer wrapper, so the whole scene lives inside one imperative
 * effect and is torn down cleanly on unmount.
 */
export default function EngineVisual3D({ status = 'normal', riskScore = 0 }) {
  const mountRef = useRef(null)
  const liveRef = useRef({ status, riskScore })

  // Keep the render loop reading fresh props without re-creating the scene.
  useEffect(() => {
    liveRef.current.status = status
    liveRef.current.riskScore = riskScore
  }, [status, riskScore])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
    camera.position.set(3.3, 2.15, 4.3)
    camera.lookAt(0, 0.35, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    mount.appendChild(renderer.domElement)

    // ---- lighting ----
    scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const key = new THREE.DirectionalLight(0xffffff, 0.9)
    key.position.set(4, 5, 3)
    scene.add(key)
    const rim = new THREE.DirectionalLight(
      new THREE.Color(readCssColor('--accent-cyan', '#4fb8d9')), 0.5
    )
    rim.position.set(-3, 2, -3)
    scene.add(rim)

    const statusLight = new THREE.PointLight(0x2dd4a7, 2, 6)
    statusLight.position.set(0, 1.7, 0.8)
    scene.add(statusLight)

    // ---- materials ----
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.45, metalness: 0.65 })
    const metalDark = new THREE.MeshStandardMaterial({ color: 0x1c222a, roughness: 0.6, metalness: 0.5 })
    const sleeveMat = new THREE.MeshStandardMaterial({
      color: 0x4a5566, roughness: 0.35, metalness: 0.4,
      transparent: true, opacity: 0.32, side: THREE.DoubleSide,
    })

    const engine = new THREE.Group()
    engine.position.y = -0.15
    scene.add(engine)

    // Block + sump
    const block = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.85, 1.1), metal)
    engine.add(block)
    const sump = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.4, 0.9), metalDark)
    sump.position.y = -0.62
    engine.add(sump)

    // Cylinders: transparent sleeve, bobbing piston, glowing head, linking rod
    const pistons = []
    const headMaterials = []
    for (let i = 0; i < N_CYLINDERS; i++) {
      const x = -1.2 + i * 0.8

      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.95, 20, 1, true), sleeveMat)
      sleeve.position.set(x, 0.88, 0)
      engine.add(sleeve)

      const headMat = new THREE.MeshStandardMaterial({
        color: 0x2dd4a7, emissive: 0x2dd4a7, emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.4,
      })
      headMaterials.push(headMat)
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.16, 20), headMat)
      head.position.set(x, 1.42, 0)
      engine.add(head)

      const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.26, 20), metalDark)
      engine.add(piston)

      const rod = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.55, 0.075), metalDark)
      engine.add(rod)

      pistons.push({ piston, rod, x, phase: (i % 2) * Math.PI })
    }

    // Crankshaft assembly: origin sits on the shaft's own axis so the
    // group's local X-rotation spins the shaft and flywheel about
    // themselves rather than orbiting the whole engine.
    const crankAssembly = new THREE.Group()
    crankAssembly.position.set(0, -0.1, 0)
    engine.add(crankAssembly)

    const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.5, 16), metalDark)
    crank.rotation.z = Math.PI / 2
    crankAssembly.add(crank)

    const flywheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 32), metal)
    flywheel.rotation.z = Math.PI / 2
    flywheel.position.set(1.9, 0, 0)
    crankAssembly.add(flywheel)

    const flyMarkMat = new THREE.MeshStandardMaterial({ color: 0xf2b84b, emissive: 0xf2b84b, emissiveIntensity: 0.7 })
    const flyMark = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.42, 0.07), flyMarkMat)
    flyMark.position.set(1.9, 0.38, 0)
    crankAssembly.add(flyMark)

    // Rising heat-haze particles above the cylinder heads (fade in with risk)
    const particleGeo = new THREE.BufferGeometry()
    const particlePos = new Float32Array(PARTICLE_COUNT * 3)
    const particleSpeed = new Float32Array(PARTICLE_COUNT)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const cyl = i % N_CYLINDERS
      particlePos[i * 3 + 0] = -1.2 + cyl * 0.8 + (Math.random() - 0.5) * 0.25
      particlePos[i * 3 + 1] = 1.5 + Math.random() * 0.7
      particlePos[i * 3 + 2] = (Math.random() - 0.5) * 0.25
      particleSpeed[i] = 0.4 + Math.random() * 0.5
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3))
    const particleMat = new THREE.PointsMaterial({ color: 0xf0605a, size: 0.055, transparent: true, opacity: 0, depthWrite: false })
    const particles = new THREE.Points(particleGeo, particleMat)
    engine.add(particles)

    // ---- responsive sizing ----
    function resize() {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    const statusColors = {
      normal: new THREE.Color(readCssColor('--status-normal', '#2dd4a7')),
      watch: new THREE.Color(readCssColor('--status-watch', '#f2b84b')),
      critical: new THREE.Color(readCssColor('--status-critical', '#f0605a')),
    }
    const currentColor = statusColors.normal.clone()

    let frameId
    const clock = new THREE.Clock()

    function animate() {
      frameId = requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.05)
      const t = clock.elapsedTime
      const { status: curStatus, riskScore: curRisk } = liveRef.current
      const risk = Math.min(Math.max(curRisk, 0), 100)

      const targetColor = statusColors[curStatus] || statusColors.normal
      currentColor.lerp(targetColor, Math.min(1, dt * 3))

      // Idle -> redline as risk climbs
      const crankAngle = t * (1.3 + (risk / 100) * 5.5)

      pistons.forEach(({ piston, rod, x, phase }) => {
        const stroke = Math.cos(crankAngle + phase)
        const y = 0.86 + stroke * 0.16
        piston.position.set(x, y, 0)
        const rodTop = y - 0.13
        const rodBottom = -0.1
        rod.position.set(x, (rodTop + rodBottom) / 2, 0)
        rod.scale.y = Math.max(0.05, (rodTop - rodBottom) / 0.55)
      })
      crankAssembly.rotation.x = crankAngle

      const criticalPulse = curStatus === 'critical' ? Math.abs(Math.sin(t * 10)) * 0.4 : 0
      headMaterials.forEach((m) => {
        m.color.copy(currentColor)
        m.emissive.copy(currentColor)
        m.emissiveIntensity = 0.35 + Math.sin(t * 4) * 0.05 + criticalPulse
      })
      statusLight.color.copy(currentColor)
      statusLight.intensity = 1.7 + criticalPulse * 3

      // Vibration grows with risk, sharpest in the critical band
      const shake = (risk / 100) ** 1.5 * 0.028
      engine.position.x = Math.sin(t * 41) * shake
      engine.position.z = Math.cos(t * 34) * shake * 0.6

      // Slow turntable sway for a "product shot" feel
      engine.rotation.y = -0.55 + Math.sin(t * 0.15) * 0.32

      // Heat haze
      const targetOpacity = curStatus === 'critical' ? 0.85 : curStatus === 'watch' ? 0.3 : 0
      particleMat.opacity += (targetOpacity - particleMat.opacity) * Math.min(1, dt * 3)
      particleMat.color.copy(currentColor)
      const pos = particleGeo.attributes.position
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        let y = pos.getY(i) + dt * particleSpeed[i] * (0.5 + risk / 120)
        if (y > 2.5) y = 1.5
        pos.setY(i, y)
      }
      pos.needsUpdate = true

      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(frameId)
      ro.disconnect()
      mount.removeChild(renderer.domElement)
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
          mats.forEach((m) => m.dispose())
        }
      })
      renderer.dispose()
    }
  }, [])

  return <div ref={mountRef} className="engine-3d-mount" />
}