/**
 * Bambu Lab chamber camera:
 * - P1 / A1 / A1 mini: TLS TCP :6000 → JPEG frames
 * - X1 series: RTSP(S) :322 (requires ffmpeg on PATH)
 */
import { spawn } from 'child_process'
import tls from 'tls'

export type BambuSnapResult =
  | { ok: true; contentType: string; base64: string }
  | { ok: false; message: string }

function buildAuthPacket(accessCode: string): Buffer {
  const buf = Buffer.alloc(80, 0)
  buf.writeUInt32LE(0x40, 0)
  buf.writeUInt32LE(0x3000, 4)
  buf.writeUInt32LE(0, 8)
  buf.writeUInt32LE(0, 12)
  Buffer.from('bblp', 'ascii').copy(buf, 16)
  Buffer.from(String(accessCode || '').trim(), 'ascii').copy(buf, 48)
  return buf
}

function extractJpeg(buf: Buffer): Buffer | null {
  let soi = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
  if (soi < 0) soi = buf.indexOf(Buffer.from([0xff, 0xd8]))
  if (soi < 0) return null
  const eoi = buf.indexOf(Buffer.from([0xff, 0xd9]), soi + 2)
  if (eoi < 0) return null
  return buf.subarray(soi, eoi + 2)
}

/** P1/A1 JPEG stream on TLS :6000 */
export async function grabBambuJpegFrame(
  host: string,
  accessCode: string,
  timeoutMs = 10000
): Promise<BambuSnapResult> {
  const ip = host.trim()
  const code = String(accessCode || '').trim()
  if (!ip) return { ok: false, message: '缺少打印机 IP' }
  if (!code) return { ok: false, message: '缺少局域网访问码' }

  return await new Promise((resolve) => {
    let settled = false
    let sock: tls.TLSSocket | null = null
    const chunks: Buffer[] = []
    let total = 0

    const done = (result: BambuSnapResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        sock?.destroy()
      } catch {
        /* ignore */
      }
      resolve(result)
    }

    const timer = setTimeout(() => {
      const jpeg = extractJpeg(Buffer.concat(chunks))
      if (jpeg && jpeg.length > 200) {
        done({ ok: true, contentType: 'image/jpeg', base64: jpeg.toString('base64') })
      } else {
        done({
          ok: false,
          message:
            '摄像头 :6000 取帧超时（P1/A1 需同网、舱内摄像头已开、访问码正确；X1 请走 RTSP :322）'
        })
      }
    }, timeoutMs)

    try {
      sock = tls.connect(
        {
          host: ip,
          port: 6000,
          rejectUnauthorized: false,
          minVersion: 'TLSv1.2'
        },
        () => {
          sock!.write(buildAuthPacket(code))
        }
      )
    } catch (err) {
      done({
        ok: false,
        message: err instanceof Error ? err.message : '摄像头 TLS 连接失败'
      })
      return
    }

    sock.setTimeout(timeoutMs)
    sock.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      total += chunk.length
      const jpeg = extractJpeg(Buffer.concat(chunks))
      if (jpeg && jpeg.length > 200) {
        done({ ok: true, contentType: 'image/jpeg', base64: jpeg.toString('base64') })
        return
      }
      if (total > 6 * 1024 * 1024) {
        done({ ok: false, message: '摄像头数据异常过大' })
      }
    })
    sock.on('error', (err) => {
      done({
        ok: false,
        message: err.message || '无法连接摄像头端口 6000（需局域网 IP）'
      })
    })
    sock.on('timeout', () => {
      done({ ok: false, message: '摄像头连接超时' })
    })
    sock.on('close', () => {
      if (!settled) {
        const jpeg = extractJpeg(Buffer.concat(chunks))
        if (jpeg && jpeg.length > 200) {
          done({ ok: true, contentType: 'image/jpeg', base64: jpeg.toString('base64') })
        } else {
          done({ ok: false, message: '摄像头连接已关闭（访问码可能不正确）' })
        }
      }
    })
  })
}

