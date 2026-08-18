/**
 * Pack production plugins/themes with cover.png + 说明.txt + install zip.
 * Usage: node ops/scripts/pack-plugins-themes-covers.mjs
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
  unlinkSync
} from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const examplesRoot = join(repoRoot, 'assets/examples')
const outRoot = join(repoRoot, 'plugins-themes-packs')
const coversDir = '/Users/macos/.cursor/projects/Users-macos-Downloads-Desktop/assets'

const SKIP_FOLDERS = new Set([
  'plugin-sample',
  'plugin-kernel-v2',
  'plugin-capability-kit',
  'theme-sample'
])
const SKIP_IDS = new Set([
  'demo_hello',
  'demo_kernel_v2',
  'capability_kit',
  'sample_topnav'
])

const COVER_MAP = {
  card_model_portrait: 'cover-card_model_portrait.png',
  card_progress_vivid: 'cover-card_progress_vivid.png',
  card_status_vivid: 'cover-card_status_vivid.png',
  chamber_temp: 'cover-chamber_temp.png',
  company_chat: 'cover-company_chat.png',
  detail_console: 'cover-detail_console.png',
  device_model_card: 'cover-device_model_card.png',
  extra_cameras: 'cover-extra_cameras.png',
  print_log: 'cover-print_log.png',
  qq_wechat_login: 'cover-qq_wechat_login.png',
  command_hud: 'cover-command_hud.png',
  fullsite_board: 'cover-fullsite_board.png',
  lineboard: 'cover-lineboard.png'
}

function walk(dir, base = dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store' || name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, base, files)
    else files.push(relative(base, p).split('\\').join('/'))
  }
  return files
}

function zipDir(srcDir, zipPath) {
  if (existsSync(zipPath)) unlinkSync(zipPath)
  const r = spawnSync(
    'zip',
    ['-r', '-q', zipPath, '.', '-x', '*.DS_Store', '*/.DS_Store'],
    { cwd: srcDir, encoding: 'utf8' }
  )
  if (r.status !== 0) {
    throw new Error(`zip failed for ${srcDir}: ${r.stderr || r.stdout || r.status}`)
  }
}

if (existsSync(outRoot)) rmSync(outRoot, { recursive: true, force: true })
mkdirSync(outRoot, { recursive: true })

const packed = []

for (const name of readdirSync(examplesRoot).sort()) {
  const dir = join(examplesRoot, name)
  if (!statSync(dir).isDirectory()) continue
  if (SKIP_FOLDERS.has(name)) continue

  let kind
  let kindEn
  let manifestName
  if (name.startsWith('plugin-')) {
    kind = '插件'
    kindEn = 'PLUGIN'
    manifestName = 'plugin.json'
  } else if (name.startsWith('theme-')) {
    kind = '主题'
    kindEn = 'THEME'
    manifestName = 'theme.json'
  } else continue

  const manifestPath = join(dir, manifestName)
  if (!existsSync(manifestPath)) continue
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (m.builtin === true) continue

  const identifier = String(m.identifier || '').trim()
  const version = String(m.version || '1.0.0').trim()
  const display = String(m.name || identifier).trim()
  const desc = String(m.description || '').trim()
  if (!identifier || SKIP_IDS.has(identifier)) continue

  const coverFile = COVER_MAP[identifier]
  const coverSrc = coverFile ? join(coversDir, coverFile) : ''
  if (!coverSrc || !existsSync(coverSrc)) {
    throw new Error(`missing cover for ${identifier}: ${coverSrc}`)
  }

  const dest = join(outRoot, identifier)
  mkdirSync(dest, { recursive: true })
  copyFileSync(coverSrc, join(dest, 'cover.png'))

  const zipName = `${identifier}-${version}.zip`
  const zipPath = join(dest, zipName)
  zipDir(dir, zipPath)

  const txt =
    `名称：${display}\n` +
    `标识：${identifier}\n` +
    `版本：${version}\n` +
    `类型：${kind}\n` +
    `\n` +
    `介绍：\n` +
    `${desc || '（无）'}\n` +
    `\n` +
    `兼容软件：hanye-printer-monitor\n` +
    `安装包：${zipName}\n` +
    `封面：cover.png\n` +
    `说明：将 ${zipName} 上传到监控台或应用集市安装；上架集市时一并上传 cover.png 作为封面。\n`
  writeFileSync(join(dest, '说明.txt'), txt, 'utf8')

  packed.push({ kindEn, identifier, version, display })
  console.log(`OK ${kind} ${identifier} v${version}`)
}

const indexLines = [
  '插件/主题打包清单（含封面，已排除示例与测试）',
  '',
  `共 ${packed.length} 个`,
  ''
]
for (const row of packed) {
  indexLines.push(
    `- [${row.kindEn}] ${row.display} | 标识 ${row.identifier} | v${row.version}`
  )
}
writeFileSync(join(outRoot, '清单.txt'), indexLines.join('\n') + '\n', 'utf8')

const bundle = join(repoRoot, 'plugins-themes-packs.zip')
if (existsSync(bundle)) unlinkSync(bundle)
const zr = spawnSync(
  'zip',
  ['-r', '-q', bundle, 'plugins-themes-packs'],
  { cwd: repoRoot, encoding: 'utf8' }
)
if (zr.status !== 0) {
  throw new Error(`bundle zip failed: ${zr.stderr || zr.stdout || zr.status}`)
}

const st = statSync(bundle)
console.log('count', packed.length)
console.log('bundle', bundle, 'mb', (st.size / 1024 / 1024).toFixed(2))
console.log('files', walk(outRoot).length)
