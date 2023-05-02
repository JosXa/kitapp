/* eslint-disable no-restricted-syntax */
import log from 'electron-log';
import { add, assign, debounce } from 'lodash';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { snapshot } from 'valtio';
import { subscribeKey } from 'valtio/utils';
import dotenv from 'dotenv';
import { rm, readFile } from 'fs/promises';
import { getAppDb, getUserDb, getScripts } from '@johnlindquist/kit/cjs/db';

import {
  parseScript,
  kitPath,
  kenvPath,
  resolveToScriptPath,
} from '@johnlindquist/kit/cjs/utils';

import { FSWatcher } from 'chokidar';
import { fork } from 'child_process';
import {
  unlinkShortcuts,
  updateMainShortcut,
  shortcutScriptChanged,
} from './shortcuts';

import { cancelSchedule, scheduleScriptChanged } from './schedule';
import { unlinkEvents, systemScriptChanged } from './system-events';
import { removeWatch, watchScriptChanged } from './watch';
import { backgroundScriptChanged, removeBackground } from './background';
import {
  appDb,
  kitState,
  scriptChanged,
  scriptRemoved,
  sponsorCheck,
  updateScripts,
} from './state';
import { addSnippet, removeSnippet } from './tick';
import { appToPrompt, clearPromptCacheFor, sendToPrompt } from './prompt';
import { startWatching, WatchEvent } from './chokidar';
import { emitter, KitEvent } from './events';
import { AppChannel, Trigger } from './enums';
import { runScript } from './kit';

// export const cacheMenu = debounce(async () => {
//   await updateScripts();
// }, 150);

const unlink = (filePath: string) => {
  unlinkShortcuts(filePath);
  cancelSchedule(filePath);
  unlinkEvents(filePath);
  removeWatch(filePath);
  removeBackground(filePath);
  removeSnippet(filePath);

  const binPath = path.resolve(
    path.dirname(path.dirname(filePath)),
    'bin',
    path
      .basename(filePath)
      .replace(new RegExp(`\\${path.extname(filePath)}$`), '')
  );

  if (existsSync(binPath)) rm(binPath);

  scriptRemoved();
};

const logEvents: { event: WatchEvent; filePath: string }[] = [];

const logAllEvents = () => {
  const adds: string[] = [];
  const changes: string[] = [];
  const removes: string[] = [];

  logEvents.forEach(({ event, filePath }) => {
    if (event === 'add') adds.push(filePath);
    if (event === 'change') changes.push(filePath);
    if (event === 'unlink') removes.push(filePath);
  });

  if (add.length) log.info('adds', adds);
  if (changes.length) log.info('changes', changes);
  if (removes.length) log.info('removes', removes);

  adds.length = 0;
  changes.length = 0;
  removes.length = 0;

  logEvents.length = 0;
};

const debouncedLogAllEvents = debounce(logAllEvents, 1000);

const logQueue = (event: WatchEvent, filePath: string) => {
  logEvents.push({ event, filePath });
  debouncedLogAllEvents();
};

const buildScriptChanged = debounce(
  (filePath: string) => {
    if (filePath.endsWith('.ts')) {
      log.info(`🏗️ Build ${filePath}`);
      const child = fork(kitPath('build', 'ts.js'), [filePath], {
        env: assign({}, process.env, {
          KIT: kitPath(),
          KENV: kenvPath(),
        }),
        stdio: 'pipe',
      });

      if (child?.stdout) {
        child.stdout.on('data', (data) => {
          log.info(`Build stdout:`, data.toString());
        });
      }

      if (child?.stderr) {
        child.stderr.on('data', (data) => {
          log.error(`Build stderr`, data.toString());
        });
      }

      // log error
      child.on('error', (error: any) => {
        log.error(`Build error:`, error);
      });

      // log exit
      child.on('exit', (code) => {
        log.info(`🏗️ Build ${filePath} exited with code ${code}`);
      });
    }
  },
  1000,
  { leading: true }
);

export const rebuildScripts = debounce(
  (scriptPaths: string[], KENV) => {
    const child = fork(
      kitPath('run', 'terminal.js'),
      [kitPath('setup', 'rebuild-ts-scripts.js')],
      {
        env: assign({}, process.env, {
          KIT: kitPath(),
          KENV,
        }),
        stdio: 'pipe',
      }
    );

    if (child?.stdout) {
      child.stdout.on('data', (data) => {
        log.info(data.toString());
      });
    }

    if (child?.stderr) {
      child.stderr.on('data', (data) => {
        log.error(data.toString());
      });
    }

    // log error
    child.on('error', (error: any) => {
      log.error(error);
    });

    // log exit
    child.on('exit', (code) => {
      log.info(`🏗️ Rebuild exited with code ${code}`);
    });

    log.info(`Rebuilding: `, {
      scriptPaths,
    });

    child.send({ scriptPaths });
  },
  500,
  {
    leading: true,
  }
);

