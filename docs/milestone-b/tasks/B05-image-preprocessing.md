# B05: Image preprocessing and upload validation

**Depends on:** B00 · **Size:** M · **Model tier:** Regular · **Autonomy:** auto

## Goal
Uploaded recipe photos are validated and normalised before anything else touches them.

## Do
- Multipart upload handling with `@fastify/multipart` and strict size and count limits.
- Detect the type by magic number with `file-type`; accept JPEG, PNG and WebP only. HEIC is rejected with a clear error code and message.
- With `sharp`: auto-orient, strip all metadata including EXIF, resize to a maximum edge from config, re-encode.
- Return the processed bytes and metadata; do not store anything (B08 decides).
- Tests with generated fixture images, including a spoofed extension and an image with GPS EXIF.

## Not in scope
Storage and AI.

## Done when
Tests prove metadata is gone, wrong types and oversized files are rejected, and decompression-bomb sized dimensions are refused.

## Security review
Yes.
