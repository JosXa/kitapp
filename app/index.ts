/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
/* eslint-disable import/first */
/* eslint-disable jest/no-identical-title */
/* eslint-disable jest/expect-expect */
/* eslint global-require: off, no-console: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `yarn build` or `yarn build-main`, this file is compiled to
 * `./src/main.prod.js` using webpack. This gives us some performance wins.
 */

process.env.DIST_ELECTRON = path.join(__dirname, './');
process.env.DIST = path.join(process.env.DIST_ELECTRON, '../dist');

process.env.PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST;

// Disables CSP warnings in browser windows.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

import {
  app,
  clipboard,
  protocol,
  powerMonitor,
  shell,
  BrowserWindow,
  crashReporter,
} from 'electron';

import StreamZip from 'node-stream-zip';
import tar from 'tar';
import unhandled from 'electron-unhandled';
import { openNewGitHubIssue, debugInfo } from 'electron-util';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import path from 'path';
import {
  fork,
  spawn,
  spawnSync,
  SpawnSyncOptions,
  SpawnSyncReturns,
  ForkOptions,
  execFileSync,
} from 'child_process';
import os, { homedir } from 'os';
import semver from 'semver';
import { ensureDir } from 'fs-extra';
import { existsSync } from 'fs';
import {
  chmod,
  lstat,
  readdir,
  readFile,
  rename,
  rm,
  mkdir,
  writeFile,
} from 'fs/promises';

import { Channel, ProcessType, UI } from '@johnlindquist/kit/cjs/enum';
import { PromptData } from '@johnlindquist/kit/types/cjs';

import {
  kenvPath,
  kitPath,
  knodePath,
  KIT_FIRST_PATH,
  tmpClipboardDir,
  tmpDownloadsDir,
  execPath,
} from '@johnlindquist/kit/cjs/utils';

import {
  getPrefsDb,
  getShortcutsDb,
  getAppDb,
} from '@johnlindquist/kit/cjs/db';

import download from 'download';

import { subscribeKey } from 'valtio/utils';
import { assign } from 'lodash';
import { setupTray } from './tray';
import { setupWatchers, teardownWatchers } from './watcher';
import {
  getArch,
  getAssetPath,
  getNodeVersion,
  getPlatform,
  getPlatformExtension,
  getReleaseChannel,
} from './assets';
import {
  clearTickTimers,
  configureInterval,
  destroyInterval,
  pantsKick,
} from './tick';
import {
  clearPromptCache,
  createPromptWindow,
  destroyPromptWindow,
  sendToPrompt,
  setPromptData,
  setScript,
  focusPrompt,
  clearPromptTimers,
} from './prompt';
import { APP_NAME, KIT_PROTOCOL, tildify } from './helpers';
import { getVersion, getStoredVersion, storeVersion } from './version';
import { checkForUpdates, configureAutoUpdate, kitIgnore } from './update';
import { INSTALL_ERROR, show } from './show';
import {
  appDb,
  cacheKitScripts,
  checkAccessibility,
  clearStateTimers,
  initKeymap,
  kitState,
  subs,
  updateScripts,
} from './state';
import { startSK } from './sk';
import { destroyAllProcesses, handleWidgetEvents, processes } from './process';
import { startIpc } from './ipc';
import { runPromptProcess } from './kit';
import { showError } from './main.dev.templates';
import { scheduleDownloads, sleepSchedule } from './schedule';
import { startSettings as setupSettings } from './settings';
import { SPLASH_PATH } from '@johnlindquist/kit/cjs/defaults';
import { registerKillLatestShortcut } from './shortcuts';
import { mainLog, mainLogPath } from './logs';
import { emitter } from './events';
import { getIcon } from './public';

// ignore lint rules for the following function
/* eslint-disable */
(function () {
  if (!process.env.NODE_EXTRA_CA_CERTS) return;
  let extraca: any = null;
  try {
    extraca = require('fs').readFileSync(process.env.NODE_EXTRA_CA_CERTS);
  } catch (e) {
    return;
  }

  // @ts-ignore
  const NativeSecureContext = process.binding('crypto').SecureContext;
  const oldaddRootCerts = NativeSecureContext.prototype.addRootCerts;
  NativeSecureContext.prototype.addRootCerts = function () {
    // @ts-ignore
    const ret = oldaddRootCerts.apply(this, ...args);
    if (extraca) {
      this.addCACert(extraca);
      return ret;
    }
  };
})();
/* eslint-enable */

