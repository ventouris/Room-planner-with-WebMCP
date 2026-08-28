/* Room Planner — boot: start screen, view switching, first render. */
(function (global) {
  'use strict';

  var RP = global.RP;
  var store = RP.store;

  function showView() {
    var onApp = store.state.view === 'app';
    document.getElementById('start-screen').hidden = onApp;
    document.getElementById('app').hidden = !onApp;
    document.body.style.overflow = onApp ? 'hidden' : '';
    if (onApp) {
      RP.ui.render();
    } else {
      var resume = document.getElementById('start-resume');
      if (resume) resume.hidden = !store.hasSaved();
    }
  }
  RP.showView = showView;

  function note(message) {
    var el = document.getElementById('start-note');
    el.textContent = message;
    el.hidden = !message;
  }

  function wireStartScreen() {
    document.getElementById('create-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var w = Number(document.getElementById('start-width').value);
      var h = Number(document.getElementById('start-height').value);
      if (!w || !h || w < 60 || h < 60 || w > 2000 || h > 2000) {
        note('Room sides need to be between 60 and 2000 cm.');
        return;
      }
      note('');
      store.createRoom(w, h);
      showView();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.tpl-card'), function (card) {
      card.addEventListener('click', function () {
        store.loadTemplate(card.dataset.template);
        showView();
      });
    });

    document.getElementById('start-demo').addEventListener('click', function () {
      store.loadDemoRoom();
      showView();
    });

    document.getElementById('start-resume').addEventListener('click', function () {
      store.restore();
      store.setView('app');
      showView();
    });
  }

  /* ?room=demo|bedroom|office|living opens straight into that layout — handy
     for demos and for pointing an agent at a known starting point. */
  function roomFromQuery() {
    var match = /[?&]room=([a-z]+)/i.exec(global.location.search);
    return match ? match[1].toLowerCase() : null;
  }

  /* ?view=plan renders the floor plan alone, filling the window, so a plain
     screenshot captures the plan without any of the app around it.
     &background=transparent drops the paper backdrop. */
  function applyViewMode() {
    var search = global.location.search;
    if (!/[?&]view=plan\b/i.test(search)) return false;
    document.body.dataset.view = 'plan';
    if (/[?&]background=transparent\b/i.test(search)) document.body.classList.add('plan-transparent');
    return true;
  }

  /* ?mcp=simulate installs a stand-in WebMCP host *before* the tools register,
     so the real `navigator.modelContext` path can be exercised in a browser
     that has no WebMCP support yet. `window.mcpHost` then holds exactly what a
     host receives — including the MCP-shaped tool results, which is what an
     agent sees (the window.roomPlanner bridge unwraps them for convenience). */
  function simulateHost() {
    if (!/[?&]mcp=simulate\b/i.test(global.location.search)) return;
    var registry = [];
    var host = {
      simulated: true,
      registerTool: function (tool) {
        registry = registry.filter(function (t) { return t.name !== tool.name; });
        registry.push(tool);
        return { unregister: function () { host.unregisterTool(tool.name); } };
      },
      unregisterTool: function (name) {
        registry = registry.filter(function (t) { return t.name !== name; });
      },
      provideContext: function (context) {
        registry = (context && context.tools) ? context.tools.slice() : [];
      },
      listTools: function () {
        return registry.map(function (t) {
          return { name: t.name, description: t.description, inputSchema: t.inputSchema };
        });
      },
      callTool: function (name, args) {
        var tool = registry.filter(function (t) { return t.name === name; })[0];
        if (!tool) return Promise.reject(new Error('Unknown tool "' + name + '".'));
        return Promise.resolve(tool.execute(args || {}));
      }
    };
    try {
      Object.defineProperty(global.navigator, 'modelContext', { value: host, configurable: true });
    } catch (e) {
      try { global.navigator.modelContext = host; } catch (e2) { /* locked down */ }
    }
    global.mcpHost = host;
    console.info('[room-planner] simulated WebMCP host installed — inspect window.mcpHost');
  }

  function boot() {
    simulateHost();
    RP.ui.init();
    wireStartScreen();

    var planOnly = applyViewMode();
    var requested = roomFromQuery();
    if (requested === 'demo') {
      store.loadDemoRoom();
    } else if (requested && RP.TEMPLATES[requested]) {
      store.loadTemplate(requested);
    } else if (store.restore()) {
      /* A saved layout means the person was mid-plan: drop them back in. */
      store.state.view = 'app';
    } else if (planOnly) {
      store.loadDemoRoom();
    } else {
      store.state.view = 'start';
    }

    if (planOnly) {
      store.state.view = 'app';
      store.state.selectedId = null;
    }

    showView();
    RP.installWebMCP();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
