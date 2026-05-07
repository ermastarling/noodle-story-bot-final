export default [
  {
    files: ["**/*.js"],
    ignores: [
      "node_modules/**",
      "data/**",
      "content/**",
      ".tmp/**"
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      "no-redeclare": "error"
    }
  }
];
