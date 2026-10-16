import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * Just enough ZIP for .xlsx files: read the entries of an archive (stored or deflated), and write
 * one (deflated) for the synthetic set and tests. No dependency: an .xlsx is a ZIP of XML files.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Entry name -> uncompressed bytes. Throws on anything that is not a readable ZIP. */
export function readZip(data: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  // The end-of-central-directory record is in the last 64 KiB (it may be followed by a comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== CENTRAL) throw new Error('Corrupt ZIP central directory');
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (buf.readUInt32LE(local) !== LOCAL) throw new Error('Corrupt ZIP entry');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + compressed);
    if (method === 0) entries.set(name, Buffer.from(body));
    else if (method === 8) entries.set(name, inflateRawSync(body));
    else throw new Error(`Unsupported ZIP compression method ${method} (${name})`);
  }
  return entries;
}

/** A ZIP archive of the given files, deflated, with a fixed timestamp so the output is reproducible. */
export function writeZip(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const body = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0, 10); // 00:00
    header.writeUInt16LE(0x5c21, 12); // 2026-01-01
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x5c21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(header, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += header.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
