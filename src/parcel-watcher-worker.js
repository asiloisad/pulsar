/* global emit */

// A worker script for `@parcel/watcher`. Runs as a `Task` (see src/task.js).
//
// Manages any number of individual folder watchers in a single process,
// communicating over IPC.
//
// Requests to watch files (rather than directories) are handled via Node's
// builtin `fs.watch` API.

const watcher = require('@parcel/watcher');
const fs = require('fs');

// Map @parcel/watcher event types to Pulsar's expected action names.
const EVENT_MAP = {
  create: 'created',
  update: 'modified',
  delete: 'deleted'
};

// Organizes watchers by unique ID.
const WATCHERS_BY_PATH = new Map();

// A shim over the real `console` methods so that they send log messages back
// to the renderer process instead of making us dig into their own console.
const console = {
  enabled: false,
  log(...args) {
    if (!this.enabled) return;
    emit('console:log', ['parcel-worker', ...args]);
  },
  warn(...args) {
    if (!this.enabled) return;
    emit('console:warn', ['parcel-worker', ...args]);
  },
  error(...args) {
    // Send errors whether logging is enabled or not.
    emit('console:error', ['parcel-worker', ...args]);
  }
};

// A shim to imitate the subscription object returned by `@parcel/watcher` for
// when we watch individual files via `fs.watch`.
class FileHandle {
  constructor(controller) {
    this.controller = controller;
  }

  async unsubscribe() {
    return this.controller.abort();
  }
}

// Reacts to events on individual files and sends batches back to the renderer.
function fileHandler(instance, eventType, normalizedPath) {
  let action = eventType === 'rename' ? 'deleted' : 'modified';
  let payload = { action, path: normalizedPath };

  console.log('File events:', [payload]);

  emit('watcher:events', {
    id: instance,
    events: [payload]
  });
}

// Reacts to filesystem events and sends batches back to the renderer.
function handler(instance, err, events) {
  if (err) {
    emit('watcher:error', { id: instance, error: err.message });
    return;
  }

  let normalizedEvents = events.map(event => {
    let action = EVENT_MAP[event.type] || `unexpected (${event.type})`;
    return { action, path: event.path };
  });

  console.log('Events:', normalizedEvents);

  emit('watcher:events', {
    id: instance,
    events: normalizedEvents
  });
}

// Builds the ignore globs array from the `core.ignoredNames` setting.
function buildIgnoreGlobs(ignoredNames) {
  if (!ignoredNames || !ignoredNames.length) return [];
  let globs = [];
  for (let name of ignoredNames) {
    globs.push(name, `**/${name}`);
  }
  return globs;
}

// Reacts to messages sent by the renderer.
async function handleMessage(message) {
  let { id, event = null, args } = JSON.parse(message);
  switch (event) {
    case 'watcher:watch':
    case 'watcher:update': {
      let { normalizedPath, instance, ignored = [] } = args;
      let existing = WATCHERS_BY_PATH.get(instance);
      try {
        let ignore = buildIgnoreGlobs(ignored);
        console.log('Watching:', normalizedPath, 'ignore:', ignore);

        let isDir;
        try {
          isDir = fs.lstatSync(normalizedPath).isDirectory();
        } catch (e) {
          // Path doesn't exist or can't be accessed.
          throw new Error(`Cannot watch path: ${normalizedPath} (${e.message})`);
        }

        if (isDir) {
          let wrappedHandler = (err, events) => handler(instance, err, events);
          let handle = await watcher.subscribe(
            normalizedPath,
            wrappedHandler,
            { ignore }
          );
          WATCHERS_BY_PATH.set(instance, handle);
        } else {
          console.log('Watching file:', normalizedPath);
          let controller = new AbortController();
          fs.watch(
            normalizedPath,
            { signal: controller.signal },
            (eventType) => fileHandler(instance, eventType, normalizedPath)
          );
          WATCHERS_BY_PATH.set(instance, new FileHandle(controller));
        }

        // If updating, stop the old watcher after the new one is running.
        if (existing) {
          await existing.unsubscribe();
        }
        emit('watcher:reply', { id, args: instance });
      } catch (err) {
        console.error('Error watching path:', normalizedPath, err.message);
        emit('watcher:reply', { id, error: err.message });
      }
      break;
    }
    case 'watcher:unwatch': {
      let { instance } = args;
      let handle = WATCHERS_BY_PATH.get(instance);
      if (handle) {
        await handle.unsubscribe();
        WATCHERS_BY_PATH.delete(instance);
      }
      emit('watcher:reply', { id, args: instance });
      break;
    }
    default: {
      console.warn('Unrecognized event:', event);
    }
  }
}

function run() {
  // Run a no-op on an interval just to keep the task alive.
  setInterval(() => {}, 10000);
  process.on('message', handleMessage);
  console.log('@parcel/watcher worker starting');
  emit('watcher:ready');
}

process.on('uncaughtException', (error) => {
  try {
    console.error(error?.message ?? error);
  } finally {
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
});

process.title = `Pulsar file watcher worker (@parcel/watcher) [PID: ${process.pid}]`;

module.exports = run;
