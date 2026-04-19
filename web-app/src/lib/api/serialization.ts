import type { Message } from "@bufbuild/protobuf";

// Converts a protobuf Message to a plain JSON-serializable object.
// Used as the serialization boundary so Redux never stores protobuf class instances.
// In @bufbuild/protobuf v2, Message is a plain TypeScript type (not a class),
// so we use JSON round-trip to strip any non-serializable values.
export function toPlainObject<T extends Message>(msg: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(msg)) as Record<string, unknown>;
}
