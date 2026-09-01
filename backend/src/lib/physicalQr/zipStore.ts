/** Store-method ZIP (no compression). Avoids adding an archive dependency. */

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipStoreEntry = { name: string; data: Buffer };

export function sanitizeZipEntryName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "") || "file";
  return cleaned.slice(0, 120);
}

function u16(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n >>> 0, 0);
  return buf;
}

function u32(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n >>> 0, 0);
  return buf;
}

export function zipStore(entries: ZipStoreEntry[]): Buffer {
  if (!entries.length) throw new Error("zipStore requires at least one file");

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = sanitizeZipEntryName(entry.name);
    const nameBuf = Buffer.from(name, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const local = Buffer.concat([
      Buffer.from("PK\u0003\u0004", "binary"),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      data,
    ]);
    const central = Buffer.concat([
      Buffer.from("PK\u0001\u0002", "binary"),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from("PK\u0005\u0006", "binary"),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);

  return Buffer.concat([...locals, centralDir, eocd]);
}
