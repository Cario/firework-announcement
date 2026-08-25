import './style.css';

/**
 * Boot. Scaffold only — the scene, audio and sequence are wired up in
 * later phases. For now this just resolves the canvas element so the
 * module graph and the DOM contract are proven to line up.
 */
const canvas = document.getElementById('scene');

if (!canvas) {
  console.error('[nikkah] #scene canvas not found');
}

export { canvas };
