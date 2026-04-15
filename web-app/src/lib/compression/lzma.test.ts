/**
 * Tests for client-side LZMA compression utilities.
 *
 * isLZMACompressed — pure detection function, testable without browser globals.
 * decompressLZMA   — requires window.LZMA; tested via mocked global.
 */

import { isLZMACompressed, decompressLZMA } from './lzma';

// XZ magic: 0xFD 0x37 0x7A 0x58 0x5A 0x00
const XZ_MAGIC = new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);

// --- isLZMACompressed ---

describe('isLZMACompressed', () => {
  it('returns true for data starting with XZ magic bytes', () => {
    const data = new Uint8Array([...XZ_MAGIC, 0x01, 0x02, 0x03]);
    expect(isLZMACompressed(data)).toBe(true);
  });

  it('returns false for plain terminal ANSI output', () => {
    const data = new TextEncoder().encode('\x1b[32mHello, World!\x1b[0m\r\n');
    expect(isLZMACompressed(data)).toBe(false);
  });

  it('returns false for raw protobuf bytes', () => {
    // Typical protobuf field tag bytes — definitely not XZ
    const data = new Uint8Array([0x0a, 0x0b, 0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    expect(isLZMACompressed(data)).toBe(false);
  });

  it('returns false when data is shorter than 6 bytes', () => {
    expect(isLZMACompressed(new Uint8Array([0xfd, 0x37, 0x7a]))).toBe(false);
    expect(isLZMACompressed(new Uint8Array([]))).toBe(false);
  });

  it('returns false when only the first byte matches', () => {
    const data = new Uint8Array([0xfd, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(isLZMACompressed(data)).toBe(false);
  });

  it('returns false when magic bytes are correct but in wrong order', () => {
    // Reversed magic
    const data = new Uint8Array([...XZ_MAGIC].reverse());
    expect(isLZMACompressed(data)).toBe(false);
  });

  it('returns true for exactly 6-byte XZ magic (minimum valid header)', () => {
    expect(isLZMACompressed(XZ_MAGIC)).toBe(true);
  });
});

// --- decompressLZMA ---
//
// decompressLZMA relies on window.LZMA which is loaded dynamically from lzma-js.
// We mock the global and the dynamic imports to test the decompression path
// without a full browser environment.

describe('decompressLZMA', () => {
  const mockDecompressedData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"

  const mockOutStream = {
    toUint8Array: () => mockDecompressedData,
  };

  const mockLZMA = {
    iStream: jest.fn().mockImplementation(() => ({})),
    oStream: jest.fn().mockImplementation(() => mockOutStream),
    decompressFile: jest.fn().mockReturnValue(mockOutStream),
  };

  beforeEach(() => {
    jest.resetModules();
    // Provide window.LZMA global used by the implementation
    (window as any).LZMA = mockLZMA;
    mockLZMA.iStream.mockClear();
    mockLZMA.decompressFile.mockClear();
    mockLZMA.decompressFile.mockReturnValue(mockOutStream);
  });

  afterEach(() => {
    delete (window as any).LZMA;
  });

  it('calls LZMA.decompressFile and returns the decompressed bytes', async () => {
    const compressed = new Uint8Array([...XZ_MAGIC, 0xaa, 0xbb]);

    const result = await decompressLZMA(compressed);

    expect(mockLZMA.decompressFile).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockDecompressedData);
  });

  it('passes the input bytes as an ArrayBuffer slice to iStream', async () => {
    const compressed = new Uint8Array([...XZ_MAGIC, 0x01, 0x02]);
    await decompressLZMA(compressed);

    expect(mockLZMA.iStream).toHaveBeenCalledTimes(1);
    const arg = mockLZMA.iStream.mock.calls[0][0];
    // iStream should receive an ArrayBuffer (or slice thereof)
    expect(arg).toBeInstanceOf(ArrayBuffer);
  });

  it('rejects when LZMA global is not loaded', async () => {
    delete (window as any).LZMA;
    const compressed = new Uint8Array([...XZ_MAGIC]);
    await expect(decompressLZMA(compressed)).rejects.toThrow();
  });

  it('rejects when LZMA.decompressFile throws', async () => {
    mockLZMA.decompressFile.mockImplementationOnce(() => {
      throw new Error('corrupt xz stream');
    });
    const compressed = new Uint8Array([...XZ_MAGIC, 0x00]);
    await expect(decompressLZMA(compressed)).rejects.toThrow('corrupt xz stream');
  });
});

// --- Transport mode integration: raw vs raw-compressed detection ---
//
// This group documents the contract between the streaming modes and the
// detection function — ensuring the client correctly identifies which path
// to take for each transport type.

describe('transport mode detection contract', () => {
  const rawTerminalOutput = new TextEncoder().encode(
    '\x1b[2J\x1b[H\x1b[32mstapler-squad\x1b[0m running on :8543\r\n'
  );

  it('"raw" mode: terminal output is not LZMA-compressed', () => {
    // In "raw" mode the server sends plain bytes — no decompression needed.
    expect(isLZMACompressed(rawTerminalOutput)).toBe(false);
  });

  it('"raw-compressed" mode: XZ-framed data is detected as compressed', () => {
    // Server wraps output in XZ format; client must decompress before writing to xterm.
    const compressedPayload = new Uint8Array([...XZ_MAGIC, 0xde, 0xad, 0xbe, 0xef]);
    expect(isLZMACompressed(compressedPayload)).toBe(true);
  });

  it('"state" mode: state payloads begin with protobuf framing, not XZ magic', () => {
    // TerminalState protobuf starts with field tags (0x0a …), never XZ magic.
    const protoBytes = new Uint8Array([0x0a, 0x10, 0x1b, 0x5b, 0x32, 0x4a]);
    expect(isLZMACompressed(protoBytes)).toBe(false);
  });

  it('"hybrid" mode: raw incremental output is not LZMA-compressed', () => {
    // Hybrid sends raw deltas; only full-state snapshots may be compressed.
    expect(isLZMACompressed(rawTerminalOutput)).toBe(false);
  });
});