/** X1 RTSP :322 via ffmpeg (one JPEG frame). */
export async function grabBambuRtspFrame(
  host: string,
  accessCode: string,
  timeoutMs = 15000
): Promise<BambuSnapResult> {
  const ip = host.trim()
  const code = String(accessCode || '').trim()
  if (!ip) return { ok: false, message: '缺少打印机 IP' }
  if (!code) return { ok: false, message: '缺少局域网访问码' }

  const userInfo = `bblp:${encodeURIComponent(code)}`
  const candidates = [
    `rtsps://${userInfo}@${ip}:322/`,
    `rtsp://${userInfo}@${ip}:322/`,
    `rtsps://${userInfo}@${ip}:322/live`
  ]

  let lastMsg = 'X1 RTSP 取帧失败'
  for (const input of candidates) {
    const shot = await grabRtspJpegWithFfmpeg(input, timeoutMs)
    if (shot.ok) return shot
    lastMsg = shot.message
    if (/ffmpeg|ENOENT|not found/i.test(shot.message)) break
  }
  return { ok: false, message: lastMsg }
}

function grabRtspJpegWithFfmpeg(input: string, timeoutMs: number): Promise<BambuSnapResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let settled = false
    const done = (r: BambuSnapResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      resolve(r)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-rtsp_transport',
          'tcp',
          '-i',
          input,
          '-frames:v',
          '1',
          '-f',
          'image2',
          'pipe:1'
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch (e) {
      resolve({
        ok: false,
        message:
          e instanceof Error
            ? e.message
            : '无法启动 ffmpeg（X1 机舱摄像头需要系统安装 ffmpeg）'
      })
      return
    }

    const timer = setTimeout(() => {
      done({ ok: false, message: 'X1 RTSP(:322) 取帧超时' })
    }, timeoutMs)

    child.stdout?.on('data', (c: Buffer) => chunks.push(c))
    let errText = ''
    child.stderr?.on('data', (c: Buffer) => {
      errText += c.toString('utf8')
    })
    child.on('error', (err) => {
      const msg = err.message || String(err)
      done({
        ok: false,
        message: /ENOENT|not found/i.test(msg)
          ? '未找到 ffmpeg：X1 系列舱内摄像头走 RTSP :322，请在 NAS/主机安装 ffmpeg 后重试'
          : msg
      })
    })
    child.on('close', (code) => {
      const jpeg = extractJpeg(Buffer.concat(chunks))
      if (jpeg && jpeg.length > 200) {
        done({ ok: true, contentType: 'image/jpeg', base64: jpeg.toString('base64') })
        return
      }
      done({
        ok: false,
        message:
          (errText || `ffmpeg 退出码 ${code}`).trim().slice(0, 240) ||
          'X1 RTSP 无有效 JPEG 帧'
      })
    })
  })
}

/**
 * Prefer JPEG :6000; on failure (typical for X1) try RTSP :322.
 * Pass preferRtsp=true when model looks like X1.
 */
export async function grabBambuCameraFrame(
  host: string,
  accessCode: string,
  opts?: { timeoutMs?: number; preferRtsp?: boolean; model?: string }
): Promise<BambuSnapResult> {
  const timeoutMs = opts?.timeoutMs ?? 12000
  const preferRtsp =
    opts?.preferRtsp === true || /x1/i.test(String(opts?.model || ''))

  if (preferRtsp) {
    const rtsp = await grabBambuRtspFrame(host, accessCode, timeoutMs)
    if (rtsp.ok) return rtsp
    const jpeg = await grabBambuJpegFrame(host, accessCode, Math.min(timeoutMs, 8000))
    if (jpeg.ok) return jpeg
    return {
      ok: false,
      message: `X1 RTSP 失败：${rtsp.message}；:6000 回退：${jpeg.message}`
    }
  }

  const jpeg = await grabBambuJpegFrame(host, accessCode, timeoutMs)
  if (jpeg.ok) return jpeg
  const rtsp = await grabBambuRtspFrame(host, accessCode, timeoutMs)
  if (rtsp.ok) return rtsp
  return {
    ok: false,
    message: `${jpeg.message}；已尝试 X1 RTSP :322：${rtsp.message}`
  }
}

/** Encode host+code into a pseudo URL for camera:snapshot */
export function bambuCameraUrl(host: string, accessCode: string, model?: string): string {
  const u = new URL('bambu-cam://frame')
  u.searchParams.set('host', host.trim())
  u.searchParams.set('code', String(accessCode || '').trim())
  if (model && String(model).trim()) u.searchParams.set('model', String(model).trim())
  return u.toString()
}

export function parseBambuCameraUrl(
  url: string
): { host: string; code: string; model?: string } | null {
  try {
    if (!url.startsWith('bambu-cam://')) return null
    const u = new URL(url)
    const host = u.searchParams.get('host') || ''
    const code = u.searchParams.get('code') || ''
    const model = u.searchParams.get('model') || undefined
    if (!host || !code) return null
    return { host, code, model: model || undefined }
  } catch {
    return null
  }
}
