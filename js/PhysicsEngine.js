// `Matter` is the sole external global, injected by the CDN <script> in index.html.
// Everything else in this module is fully encapsulated within the class.
const { Engine, Runner, Bodies, Body, Composite, Events } = Matter;

export class PhysicsEngine {
  /**
   * @param {{ x: number, y: number, w: number, h: number }} rect
   *   The inner-frame rectangle in logical pixels. Physics boundaries and card
   *   spawn positions are all derived from this rect.
   */
  constructor(rect) {
    this.rect = rect;

    this.engine = Engine.create({
      enableSleeping: true,
      gravity: { x: 0, y: 0 },
    });

    this.world  = this.engine.world;
    this.runner = Runner.create();

    this._addBoundaries();
  }

  // ─── Boundaries ─────────────────────────────────────────────────────────────

  _addBoundaries() {
    const { x, y, w, h } = this.rect;
    const T    = 80;
    const opts = {
      isStatic: true, friction: 0.5, restitution: 0.1,
      collisionFilter: { category: 0x0001, mask: 0x0001 | 0x0002 },
    };

    Composite.add(this.world, [
      Bodies.rectangle(x + w / 2,     y - T / 2,       w + T * 2, T,         opts), // top
      Bodies.rectangle(x + w / 2,     y + h + T / 2,   w + T * 2, T,         opts), // bottom
      Bodies.rectangle(x - T / 2,     y + h / 2,       T,         h + T * 2, opts), // left
      Bodies.rectangle(x + w + T / 2, y + h / 2,       T,         h + T * 2, opts), // right
    ]);
  }

  // ─── Gaussian RNG (Box-Muller) ───────────────────────────────────────────────

  _gaussian(mean = 0, std = 1) {
    const u1 = Math.max(Math.random(), 1e-10);
    const u2 = Math.random();
    const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * std;
  }

  // ─── Card launching ──────────────────────────────────────────────────────────

  /**
   * Launch a card from the bottom-center of the inner frame toward a target
   * pile center. Velocity is derived so the card naturally decelerates to rest
   * near the target (total travel ≈ v₀ / frictionAir via geometric series).
   * Gaussian jitter on the destination produces a natural, overlapping pile.
   *
   * The physics body is inset to BODY_SCALE of the rendered image dimensions.
   * Cards collide via these smaller bodies, so images visually overlap by at
   * most ~(1 - BODY_SCALE) of their width — preventing full occlusion while
   * still allowing a natural, close-together pile feel.
   *
   * @param {number} w       - rendered image width  (logical px)
   * @param {number} h       - rendered image height (logical px)
   * @param {number} targetX - pile center x (logical px)
   * @param {number} targetY - pile center y (logical px)
   * @returns {Matter.Body}
   */
  launchCardToTarget({ w: cardW, h: cardH, targetX, targetY }) {
    const { x, y, w, h } = this.rect;

    // Physics body is inset — controls maximum visual overlap between cards.
    // At 0.78 each image sticks out ~11% past its body on every side,
    // so two touching bodies produce at most ~22% image overlap.
    const BODY_SCALE = 0.78;
    const bodyW = cardW * BODY_SCALE;
    const bodyH = cardH * BODY_SCALE;

    // ── Spawn: bottom-center of inner frame, small x-jitter ──────────────────
    const spawnX = x + w / 2 + this._gaussian(0, w * 0.03);
    const spawnY = y + h - bodyH / 2 - 2;

    // ── Destination: target + pile jitter so cards fan out naturally ──────────
    const destX = targetX + this._gaussian(0, cardW * 0.95); // higher = cards fan out more within the pile
    const destY = targetY + this._gaussian(0, cardH * 0.95); // same

    // ── Velocity: v₀ = Δ × frictionAir → card decelerates to rest at dest ────
    const FRICTION_AIR = 0.06;
    const vx = (destX - spawnX) * FRICTION_AIR;
    const vy = (destY - spawnY) * FRICTION_AIR;

    const body = Bodies.rectangle(spawnX, spawnY, bodyW, bodyH, {
      friction:        0.4,
      frictionAir:     FRICTION_AIR,
      restitution:     0.1,
      sleepThreshold:  25,
      // Cards collide with walls (0x0001) AND with each other (0x0002).
      collisionFilter: { category: 0x0002, mask: 0x0001 | 0x0002 },
    });

    // ── Slight entry tilt + spin ──────────────────────────────────────────────
    Body.setAngle(body, this._gaussian(0, 0.15));
    Body.setVelocity(body, { x: vx, y: vy });
    Body.setAngularVelocity(body, this._gaussian(0, 0.06));

    Composite.add(this.world, body);
    return body;
  }

  // ─── Utility ─────────────────────────────────────────────────────────────────

  clearDynamic() {
    const dynamic = Composite.allBodies(this.world).filter(b => !b.isStatic);
    Composite.remove(this.world, dynamic);
  }

  /** Fully tear down the engine — call before replacing with a new instance. */
  destroy() {
    Runner.stop(this.runner);
    Composite.clear(this.world, false);
    Engine.clear(this.engine);
    Events.off(this.engine);
  }

  start() { Runner.run(this.runner, this.engine); }
  stop()  { Runner.stop(this.runner); }

  onAfterUpdate(cb) { Events.on(this.engine, "afterUpdate", cb); }
  onSleepStart(cb)  { Events.on(this.engine, "sleepStart",  cb); }

  /** Rebuild boundaries for a new frame rect (call after resize). */
  resize(rect) {
    this.rect = rect;
    const statics = Composite.allBodies(this.world).filter(b => b.isStatic);
    Composite.remove(this.world, statics);
    this._addBoundaries();
  }
}
