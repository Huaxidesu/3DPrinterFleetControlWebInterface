/**
 * Detect ffmpeg on PATH (needed for Bambu X1 RTSP cabin camera).
 */
import { spawn } from 'child_process'

export type FfmpegProbeResult = {
  ok: boolean
  available: boolean
  version: string | null
  message: string
}

export function probeFfmpeg(timeoutMs = 4000): Promise<FfmpegProbeResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (r: FfmpegProbeResult) => {
      if (settled) return
      settled = true
      resolve(r)
    }
    let out = ''
    let err = ''
    let child
    try {
      child = spawn('ffmpeg', ['-version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
      })
    } catch (e) {
      finish({
        ok: true,
        available: false,
        version: null,
        message: e instanceof Error ? e.message : '无法启动 ffmpeg'
      })
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      finish({
        ok: true,
        available: false,
        version: null,
        message: '检测超时：ffmpeg 无响应'
      })
    }, timeoutMs)
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf8')
    })
    child.stderr?.on('data', (c: Buffer) => {
      err += c.toString('utf8')
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      const msg = e.message || String(e)
      finish({
        ok: true,
        available: false,
        version: null,
        message: /ENOENT|not found/i.test(msg)
          ? '未找到 ffmpeg（PATH 中无此命令）。X1 舱内摄像头需要安装 ffmpeg。'
          : msg
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const text = (out || err).trim()
      const first = text.split(/\r?\n/).find((l) => l.trim()) || ''
      if (code === 0 || /ffmpeg\s+version/i.test(first)) {
        const ver =
          first.match(/ffmpeg\s+version\s+([^\s]+)/i)?.[1] || first.slice(0, 80) || null
        finish({
          ok: true,
          available: true,
          version: ver,
          message: ver ? `已安装 ffmpeg ${ver}` : '已检测到 ffmpeg'
        })
        return
      }
      finish({
        ok: true,
        available: false,
        version: null,
        message:
          first.slice(0, 200) ||
          (code != null ? `ffmpeg 退出码 ${code}` : 'ffmpeg 不可用')
      })
    })
  })
}
