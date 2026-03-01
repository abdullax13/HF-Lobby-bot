const fs = require("fs");

function createStore(file) {
  let data = {};

  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file));
  }

  function save() {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  return {
    get: (k) => data[k],
    set: (k, v) => {
      data[k] = v;
      save();
    },
    del: (k) => {
      delete data[k];
      save();
    },
    all: () => Object.entries(data).map(([key, value]) => ({ key, value })),
  };
}

module.exports = { createStore };
