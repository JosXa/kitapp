/* eslint-disable no-nested-ternary */
import log from 'electron-log';
import chokidar from 'chokidar';
import path from 'path';
import { FSWatcher } from 'fs';
import { app } from 'electron';
import { Script } from '@johnlindquist/kit/types/cjs';
import { runPromptProcess } from './kit';
import { Trigger } from 'kit-common';

export const watchMap = new Map();

export const removeWatch = (filePath: string) => {
  const watcher = watchMap.get(filePath) as FSWatcher;
  if (watcher) {
    log.info(`🗑 Remove watch: ${filePath}`);
    watcher.close();
    watchMap.delete(filePath);
  }
};

const normalizePath = (scriptPath: string) => (filePath: string) => {
  const resolvedPath = () => {
    if (filePath?.startsWith('~')) {
      return filePath.replace('~', app.getPath('home'));
    }

    if (filePath?.startsWith(path.sep)) {
      return filePath;
    }

    return path.resolve(path.dirname(scriptPath), filePath);
  };
  return path.normalize(resolvedPath());
};

const validWatchEvents = ['add', 'change', 'unlink'];

const addWatch = (watchString: string, scriptPath: string) => {
  try {
    log.info(`Watch: ${watchString} - from - ${scriptPath}`);

    const [pathsString] = watchString.split('|');

    const paths = pathsString.startsWith('[')
      ? JSON.parse(pathsString).map(normalizePath(scriptPath))
      : normalizePath(scriptPath)(pathsString);

    log.info(`Watched paths:`, { paths });

    const watcher = chokidar.watch(paths, {
      ignoreInitial: true,
    });

    watcher.on('all', (eventName: string, filePath: string) => {
      log.info({ eventName, filePath });
      if (validWatchEvents.includes(eventName)) {
        log.info(`👀 ${paths} changed`);
        runPromptProcess(scriptPath, [filePath, eventName], {
          force: false,
          trigger: Trigger.Watch,
        });
      }
    });

    watchMap.set(scriptPath, watcher);
  } catch (error) {
    removeWatch(scriptPath);
    log.warn(error?.message);
  }
};

export const watchScriptChanged = ({
  filePath,
  kenv,
  watch: watchString,
}: Script) => {
  if (!watchString && watchMap.get(filePath)) {
    removeWatch(filePath);
    return;
  }

  if (watchString && !watchMap.get(filePath)) {
    addWatch(watchString, filePath);
    return;
  }

  if (watchString && watchMap.get(filePath)) {
    removeWatch(filePath);
    addWatch(watchString, filePath);
  }
};