crashReporter.start({ submitURL: '', uploadToServer: false });

unhandled({
  showDialog: true,
  logger: (error) => {
    log.error(error);
  },
  reportButton: (error) => {
    openNewGitHubIssue({
      user: 'johnlindquist',
      repo: 'kit',
      body: `\`\`\`\n${error.stack}\n\`\`\`\n\n---\n\n${debugInfo()}`,
    });
  },
});

if (!app.requestSingleInstanceLock()) {
  app.exit();
}

app.setName(APP_NAME);
if (app?.dock) {
  app?.dock?.setIcon(getIcon());
}

app.setAsDefaultProtocolClient(KIT_PROTOCOL);
if (app?.dock) {
  // app?.dock?.hide();
  app?.dock?.setIcon(getIcon());
}
const releaseChannel = getReleaseChannel();
const arch = getArch();
const platform = getPlatform();
const nodeVersion = getNodeVersion();

app.on('window-all-closed', (e: Event) => {
  mainLog.log(`🪟 window-all-closed`);
  e.preventDefault();
});

log.info(`
Release channel: ${releaseChannel}
Arch: ${arch}
Platform: ${platform}
Node version: ${nodeVersion}
Node path: ${execPath}
Electron version: ${process.versions.electron}
Electron Node version: ${process.versions.node}
Electron Chromium version: ${process.versions.chrome}
Electron execPath: ${process.execPath}
`);

const KIT = kitPath();

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

if (
  process.env.NODE_ENV === 'development' ||
  process.env.DEBUG_PROD === 'true'
) {
  require('electron-debug')({ showDevTools: false });
}

// fmkadmapgofadopljbjfkapdkoienihi
const installExtensions = async () => {
  const { default: installExtension, REACT_DEVELOPER_TOOLS } = await import(
    'electron-devtools-installer'
  );
  const result = await installExtension(REACT_DEVELOPER_TOOLS, {
    loadExtensionOptions: { allowFileAccess: true },
  }).catch((error) => {
    log.info(`😬 DEVTOOLS INSTALL FAILED`, { error });
  });
  if (result) log.info(`😬 DEVTOOLS INSTALLED`, { result });
};

const cliFromParams = async (cli: string, params: URLSearchParams) => {
  const name = params.get('name');
  const newUrl = params.get('url');
  if (name && newUrl) {
    await runPromptProcess(kitPath(`cli/${cli}.js`), [name, '--url', newUrl]);
    return true;
  }

  const content = params.get('content');

  if (content) {
    await runPromptProcess(kitPath(`cli/${cli}.js`), [
      name || '',
      '--content',
      content,
    ]);
    return true;
  }
  return false;
};

const newFromProtocol = async (u: string) => {
  const url = new URL(u);
  console.log({ url });
  if (url.protocol === 'kit:') {
    const pathname = url.pathname.replace('//', '');
    if (pathname === 'new') {
      await cliFromParams('new', url.searchParams);
    }
    if (pathname === 'snippet' || url.host === 'snippet') {
      await cliFromParams('snippet', url.searchParams);
    }

    if (pathname === 'kenv') {
      const repo = url.searchParams.get('repo');
      await runPromptProcess(kitPath('cli', 'kenv-clone.js'), [repo || '']);
    }
  }
};

app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', async (event, navigationUrl) => {
    const url = new URL(navigationUrl);
    console.log({ url });
    event.preventDefault();

    if (url.host === 'scriptkit.com' && url.pathname === '/api/new') {
      await cliFromParams('new', url.searchParams);
    } else if (url.protocol === 'kit:') {
      await cliFromParams(url.pathname, url.searchParams);
    } else if (url.protocol === 'submit:') {
      sendToPrompt(Channel.SET_SUBMIT_VALUE, url.pathname);
    } else if (url.protocol.startsWith('http')) {
      shell.openExternal(url.href);
    }
  });
});

