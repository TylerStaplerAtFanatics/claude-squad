package backend

import (
	"path/filepath"
	"runtime"
	"testing"
)

func testdataPath(name string) string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "testdata", name)
}

func TestScanProto_ThreeMethods(t *testing.T) {
	features, err := ScanProto(testdataPath("test.proto"))
	if err != nil {
		t.Fatalf("ScanProto error: %v", err)
	}
	if len(features) != 3 {
		t.Fatalf("expected 3 features, got %d", len(features))
	}

	ids := map[string]bool{}
	for _, f := range features {
		ids[f.ID] = true
		if f.Service != "SessionService" {
			t.Errorf("expected Service=SessionService, got %s", f.Service)
		}
		if f.Type != "backend" {
			t.Errorf("expected Type=backend, got %s", f.Type)
		}
		if f.MarkerFound {
			t.Errorf("expected MarkerFound=false for proto scan, got true")
		}
		if f.TestIDs == nil {
			t.Errorf("expected TestIDs to be non-nil slice")
		}
	}

	for _, want := range []string{"session:create", "session:list", "session:delete"} {
		if !ids[want] {
			t.Errorf("expected feature ID %q not found; got %v", want, ids)
		}
	}
}

func TestScanProto_NoServices(t *testing.T) {
	// Write a minimal proto with only messages to a temp file.
	tmp := t.TempDir()
	protoPath := filepath.Join(tmp, "messages_only.proto")

	content := `syntax = "proto3";
package test;

message Foo {
  string id = 1;
}

message Bar {
  int32 count = 1;
}
`
	if err := writeFile(protoPath, content); err != nil {
		t.Fatal(err)
	}

	features, err := ScanProto(protoPath)
	if err != nil {
		t.Fatalf("ScanProto error: %v", err)
	}
	if len(features) != 0 {
		t.Fatalf("expected 0 features for messages-only proto, got %d", len(features))
	}
}

func TestScanProto_RealLikeFixture(t *testing.T) {
	features, err := ScanProto(testdataPath("test.proto"))
	if err != nil {
		t.Fatalf("ScanProto error: %v", err)
	}

	// Verify method names are populated correctly.
	methodNames := map[string]bool{}
	for _, f := range features {
		methodNames[f.Method] = true
		if f.ProtoFile != testdataPath("test.proto") {
			t.Errorf("expected ProtoFile to be set, got %q", f.ProtoFile)
		}
	}
	for _, want := range []string{"CreateSession", "ListSessions", "DeleteSession"} {
		if !methodNames[want] {
			t.Errorf("expected method %q in features", want)
		}
	}
}

func writeFile(path, content string) error {
	f, err := openFileCreate(path)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(content)
	return err
}
