package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/tstapler/stapler-squad/tools/scanner/backend"
)

// Registry is the top-level JSON structure written to the output file.
type Registry struct {
	Version     string          `json:"version"`
	GeneratedAt time.Time       `json:"generatedAt"`
	Features    []RegistryEntry `json:"features"`
}

// BackendDetails holds backend-specific fields nested under "backend" in the JSON.
type BackendDetails struct {
	Service     string `json:"service"`
	Method      string `json:"method"`
	ProtoFile   string `json:"protoFile"`
	MarkerFound bool   `json:"markerFound"`
	HandlerFile string `json:"handlerFile,omitempty"`
}

// RegistryEntry is a single feature entry in the registry JSON.
type RegistryEntry struct {
	ID           string         `json:"id"`
	Type         string         `json:"type"`
	Backend      BackendDetails `json:"backend"`
	Tested       bool           `json:"tested"`
	TestIDs      []string       `json:"testIds"`
	LastModified time.Time      `json:"lastModified"`
}

func main() {
	protoFile := "proto/session/v1/session.proto"
	servicesDir := "server/services/"
	outputFile := "docs/registry/backend-features.json"

	if len(os.Args) >= 2 {
		protoFile = os.Args[1]
	}
	if len(os.Args) >= 3 {
		servicesDir = os.Args[2]
	}
	if len(os.Args) >= 4 {
		outputFile = os.Args[3]
	}

	features, err := backend.ScanProto(protoFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error scanning proto: %v\n", err)
		os.Exit(1)
	}

	markers, err := backend.ScanMarkers(servicesDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error scanning markers: %v\n", err)
		os.Exit(1)
	}

	var entries []RegistryEntry
	for _, f := range features {
		entry := RegistryEntry{
			ID:   f.ID,
			Type: f.Type,
			Backend: BackendDetails{
				Service:   f.Service,
				Method:    f.Method,
				ProtoFile: f.ProtoFile,
			},
			Tested:       f.Tested,
			TestIDs:      f.TestIDs,
			LastModified: f.LastModified,
		}
		if m, ok := markers[f.ID]; ok {
			entry.Backend.MarkerFound = true
			entry.Backend.HandlerFile = m.FilePath
		}
		entries = append(entries, entry)
	}

	registry := Registry{
		Version:     "1",
		GeneratedAt: time.Now().UTC(),
		Features:    entries,
	}

	// Ensure output directory exists.
	if err := os.MkdirAll(filepath.Dir(outputFile), 0755); err != nil {
		fmt.Fprintf(os.Stderr, "error creating output directory: %v\n", err)
		os.Exit(1)
	}

	data, err := json.MarshalIndent(registry, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "error marshaling JSON: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(outputFile, data, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "error writing output file: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Wrote %d features to %s\n", len(entries), outputFile)
}
