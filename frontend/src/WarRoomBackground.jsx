import { useEffect, useRef } from 'react'
import * as THREE from 'three'

function readCssColor(varName, fallback) {
  if (typeof window === 'undefined') return fallback
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return val || fallback
}

const PARTICLE_COUNT = 220

/**
 * Fixed, full-viewport 3D backdrop that sits behind the whole dashboard —
 * a dim holographic ops-table grid, a slow rotating radar sweep, and drifting
 * dust particles, all rendered in three.js. Purely decorative (pointer
 * events disabled) so it never interferes with the UI on top of it.
 */
export default function WarRoomBackground() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    const cyan = new THREE.Color(readCssColor('--accent-cyan', '#4fb8d9'))

    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200)
    camera.position.set(0, 9, 15)
    camera.lookAt(0, 0, -4)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    renderer.setSize(window.innerWidth, window.innerHeight)
    mount.appendChild(renderer.domElement)

    scene.fog = new THREE.Fog(0x05070a, 14, 34)

    // Ops-table grid floor
    const grid = new THREE.GridHelper(46, 46, cyan.getHex(), 0x14202a)
    grid.position.y = -2.4
    grid.material.transparent = true
    grid.material.opacity = 0.22
    scene.add(grid)

    // A second, finer grid drifting slightly above for a layered holo look
    const gridFine = new THREE.GridHelper(46, 92, 0x1e2e38, 0x101a22)
    gridFine.position.y = -2.39
    gridFine.material.transparent = true
    gridFine.material.opacity = 0.1
    scene.add(gridFine)

    // Rotating radar sweep wedge
    const sweepGeo = new THREE.CircleGeometry(20, 48, 0, Math.PI / 7)
    const sweepMat = new THREE.MeshBasicMaterial({
      color: cyan, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false,
    })
    const sweep = new THREE.Mesh(sweepGeo, sweepMat)
    sweep.rotation.x = -Math.PI / 2
    sweep.position.y = -2.38
    scene.add(sweep)

    // Faint concentric radar rings
    for (let r = 6; r <= 20; r += 4.5) {
      const ringGeo = new THREE.RingGeometry(r - 0.02, r, 64)
      const ringMat = new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0.06, side: THREE.DoubleSide })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.rotation.x = -Math.PI / 2
      ring.position.y = -2.37
      scene.add(ring)
    }

    // Drifting dust / data-point particles
    const particleGeo = new THREE.BufferGeometry()
    const positions = new Float32Array(PARTICLE_COUNT * 3)
    const speeds = new Float32Array(PARTICLE_COUNT)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 40
      positions[i * 3 + 1] = Math.random() * 10 - 2
      positions[i * 3 + 2] = (Math.random() - 0.5) * 40
      speeds[i] = 0.1 + Math.random() * 0.25
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const particleMat = new THREE.PointsMaterial({ color: cyan, size: 0.05, transparent: true, opacity: 0.35, depthWrite: false })
    const particles = new THREE.Points(particleGeo, particleMat)
    scene.add(particles)

    function resize() {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }
    window.addEventListener('resize', resize)

    let frameId
    const clock = new THREE.Clock()
    function animate() {
      frameId = requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.05)
      const t = clock.elapsedTime

      sweep.rotation.z -= dt * 0.35

      const pos = particleGeo.attributes.position
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        let y = pos.getY(i) + dt * speeds[i]
        if (y > 8) y = -2
        pos.setY(i, y)
      }
      pos.needsUpdate = true

      camera.position.x = Math.sin(t * 0.03) * 2
      camera.lookAt(0, 0, -4)

      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', resize)
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

  return <div ref={mountRef} className="warroom-bg" />
}