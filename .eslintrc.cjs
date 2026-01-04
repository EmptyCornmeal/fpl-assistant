module.exports = {
  root: true,
  env: {
    browser: true,
    es2023: true,
    worker: true,
  },
  extends: ["eslint:recommended", "plugin:import/recommended", "prettier"],
  plugins: ["import"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  settings: {
    "import/resolver": {
      node: {
        extensions: [".js"],
      },
    },
  },
  rules: {
    "import/no-unresolved": "off", // hash-routed relative imports in static hosting
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "no-var": "error",
    "prefer-const": "warn",
  },
};
