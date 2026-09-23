import { useEffect, useRef } from 'react'
import * as THREE from 'three'

function cssColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * 3D satellite orbiting Earth. Same props as the old drone visual:
 * - status colour drives the thruster / antenna glow
 * - riskScore drives tumble speed and orbit speed
 */
export default function SpacecraftVisual3D({ status = 'normal', riskScore = 0 }) {
  const mountRef = useRef(null)
  const live = useRef({ status, riskScore })
  useEffect(() => { live.current = { status, riskScore } }, [status, riskScore])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
    camera.position.set(0, 2.2, 6.5)
    camera.lookAt(0, 0, 0)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    mount.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const sun = new THREE.DirectionalLight(0xffffff, 1.1)
    sun.position.set(5, 4, 3)
    scene.add(sun)
    const glow = new THREE.PointLight(0x2dd4a7, 2, 6)
    scene.add(glow)

    // Earth
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0x1b4f8a, roughness: 0.8 })
    )
    earth.position.set(0, -0.6, 0)
    scene.add(earth)

    const orbit = new THREE.Group()
    scene.add(orbit)
    const sat = new THREE.Group()
    sat.position.set(2.6, 0.5, 0)
    orbit.add(sat)

    const gold = new THREE.MeshStandardMaterial({ color: 0xb8945a, metalness: 0.7, roughness: 0.35 })
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1f3d7a, metalness: 0.5, roughness: 0.3 })
    const grey = new THREE.MeshStandardMaterial({ color: 0xaab4c0, metalness: 0.6, roughness: 0.4 })
    const statusMat = new THREE.MeshStandardMaterial({
      color: 0x2dd4a7, emissive: 0x2dd4a7, emissiveIntensity: 0.8,
    })

    sat.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.8), gold))
    ;[-1, 1].forEach((s) => {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8), grey)
      arm.rotation.z = Math.PI / 2
      arm.position.x = s * 0.45
      sat.add(arm)
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.03, 0.6), panelMat)
      panel.position.x = s * 1.2
      sat.add(panel)
    })
    const dish = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.2, 20, 1, true), grey)
    dish.position.set(0, 0.45, 0)
    sat.add(dish)
    const thruster = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), statusMat)
    thruster.position.set(0, 0, -0.5)
    sat.add(thruster)

    function resize() {
      const w = mount.clientWidth, h = mount.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    const colors = {
      normal: new THREE.Color(cssColor('--status-normal', '#2dd4a7')),
      watch: new THREE.Color(cssColor('--status-watch', '#f2b84b')),
      critical: new THREE.Color(cssColor('--status-critical', '#f0605a')),
    }
    const cur = colors.normal.clone()
    const clock = new THREE.Clock()
    let frame
    const tmp = new THREE.Vector3()

    function animate() {
      frame = requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.05)
      const t = clock.elapsedTime
      const risk = Math.min(Math.max(live.current.riskScore, 0), 100) / 100
      cur.lerp(colors[live.current.status] || colors.normal, Math.min(1, dt * 3))

      orbit.rotation.y += dt * (0.25 + risk * 0.5)
      sat.rotation.y += dt * (0.3 + risk * 2.2) // tumble grows with risk
      sat.rotation.z = Math.sin(t * 2) * risk * 0.4
      earth.rotation.y += dt * 0.05

      const pulse = live.current.status === 'critical' ? Math.abs(Math.sin(t * 10)) * 0.6 : 0
      statusMat.color.copy(cur)
      statusMat.emissive.copy(cur)
      statusMat.emissiveIntensity = 0.7 + pulse
      sat.getWorldPosition(tmp)
      glow.position.set(tmp.x, tmp.y + 0.5, tmp.z)
      glow.color.copy(cur)
      glow.intensity = 1.8 + pulse * 3

      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      mount.removeChild(renderer.domElement)
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose())
      })
      renderer.dispose()
    }
  }, [])

  return <div ref={mountRef} className="drone-3d-mount" />
}