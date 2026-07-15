/**
 * Builds install / manifest icons from the official CareTip app icon.
 *
 * Source of truth: src/assets/brand/App-Icon_L.png (logo package App-Icon_L).
 * Do not regenerate from the old company_logo wordmark.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const logoPath = join(root, 'src/assets/brand/App-Icon_L.png')

async function writeSquarePng({ outName, size }) {
  const buf = await readFile(logoPath)
  await sharp(buf)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false,
    })
    .png()
    .toFile(join(root, `public/${outName}`))
}

const outputs = [
  { outName: 'icon-192.png', size: 192 },
  { outName: 'icon-512.png', size: 512 },
  { outName: 'apple-touch-icon.png', size: 180 },
  { outName: 'favicon-32.png', size: 32 },
]

for (const o of outputs) {
  await writeSquarePng(o)
  console.log(`Wrote public/${o.outName}`)
}
