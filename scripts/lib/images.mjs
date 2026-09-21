import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { sourceFile } from './paths.mjs';

const MIME_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

function imageError(source, message) {
  return new Error(`Invalid image "${source}": ${message}`);
}

function validateRequestedPath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('Image path must be a nonempty relative path.');
  }
  if (relativePath.includes('\0')) throw imageError(relativePath, 'path contains a null byte.');
  if (
    path.isAbsolute(relativePath)
    || /^[a-zA-Z]:[\\/]/.test(relativePath)
    || /^[\\/]{2}/.test(relativePath)
  ) {
    throw imageError(relativePath, 'absolute and protocol-relative paths are not allowed.');
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(relativePath)) {
    throw imageError(relativePath, 'URLs and URI schemes are not allowed.');
  }
  if (relativePath.includes('?') || relativePath.includes('#')) {
    throw imageError(relativePath, 'query strings and fragments are not allowed.');
  }

  const extension = path.extname(relativePath).toLowerCase();
  const expectedMime = MIME_BY_EXTENSION.get(extension);
  if (!expectedMime) {
    throw imageError(relativePath, 'only .png, .jpg, .jpeg, and .webp files are supported.');
  }
  return expectedMime;
}

async function readRegularFile(filename, source) {
  let handle;
  try {
    handle = await open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw imageError(source, 'source is not a regular file.');
    const buffer = await handle.readFile();
    if (buffer.length === 0) throw imageError(source, 'file is empty.');
    return buffer;
  } catch (error) {
    if (error?.message?.startsWith('Invalid image ')) throw error;
    throw imageError(source, `could not read the regular file (${error?.code ?? error?.message ?? 'unknown error'}).`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

function dimensions(source, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw imageError(source, 'intrinsic width and height must be positive integers.');
  }
  return { width, height };
}

function parsePng(buffer, source) {
  if (buffer.length < 33) throw imageError(source, 'PNG header is truncated.');

  let offset = 8;
  let chunkIndex = 0;
  let width;
  let height;
  let sawIdat = false;
  let sawIend = false;

  while (offset < buffer.length) {
    if (buffer.length - offset < 12) throw imageError(source, 'PNG chunk header is truncated.');
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) throw imageError(source, `PNG ${type || 'unknown'} chunk is truncated.`);

    if (chunkIndex === 0 && type !== 'IHDR') throw imageError(source, 'PNG IHDR must be the first chunk.');
    if (type === 'IHDR') {
      if (chunkIndex !== 0 || length !== 13) throw imageError(source, 'PNG must contain one 13-byte IHDR first.');
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      dimensions(source, width, height);
      const bitDepth = buffer[dataStart + 8];
      const colorType = buffer[dataStart + 9];
      const validDepths = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (!validDepths[colorType]?.includes(bitDepth)) throw imageError(source, 'PNG IHDR has an invalid bit-depth/color-type combination.');
      if (buffer[dataStart + 10] !== 0 || buffer[dataStart + 11] !== 0 || buffer[dataStart + 12] > 1) {
        throw imageError(source, 'PNG IHDR uses unsupported compression, filtering, or interlacing values.');
      }
    } else if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
      throw imageError(source, 'animated PNG is not supported.');
    } else if (type === 'IDAT') {
      if (length > 0) sawIdat = true;
    } else if (type === 'IEND') {
      if (length !== 0) throw imageError(source, 'PNG IEND chunk must be empty.');
      sawIend = true;
      offset = chunkEnd;
      if (offset !== buffer.length) throw imageError(source, 'PNG has data after IEND.');
      break;
    }

    offset = chunkEnd;
    chunkIndex += 1;
  }

  if (width === undefined || height === undefined) throw imageError(source, 'PNG IHDR is missing.');
  if (!sawIdat) throw imageError(source, 'PNG has no nonempty IDAT image data.');
  if (!sawIend) throw imageError(source, 'PNG IEND is missing.');
  return { width, height };
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const SUPPORTED_JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2]);

