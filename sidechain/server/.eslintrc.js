
module.exports = {
  extends: '../../.eslintrc.js',
  ignorePatterns: ['.eslintrc.js'],
  overrides: [
    {
      files: ['hardhat.config.ts'],
      rules: {
        'import/no-extraneous-dependencies': 'off',
      },
    },
  ],
};
