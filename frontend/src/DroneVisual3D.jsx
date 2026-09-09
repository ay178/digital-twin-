import { useEffect, useRef } from 'react'
import * as THREE from 'three'

function readCssColor(varName, fallback) {
  if (typeof window === 'undefined') return fallback
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return val || fallback
}

const BLADE_COUNT = 3

/**
 * Full 3D UAV (MALE-class, V-tail, rear pusher prop — TAPAS/Archer style)
 * flying a slow surveillance orbit above the war-room floor.
 *
 * - The airframe circles continuously; bank angle + orbit speed scale with
 *   `riskScore` (a calm racetrack pattern when healthy, a tighter, faster,
 *   more agitated orbit as risk climbs).
 * - The nose EO/IR sensor ball and rear engine nacelle glow with the
 *   `status` color (normal / watch / critical), matching the dashboard's
 *   CSS variables so the model always tracks the live theme.
 * - The rear pusher propeller spins at a rate tied to risk, and a wingtip
 *   nav-light pair (red/green) blinks for realism.
 */
export default function DroneVisual3D({ status = 'normal', riskScore = 0 }) {
  const mountRef = useRef(null)
  const liveRef = useRef({ status, riskScore })

  useEffect(() => {
    liveRef.current.status = status
    liveRef.current.riskScore = riskScore
  }, [status, riskScore])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
    camera.position.set(0, 2.6, 6.2)
    camera.lookAt(0, 0.1, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    mount.appendChild(renderer.domElement)

    // ---- lighting ----
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const key = new THREE.DirectionalLight(0xffffff, 1.0)
    key.position.set(4, 6, 3)
    scene.add(key)
    const rim = new THREE.DirectionalLight(new THREE.Color(readCssColor('--accent-cyan', '#4fb8d9')), 0.6)
    rim.position.set(-4, 1.5, -3)
    scene.add(rim)

    const statusLight = new THREE.PointLight(0x2dd4a7, 2.2, 5)
    scene.add(statusLight)

    // ---- materials ----
    const skin = new THREE.MeshStandardMaterial({ color: 0x545f6d, roughness: 0.45, metalness: 0.35 })
    const skinDark = new THREE.MeshStandardMaterial({ color: 0x232a33, roughness: 0.55, metalness: 0.3 })
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x1a2027, roughness: 0.4, metalness: 0.5 })

    // Everything below sits in `orbit`, which yaws around Y so the whole
    // airframe flies a circular surveillance pattern around the scene origin.
    const orbit = new THREE.Group()
    scene.add(orbit)

    const drone = new THREE.Group()
    drone.position.set(2.1, 0, 0)
    drone.rotation.y = Math.PI / 2 // face tangent to the orbit
    orbit.add(drone)

    // Fuselage — tapered cylinder, nose (+X) wider than tail (-X)
    const fuselage = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.11, 2.4, 18),
      skin
    )
    fuselage.rotation.z = Math.PI / 2
    drone.add(fuselage)

    // Nose cone
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), skinDark)
    nose.rotation.z = -Math.PI / 2
    nose.position.set(1.2, 0, 0)
    drone.add(nose)

    // EO/IR sensor ball under the nose — glows with mission status
    const sensorMat = new THREE.MeshStandardMaterial({
      color: 0x2dd4a7, emissive: 0x2dd4a7, emissiveIntensity: 0.7, roughness: 0.25, metalness: 0.3,
    })
    const sensorBall = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), sensorMat)
    sensorBall.position.set(1.05, -0.2, 0)
    drone.add(sensorBall)

    // Wings — straight, high-aspect-ratio (MALE UAV style), slight dihedral
    const wingGroup = new THREE.Group()
    wingGroup.position.set(0.15, 0, 0)
    drone.add(wingGroup)
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.045, 3.1), skin)
    wingGroup.add(wing)
    const wingL = new THREE.Group()
    wingL.position.z = 1.0
    wingL.rotation.x = 0.06
    wingGroup.add(wingL)
    const wingR = new THREE.Group()
    wingR.position.z = -1.0
    wingR.rotation.x = -0.06
    wingGroup.add(wingR)

    // Wingtip nav lights (red = left/port, green = right/starboard) — blink
    const navMatL = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff3b3b, emissiveIntensity: 1 })
    const navMatR = new THREE.MeshStandardMaterial({ color: 0x39ff6a, emissive: 0x39ff6a, emissiveIntensity: 1 })
    const navL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), navMatL)
    navL.position.set(0.15, 0, 1.53)
    drone.add(navL)
    const navR = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), navMatR)
    navR.position.set(0.15, 0, -1.53)
    drone.add(navR)

    // Anti-collision beacon on top of fuselage
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1 })
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), beaconMat)
    beacon.position.set(0.1, 0.19, 0)
    drone.add(beacon)

    // V-tail — two angled fins at the rear
    const tailMat = skin
    const finGeo = new THREE.BoxGeometry(0.42, 0.6, 0.03)
    const finL = new THREE.Mesh(finGeo, tailMat)
    finL.position.set(-1.05, 0.22, 0.2)
    finL.rotation.x = 0.6
    drone.add(finL)
    const finR = new THREE.Mesh(finGeo, tailMat)
    finR.position.set(-1.05, 0.22, -0.2)
    finR.rotation.x = -0.6
    drone.add(finR)

    // Rear engine nacelle — glows with status, houses the pusher prop
    const nacelleMat = new THREE.MeshStandardMaterial({
      color: 0x2dd4a7, emissive: 0x2dd4a7, emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.4,
    })
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.22, 16), nacelleMat)
    nacelle.rotation.z = Math.PI / 2
    nacelle.position.set(-1.28, 0, 0)
    drone.add(nacelle)

    // Pusher propeller
    const propGroup = new THREE.Group()
    propGroup.position.set(-1.4, 0, 0)
    drone.add(propGroup)
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 12), bladeMat)
    spinner.rotation.z = -Math.PI / 2
    spinner.position.x = -0.02
    propGroup.add(spinner)
    for (let i = 0; i < BLADE_COUNT; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.42, 0.07), bladeMat)
      blade.position.y = 0.21
      const holder = new THREE.Group()
      holder.rotation.x = (i / BLADE_COUNT) * Math.PI * 2
      holder.add(blade)
      propGroup.add(holder)
    }

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

      // Orbit speed / bank tighten as risk climbs
      const orbitSpeed = 0.28 + (risk / 100) * 0.55
      orbit.rotation.y += dt * orbitSpeed
      drone.rotation.z = -0.14 - (risk / 100) * 0.22 + Math.sin(t * 1.6) * 0.02

      // Pusher prop spins with risk
      propGroup.rotation.x += dt * (10 + (risk / 100) * 55)

      const criticalPulse = curStatus === 'critical' ? Math.abs(Math.sin(t * 10)) * 0.5 : 0
      ;[sensorMat, nacelleMat].forEach((m) => {
        m.color.copy(currentColor)
        m.emissive.copy(currentColor)
        m.emissiveIntensity = 0.5 + Math.sin(t * 4) * 0.08 + criticalPulse
      })
      statusLight.color.copy(currentColor)
      statusLight.intensity = 1.8 + criticalPulse * 3
      statusLight.position.set(
        drone.getWorldPosition(new THREE.Vector3()).x,
        1.4,
        drone.getWorldPosition(new THREE.Vector3()).z
      )

      // Blinking nav + beacon lights
      navMatL.emissiveIntensity = 0.3 + (Math.sin(t * 5) > 0.85 ? 1.5 : 0)
      navMatR.emissiveIntensity = 0.3 + (Math.sin(t * 5 + 0.3) > 0.85 ? 1.5 : 0)
      beaconMat.emissiveIntensity = Math.sin(t * 6) > 0.9 ? 2 : 0.1

      // Slight bob for a "flying" feel
      drone.position.y = Math.sin(t * 0.9) * 0.05

      camera.position.x = Math.sin(t * 0.05) * 0.4
      camera.lookAt(0, 0.1, 0)

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

  return <div ref={mountRef} className="drone-3d-mount" />
}