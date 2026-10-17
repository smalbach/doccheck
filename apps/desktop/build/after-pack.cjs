// electron-builder leaves node_modules out of extraResources whatever the filter says, so the staged
// server's dependencies are copied into the packed app here, before the installer is made.
const { cpSync, existsSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const resources =
    electronPlatformName === 'darwin'
      ? join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(appOutDir, 'resources');
  const from = join(packager.projectDir, 'server', 'node_modules');
  if (!existsSync(from)) throw new Error('apps/desktop/server/node_modules is missing: run npm run stage first');
  cpSync(from, join(resources, 'server', 'node_modules'), { recursive: true, verbatimSymlinks: true });
};
