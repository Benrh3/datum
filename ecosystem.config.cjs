// PM2 config. Deploy with deploy.sh; runs on its own port, no conflict with 3333.
module.exports = {
  apps: [{
    name: 'commercial-pm',
    script: 'dist/index.js',
    env: { NODE_ENV: 'production', PORT: 4010 }
  }]
};
