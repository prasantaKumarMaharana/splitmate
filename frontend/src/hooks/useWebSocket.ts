import { useEffect, useRef } from 'react'
import { WS_URL } from '../lib/api'

type Handler = (data: any) => void

export function useWebSocket(handlers: Record<string, Handler>) {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef(handlers)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const retryCount = useRef(0)

  handlersRef.current = handlers

  useEffect(() => {
    let ws: WebSocket | null = null
    let cancelled = false

    function connect() {
      if (cancelled) return
      const token = localStorage.getItem('access_token')
      if (!token) return

      ws = new WebSocket(`${WS_URL}/ws?token=${token}`)
      wsRef.current = ws

      let pingInterval: ReturnType<typeof setInterval>

      ws.onopen = () => {
        retryCount.current = 0
        pingInterval = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send('ping')
        }, 25000)
      }

      ws.onmessage = (e) => {
        if (e.data === 'pong') return
        try {
          const { event, data } = JSON.parse(e.data)
          const handler = handlersRef.current[event]
          if (handler) handler(data)
          const wildcard = handlersRef.current['*']
          if (wildcard) wildcard({ event, data })
        } catch {}
      }

      ws.onclose = (ev) => {
        clearInterval(pingInterval)
        if (cancelled || ev.code === 4001) return
        const delay = Math.min(1000 * 2 ** retryCount.current, 30000)
        retryCount.current++
        reconnectTimer.current = setTimeout(connect, delay)
      }

      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      cancelled = true
      clearTimeout(reconnectTimer.current)
      ws?.close()
    }
  }, [])
}
