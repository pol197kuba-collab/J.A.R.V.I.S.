// Shared spatial scale for the whole /jarvis matrix composition (orbit
// radius, node/core geometry, camera distance, fog/control ranges) — one
// knob so JarvisCanvas/Core3D/AgentNode3D shrink as a single coherent unit.
// The matrix now shares the viewport with the chat panel below
// (routes/jarvis.tsx) instead of owning the full height.
export const MATRIX_SCALE = 0.72;
