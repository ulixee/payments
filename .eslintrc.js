const { monorepo } = require('@ulixee/repo-tools/eslint');

module.exports = monorepo(__dirname);

module.exports.parserOptions.extraFileExtensions.push('.sol');

module.exports.overrides.push({
  files: ['**/*.config.*'],
  rules: { 'import/no-extraneous-dependencies': 'off' },
});
