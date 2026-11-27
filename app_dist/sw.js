/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-7e5eb42b'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "pwa-maskable-512x512.png",
    "revision": "7fa75c71197d2736c3af9f886f305375"
  }, {
    "url": "pwa-512x512.png",
    "revision": "e3681fd4850f8ae2222242d2f0f9d8f3"
  }, {
    "url": "pwa-192x192.png",
    "revision": "b4864c0311142f1b45c57b4831a4a8fa"
  }, {
    "url": "logo.svg",
    "revision": "e5f6ddeb269318bbfaddac1e1bd9c751"
  }, {
    "url": "index.html",
    "revision": "0129761b1d284b2b4df99e304995aec7"
  }, {
    "url": "favicon.ico",
    "revision": "0597005b3f3936efcaeba909c0fa80c9"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "9b3787f9031c76b364ef23510d363a60"
  }, {
    "url": "assets/brewpanda-v207.js",
    "revision": null
  }, {
    "url": "assets/brewpanda-v207.css",
    "revision": null
  }, {
    "url": "assets/brewpanda-v207-workbox-window.prod.es5.js",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "9b3787f9031c76b364ef23510d363a60"
  }, {
    "url": "favicon.ico",
    "revision": "0597005b3f3936efcaeba909c0fa80c9"
  }, {
    "url": "logo.svg",
    "revision": "e5f6ddeb269318bbfaddac1e1bd9c751"
  }, {
    "url": "pwa-192x192.png",
    "revision": "b4864c0311142f1b45c57b4831a4a8fa"
  }, {
    "url": "pwa-512x512.png",
    "revision": "e3681fd4850f8ae2222242d2f0f9d8f3"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "7fa75c71197d2736c3af9f886f305375"
  }, {
    "url": "manifest.webmanifest",
    "revision": "9bd9f725d7c2c342a011a42532212de7"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));

}));
