/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  setupFiles: ['<rootDir>/__tests__/setup.js'],
  // pnpm uses a nested .pnpm store; the inner node_modules paths must also be
  // transformed. The exception list covers every package that uses ESM or JSX.
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      '\\.pnpm|' +
      '(jest-)?react-native|' +
      '@react-native(/[\\w-]+)*|' +
      '@react-native-community(/[\\w-]+)*|' +
      'expo(-[\\w-]+)?(/[\\w-]+)*|' +
      '@expo(/[\\w-]+)*|' +
      '@expo-google-fonts(/[\\w-]+)*|' +
      '@clerk(/[\\w-]+)*|' +
      'expo-router' +
    '))',
  ],
  moduleNameMapper: {
    // Stub for react-native/setup-env — only exists in RN 0.82+, but
    // @react-native/jest-preset@0.87 maps it unconditionally.
    '^react-native/setup-env$':
      '<rootDir>/__tests__/__mocks__/setup-env-stub.js',
    '^@/(.*)$': '<rootDir>/$1',
    '^@workspace/api-client-react$':
      '<rootDir>/__tests__/__mocks__/api-client-react.js',
  },
};
