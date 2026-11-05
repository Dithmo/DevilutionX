/**
 * Tiny synchronous pub/sub bus for decoupled hooks (sfx, floating numbers,
 * quest triggers). Handlers run in registration order; a handler throwing
 * does not stop the others.
 */

/**
 * @returns {{
 *   on(name:string, fn:Function):Function,
 *   once(name:string, fn:Function):Function,
 *   off(name:string, fn:Function):void,
 *   emit(name:string, payload?:*):number,
 *   clear(name?:string):void
 * }}
 */
export function createBus() {
  const handlers = new Map();

  const bus = {
    /** Subscribe; returns an unsubscribe function. */
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
      return () => bus.off(name, fn);
    },

    /** Subscribe for a single emission. */
    once(name, fn) {
      const wrapper = (payload) => {
        bus.off(name, wrapper);
        fn(payload);
      };
      return bus.on(name, wrapper);
    },

    /** Unsubscribe a handler. */
    off(name, fn) {
      const list = handlers.get(name);
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
      if (list.length === 0) handlers.delete(name);
    },

    /** Emit to all handlers (snapshot, so handlers may unsubscribe). Returns handler count. */
    emit(name, payload) {
      const list = handlers.get(name);
      if (!list || list.length === 0) return 0;
      const snapshot = list.slice();
      for (const fn of snapshot) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[events] handler for "${name}" threw`, err);
        }
      }
      return snapshot.length;
    },

    /** Remove every handler for a name, or all handlers if no name given. */
    clear(name) {
      if (name === undefined) handlers.clear();
      else handlers.delete(name);
    },
  };
  return bus;
}
