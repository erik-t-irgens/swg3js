// Whether any water actually shows on screen, rather than merely lying in the frustum.
// The far ring reaches nine kilometres and the near sea spans three, so on a planet with a global
// water table the frustum test says "water in view" almost whenever the camera looks near the
// horizon, even deep inland behind hills. A WebGL2 occlusion query around a colourless draw of the
// water against the finished scene depth answers the real question, a frame or more later.
//
// No three import: a plain node test runs this against a fake context.

export type WaterVisibilityState = 'unknown' | 'visible' | 'hidden';

/** How many frames a query may go unanswered (a lost context) before the question is asked again. */
const GIVE_UP_FRAMES = 60;

export class WaterVisibility {
  /** 'unknown' until a query answers, and again whenever no body is in the frustum. Unknown counts as visible. */
  state: WaterVisibilityState = 'unknown';
  /** Frames since the state last came from a query, or since the question went out; 0 while neither. */
  age = 0;
  private gl: WebGL2RenderingContext | null = null;
  private query: WebGLQuery | null = null;
  private pending = false;
  private waited = 0;
  /** Bumped by invalidate: an answer about a view that has emptied since is thrown away. */
  private generation = 0;
  private asked = 0;

  attach(gl: WebGL2RenderingContext): void {
    this.gl = gl;
  }

  get attached(): boolean {
    return this.gl !== null;
  }

  /** Once a frame, before deciding: take a finished answer if there is one. */
  poll(): void {
    // Only while an answer stands or a question is out: a frame in which nothing is known and
    // nothing is asked (no water anywhere near the view) is not an age, and counting it would
    // have `describe()` report hundreds of thousands of frames on a dry planet.
    if (this.pending || this.state !== 'unknown') this.age++;
    const gl = this.gl;
    if (!gl || !this.pending || !this.query) return;
    if (++this.waited > GIVE_UP_FRAMES) {
      this.pending = false;
      return;
    }
    if (!gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) return;
    const any = !!gl.getQueryParameter(this.query, gl.QUERY_RESULT);
    this.pending = false;
    if (this.asked !== this.generation) return;
    this.state = any ? 'visible' : 'hidden';
    this.age = 0;
  }

  /** No body in the frustum: forget the answer and any question still out. */
  invalidate(): void {
    this.state = 'unknown';
    this.age = 0;
    this.generation++;
  }

  /** Run `draw` inside a query when none is waiting. Returns whether it drew. */
  measure(draw: () => void): boolean {
    const gl = this.gl;
    if (!gl || this.pending) return false;
    this.query ??= gl.createQuery();
    if (!this.query) return false;
    gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, this.query);
    try {
      draw();
    } finally {
      gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
    }
    this.pending = true;
    this.waited = 0;
    this.asked = this.generation;
    return true;
  }

  dispose(): void {
    if (this.gl && this.query) this.gl.deleteQuery(this.query);
    this.query = null;
    this.pending = false;
    this.state = 'unknown';
  }
}