const prepareProtocols = async () => {
  app.on('open-url', async (e, u) => {
    log.info(`URL PROTOCOL`, u);
    e.preventDefault();
    await newFromProtocol(u);
  });

  protocol.registerFileProtocol(KIT_PROTOCOL, (request, callback) => {
    const url = request.url.substr(KIT_PROTOCOL.length + 2);
    const file = { path: url };

    log.info(`fileProtocol loading:`, file);

    callback(file);
  });

  // session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  //   callback({
  //     responseHeaders: {
  //       'Content-Security-Policy': ["default-src 'self'"],
  //       ...details.responseHeaders,
  //     },
  //   });
  // });
};

const createLogs = () => {
  log.transports.file.resolvePath = () => kitPath('logs', 'kit.log');
};

const sendSplashBody = (message: string) => {
  if (message.includes('object')) return;
  if (message.toLowerCase().includes('warn')) return;
  sendToPrompt(Channel.SET_SPLASH_BODY, message);
};

const sendSplashHeader = (message: string) => {
  sendToPrompt(Channel.SET_SPLASH_HEADER, message);
};

const sendSplashProgress = (progress: number) => {
  sendToPrompt(Channel.SET_SPLASH_PROGRESS, progress);
};

const setupDone = () => {
  sendSplashProgress(100);
  sendSplashHeader(`Kit SDK Install verified ✅`);
};

const setupLog = async (message: string) => {
  sendSplashBody(message);
  log.info(message);
  if (process.env.KIT_SPLASH) {
    await new Promise((resolve, reject) =>
      setTimeout(() => {
        resolve(true);
      }, 500)
    );
  }
};

const forkOptions: ForkOptions = {
  cwd: homedir(),
  env: {
    KIT,
    KENV: kenvPath(),
    KNODE: knodePath(),
    PATH: KIT_FIRST_PATH + path.delimiter + process?.env?.PATH,
  },
  stdio: 'pipe',
};

const optionalSetupScript = (...args: string[]) => {
  return new Promise((resolve, reject) => {
    log.info(`Running optional setup script: ${args.join(' ')}`);
    const child = fork(kitPath('run', 'terminal.js'), args, forkOptions);

    if (child?.stdout) {
      child.stdout.on('data', (data) => {
        setupLog(data.toString());
      });
    }

    if (child?.stderr) {
      child.stderr.on('data', (data) => {
        setupLog(data.toString());
      });
    }

    child.on('message', (data) => {
      const dataString = typeof data === 'string' ? data : data.toString();

      if (!dataString.includes(`[object`)) {
        log.info(args[0], dataString);
        // sendSplashBody(dataString.slice(0, 200));
      }
    });

    child.on('exit', () => {
      log.info(`✅ Successfully ran setup script: ${args.join(' ')}`);
      resolve('success');
    });

    child.on('error', (error: Error) => {
      log.error(`⚠️ Errored on setup script: ${args.join(' ')}`, error.message);
      resolve('error');
      // reject(error);
      // throw new Error(error.message);
    });
  });
};

const ensureKitDirs = async () => {
  await ensureDir(kitPath('logs'));
  await ensureDir(kitPath('db'));
  await ensureDir(tmpClipboardDir);
  await ensureDir(tmpDownloadsDir);
  await getPrefsDb();
  await getShortcutsDb();
};

const ensureKenvDirs = async () => {
  await ensureDir(kenvPath('kenvs'));
  await ensureDir(kenvPath('assets'));
};

let resumeTimeout: any = null;

const systemEvents = () => {
  powerMonitor.addListener('suspend', async () => {
    log.info(`😴 System suspending. Removing watchers.`);
    teardownWatchers();
    sleepSchedule();

    kitState.suspended = true;
    // app?.hide();
  });

  powerMonitor.addListener('resume', async () => {
    log.info(`🌄 System waking. Starting watchers.`);
    await setupWatchers();

    log.info(`Resume tasks`);
    if (!kitState.updateDownloaded) {
      resumeTimeout = setTimeout(() => {
        try {
          checkForUpdates();
        } catch (error) {
          log.error(`Error checking for updates`, error);
        }
      }, 10000);
    }

    kitState.suspended = false;

    configureIntervalMac(pantsKick);
  });

  powerMonitor.addListener('lock-screen', async () => {
    kitState.screenLocked = true;
    // app?.hide();
  });

  powerMonitor.addListener('unlock-screen', async () => {
    kitState.screenLocked = false;
    kitState.isSponsor = false;
  });
};

