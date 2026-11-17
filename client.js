window.__ModuleLoader__.load({
  id: '@oheco/dsh-open-sessions',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;

    const NS = 'oheco.openSessions';
    const SLOT_ID = 'oheco.open-sessions';
    const STORAGE_KEY = 'oheco.dsh-open-sessions.v1';
    /** Reference source label shown in `ctx.sessions.retainInfo(...).retainedBy`. */
    const SOURCE = 'openSessions';
    /** Most recently shown sessions kept loaded; older list entries stay listed but are released. */
    const MAX_WARM = 10;

    const dicts = {
      zh: {
        heading: '已打开',
        list: '已打开的会话',
        close: '关闭 {title}',
        closeHint: '关闭（中键单击行也可关闭）',
        running: '运行中',
      },
      en: {
        heading: 'Open',
        list: 'Open sessions',
        close: 'Close {title}',
        closeHint: 'Close (middle-click the row also closes it)',
        running: 'Running',
      },
    };

    function readStored() {
      try {
        const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
        return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && id !== ''))] : [];
      } catch {
        return [];
      }
    }

    function writeStored(ids) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* storage unavailable: keep the in-memory list */ }
    }

    function sameView(previous, items, currentId) {
      if (previous.currentId !== currentId || previous.items.length !== items.length) return false;
      return previous.items.every((item, index) => {
        const next = items[index];
        return item.id === next.id && item.title === next.title && item.running === next.running;
      });
    }

    /**
     * Open-session list state: follows the main-view Session, keeps listed Sessions retained
     * (so reopening reuses the loaded Client generation), and exposes open/close actions.
     */
    function createModel(ctx) {
      const sessions = ctx.sessions;
      const workspaces = ctx.get('workspaces');
      const layout = ctx.get('layout');
      const navigation = ctx.uiWorkspace;

      let openIds = readStored();
      const refs = new Map();
      let warmOrder = [];
      let lastMain;
      let suppressed;
      let view = { items: [], currentId: undefined };
      const listeners = new Set();

      const listOf = () => sessions.list.getSnapshot();
      const archivedOf = () => {
        try { return new Set(workspaces?.list?.getSnapshot()?.archivedSessionIds ?? []); } catch { return new Set(); }
      };
      const panelActive = () => {
        try { return (layout?.panelInfo?.getSnapshot()?.activePanelId ?? null) !== null; } catch { return false; }
      };

      function mainIdOf(list) {
        for (const id of Object.keys(list.byId)) {
          if ((list.byId[id]?.retainedBy?.mainView ?? 0) > 0) return id;
        }
        return undefined;
      }

      function retain(id) {
        if (refs.has(id)) return;
        try {
          const reference = sessions.retain(id, { source: SOURCE });
          reference.ready?.catch?.(() => { /* the main view reports open failures */ });
          refs.set(id, reference);
        } catch (error) {
          console.error('[open-sessions] retain failed', id, error);
        }
      }

      function release(id) {
        const reference = refs.get(id);
        if (reference === undefined) return;
        refs.delete(id);
        try { reference.release(); } catch (error) { console.error('[open-sessions] release failed', id, error); }
      }

      function forget(id) {
        warmOrder = warmOrder.filter(other => other !== id);
        release(id);
      }

      /** Mark a Session as most recently shown and keep at most MAX_WARM references. */
      function touch(id) {
        warmOrder = [...warmOrder.filter(other => other !== id), id];
        retain(id);
        while (warmOrder.length > MAX_WARM) release(warmOrder.shift());
      }

      function publish(list, main) {
        const currentId = panelActive() ? undefined : main;
        const items = openIds.map(id => {
          const summary = list.byId[id];
          return { id, title: summary?.displayTitle || summary?.title || id, running: summary?.running === true };
        });
        if (sameView(view, items, currentId)) return;
        view = { items, currentId };
        for (const listener of [...listeners]) listener();
      }

      function reconcile() {
        const list = listOf();
        const archived = archivedOf();
        let changed = false;
        if (list.phase === 'ready') {
          const kept = openIds.filter(id => {
            const summary = list.byId[id];
            return summary !== undefined && summary.origin !== 'subagent' && !archived.has(id);
          });
          if (kept.length !== openIds.length) {
            for (const id of openIds) if (!kept.includes(id)) forget(id);
            openIds = kept;
            changed = true;
          }
        }
        const main = mainIdOf(list);
        if (main !== lastMain) {
          lastMain = main;
          if (suppressed !== undefined && main !== suppressed) suppressed = undefined;
        }
        const summary = main === undefined ? undefined : list.byId[main];
        if (summary !== undefined && main !== suppressed && !summary.blank && summary.origin !== 'subagent' && !archived.has(main)) {
          if (!openIds.includes(main)) {
            openIds = [...openIds, main];
            changed = true;
          }
          if (warmOrder[warmOrder.length - 1] !== main) touch(main);
        }
        if (changed) writeStored(openIds);
        publish(list, main);
      }

      function open(id) {
        try {
          navigation.openSession(id);
        } catch (error) {
          console.error('[open-sessions] open failed', id, error);
        }
      }

      function close(id) {
        const index = openIds.indexOf(id);
        if (index < 0) return;
        const wasMain = id === lastMain;
        openIds = openIds.filter(other => other !== id);
        writeStored(openIds);
        if (wasMain) {
          // Keep the closed Session out of the list until the main view shows another Session.
          suppressed = id;
          const neighbor = openIds[Math.min(index, openIds.length - 1)];
          if (neighbor !== undefined) open(neighbor);
        }
        forget(id);
        publish(listOf(), lastMain);
      }

      const disposers = [sessions.list.subscribe(reconcile)];
      if (typeof workspaces?.list?.subscribe === 'function') disposers.push(workspaces.list.subscribe(reconcile));
      if (typeof layout?.panelInfo?.subscribe === 'function') disposers.push(layout.panelInfo.subscribe(() => publish(listOf(), lastMain)));
      reconcile();

      return {
        getSnapshot: () => view,
        subscribe(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        open,
        close,
        dispose() {
          for (const dispose of disposers.splice(0)) dispose();
          for (const id of [...refs.keys()]) release(id);
          warmOrder = [];
          listeners.clear();
        },
      };
    }

    const CSS = `
.oheco-os-host{flex:none;display:flex;flex-direction:column;min-height:0;max-height:min(38vh,320px)}
.oheco-os{display:flex;flex-direction:column;min-height:0;margin:0 0 6px}
.oheco-os-header{flex:none;display:flex;align-items:center;gap:6px;height:28px;padding:0 8px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:12px;line-height:20px;user-select:none}
.oheco-os-count{font-variant-numeric:tabular-nums}
.oheco-os-list{list-style:none;margin:0;padding:0;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:1px}
.oheco-os-row{flex:none;display:flex;align-items:center;height:32px;border-radius:var(--dsw-radius-md,8px);color:var(--dsw-alias-label-primary)}
.oheco-os-row:hover,.oheco-os-row[data-active]{background:var(--dsw-alias-interactive-bg-hover)}
.oheco-os-open{flex:1;min-width:0;height:100%;display:flex;align-items:center;margin:0;padding:0 4px 0 8px;border:none;border-radius:inherit;background:none;color:inherit;font:inherit;font-size:14px;line-height:20px;text-align:left;cursor:pointer}
.oheco-os-lead{flex:none;width:16px;height:20px;display:inline-flex;align-items:center;justify-content:center}
.oheco-os-spinner{box-sizing:border-box;width:10px;height:10px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:oheco-os-spin .9s linear infinite}
@keyframes oheco-os-spin{to{transform:rotate(360deg)}}
.oheco-os-title{flex:1;min-width:0;margin:0 2px 0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oheco-os-close{flex:none;width:24px;height:24px;margin-right:4px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:var(--dsw-radius-sm,6px);background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0}
.oheco-os-row:hover .oheco-os-close,.oheco-os-row:focus-within .oheco-os-close,.oheco-os-row[data-active] .oheco-os-close{opacity:1}
.oheco-os-close:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,currentColor 12%,transparent)}
.oheco-os-open:focus-visible,.oheco-os-close:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)));outline-offset:-2px}
.oheco-os-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion:reduce){.oheco-os-spinner{animation:none}}
`;

    function CloseIcon() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M3 3l6 6M9 3l-6 6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', fill: 'none' }));
    }

    function Row({ item, active, model, t }) {
      return h('li', {
        className: 'oheco-os-row',
        'data-active': active ? '' : undefined,
        onMouseDown: event => { if (event.button === 1) event.preventDefault(); },
        onAuxClick: event => {
          if (event.button !== 1) return;
          event.preventDefault();
          model.close(item.id);
        },
      },
      h('button', {
        type: 'button',
        className: 'oheco-os-open',
        title: item.title,
        'aria-current': active ? 'page' : undefined,
        onClick: () => { model.open(item.id); },
      },
      h('span', { className: 'oheco-os-lead', 'aria-hidden': true }, item.running ? h('span', { className: 'oheco-os-spinner' }) : null),
      h('span', { className: 'oheco-os-title' }, item.title),
      item.running ? h('span', { className: 'oheco-os-sr' }, t('running')) : null),
      h('button', {
        type: 'button',
        className: 'oheco-os-close',
        'aria-label': t('close', { title: item.title }),
        title: t('closeHint'),
        onClick: () => { model.close(item.id); },
      }, h(CloseIcon)));
    }

    function OpenSessionsList({ model, t }) {
      const { items, currentId } = React.useSyncExternalStore(model.subscribe, model.getSnapshot);
      if (items.length === 0) return null;
      return h('section', { className: 'oheco-os', 'aria-label': t('list') },
        h('div', { className: 'oheco-os-header' },
          h('span', null, t('heading')),
          h('span', { className: 'oheco-os-count' }, String(items.length))),
        h('ul', { className: 'oheco-os-list' },
          items.map(item => h(Row, { key: item.id, item, active: item.id === currentId, model, t }))));
    }

    /** Locate the sidebar column and its workspace region from an element rendered at the sidebar foot. */
    function findSidebarRegion(anchor) {
      const foot = anchor.closest('[class*="_footArea"]');
      const root = foot?.parentElement;
      if (!root) return undefined;
      const region = Array.from(root.children).find(element =>
        typeof element.className === 'string' && /(^|\s)\S*_regionArea(\s|$)/.test(element.className));
      return region === undefined ? undefined : { root, region };
    }

    /**
     * Renderless seat at the sidebar foot. It mounts one container directly above the
     * workspace region and portals the list there; without that region it renders in place.
     */
    function OpenSessionsSeat({ wide, t, model }) {
      const anchorRef = React.useRef(null);
      const [placement, setPlacement] = React.useState('pending');

      React.useLayoutEffect(() => {
        const anchor = anchorRef.current;
        const found = anchor === null ? undefined : findSidebarRegion(anchor);
        if (found === undefined) {
          console.warn('[open-sessions] sidebar workspace region not found; rendering the list at the sidebar foot');
          setPlacement('inline');
          return undefined;
        }
        const container = document.createElement('div');
        container.className = 'oheco-os-host';
        container.dataset.ohecoOpenSessions = '';
        const place = () => {
          if (found.region.parentElement === found.root && container.nextElementSibling !== found.region) {
            found.root.insertBefore(container, found.region);
          }
        };
        place();
        const observer = new MutationObserver(place);
        observer.observe(found.root, { childList: true });
        setPlacement(container);
        return () => {
          observer.disconnect();
          container.remove();
          setPlacement('pending');
        };
      }, []);

      const content = wide
        ? h(React.Fragment, null, h('style', null, CSS), h(OpenSessionsList, { model, t }))
        : null;
      return h(React.Fragment, null,
        h('span', { ref: anchorRef, hidden: true, 'data-oheco-open-sessions-anchor': '' }),
        placement === 'pending' ? null : placement === 'inline' ? content : createPortal(content, placement));
    }

    return {
      inject: ['slots', 'locale', 'sessions', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dicts), 'open-sessions: dictionaries');
        let model;
        ctx.effect(() => {
          model = createModel(ctx);
          return () => { model.dispose(); };
        }, 'open-sessions: model');
        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: SLOT_ID,
          order: 10000,
          locale: NS,
          inject: () => ({ model }),
        }, OpenSessionsSeat)), 'open-sessions: sidebar seat');
      },
    };
  },
});
