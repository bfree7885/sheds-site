/**
 * Sheds Field View — Service Worker for offline map tiles
 * Intercepts tile requests, serves from Cache API or IndexedDB when available,
 * fetches and caches when online.
 */

const OFFLINE_CACHE = 'sheds-offline-tiles';
const IDB_NAME = 'sheds-offline';
const IDB_STORE = 'tiles';

const TILE_SOURCE_URLS = {
  base: 'https://demotiles.maplibre.org/tiles'
};

function openIDB() {
  return new Promise(function (resolve, reject) {
    var r = indexedDB.open(IDB_NAME, 1);
    r.onerror = function () { reject(r.error); };
    r.onsuccess = function () { resolve(r.result); };
    r.onupgradeneeded = function () {
      r.result.createObjectStore(IDB_STORE);
    };
  });
}

function getTileFromIDB(key) {
  return openIDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, 'readonly');
      var store = tx.objectStore(IDB_STORE);
      var req = store.get(key);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function putTileInIDB(key, buffer) {
  return openIDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, 'readwrite');
      var store = tx.objectStore(IDB_STORE);
      var req = store.put(buffer, key);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function parseTilePath(url) {
  try {
    var u = new URL(url);
    var m = u.pathname.match(/\/tiles\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.(pbf|png|webp)$/);
    if (!m) return null;
    return { sourceId: m[1], z: parseInt(m[2], 10), x: parseInt(m[3], 10), y: parseInt(m[4], 10), ext: m[5] };
  } catch (e) {
    return null;
  }
}

function realTileUrl(sourceId, z, x, y, ext) {
  var base = TILE_SOURCE_URLS[sourceId] || TILE_SOURCE_URLS.base;
  return base + '/' + z + '/' + x + '/' + y + '.' + (ext || 'pbf');
}

function idbKey(sourceId, z, x, y) {
  return sourceId + ':' + z + ':' + x + ':' + y;
}

self.addEventListener('fetch', function (event) {
  var url = event.request.url;
  var parsed = parseTilePath(url);
  if (!parsed) return;

  event.respondWith(
    caches.open(OFFLINE_CACHE).then(function (cache) {
      return cache.match(event.request).then(function (cached) {
        if (cached) return cached;
        return getTileFromIDB(idbKey(parsed.sourceId, parsed.z, parsed.x, parsed.y)).then(function (buffer) {
          if (!buffer) throw new Error('not in idb');
          var contentType = parsed.ext === 'pbf' ? 'application/x-protobuf' : 'image/' + parsed.ext;
          return new Response(buffer, {
            headers: { 'Content-Type': contentType }
          });
        }).catch(function () {
          if (!self.navigator.onLine) {
            return new Response(null, { status: 404, statusText: 'Not found (offline)' });
          }
          var realUrl = realTileUrl(parsed.sourceId, parsed.z, parsed.x, parsed.y, parsed.ext);
          return fetch(realUrl).then(function (networkResponse) {
            if (!networkResponse.ok) return networkResponse;
            return networkResponse.clone().arrayBuffer().then(function (buffer) {
              return putTileInIDB(idbKey(parsed.sourceId, parsed.z, parsed.x, parsed.y), buffer).then(function () {
                return networkResponse;
              });
            });
          }).then(function (response) {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          });
        });
      });
    })
  );
});
