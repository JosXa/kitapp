/* eslint-disable no-template-curly-in-string */
/* eslint-disable no-useless-escape */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { motion } from 'framer-motion';
import MonacoEditor, { Monaco, useMonaco, loader } from '@monaco-editor/react';
import { editor as monacoEditor, Range } from 'monaco-editor';
import { UI } from '@johnlindquist/kit/core/enum';
import { EditorOptions } from '@johnlindquist/kit/types/kitapp';
import {
  darkAtom,
  editorAppendAtom,
  editorConfigAtom,
  editorCursorPosAtom,
  editorOptions,
  editorSuggestionsAtom,
  inputAtom,
  openAtom,
  uiAtom,
} from '../jotai';
import { useMountMainHeight } from '../hooks';
import { kitLight, nightOwl } from '../editor-themes';

import * as monaco from 'monaco-editor';
// @ts-ignore
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
// @ts-ignore
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
// @ts-ignore
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
// @ts-ignore
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
// @ts-ignore
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    // async getWorker(_, label) {
    // const { default: jsonWorker } = await import(
    //   // @ts-ignore
    //   'monaco-editor/esm/vs/language/json/json.worker?worker'
    // );
    // const { default: cssWorker } = await import(
    //   // @ts-ignore
    //   'monaco-editor/esm/vs/language/css/css.worker?worker'
    // );
    // const { default: htmlWorker } = await import(
    //   // @ts-ignore
    //   'monaco-editor/esm/vs/language/html/html.worker?worker'
    // );
    // const { default: tsWorker } = await import(
    //   // @ts-ignore
    //   'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
    // );
    // const { default: editorWorker } = await import(
    //   // @ts-ignore
    //   'monaco-editor/esm/vs/editor/editor.worker?worker'
    // );

    console.log({
      _,
      label,
      editorWorker,
      jsonWorker,
      cssWorker,
      htmlWorker,
      tsWorker,
    });
    if (label === 'json') {
      return new jsonWorker();
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker();
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker();
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

loader.config({ monaco });

const registerPropertiesLanguage = (monaco: Monaco) => {
  monaco.languages.register({ id: 'properties' });

  // Register a tokens provider for the language
  monaco.languages.setMonarchTokensProvider('properties', {
    tokenizer: {
      root: [
        [/^\#.*/, 'comment'],
        [/.*\=/, 'key'],
        [/^=.*/, 'value'],
      ],
    },
  });

  // Define a new theme that constains only rules that match this language
  monaco.editor.defineTheme('properties', {
    base: 'vs',
    inherit: false,
    rules: [
      { token: 'key', foreground: '009968' },
      { token: 'value', foreground: '009968' },
      { token: 'comment', foreground: '666666' },
    ],
  } as any);

  // Register a comment rule that will let us have comments in properties files
  monaco.languages.setLanguageConfiguration('properties', {
    comments: {
      lineComment: '#',
      blockComment: ['<#', '#>'],
    },
  });

  // Register a completion item provider for the new language
  monaco.languages.registerCompletionItemProvider('properties', {
    provideCompletionItems: () => [
      {
        label: 'simpleText',
        kind: monaco.languages.CompletionItemKind.Text,
      },
      {
        label: 'testing',
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: {
          value: 'testing(${1:condition})',
        },
      },
      {
        label: 'ifelse',
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: {
          value: ['if (${1:condition}) {', '\t$0', '} else {', '\t', '}'].join(
            '\n'
          ),
        },
        documentation: 'If-Else Statement',
      },
    ],
  } as any);
};

export default function Editor() {
  const [config] = useAtom(editorConfigAtom);
  const [kitIsDark] = useAtom(darkAtom);
  const [open] = useAtom(openAtom);
  const [inputValue, setInputValue] = useAtom(inputAtom);
  const setCursorPosition = useSetAtom(editorCursorPosAtom);
  const [ui] = useAtom(uiAtom);
  const [options] = useAtom(editorOptions);
  const [editorSuggestions] = useAtom(editorSuggestionsAtom);
  const editorAppend = useAtomValue(editorAppendAtom);
  const disposeRef = useRef<any>(null);

  const m = useMonaco();

  // useSave(inputValue);
  // useClose();
  // useEscape();
  // useOpen();

  useEffect(() => {
    if (!m) return;

    if (disposeRef?.current) disposeRef?.current?.dispose();
    if (options?.language === 'markdown' || options?.language === 'md') {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      disposeRef.current = m.languages.registerCompletionItemProvider(
        'markdown',
        {
          async provideCompletionItems() {
            // clear previous suggestions

            const suggestions = editorSuggestions?.map((str: string) => ({
              label: str,
              insertText: str,
            }));

            return {
              suggestions,
            };
          },
        } as any
      );
    }
  }, [editorSuggestions, m, options]);

  const [
    editor,
    setEditorRef,
  ] = useState<monacoEditor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (editorSuggestions.length && options.language === 'markdown') {
      editor?.getAction('editor.action.triggerSuggest')?.run();
    }
  }, [editorSuggestions, editor, options]);

  const containerRef = useMountMainHeight();

  const onBeforeMount = useCallback(
    (monaco: Monaco) => {
      monaco.editor.defineTheme('kit-dark', nightOwl);
      monaco.editor.defineTheme('kit-light', kitLight);

      if (options?.language === 'properties') {
        registerPropertiesLanguage(monaco);
      }

      if (options?.language === 'typescript') {
        monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
          noSyntaxValidation: false,
          noSemanticValidation: false,
        });

        monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
          target: monaco.languages.typescript.ScriptTarget.ESNext,
          allowNonTsExtensions: true,
          moduleResolution:
            monaco.languages.typescript.ModuleResolutionKind.NodeJs,
          module: monaco.languages.typescript.ModuleKind.ESNext,
          lib: ['esnext'],
          jsx: monaco.languages.typescript.JsxEmit.React,
          reactNamespace: 'React',
          typeRoots: ['node_modules/@types'],
        });
      }

      if (options?.language === 'javascript') {
        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
          noSyntaxValidation: false,
          noSemanticValidation: true,
        });

        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
          target: monaco.languages.typescript.ScriptTarget.ESNext,
          allowNonTsExtensions: true,
          moduleResolution:
            monaco.languages.typescript.ModuleResolutionKind.NodeJs,
          module: monaco.languages.typescript.ModuleKind.ESNext,
          lib: ['esnext'],
          jsx: monaco.languages.typescript.JsxEmit.React,
          reactNamespace: 'React',
          typeRoots: ['node_modules/@types'],
        });
      }
    },
    [options]
  );

  const onMount = useCallback(
    (mountEditor: monacoEditor.IStandaloneCodeEditor, monaco: Monaco) => {
      setEditorRef(mountEditor);

      mountEditor.focus();

      // monaco.languages.typescript.typescriptDefaults.addExtraLib(
      //   `
      //   declare module 'axios' {
      //       export interface Foo {
      //           foo: string;
      //       }
      //   }
      //   `
      // );

      if (typeof config !== 'string') {
        if (config?.language === 'typescript') {
          if (config?.extraLibs?.length) {
            for (const { content, filePath } of config.extraLibs) {
              // console.log(filePath);
              // console.log(content);
              monaco.languages.typescript.typescriptDefaults.addExtraLib(
                content,
                filePath
              );
            }
          }
        }

        if (config?.language === 'javascript') {
          if (config?.extraLibs?.length) {
            for (const { content, filePath } of config.extraLibs) {
              monaco.languages.typescript.javascriptDefaults.addExtraLib(
                content,
                filePath
              );
            }
          }
        }
      }

      // const model = monaco.editor.createModel(
      //   `
      // import { getUserProfile } from './user';
      // const profile = getUserProfile("some-id");
      // console.log(profile.firstName);
      //     `.trim(),
      //   'typescript',
      //   monaco.Uri.parse('file:///main.tsx')
      // );

      // editor.setModel(model);

      monaco.editor.setTheme(kitIsDark ? 'kit-dark' : 'kit-light');

      mountEditor.layout({
        width: containerRef?.current?.offsetWidth || document.body.offsetWidth,
        height:
          (containerRef?.current?.offsetHeight || document.body.offsetHeight) -
          24,
      });

      // if (typeof global?.exports === 'undefined') global.exports = {};
      mountEditor.focus();

      if (mountEditor?.getDomNode())
        ((mountEditor.getDomNode() as HTMLElement)
          .style as any).webkitAppRegion = 'no-drag';

      const lineNumber = mountEditor.getModel()?.getLineCount() || 0;

      if ((config as EditorOptions).scrollTo === 'bottom') {
        const column =
          (mountEditor?.getModel()?.getLineContent(lineNumber).length || 0) + 1;

        const position = { lineNumber, column };
        // console.log({ position });
        mountEditor.setPosition(position);

        mountEditor.revealPosition(position);
      }

      if ((config as EditorOptions).scrollTo === 'center') {
        mountEditor.revealLineInCenter(Math.floor(lineNumber / 2));
      }
    },
    [config, containerRef, kitIsDark]
  );

  const onChange = useCallback(
    (value) => {
      if (!editor) return;
      if (!editor?.getModel()) return;
      if (!editor?.getPosition()) return;
      setCursorPosition(
        editor
          ?.getModel()
          ?.getOffsetAt(editor.getPosition() || { lineNumber: 1, column: 1 }) ||
          0
      );
      setInputValue(value);
    },
    [editor, setCursorPosition, setInputValue]
  );

  useEffect(() => {
    if (ui === UI.editor && open && editor) {
      const lineNumber = editor.getModel()?.getLineCount() || 0;

      if ((config as EditorOptions).scrollTo === 'bottom') {
        const column =
          (editor?.getModel()?.getLineContent(lineNumber).length || 0) + 1;

        const position = { lineNumber, column };
        editor.setPosition(position);

        editor.revealPosition(position);
      }

      if ((config as EditorOptions).scrollTo === 'center') {
        editor.revealLineInCenter(Math.floor(lineNumber / 2));
      }

      if ((config as any)?.template) {
        const contribution = editor.getContribution('snippetController2');
        if (contribution && config) {
          (contribution as any).insert((config as any).template as any);
        }
      }

      editor.focus();
    }
  }, [open, config, editor, ui]);

  useEffect(() => {
    if (editor && editorAppend) {
      // set position to the end of the file
      const lineNumber = editor.getModel()?.getLineCount() || 0;
      const column = editor.getModel()?.getLineMaxColumn(lineNumber) || 0;
      const range = new Range(lineNumber, column, lineNumber, column);

      const id = { major: 1, minor: 1 };
      const op = {
        identifier: id,
        range,
        text: editorAppend,
        forceMoveMarkers: true,
      };

      editor.executeEdits('my-source', [op]);
      // scroll to bottom
      editor.revealLine(lineNumber + 1);
    }
  }, [editor, editorAppend]);

  const theme = kitIsDark ? 'kit-dark' : 'kit-light';

  return (
    <motion.div
      key="editor"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1] }}
      transition={{ duration: 0.5, ease: 'circOut' }}
      ref={containerRef}
      className={`
      pt-3 -mb-3
    w-full h-full`}
    >
      <MonacoEditor
        className="w-full h-full"
        beforeMount={onBeforeMount}
        onMount={onMount}
        language={(config as EditorOptions)?.language || 'markdown'}
        // language="typescript"
        theme={theme}
        options={options}
        path="file:///index.ts"
        value={inputValue}
        onChange={onChange}
      />
    </motion.div>
  );
}
