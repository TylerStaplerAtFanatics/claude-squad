'use client'
import { useEffect } from 'react'

export function ViewportProvider() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      requestAnimationFrame(() => {
        // Must listen to both resize AND scroll events on iOS Safari —
        // scroll fires during keyboard transitions alongside resize.
        const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        document.documentElement.style.setProperty('--keyboard-height', `${kb}px`)
        document.documentElement.style.setProperty('--viewport-height', `${vv.height}px`)
      })
    }

    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return null
}
