#!/usr/bin/env node

/**
 *
 * Google Sheet Search
 * ᴍ ɪ ᴄ ʀ ᴏ s ᴇ ʀ ᴠ ᴇ ʀ
 *
 * for The Mint Karaoke Lounge song search
 *
 * Matt Montag · February 2020
 *
 */

const TrieSearch = require('trie-search');
const http = require('http');
const URL = require('url');
const fetch = require('node-fetch');
const { performance } = require('perf_hooks');

const SHEET_ID = '';
const API_KEY = '';
const SHEET_RANGE = 'Sheet1!A2:C';
const SHEET_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_RANGE}?key=${API_KEY}`;
const DRIVE_URL = `https://www.googleapis.com/drive/v3/files/${SHEET_ID}?fields=modifiedTime&key=${API_KEY}`;

const PORT = 8081;
const HEADERS = {
  // If running behind a proxy such as nginx,
  // configure it to ignore this CORS header
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};
const CHECK_FOR_UPDATES_INTERVAL_MS = 5/* minutes */ * 60 * 1000;

// For testing only
// const CATALOG_PATH = './test.json';
// let trie = createTrie(transformRangeResult(require(CATALOG_PATH)));
let trie = null;
fetchCatalog().then(catalog => trie = createTrie(catalog));
let lastModifiedTime = 0;
fetchModifiedTime().then(modifiedTime => lastModifiedTime = modifiedTime);

function transformRangeResult(data) {
  /*
  {
    "range": "Sheet1!A2:C500",
    "majorDimension": "ROWS",
    "values": [
      [
        " 1 Giant Leap & Maxi, Jazz & Robbie Williams",
        "    /    ",
        " My Culture"
      ],
      ...
    ]
  }
  */
  return data['values'].map((value, i) => {
    return {
      id: i,
      artist: value[0] ? value[0].trim() : null, 
      title: value[2] ? value[2].trim() : null,
      // artistTitle: value[0].trim() + ' ' + value[2].trim();
    };
  });
}

function fetchModifiedTime() {
  return fetch(DRIVE_URL)
      .then(response => response.json())
      .then(json => new Date(json.modifiedTime));
}

function fetchCatalog() {
  return fetch(SHEET_URL)
    .then(response => response.json())
    .then(json => transformRangeResult(json));
}

function createTrie(catalog) {
  const start = performance.now();
  const trie = new TrieSearch(['artist', 'title'], {
    idFieldOrFunction: 'id',
  });
  trie.addAll(catalog);
  const time = (performance.now() - start).toFixed(1);
  console.log('Added %s items (%s tokens) to search trie in %s ms.', catalog.length, trie.size, time);
  return trie;
}

function checkForUpdates() {
  return fetchModifiedTime()
      .then(modifiedTime => {
        if (modifiedTime > lastModifiedTime) {
          lastModifiedTime = modifiedTime;
          return fetchCatalog()
            .then(catalog => {
              createTrie(catalog);
              return catalog.length;
            })
            .then(length => {
              const status = `Fetched latest updates; ${length} entries. Last modified at ${modifiedTime.toLocaleString()}.`;
              console.log(status);
              return status;
            });
        } else {
          const status = `Not modified since ${lastModifiedTime.toLocaleString()}.`;
          console.log(status);
          return status;
        }
      });
}

const routes = {
  'search': async (params) => {
    const limit = parseInt(params.limit, 10);
    const query = params.query;
    const start = performance.now();
    let items = trie.get(query, TrieSearch.UNION_REDUCER) || [];
    const total = items.length;
    if (limit) items = items.slice(0, limit);
    const time = (performance.now() - start).toFixed(1);
    console.log('Returned %s results in %s ms.', items.length, time);
    return {
      items: items,
      total: total,
    };
  },

  'update': async (params) => {
    return checkForUpdates();
  },

  'total': async (params) => {
    return { total: files.length };
  },
};


http.createServer(async function (req, res) {
  try {
    const url = URL.parse(req.url, true);
    const params = url.query || {};
    const lastPathComponent = url.pathname.split('/').pop();
    const route = routes[lastPathComponent];
    if (route) {
      try {
        const json = await route(params);
        const headers = {...HEADERS};
        if (!['random', 'shuffle'].includes(lastPathComponent)) {
          headers['Cache-Control'] = 'public, max-age=3600';
        }
        if (json) {
          res.writeHead(200, headers);
          res.end(JSON.stringify(json) + '\n');
          return;
        } else {
          res.writeHead(404, headers);
          res.end('Not found\n');
        }
      } catch (e) {
        res.writeHead(500);
        res.end('Server error\n');
        console.log('Error processing request:', req.url, e);
      }
    }
    res.writeHead(404);
    res.end('Route not found\n');
  } catch (e) {
    res.writeHead(500);
    res.end(`Server error\n${e}\n`);
  }
}).listen(PORT, 'localhost');

setInterval(checkForUpdates, CHECK_FOR_UPDATES_INTERVAL_MS);