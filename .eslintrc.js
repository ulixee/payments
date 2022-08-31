const { monorepo } = require('@ulixee/repo-tools/eslint');

module.exports = monorepo(__dirname);

module.exports.parserOptions.extraFileExtensions.push('.sol');