let macAccessibiltyInterval: any = null;

const configureIntervalMac = (fn = configureInterval) => {
  macAccessibiltyInterval = setTimeout(() => {
    if (kitState.isMac && kitState.authorized && appDb?.authorized) {
      log.info(
        `💻 Accessibility authorized ✅. Kicking uiohook in the pants 👖`
      );
      fn();
    }
  }, 5000);
};

const ready = async () => {
  try {
    await ensureKitDirs();
    await ensureKenvDirs();
    createLogs();
    await initKeymap();
    await prepareProtocols();
    await setupLog(`Protocols Prepared`);
    await setupSettings();

    await setupTray(true, 'default');
    assign(appDb, (await getAppDb()).data);

    await setupLog(`Tray created`);

    await updateScripts();
    await setupWatchers();
    await setupLog(`Shortcuts Assigned`);

    await checkAccessibility();

    const isMac = os.platform() === 'darwin';

    await setupLog(``);
    setupDone();

    if (isMac) startSK();
    await cacheKitScripts();

    processes.findIdlePromptProcess();

    handleWidgetEvents();

    scheduleDownloads();

    subscribeKey(kitState, 'previousDownload', async () => {
      scheduleDownloads();
    });

    systemEvents();

    if (!isMac) {
      configureInterval();
    } else {
      configureIntervalMac();
    }

    log.info(`NODE_ENV`, process.env.NODE_ENV);
  } catch (error) {
    log.warn(error);
  }
};

const handleSpawnReturns = async (
  message: string,
  result: SpawnSyncReturns<any>,
  required = true
) => {
  console.log(`stdout:`, result?.stdout?.toString());
  console.log(`stderr:`, result?.stderr?.toString());
  const { stdout, stderr, error } = result;

  if (stdout?.toString().length) {
    const out = stdout.toString();
    log.info(message, out);
    sendSplashBody(out.slice(0, 200));
  }

  if (error && required) {
    throw new Error(error.message);
  }

  if (stderr?.toString().length) {
    sendSplashBody(stderr.toString());
    console.log({ stderr: stderr.toString() });
    // throw new Error(stderr.toString());
  }

  return result;
};

const kitExists = async () => {
  setupLog(kitPath());
  const doesKitExist = existsSync(kitPath());

  await setupLog(`kit${doesKitExist ? `` : ` not`} found`);

  return doesKitExist;
};

const kitUserDataExists = async () => {
  const userDataExists = existsSync(app.getPath('userData'));
  await setupLog(`kit user data ${userDataExists ? `` : ` not`} found`);

  return userDataExists;
};

const isContributor = async () => {
  // eslint-disable-next-line no-return-await
  return (await kitExists()) && kitIgnore();
};

const kenvExists = async () => {
  const doesKenvExist = existsSync(kenvPath());
  await setupLog(`kenv${doesKenvExist ? `` : ` not`} found`);

  return doesKenvExist;
};

const kenvConfigured = async () => {
  const isKenvConfigured = existsSync(kenvPath('.env'));
  await setupLog(`kenv is${isKenvConfigured ? `` : ` not`} configured`);

  return isKenvConfigured;
};

const nodeExists = async () => {
  const doesNodeExist = existsSync(execPath);
  await setupLog(`node${doesNodeExist ? `` : ` not`} found`);

  return doesNodeExist;
};

const nodeModulesExists = async () => {
  const doesNodeModulesExist = existsSync(kitPath('node_modules'));
  await setupLog(`node_modules${doesNodeModulesExist ? `` : ` not`} found`);

  return doesNodeModulesExist;
};

