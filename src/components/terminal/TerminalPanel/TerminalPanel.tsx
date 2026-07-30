import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useStores } from '@stores/index';
import styles from './TerminalPanel.module.css';

interface TerminalPanelProps {
  tabId: string;
  isActive: boolean;
}

export const TerminalPanel = observer(function TerminalPanel({
  tabId,
  isActive,
}: TerminalPanelProps) {
  const { terminalStore, settingsStore } = useStores();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const tab = terminalStore.tabs.find((t) => t.id === tabId);
  const canResize = tab?.status === 'connected' && Boolean(tab.connectionId);

  useEffect(() => {
    if (!containerRef.current) return;

    const isLight = settingsStore.settings.theme === 'light';
    const term = new Terminal({
      cursorBlink: true,
      fontSize: settingsStore.settings.terminalFontSize,
      fontFamily: settingsStore.settings.terminalFontFamily,
      theme: {
        // Fully transparent: the terminal has no background color of its
        // own, so it shows through to the .panel wrapper's own (opacity
        // setting-aware) background instead of painting a second, separate
        // opaque/translucent layer on top of it.
        background: '#00000000',
        foreground: isLight ? '#1e1e1e' : '#cccccc',
        cursor: isLight ? '#1e1e1e' : '#cccccc',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    terminalStore.registerTerminal(tabId, {
      write: (data) => {
        term.write(data);
      },
      resize: (cols, rows) => {
        void terminalStore.resizeTab(tabId, cols, rows);
      },
      focus: () => {
        term.focus();
      },
      clear: () => {
        term.clear();
      },
    });

    const dataDisposable = term.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      void terminalStore.writeToTab(tabId, bytes);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (terminalStore.activeTabId !== tabId) return;
      const currentTab = terminalStore.tabs.find((t) => t.id === tabId);
      if (currentTab?.connectionId && currentTab.status === 'connected') {
        void terminalStore.resizeTab(tabId, term.cols, term.rows);
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
      terminalStore.unregisterTerminal(tabId);
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [
    tabId,
    terminalStore,
    settingsStore.settings.theme,
    settingsStore.settings.terminalFontSize,
    settingsStore.settings.terminalFontFamily,
  ]);

  useEffect(() => {
    if (!isActive || !terminalRef.current || !fitAddonRef.current) return;

    fitAddonRef.current.fit();
    terminalRef.current.focus();

    if (canResize) {
      void terminalStore.resizeTab(
        tabId,
        terminalRef.current.cols,
        terminalRef.current.rows,
      );
    }
  }, [isActive, canResize, tabId, terminalStore, tab?.connectionId]);

  return (
    <div
      className={`${styles.panel} ${isActive ? styles.panelActive : ''}`}
      aria-hidden={!isActive}
    >
      <div ref={containerRef} className={styles.terminal} />
    </div>
  );
});
