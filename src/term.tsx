import React, { RefObject, useEffect, useRef } from 'react';
import { shell } from 'electron';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { Unicode11Addon } from 'xterm-addon-unicode11';
import { SearchAddon } from 'xterm-addon-search';
import { LigaturesAddon } from 'xterm-addon-ligatures';
import { SerializeAddon } from 'xterm-addon-serialize';
import { AttachAddon } from 'xterm-addon-attach';
import useResizeObserver from '@react-hook/resize-observer';
import { motion } from 'framer-motion';
import { debounce } from 'lodash';
import { Channel } from '@johnlindquist/kit/cjs/enum';
import { useAtom } from 'jotai';
import {
  appDbAtom,
  darkAtom,
  openAtom,
  submitValueAtom,
  termFontAtom,
  webSocketAtom,
  webSocketOpenAtom,
} from './jotai';

import XTerm from './components/xterm';

const defaultTheme = {
  foreground: '#2c3e50',
  background: '#ffffff00',
  cursor: 'rgba(0, 0, 0, .4)',
  selection: 'rgba(0, 0, 0, 0.3)',
  black: '#000000',
  red: '#e83030',
  brightRed: '#e83030',
  green: '#42b983',
  brightGreen: '#42b983',
  brightYellow: '#ea6e00',
  yellow: '#ea6e00',
  magenta: '#e83030',
  brightMagenta: '#e83030',
  cyan: '#03c2e6',
  brightBlue: '#03c2e6',
  brightCyan: '#03c2e6',
  blue: '#03c2e6',
  white: '#d0d0d0',
  brightBlack: '#808080',
  brightWhite: '#ffffff',
};

const darkTheme = {
  ...defaultTheme,
  foreground: '#fff',
  background: '#00000000',
  cursor: 'rgba(255, 255, 255, .4)',
  selection: 'rgba(255, 255, 255, 0.3)',
  magenta: '#e83030',
  brightMagenta: '#e83030',
};

function isCtrlKeyOn(e: MouseEvent) {
  return e.ctrlKey;
}

export default function Terminal() {
  const xtermRef = useRef<XTerm>(null);
  const fitRef = useRef(new FitAddon());

  const [ws] = useAtom(webSocketAtom);
  const [wsOpen] = useAtom(webSocketOpenAtom);
  const [, submit] = useAtom(submitValueAtom);
  const [open] = useAtom(openAtom);
  const [isDark] = useAtom(darkAtom);
  const containerRef = useRef<HTMLDivElement>(null);

  useResizeObserver(
    containerRef,
    debounce((entry) => {
      if (entry?.contentRect?.height) {
        fitRef.current.fit();
      }
    }, 5)
  );

  useEffect(() => {
    if (xtermRef?.current?.terminal && !open) {
      xtermRef.current?.terminal?.clear();
    }
  }, [open]);

  // useEscape();

  useEffect(() => {
    if (wsOpen) {
      if (!xtermRef?.current?.terminal) return;
      const t = xtermRef.current.terminal;

      // console.log(`onopen`, { ws });
      const attachAddon = new AttachAddon(ws as WebSocket);

      // console.log(`loadAddon`, xtermRef?.current?.terminal.loadAddon);

      t.loadAddon(fitRef.current);
      t.loadAddon(
        new WebLinksAddon((e, uri) => {
          shell.openExternal(uri);
        })
      );

      // t.loadAddon(new WebglAddon());
      t.loadAddon(new Unicode11Addon());
      t.loadAddon(new SearchAddon());
      t.loadAddon(new LigaturesAddon());
      t.loadAddon(new SerializeAddon());

      t.onKey((x: any) => {
        // console.log({ key: x });
        if (
          (x?.domEvent.key === 'Enter' && x?.domEvent.metaKey) ||
          (x.domEvent.ctrlKey && x?.domEvent.key === 'c')
        ) {
          // console.log(`SUBMITTING TERMINAL`);
          submit(Channel.TERMINAL);
          if (attachAddon) {
            attachAddon.dispose();
          } else {
            console.log(`attachAddon is null`);
          }
        }
      });

      t.loadAddon(attachAddon);

      // fitRef.current.fit();
      t.focus();

      setTimeout(() => {
        t.focus();
      }, 250);
    }
  }, [xtermRef?.current?.terminal, wsOpen]);

  const [appDb] = useAtom(appDbAtom);

  return (
    <motion.div
      key="terminal"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1] }}
      transition={{ duration: 0.5, ease: 'circOut' }}
      className="w-full h-full pt-3 -mb-6 px-3 max-h-full"
    >
      <div
        ref={containerRef as RefObject<HTMLDivElement>}
        className="w-full h-full"
      >
        <XTerm
          className="w-full h-full max-h-fit

          "
          options={{
            fontFamily: appDb?.termFont || 'monospace',
            allowTransparency: true,
            theme: isDark ? darkTheme : defaultTheme,
          }}
          ref={xtermRef}
          addons={[]}
        />
      </div>
    </motion.div>
  );
}
