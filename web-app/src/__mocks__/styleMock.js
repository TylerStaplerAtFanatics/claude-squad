// Mock for CSS files in Jest. Returns callable functions so vanilla-extract
// recipe() imports (e.g. `button({ intent })`) don't throw in tests.
// The function returns the prop name string so className values stay readable.
module.exports = new Proxy(
  {},
  {
    get: function (_, prop) {
      if (typeof prop === "symbol") return undefined;
      const fn = (..._args) => String(prop);
      fn.toString = () => String(prop);
      fn.valueOf = () => String(prop);
      return fn;
    },
  }
);