const unlinkBin = (filePath: string) => {
  const binPath = path.resolve(
    path.dirname(path.dirname(filePath)),
    'bin',
    path.basename(filePath)
  );

  // if binPath exists, remove it
  if (existsSync(binPath)) {
    unlink(binPath);
  }
};

export const onScriptsChanged = async (event: WatchEvent, filePath: string) => {
  if (event === 'unlink') {
    unlink(filePath);
    unlinkBin(filePath);
  }

  if (
    event === 'change' ||
    // event === 'ready' ||
    event === 'add'
  ) {
    logQueue(event, filePath);
    const script = await parseScript(filePath);
    shortcutScriptChanged(script);
    scheduleScriptChanged(script);
    systemScriptChanged(script);
    watchScriptChanged(script);
    backgroundScriptChanged(script);
    buildScriptChanged(script?.filePath);
    addSnippet(script);
  }

  if (event === 'change') {
    scriptChanged(filePath);
    clearPromptCacheFor(filePath);
  }

  if (event === 'add') {
    if (kitState.ready) {
      setTimeout(async () => {
        try {
          const binDirPath = path.resolve(
            path.dirname(path.dirname(filePath)),
            'bin'
          );
          const command = path.parse(filePath).name;
          const binFilePath = path.resolve(binDirPath, command);
          if (!existsSync(binFilePath)) {
            log.info(`🔗 Creating bin for ${command}`);
            await runScript(kitPath('cli', 'create-bin'), 'scripts', filePath);
          }
        } catch (error) {
          log.error(error);
        }
      }, 1000);
    }
  }
};

export const onDbChanged = async (event: any, filePath: string) => {
  updateMainShortcut(filePath);
};

let watchers = [] as FSWatcher[];

export const teardownWatchers = async () => {
  if (watchers.length) {
    watchers.forEach((watcher) => {
      try {
        watcher.removeAllListeners();
        watcher.close();
      } catch (error) {
        log.error(error);
      }
    });
    watchers.length = 0;
  }
};

export const checkUserDb = async (eventName: string) => {
  log.info(`checkUserDb ${eventName}`);

  const currentUserDb = (await getUserDb()).data;
  kitState.user = currentUserDb;

  if (eventName === 'unlink') return;
  if (kitState?.user?.login) {
    const isSponsor = await sponsorCheck('Login', false);
    kitState.isSponsor = isSponsor;
  } else {
    kitState.isSponsor = false;
  }

  const user = snapshot(kitState.user);
  log.info(`Send user.json to prompt`, user);

  appToPrompt(AppChannel.USER_CHANGED, user);
};

const triggerRunText = debounce(
  async (eventName: WatchEvent) => {
    const runPath = kitPath('run.txt');
    if (eventName === 'add' || eventName === 'change') {
      const runText = await readFile(runPath, 'utf8');
      const [scriptPath, ...args] = runText.trim().split(' ');
      log.info(`run.txt ${eventName}`, scriptPath, args);
      emitter.emit(KitEvent.RunPromptProcess, {
        scriptPath: resolveToScriptPath(scriptPath, kenvPath()),
        args: args || [],
        options: {
          force: true,
          trigger: Trigger.RunTxt,
        },
      });
    } else {
      log.info(`run.txt removed`);
    }
  },
  1000,
  {
    leading: true,
  }
);

const refreshScripts = debounce(
  async () => {
    log.info(`🌈 Refreshing Scripts...`);
    const scripts = await getScripts(false);
    for (const script of scripts) {
      onScriptsChanged('change', script.filePath);
    }
  },
  500,
  { leading: true }
);

