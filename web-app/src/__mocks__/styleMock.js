// Identity proxy for CSS modules: returns the class name as-is so tests can
// query by className without needing a real CSS build.
module.exports = new Proxy(
  {},
  {
    get: function (_, prop) {
      return prop;
    },
  }
);
