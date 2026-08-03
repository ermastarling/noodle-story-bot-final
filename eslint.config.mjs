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
      "no-redeclare": "error",
      "no-unused-vars": [
        "warn",
        {
          vars: "all",
          args: "after-used",
          ignoreRestSiblings: true,
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ],
      "no-unreachable": "error",
      "no-unsafe-finally": "error"
    }
  }
];