function parseJpeg(buffer, source) {
  if (buffer.length < 4) throw imageError(source, 'JPEG header is truncated.');
  let offset = 2;
  let width;
  let height;
  let sawScan = false;
  let sawEoi = false;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw imageError(source, 'JPEG marker stream is malformed.');
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) throw imageError(source, 'JPEG marker is truncated.');
    const marker = buffer[offset++];
    if (marker === 0x00) throw imageError(source, 'JPEG has a stuffed byte outside scan data.');
    if (marker === 0xd8) throw imageError(source, 'multi-image JPEG is not supported.');
    if (marker === 0xd9) {
      sawEoi = true;
      if (offset !== buffer.length) throw imageError(source, 'JPEG has data after EOI; multi-image files are not supported.');
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (buffer.length - offset < 2) throw imageError(source, 'JPEG segment length is truncated.');
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2) throw imageError(source, 'JPEG segment has an invalid length.');
    const dataStart = offset + 2;
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > buffer.length) throw imageError(source, 'JPEG segment is truncated.');

    if (marker === 0xe2 && buffer.subarray(dataStart, Math.min(dataStart + 4, segmentEnd)).equals(Buffer.from('MPF\0'))) {
      throw imageError(source, 'multi-picture JPEG (MPO/MPF) is not supported.');
    }

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (!SUPPORTED_JPEG_SOF_MARKERS.has(marker)) throw imageError(source, 'JPEG frame encoding is not supported by this browser-oriented gate.');
      if (width !== undefined) throw imageError(source, 'multi-frame JPEG is not supported.');
      if (segmentLength < 11) throw imageError(source, 'JPEG frame header is truncated.');
      const components = buffer[dataStart + 5];
      if (components < 1 || components > 4 || segmentLength !== 8 + (3 * components)) {
        throw imageError(source, 'JPEG frame header has an invalid component layout.');
      }
      if (buffer[dataStart] !== 8) throw imageError(source, 'only 8-bit JPEG samples are supported.');
      height = buffer.readUInt16BE(dataStart + 1);
      width = buffer.readUInt16BE(dataStart + 3);
      dimensions(source, width, height);
    }

    offset = segmentEnd;
    if (marker === 0xda) {
      if (width === undefined) throw imageError(source, 'JPEG scan appears before its frame header.');
      if (segmentLength < 8) throw imageError(source, 'JPEG scan header is truncated.');
      const components = buffer[dataStart];
      if (components < 1 || components > 4 || segmentLength !== 6 + (2 * components)) {
        throw imageError(source, 'JPEG scan header has an invalid component layout.');
      }
      sawScan = true;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const markerStart = offset;
        while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
        if (offset >= buffer.length) throw imageError(source, 'JPEG scan data is truncated.');
        const scanMarker = buffer[offset];
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
          offset += 1;
          continue;
        }
        offset = markerStart;
        break;
      }
    }
  }

  if (width === undefined || height === undefined) throw imageError(source, 'JPEG frame header is missing.');
  if (!sawScan) throw imageError(source, 'JPEG scan data is missing.');
  if (!sawEoi) throw imageError(source, 'JPEG EOI marker is missing.');
  return { width, height };
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function parseVp8(buffer, start, size, source) {
  if (size < 10) throw imageError(source, 'WebP VP8 frame header is truncated.');
  if ((buffer[start] & 1) !== 0 || buffer[start + 3] !== 0x9d || buffer[start + 4] !== 0x01 || buffer[start + 5] !== 0x2a) {
    throw imageError(source, 'WebP VP8 key-frame header is invalid.');
  }
  const width = buffer.readUInt16LE(start + 6) & 0x3fff;
  const height = buffer.readUInt16LE(start + 8) & 0x3fff;
  return dimensions(source, width, height);
}

function parseVp8l(buffer, start, size, source) {
  if (size < 5) throw imageError(source, 'WebP VP8L frame header is truncated.');
  if (buffer[start] !== 0x2f) throw imageError(source, 'WebP VP8L signature is invalid.');
  const bits = buffer.readUInt32LE(start + 1);
  if ((bits >>> 29) !== 0) throw imageError(source, 'WebP VP8L version is unsupported.');
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >>> 14) & 0x3fff) + 1;
  return dimensions(source, width, height);
}

function parseWebp(buffer, source) {
  if (buffer.length < 20) throw imageError(source, 'WebP RIFF header is truncated.');
  const declaredLength = buffer.readUInt32LE(4) + 8;
  if (declaredLength !== buffer.length) throw imageError(source, 'WebP RIFF length does not match the file size.');

  let offset = 12;
  let extendedDimensions;
  let imageDimensions;
  let sawVp8x = false;
  let chunkIndex = 0;

  while (offset < buffer.length) {
    if (buffer.length - offset < 8) throw imageError(source, 'WebP chunk header is truncated.');
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const chunkEnd = dataEnd + (size & 1);
    if (chunkEnd > buffer.length) throw imageError(source, `WebP ${type || 'unknown'} chunk is truncated.`);

    if (type === 'VP8X') {
      if (sawVp8x || chunkIndex !== 0 || size !== 10) throw imageError(source, 'WebP VP8X must be one 10-byte first chunk.');
      sawVp8x = true;
      const flags = buffer[dataStart];
      if ((flags & 0xc1) !== 0 || buffer[dataStart + 1] !== 0 || buffer[dataStart + 2] !== 0 || buffer[dataStart + 3] !== 0) {
        throw imageError(source, 'WebP VP8X contains nonzero reserved fields.');
      }
      if ((flags & 0x02) !== 0) throw imageError(source, 'animated WebP is not supported.');
      extendedDimensions = dimensions(
        source,
        readUInt24LE(buffer, dataStart + 4) + 1,
        readUInt24LE(buffer, dataStart + 7) + 1,
      );
    } else if (type === 'ANIM' || type === 'ANMF') {
      throw imageError(source, 'animated WebP is not supported.');
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (imageDimensions) throw imageError(source, 'multi-frame WebP is not supported.');
      imageDimensions = type === 'VP8 '
        ? parseVp8(buffer, dataStart, size, source)
        : parseVp8l(buffer, dataStart, size, source);
    }

    offset = chunkEnd;
    chunkIndex += 1;
  }

  if (!imageDimensions) throw imageError(source, 'WebP contains no VP8 or VP8L image frame.');
  if (extendedDimensions && (
    extendedDimensions.width !== imageDimensions.width
    || extendedDimensions.height !== imageDimensions.height
  )) {
    throw imageError(source, 'WebP VP8X canvas dimensions do not match its image frame.');
  }
  return extendedDimensions ?? imageDimensions;
}

function detectMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

export async function prepareImage(root, relativePath) {
  const expectedMime = validateRequestedPath(relativePath);
  const filename = await sourceFile(root, relativePath, { maxBytes: null });
  const buffer = await readRegularFile(filename, relativePath);
  const mime = detectMime(buffer);
  if (!mime) throw imageError(relativePath, 'content is not a supported PNG, JPEG, or WebP image.');
  if (mime !== expectedMime) throw imageError(relativePath, `file extension does not match detected ${mime} content.`);

  const parsed = mime === 'image/png'
    ? parsePng(buffer, relativePath)
    : mime === 'image/jpeg'
      ? parseJpeg(buffer, relativePath)
      : parseWebp(buffer, relativePath);

  return {
    filename,
    dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
    width: parsed.width,
    height: parsed.height,
    bytes: buffer.length,
    mime,
  };
}
