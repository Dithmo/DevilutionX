/**
 * Mouse + keyboard capture for a scaled canvas.
 *
 * All mouse coordinates are in logical canvas pixels (canvas.width x
 * canvas.height) regardless of CSS scaling. Clicks and key presses are
 * queued and consumed once per tick by the simulation; `mouse` and `keys`
 * reflect the live held state.
 */

const LEFT_BUTTON = 0;
const RIGHT_BUTTON = 2;
const MAX_QUEUE = 64;
const SPACE_KEY = ' ';
const SPACE_NAME = 'space';
const PREVENT_DEFAULT_KEYS = new Set(['space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Normalise a KeyboardEvent.key: single characters lower-cased, space named.
 * @param {string} key
 * @returns {string}
 */
export function normalizeKey(key) {
  if (key === SPACE_KEY) return SPACE_NAME;
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * Attach listeners to a canvas and return the input state object.
 * @param {HTMLCanvasElement} canvas
 * @param {{ screenToWorld(sx:number, sy:number):{x:number,y:number} }} [camera]
 *   if given, each click also carries fractional world coords `wx, wy`
 * @returns {{
 *   mouse:{x:number,y:number,down:boolean,rightDown:boolean,inside:boolean},
 *   keys:Set<string>, wheel:number,
 *   consumeClicks():Array<{x:number,y:number,button:number,shift:boolean,ctrl:boolean,alt:boolean,wx?:number,wy?:number}>,
 *   consumeKeyPresses():string[],
 *   consumeWheel():number,
 *   isDown(key:string):boolean,
 *   toLogical(clientX:number, clientY:number):{x:number,y:number},
 *   destroy():void
 * }}
 */
export function createInput(canvas, camera) {
  let clicks = [];
  let presses = [];

  const input = {
    mouse: { x: 0, y: 0, down: false, rightDown: false, inside: false },
    keys: new Set(),
    wheel: 0,

    /** Drain queued clicks (mouse-down events) since the last call. */
    consumeClicks() {
      const out = clicks;
      clicks = [];
      return out;
    },

    /** Drain queued key presses (no auto-repeat) since the last call. */
    consumeKeyPresses() {
      const out = presses;
      presses = [];
      return out;
    },

    /** Return accumulated wheel notches (+down / -up) and reset. */
    consumeWheel() {
      const w = input.wheel;
      input.wheel = 0;
      return w;
    },

    /** Is the normalised key currently held? */
    isDown(key) {
      return input.keys.has(key);
    },

    /** Convert client (CSS pixel) coordinates to logical canvas coordinates. */
    toLogical(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const lw = canvas.logicalW || canvas.width;
      const lh = canvas.logicalH || canvas.height;
      const scaleX = r.width ? lw / r.width : 1;
      const scaleY = r.height ? lh / r.height : 1;
      return { x: (clientX - r.left) * scaleX, y: (clientY - r.top) * scaleY };
    },

    /** Remove all listeners. */
    destroy() {
      for (const [target, name, fn, opts] of bindings) target.removeEventListener(name, fn, opts);
      bindings.length = 0;
    },
  };

  function updateMouse(e) {
    const p = input.toLogical(e.clientX, e.clientY);
    input.mouse.x = p.x;
    input.mouse.y = p.y;
    input.mouse.inside = p.x >= 0 && p.y >= 0 && p.x < (canvas.logicalW || canvas.width) && p.y < (canvas.logicalH || canvas.height);
  }

  function onMouseDown(e) {
    updateMouse(e);
    if (e.button === LEFT_BUTTON) input.mouse.down = true;
    if (e.button === RIGHT_BUTTON) input.mouse.rightDown = true;
    const click = {
      x: input.mouse.x,
      y: input.mouse.y,
      button: e.button,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      alt: e.altKey,
    };
    if (camera && typeof camera.screenToWorld === 'function') {
      const w = camera.screenToWorld(click.x, click.y);
      click.wx = w.x;
      click.wy = w.y;
    }
    if (clicks.length < MAX_QUEUE) clicks.push(click);
    if (typeof canvas.focus === 'function') canvas.focus({ preventScroll: true });
    e.preventDefault();
  }

  function onMouseUp(e) {
    if (e.button === LEFT_BUTTON) input.mouse.down = false;
    if (e.button === RIGHT_BUTTON) input.mouse.rightDown = false;
  }

  function onKeyDown(e) {
    const k = normalizeKey(e.key);
    input.keys.add(k);
    if (!e.repeat && presses.length < MAX_QUEUE) presses.push(k);
    if (PREVENT_DEFAULT_KEYS.has(k) && !e.ctrlKey && !e.metaKey) e.preventDefault();
  }

  function onKeyUp(e) {
    input.keys.delete(normalizeKey(e.key));
  }

  function onBlur() {
    input.keys.clear();
    input.mouse.down = false;
    input.mouse.rightDown = false;
  }

  function onWheel(e) {
    input.wheel += Math.sign(e.deltaY);
    e.preventDefault();
  }

  const bindings = [
    [canvas, 'mousemove', updateMouse, false],
    [canvas, 'mousedown', onMouseDown, false],
    [canvas, 'contextmenu', (e) => e.preventDefault(), false],
    [canvas, 'wheel', onWheel, { passive: false }],
    [canvas, 'mouseleave', () => { input.mouse.inside = false; }, false],
    [window, 'mouseup', onMouseUp, false],
    [window, 'keydown', onKeyDown, false],
    [window, 'keyup', onKeyUp, false],
    [window, 'blur', onBlur, false],
  ];
  for (const [target, name, fn, opts] of bindings) target.addEventListener(name, fn, opts);

  return input;
}