const verifyInstall = async () => {
  await setupLog(`Verifying ~/.kit exists:`);
  const checkKit = await kitExists();
  await setupLog(`Verifying ~/.kenv exists:`);
  const checkKenv = await kenvExists();

  const checkNode = await nodeExists();
  await setupLog(checkNode ? `node found` : `node missing`);

  const checkNodeModules = await nodeModulesExists();
  await setupLog(
    checkNodeModules ? `node_modules found` : `node_modules missing`
  );

  const isKenvConfigured = await kenvConfigured();
  await setupLog(isKenvConfigured ? `kenv .env found` : `kenv .env missinag`);

  if (
    checkKit &&
    checkKenv &&
    checkNode &&
    checkNodeModules &&
    isKenvConfigured
  ) {
    await setupLog(`Install verified`);
    return true;
  }

  throw new Error(`Install not verified...`);
};

const ohNo = async (error: Error) => {
  log.warn(error.message);
  log.warn(error.stack);
  const mainLogContents = await readFile(mainLogPath, {
    encoding: 'utf8',
  });

  await clipboard.writeText(
    `
${error.message}
${error.stack}
${mainLogContents}
  `.trim()
  );
  destroyPromptWindow();
  await show(INSTALL_ERROR, showError(error, mainLogContents));

  throw new Error(error.message);
};

const extractTar = async (tarFile: string, outDir: string) => {
  await setupLog(`Extracting ${path.basename(tarFile)} to ${tildify(outDir)}`);
  await ensureDir(outDir);

  await tar.x({
    file: tarFile,
    C: outDir,
    strip: 1,
  });
};

const currentVersionIsGreater = async () => {
  const currentVersion = getVersion();
  const storedVersion = await getStoredVersion();

  await setupLog(
    `Stored version: ${storedVersion} -> Current version: ${currentVersion}`
  );

  return semver.gt(currentVersion, storedVersion);
};

const cleanKit = async () => {
  log.info(`🧹 Cleaning ${kitPath()}`);
  const pathToClean = kitPath();

  const keep = (file: string) =>
    file === 'db' || file === 'node_modules' || file === 'assets';

  // eslint-disable-next-line no-restricted-syntax
  for await (const file of await readdir(pathToClean)) {
    if (keep(file)) {
      log.info(`👍 Keeping ${file}`);
      // eslint-disable-next-line no-continue
      continue;
    }

    const filePath = path.resolve(pathToClean, file);
    const stat = await lstat(filePath);
    if (stat.isDirectory()) {
      await rm(filePath, { recursive: true, force: true });
      log.info(`🧹 Cleaning dir ${filePath}`);
    } else {
      await rm(filePath);
      log.info(`🧹 Cleaning file ${filePath}`);
    }
  }
};

const cleanUserData = async () => {
  const pathToClean = app.getPath('userData');
  await rm(pathToClean, { recursive: true, force: true });
};

const KIT_NODE_TAR =
  process.env.KIT_NODE_TAR || getAssetPath(`node.${getPlatformExtension()}`);

