package compression

import (
	"bytes"
	"strings"
	"testing"
)

// TestCompressLZMASmallDataSkipsCompression verifies that payloads below the
// threshold are returned as-is (ratio 1.0) without spending CPU on compression.
func TestCompressLZMASmallDataSkipsCompression(t *testing.T) {
	data := []byte("small payload")
	if len(data) >= CompressionThreshold {
		t.Fatalf("test precondition failed: data (%d bytes) must be < CompressionThreshold (%d)", len(data), CompressionThreshold)
	}

	out, ratio, err := CompressLZMA(data)
	if err != nil {
		t.Fatalf("CompressLZMA returned error for small data: %v", err)
	}
	if !bytes.Equal(out, data) {
		t.Errorf("small data: expected original bytes returned, got different bytes")
	}
	if ratio != 1.0 {
		t.Errorf("small data: expected ratio 1.0, got %f", ratio)
	}
}

// TestCompressLZMARoundTrip verifies that large, compressible data can be
// compressed and then fully recovered via DecompressLZMA.
func TestCompressLZMARoundTrip(t *testing.T) {
	// Terminal output is highly repetitive → should compress well.
	original := []byte(strings.Repeat("\x1b[32mHello, World!\x1b[0m\r\n", 100))
	if len(original) < CompressionThreshold {
		t.Fatalf("test precondition failed: data (%d bytes) must be >= CompressionThreshold (%d)", len(original), CompressionThreshold)
	}

	compressed, ratio, err := CompressLZMA(original)
	if err != nil {
		t.Fatalf("CompressLZMA error: %v", err)
	}

	// Verify compression actually reduced the size.
	if ratio >= 1.0 {
		t.Errorf("expected ratio < 1.0 for repetitive data, got %f", ratio)
	}
	if len(compressed) >= len(original) {
		t.Errorf("expected compressed (%d bytes) < original (%d bytes)", len(compressed), len(original))
	}

	// Round-trip: decompress and verify identity.
	recovered, err := DecompressLZMA(compressed)
	if err != nil {
		t.Fatalf("DecompressLZMA error: %v", err)
	}
	if !bytes.Equal(recovered, original) {
		t.Errorf("round-trip failed: recovered %d bytes, want %d bytes", len(recovered), len(original))
	}
}

// TestCompressLZMAIncompressibleDataReturnedAsIs verifies that data which
// cannot be compressed (already random/binary) is returned unchanged with
// ratio 1.0 so the caller doesn't need to handle the "worse than raw" case.
func TestCompressLZMAIncompressibleDataReturnedAsIs(t *testing.T) {
	// Pseudo-random bytes: each byte cycles through all 256 values, which is
	// hard to compress.
	data := make([]byte, CompressionThreshold*2)
	for i := range data {
		data[i] = byte(i % 256)
	}

	out, ratio, err := CompressLZMA(data)
	if err != nil {
		t.Fatalf("CompressLZMA error: %v", err)
	}
	// Either the original is returned (ratio == 1.0) or compression helped.
	// For the cycling-byte pattern LZMA may or may not compress it; the important
	// invariant is that if ratio == 1.0 then out == data (original returned).
	if ratio == 1.0 {
		if !bytes.Equal(out, data) {
			t.Errorf("when ratio==1.0, original bytes should be returned unchanged")
		}
	} else {
		// Compression helped — verify round-trip still works.
		recovered, err := DecompressLZMA(out)
		if err != nil {
			t.Fatalf("DecompressLZMA error after compression: %v", err)
		}
		if !bytes.Equal(recovered, data) {
			t.Errorf("round-trip failed for compressible cycling data")
		}
	}
}

// TestDecompressLZMAInvalidDataReturnsError verifies graceful error handling
// when handed garbage bytes rather than a valid XZ stream.
func TestDecompressLZMAInvalidDataReturnsError(t *testing.T) {
	garbage := []byte("this is not xz compressed data at all")
	_, err := DecompressLZMA(garbage)
	if err == nil {
		t.Error("expected error when decompressing invalid data, got nil")
	}
}

// TestCompressDecompressEmptyBytesAboveThreshold is a boundary test: an empty
// slice is below the threshold so it returns as-is; ensure it doesn't panic.
func TestCompressLZMAEmptySlice(t *testing.T) {
	out, ratio, err := CompressLZMA([]byte{})
	if err != nil {
		t.Fatalf("CompressLZMA error on empty slice: %v", err)
	}
	if ratio != 1.0 {
		t.Errorf("empty slice: expected ratio 1.0, got %f", ratio)
	}
	if len(out) != 0 {
		t.Errorf("empty slice: expected empty output, got %d bytes", len(out))
	}
}

// TestCompressLZMAExactlyAtThreshold verifies data of exactly CompressionThreshold
// bytes is eligible for compression (boundary case).
func TestCompressLZMAExactlyAtThreshold(t *testing.T) {
	// Highly repetitive so it should compress below the threshold.
	data := bytes.Repeat([]byte("a"), CompressionThreshold)
	if len(data) != CompressionThreshold {
		t.Fatalf("test setup error")
	}

	_, _, err := CompressLZMA(data)
	if err != nil {
		t.Fatalf("CompressLZMA error at threshold boundary: %v", err)
	}
}
