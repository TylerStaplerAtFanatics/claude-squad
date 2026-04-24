# Backend Feature Scanner

A Go tool that generates `docs/registry/backend-features.json` by combining two sources of truth:

1. **Proto scanner** - parses `proto/session/v1/session.proto` for RPC service methods.
2. **Marker scanner** - walks `server/services/*.go` (excluding `.pb.go` and `_test.go`) for `// +api:` comment markers.

## Usage

From the project root:

```bash
cd tools/scanner
go build -o ../../backend-scanner ./backend/cmd/
cd ../..
./backend-scanner proto/session/v1/session.proto server/services/ docs/registry/backend-features.json
```

Or with default paths (run from project root):

```bash
cd tools/scanner && go run ./backend/cmd/
```

## Arguments

```
backend-scanner [protoFile] [servicesDir] [outputFile]
```

| Argument | Default | Description |
|---|---|---|
| `protoFile` | `proto/session/v1/session.proto` | Path to the proto file |
| `servicesDir` | `server/services/` | Directory to scan for `// +api:` markers |
| `outputFile` | `docs/registry/backend-features.json` | Output JSON path |

## Markers

Add `// +api: <feature-id>` just before a handler function to link it to the feature registry:

```go
// +api: session:create
func (s *SessionService) CreateSession(ctx context.Context, req *connect.Request[sessionv1.CreateSessionRequest]) (*connect.Response[sessionv1.CreateSessionResponse], error) {
```

## Output Schema

See `docs/registry/schema.json` for the full JSON Schema definition.

## Running Tests

```bash
cd tools/scanner
go test ./backend/...
```
