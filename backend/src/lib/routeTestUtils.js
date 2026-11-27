/**
 * Helpers for invoking Express Router handlers in node:test without a live server.
 */

export function getRouterHandler(router, method, routePath) {
  const m = String(method || "").toLowerCase();
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods?.[m],
  );
  if (!layer) {
    throw new Error(`Route ${method.toUpperCase()} ${routePath} not found on router`);
  }
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

export function mockReqRes({ body = {}, query = {}, params = {} } = {}) {
  let statusCode = 200;
  let jsonResult = null;
  const req = { body, query, params };
  const res = {
    set() {
      return res;
    },
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      jsonResult = data;
      return res;
    },
  };
  return {
    req,
    res,
    getResult: () => jsonResult,
    getStatus: () => statusCode,
  };
}