export const setupWatchers = async () => {
  await teardownWatchers();

  log.info('--- 👀 Watching Scripts ---');

  watchers = startWatching(async (eventName: WatchEvent, filePath: string) => {
    // if (!filePath.match(/\.(ts|js|json|txt|env)$/)) return;
    const { base, dir } = path.parse(filePath);

    if (base === 'run.txt') {
      log.info(`run.txt ${eventName}`);
      triggerRunText(eventName);
      return;
    }

    if (base === '.env') {
      log.info(`🌎 .env ${eventName}`);

      if (existsSync(filePath)) {
        try {
          const envData = dotenv.parse(readFileSync(filePath));
          kitState.kenvEnv = envData;

          const setCSSVariable = (name: string, value: undefined | string) => {
            if (value) {
              log.info(`Setting CSS`, name, value);
              appToPrompt(AppChannel.CSS_VARIABLE, { name, value });
            }
          };

          setCSSVariable(
            '--mono-font',
            envData?.KIT_MONO_FONT || `JetBrains Mono`
          );
          setCSSVariable(
            '--sans-font',
            envData?.KIT_SANS_FONT ||
              `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica,
        Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'`
          );
          setCSSVariable(
            '--serif-font',
            envData?.KIT_SERIF_FONT ||
              `'ui-serif', 'Georgia', 'Cambria', '"Times New Roman"', 'Times',
        'serif'`
          );

          if (envData?.KIT_MIC) {
            log.info(`Setting mic`, envData?.KIT_MIC);
            appToPrompt(AppChannel.SET_MIC_ID, envData?.KIT_MIC);
          }

          if (envData?.KIT_WEBCAM) {
            log.info(`Setting webcam`, envData?.KIT_WEBCAM);
            appToPrompt(AppChannel.SET_WEBCAM_ID, envData?.KIT_WEBCAM);
          }

          if (envData?.KIT_TYPED_LIMIT) {
            kitState.typedLimit = parseInt(envData?.KIT_TYPED_LIMIT, 10);
          }

          if (envData?.KIT_TRUSTED_KENVS) {
            const trustedKenvs = envData?.KIT_TRUSTED_KENVS.split(
              ','
            ).map((kenv) => kenv.trim());
            log.info(`👩‍⚖️ Trusted Kenvs`, trustedKenvs);
            kitState.trustedKenvs = trustedKenvs;
            if (eventName === 'change') await refreshScripts();
          } else if (kitState.trustedKenvs.length) {
            kitState.trustedKenvs = [];
            log.info(`👩‍⚖️ Trusted Kenvs Removed`);
            if (eventName === 'change') await refreshScripts();
          }

          // if (envData?.KIT_SUSPEND_WATCHERS) {
          //   const suspendWatchers = envData?.KIT_SUSPEND_WATCHERS === 'true';
          //   kitState.suspendWatchers = suspendWatchers;

          //   if (suspendWatchers) {
          //     log.info(`⌚️ Suspending Watchers`);
          //     teardownWatchers();
          //   } else {
          //     log.info(`⌚️ Resuming Watchers`);
          //     setupWatchers();
          //   }
          // } else if (kitState.suspendWatchers) {
          //   kitState.suspendWatchers = false;
          //   log.info(`⌚️ Resuming Watchers`);
          //   setupWatchers();
          // }
        } catch (error) {
          log.warn(error);
        }

        // if (envData?.KIT_SHELL) kitState.envShell = envData?.KIT_SHELL;
        // TODO: Would need to update the dark/light contrast
        // setCSSVariable('--color-text', envData?.KIT_COLOR_TEXT);
        // setCSSVariable('--color-background', envData?.KIT_COLOR_BACKGROUND);
        // setCSSVariable('--color-primary', envData?.KIT_COLOR_PRIMARY);
        // setCSSVariable('--color-secondary', envData?.KIT_COLOR_SECONDARY);
        // setCSSVariable('--opacity', envData?.KIT_OPACITY);
      }

      return;
    }

    if (base === 'app.json') {
      log.info(`app.json changed`);
      try {
        const currentAppDb = (await getAppDb()).data;
        assign(appDb, currentAppDb);
      } catch (error) {
        log.warn(error);
      }

      return;
    }

    if (base === 'user.json') {
      checkUserDb(eventName);
      return;
    }

    if (base === 'shortcuts.json') {
      onDbChanged(eventName, filePath);
      return;
    }

    if (dir.endsWith('lib')) {
      if (eventName === 'change') {
        const { name: libName } = path.parse(filePath);
        log.info(`lib changed ${eventName} ${filePath}`);

        try {
          const scripts = await getScripts();
          // find scripts that use this lib by search their contents for "libName"
          const scriptsUsingLib = (
            await Promise.all(
              scripts.map(async (script: { filePath: string }) => {
                const contents = await readFile(script.filePath, 'utf8');
                if (contents.includes(libName)) {
                  return script.filePath;
                }
                return false;
              })
            )
          ).filter(Boolean);

          rebuildScripts(scriptsUsingLib, path.dirname(dir));
        } catch (error) {
          log.error(error);
        }
      }

      return;
    }

    onScriptsChanged(eventName, filePath);
  });
};

subscribeKey(kitState, 'suspendWatchers', async (suspendWatchers) => {
  if (suspendWatchers) {
    log.info(`⌚️ Suspending Watchers`);
    teardownWatchers();
  } else {
    log.info(`⌚️ Resuming Watchers`);
    setupWatchers();
  }
});

emitter.on(KitEvent.TeardownWatchers, teardownWatchers);

emitter.on(KitEvent.RestartWatcher, async () => {
  try {
    await setupWatchers();
  } catch (error) {
    log.error(error);
  }
});

emitter.on(KitEvent.Sync, async () => {
  checkUserDb('sync');
});