const checkKit = async () => {
  await setupTray(true, 'busy');
  await setupLog(`Tray created`);

  const options: SpawnSyncOptions = {
    cwd: KIT,
    encoding: 'utf-8',
    env: {
      KIT,
      KENV: kenvPath(),
      PATH: KIT_FIRST_PATH + path.delimiter + process?.env?.PATH,
    },
    stdio: 'pipe',
  };

  log.info(`🧐 Checking ${KIT}`, options);

  const setupScript = (...args: string[]) => {
    return new Promise((resolve, reject) => {
      log.info(`🔨 Running Setup Script ${args.join(' ')}`);
      const child = fork(kitPath('run', 'terminal.js'), args, forkOptions);

      child.on('message', (data) => {
        const dataString = data.toString();
        log.info(args[0], dataString);
      });

      child.on('exit', () => {
        log.info(`✅ Successfully ran ${args.join(' ')}`);
        resolve('success');
      });

      child.on('error', (error: Error) => {
        reject(error);
        ohNo(error);
      });
    });
  };

  const showSplash = async () => {
    await setScript(
      {
        name: 'Kit Setup',
        command: 'splash-screen',
        filePath: SPLASH_PATH,
        kenv: '',
        id: 'spash-screen',
        type: ProcessType.Prompt,
        hasPreview: true,
      },
      kitState.pid,
      true
    );

    sendSplashHeader(`Installing Kit SDK and Kit Environment...`);

    log.info(`🌊 Showing Splash Install Screen`);
    await setPromptData(
      {
        ignoreBlur: true,
        ui: UI.splash,
        scriptPath: SPLASH_PATH,
      } as PromptData,
      kitState.pid
    );
    sendSplashBody(`Starting up...`);

    setTimeout(() => {
      focusPrompt();
    }, 500);
  };

  if (process.env.NODE_ENV === 'development') {
    try {
      await installExtensions();
    } catch (error) {
      log.info(`Failed to install extensions`, error);
    }
  }
  startIpc();
  await createPromptWindow();

  await setupLog(`Prompt window created`);

  const isWin = os.platform().startsWith('win');

  await setupLog(`\n\n---------------------------------`);
  await setupLog(`Launching Script Kit  ${getVersion()}`);
  await setupLog(
    `auto updater detected version: ${autoUpdater.currentVersion}`
  );
  log.info(`PATH:`, KIT_FIRST_PATH);
  try {
    configureAutoUpdate();
  } catch (error) {
    log.error(error);
  }
  try {
    await checkForUpdates();
  } catch (error) {
    log.error(error);
  }

  if (process.env.KIT_SPLASH) {
    await showSplash();
  }

  const storedVersion = await getStoredVersion();
  log.info(`Stored version: ${storedVersion}`);

  if (!(await kitExists()) || storedVersion === '0.0.0') {
    if (!process.env.KIT_SPLASH) {
      await showSplash();
    }
    kitState.installing = true;
    log.info(`🔥 Starting Kit First Install`);
  }

  let nodeVersionMatch = true;

  if (await nodeExists()) {
    log.info(`👍 Node Exists`);
    // Compare nodeVersion to execPath
    const execPathVersion = execFileSync(execPath, ['--version']);
    log.info(`existingNode ${nodeVersion}, execPath: ${execPathVersion}`);
    nodeVersionMatch = execPathVersion.toString().trim() === nodeVersion.trim();
  }

  if (!(await nodeExists()) || !nodeVersionMatch) {
    await setupLog(
      `Adding node ${nodeVersion} ${platform} ${arch} ${tildify(knodePath())}`
    );

    const nodeUrlPath = getAssetPath('node_url.txt');
    if (
      // process.env.KIT_EXPERIMENTAL &&
      existsSync(nodeUrlPath)
    ) {
      try {
        const nodeUrl = await readFile(nodeUrlPath, 'utf8');
        await setupLog(`Download node.js from ${nodeUrl}`);
        const buffer = await download(nodeUrl.trim());
        await writeFile(KIT_NODE_TAR, buffer);
        log.info(`Node download complete. Beginning extraction...`);
      } catch (error) {
        log.error(error);
      }
    }

    if (existsSync(KIT_NODE_TAR)) {
      if (existsSync(knodePath())) {
        await setupLog(`Removing old node ${tildify(knodePath())}`);
        await rm(knodePath(), {
          recursive: true,
          force: true,
        });
      }

      await setupLog(`Create node dir ${tildify(knodePath())}`);
      await mkdir(knodePath());

      log.info(`Found ${KIT_NODE_TAR}. Extracting...`);

      if (platform === 'win') {
        log.info(`Extracting ${KIT_NODE_TAR} to ${tildify(knodePath())}`);

        try {
          // const copyPath = path.resolve(homedir(), 'node.zip');
          // await copyFile(KIT_NODE_TAR, copyPath);
          // const d = await Open.file(copyPath);
          // await d.extract({ path: knodePath(), concurrency: 5 });
          /* eslint-disable new-cap */
          const zip = new StreamZip.async({ file: KIT_NODE_TAR });

          await zip.extract(null, knodePath());
          await zip.close();

          const nodeDir = await readdir(knodePath());
          const nodeDirName = nodeDir.find((n) => n.startsWith('node-'));
          if (nodeDirName) {
            await rename(knodePath(nodeDirName), knodePath('bin'));
            log.info(await readdir(knodePath('bin')));
            await chmod(knodePath('bin', 'npm.cmd'), 0o755);
            await chmod(knodePath('bin', 'node.exe'), 0o755);
          } else {
            log.warn(`Couldn't find node dir in ${nodeDir}`);
          }
        } catch (error) {
          log.error(error);
        }
      }

      if (platform === 'darwin') {
        await tar.x({
          file: KIT_NODE_TAR,
          C: knodePath(),
          strip: 1,
        });
      }

      if (platform === 'linux') {
        const extractNode = spawnSync(
          `tar --strip-components 1 -xf '${getAssetPath(
            'node.tar.xz'
          )}' --directory '${knodePath}'`,
          {
            shell: true,
          }
        );

        await handleSpawnReturns(`extract node`, extractNode);
        // await tar.x({
        //   file: KIT_NODE_TAR,
        //   C: kitPath('node'),
        //   strip: 1,
        // });
      }
    } else {
      const installScript = `./build/install-node.sh`;
      await chmod(kitPath(installScript), 0o755);
      const nodeInstallResult = spawnSync(
        installScript,
        ` --prefix node --platform darwin`.split(' '),
        options
      );
      await handleSpawnReturns(`install-node.sh`, nodeInstallResult);
    }
  }

  const requiresInstall =
    (await currentVersionIsGreater()) || !(await kitExists());
  log.info(`Requires install: ${requiresInstall}`);
  if (await isContributor()) {
    await setupLog(`Welcome fellow contributor! Thanks for all you do!`);
  } else if (requiresInstall) {
    if (await kitExists()) {
      kitState.updateInstalling = true;
      await setupLog(`Cleaning previous .kit`);
      await cleanKit();
    }

    await setupLog(`.kit doesn't exist or isn't on a contributor branch`);

    const kitTar = getAssetPath('kit.tar.gz');

    if (
      // process.env.KIT_EXPERIMENTAL &&
      existsSync(getAssetPath('kit_url.txt'))
    ) {
      try {
        const kitUrl = await readFile(getAssetPath('kit_url.txt'), 'utf8');
        await setupLog(`Download SDK from ${kitUrl}`);
        log.info(`Downloading pre-bundled kit...`);
        const buffer = await download(kitUrl.trim());
        await writeFile(kitTar, buffer);
        log.info(`Downloading complete. Beginning extraction...`);
      } catch (error) {
        log.error(error);
      }
    }

    await extractTar(kitTar, kitPath());
    await setupLog(`.kit installed`);

    // await setupLog(`Installing ~/.kit packages...`);
    log.info(`PATH:`, options?.env?.PATH);

    if (isWin) {
      const npmResult = await new Promise((resolve, reject) => {
        const child = fork(
          knodePath('bin', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
          [`i`, `--production`, `--prefer-dedupe`, `--loglevel`, `verbose`],
          options
        );

        if (child.stdout) {
          child.stdout.on('data', (data) => {
            sendSplashBody(data.toString());
          });
        }

        if (child.stderr) {
          child.stderr.on('data', (data) => {
            sendSplashBody(data.toString());
          });
        }

        child.on('message', (data) => {
          sendSplashBody(data.toString());
        });
        child.on('exit', () => {
          resolve('npm install success');
        });
        child.on('error', (error) => {
          reject(error);
        });
      });
    } else {
      const npmResult = await new Promise((resolve, reject) => {
        const child = spawn(
          knodePath('bin', 'npm'),
          [`i`, `--production`, `--prefer-dedupe`, `--loglevel`, `verbose`],
          options
        );
        if (child.stdout) {
          child.stdout.on('data', (data) => {
            sendSplashBody(data.toString());
          });
        }

        if (child.stderr) {
          child.stderr.on('data', (data) => {
            sendSplashBody(data.toString());
          });
        }

        child.on('message', (data: any) => {
          sendSplashBody(data.toString());
        });
        child.on('exit', (code) => {
          resolve(`Deps install exit code ${code}`);
        });
        child.on('error', (error: any) => {
          reject(error);
        });
      });

      log.info({ npmResult });
    }

    await setupScript(kitPath('setup', 'chmod-helpers.js'));
    await clearPromptCache();
  }

  // await handleSpawnReturns(`docs-pull`, pullDocsResult);

  if (!(await kenvExists())) {
    // Step 4: Use kit wrapper to run setup.js script
    // configWindow?.show();
    await setupLog(`Extract tar to ~/.kenv...`);
    const kenvTar = getAssetPath('kenv.tar.gz');
    await extractTar(kenvTar, kenvPath());
    log.info(await readdir(kenvPath()));

    await kenvExists();
    await ensureKenvDirs();

    optionalSetupScript(kitPath('setup', 'clone-examples.js'));
    optionalSetupScript(kitPath('setup', 'clone-sponsors.js'));
  } else {
    optionalSetupScript(kitPath('setup', 'build-ts-scripts.js'));
  }

  if (!(await kenvConfigured())) {
    await setupLog(`Run .kenv setup script...`);
    await setupScript(kitPath('setup', 'setup.js'));

    if (isWin) {
      const npmResult = await new Promise((resolve, reject) => {
        const child = fork(
          knodePath('bin', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
          [`i`, kitPath()],
          {
            cwd: kenvPath(),
            env: {
              ...process.env,
              PATH: KIT_FIRST_PATH + path.delimiter + process?.env?.PATH,
            },
          }
        );
        child.on('message', (data) => {
          sendSplashBody(data.toString());
        });
        child.on('exit', () => {
          resolve('npm install success');
        });
        child.on('error', (error) => {
          reject(error);
        });
      });
    }
    await kenvConfigured();
  }

  await setupLog(`Update .kenv`);
  await setupScript(kitPath('setup', 'patch.js'));

  await setupLog(`Creating bins`);
  optionalSetupScript(kitPath('cli', 'create-all-bins-no-trash.js'));

  try {
    await verifyInstall();

    await storeVersion(getVersion());

    kitState.starting = false;
    kitState.updateInstalling = false;
    kitState.installing = false;

    // log.info(`kitState`, kitState);

    registerKillLatestShortcut();

    await ready();
    kitState.ready = true;

    sendToPrompt(Channel.SET_READY, true);

    focusPrompt();
  } catch (error) {
    ohNo(error);
  }
};

app.whenReady().then(checkKit).catch(ohNo);

subscribeKey(kitState, 'allowQuit', async (allowQuit) => {
  mainLog.info('allowQuit begin...');

  // app?.removeAllListeners('window-all-closed');
  if (!allowQuit) return;
  if (kitState.relaunch) {
    mainLog.info(`🚀 Kit.app should relaunch after quit...`);
    app.relaunch();
  }
  mainLog.info(`😬 Tear down all processes before quit`);
  try {
    teardownWatchers();
    sleepSchedule();
    destroyInterval();
    subs.forEach((sub) => {
      try {
        sub();
      } catch (error) {
        mainLog.error(`😬 Error unsubscribing`, { error });
      }
    });
    subs.length = 0;
    clearPromptTimers();
    clearTickTimers();
    clearStateTimers();
    if (macAccessibiltyInterval) clearInterval(macAccessibiltyInterval);
    if (resumeTimeout) clearTimeout(resumeTimeout);
    // destory event emitter named "emitter"
    if (emitter) emitter.removeAllListeners();

    mainLog.info(`Cleared out everything...`);

    // destroyTray();
  } catch (error) {
    mainLog.error(`😬 Error Teardown and Sleep`, { error });
  }

  try {
    destroyAllProcesses();
  } catch (error) {
    mainLog.error(error);
  }

  app?.removeAllListeners('window-all-closed');
  app?.removeAllListeners();

  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win?.isDestroyed()) {
      win.removeAllListeners();
      win?.destroy();
    }
  });

  try {
    if (kitState?.quitAndInstall) {
      mainLog.info(`🚀 Quit and Install`);
      autoUpdater?.quitAndInstall();
    } else {
      mainLog.info(`🚀 Quit`);
      app?.quit();
    }
  } catch (error) {
    mainLog.error(error);
    app?.quit();
    app?.exit(0);
  }
});
