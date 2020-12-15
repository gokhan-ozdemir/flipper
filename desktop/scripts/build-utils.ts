/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import Metro from 'metro';
import tmp from 'tmp';
import path from 'path';
import fs from 'fs-extra';
import {spawn} from 'promisify-child-process';
import {getWatchFolders} from 'flipper-pkg-lib';
import getAppWatchFolders from './get-app-watch-folders';
import {
  getSourcePlugins,
  getPluginSourceFolders,
  BundledPluginDetails,
} from 'flipper-plugin-lib';
import {
  appDir,
  staticDir,
  defaultPluginsIndexDir,
  babelTransformationsDir,
} from './paths';

const {version} = require('../package.json');

const dev = process.env.NODE_ENV !== 'production';

export function die(err: Error) {
  console.error(err.stack);
  process.exit(1);
}

export async function generatePluginEntryPoints() {
  console.log('⚙️  Generating plugin entry points...');
  const sourcePlugins = await getSourcePlugins();
  const bundledPlugins = sourcePlugins.map(
    (p) =>
      ({
        ...p,
        isBundled: true,
        version: p.version === '0.0.0' ? version : p.version,
        flipperSDKVersion:
          p.flipperSDKVersion === '0.0.0' ? version : p.flipperSDKVersion,
      } as BundledPluginDetails),
  );
  if (await fs.pathExists(defaultPluginsIndexDir)) {
    await fs.remove(defaultPluginsIndexDir);
  }
  await fs.mkdirp(defaultPluginsIndexDir);
  await fs.writeJSON(
    path.join(defaultPluginsIndexDir, 'index.json'),
    bundledPlugins,
  );
  const pluginRequres = bundledPlugins
    .map((x) => `  '${x.name}': require('${x.name}')`)
    .join(',\n');
  const generatedIndex = `
  /* eslint-disable */
  // THIS FILE IS AUTO-GENERATED by function "generatePluginEntryPoints" in "build-utils.ts".
  export default {\n${pluginRequres}\n} as any
  `;
  await fs.ensureDir(path.join(appDir, 'src', 'defaultPlugins'));
  await fs.writeFile(
    path.join(appDir, 'src', 'defaultPlugins', 'index.tsx'),
    generatedIndex,
  );
  console.log('✅  Generated plugin entry points.');
}

const minifierConfig = {
  minifierPath: require.resolve('metro-minify-terser'),
  minifierConfig: {
    // see: https://www.npmjs.com/package/terser
    keep_fnames: true,
    module: true,
    warnings: true,
  },
};

async function compile(
  buildFolder: string,
  projectRoot: string,
  watchFolders: string[],
  entry: string,
) {
  const out = path.join(buildFolder, 'bundle.js');
  const sourceMapUrl = dev ? 'bundle.map' : undefined;
  await Metro.runBuild(
    {
      reporter: {update: () => {}},
      projectRoot,
      watchFolders,
      serializer: {},
      transformer: {
        babelTransformerPath: path.join(
          babelTransformationsDir,
          'transform-app',
        ),
        ...minifierConfig,
      },
      resolver: {
        resolverMainFields: ['flipperBundlerEntry', 'module', 'main'],
        blacklistRE: /\.native\.js$/,
        sourceExts: ['js', 'jsx', 'ts', 'tsx', 'json', 'mjs', 'cjs'],
      },
    },
    {
      dev,
      minify: !dev,
      resetCache: !dev,
      sourceMap: dev,
      sourceMapUrl,
      entry,
      out,
    },
  );
}

export async function compileRenderer(buildFolder: string) {
  console.log(`⚙️  Compiling renderer bundle...`);
  const watchFolders = [
    ...(await getAppWatchFolders()),
    ...(await getPluginSourceFolders()),
  ];
  try {
    await compile(
      buildFolder,
      appDir,
      watchFolders,
      path.join(appDir, 'src', 'init.tsx'),
    );
    console.log('✅  Compiled renderer bundle.');
  } catch (err) {
    die(err);
  }
}

export async function compileMain() {
  const out = path.join(staticDir, 'main.bundle.js');
  process.env.FLIPPER_ELECTRON_VERSION = require('electron/package.json').version;
  console.log('⚙️  Compiling main bundle...');
  try {
    const config = Object.assign({}, await Metro.loadConfig(), {
      reporter: {update: () => {}},
      projectRoot: staticDir,
      watchFolders: await getWatchFolders(staticDir),
      transformer: {
        babelTransformerPath: path.join(
          babelTransformationsDir,
          'transform-main',
        ),
        ...minifierConfig,
      },
      resolver: {
        sourceExts: ['tsx', 'ts', 'js'],
        resolverMainFields: ['flipperBundlerEntry', 'module', 'main'],
        blacklistRE: /\.native\.js$/,
      },
    });
    await Metro.runBuild(config, {
      platform: 'web',
      entry: path.join(staticDir, 'main.ts'),
      out,
      dev,
      minify: !dev,
      sourceMap: dev,
      resetCache: !dev,
    });
    console.log('✅  Compiled main bundle.');
  } catch (err) {
    die(err);
  }
}
export function buildFolder(): Promise<string> {
  // eslint-disable-next-line no-console
  console.log('Creating build directory');
  return new Promise<string>((resolve, reject) => {
    tmp.dir({prefix: 'flipper-build-'}, (err, buildFolder) => {
      if (err) {
        reject(err);
      } else {
        resolve(buildFolder);
      }
    });
  }).catch((e) => {
    die(e);
    return '';
  });
}
export function getVersionNumber(buildNumber: number) {
  let {version} = require('../package.json');
  // Unique build number is passed as --version parameter from Sandcastle
  version = [...version.split('.').slice(0, 2), buildNumber].join('.');
  return version;
}

// Asynchronously determine current mercurial revision as string or `null` in case of any error.
export function genMercurialRevision(): Promise<string | null> {
  return spawn('hg', ['log', '-r', '.', '-T', '{node}'], {encoding: 'utf8'})
    .then(
      (res) =>
        (res &&
          (typeof res.stdout === 'string'
            ? res.stdout
            : res.stdout?.toString())) ||
        null,
    )
    .catch(() => null);
}
