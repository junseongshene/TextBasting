module.exports = {
  testDir: '.',
  timeout: 60000,
  use: {
    headless: true,
    viewport: { width: 1600, height: 1000 },
  },
  reporter: [['list']],
};
