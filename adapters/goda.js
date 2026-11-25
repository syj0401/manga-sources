/* adapters/goda.js — GoDa漫画 (normal, primary).
 * Protocol: venera-app/venera-configs goda.js (GPL-3.0).
 * Search GET {base}/s/{keyword}?page=; categories /manga-genre/kr|cn|jp;
 * detail GET {base}{id} + {api}/manga/get?mid=&mode=all; chapter
 * GET {api}/chapter/getinfo?m=&c= — images may be an obfuscated string,
 * decoded by decodeChapterImages below (ported verbatim in logic from
 * goda.js L1-108, which itself ports keiyoushi/extensions-source).
 * 5-method interface (v2.2 §4.4). No login, no paywall. */
'use strict';

(function () {
  var STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var CUSTOM = '_-9876543210abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var TABLE = new Array(128).fill(-1);
  for (var i = 0; i < CUSTOM.length; i++) TABLE[CUSTOM.charCodeAt(i)] = STD.charCodeAt(i);
  function decodeChapterImages(input) {
    if (typeof input !== 'string' || !input.startsWith('J7r') || !input.endsWith('nQ')) throw new Error('未知的章节数据格式');
    var body = input.substring(3, input.length - 2);
    var payloadLen = body.length - 2 - 3;
    if (payloadLen <= 0) throw new Error('未知的章节数据格式');
    var aLen = Math.floor(payloadLen / 3);
    var bLen = Math.floor((payloadLen - aLen) / 2);
    var cLen = payloadLen - aLen - bLen;
    var part1 = body.substring(0, bLen);
    var marker1 = body.substring(bLen, bLen + 2);
    var part2 = body.substring(bLen + 2, bLen + 2 + cLen);
    var marker2 = body.substring(bLen + 2 + cLen, bLen + 2 + cLen + 3);
    var part3 = body.substring(bLen + 2 + cLen + 3);
    if (marker1 !== 'kD' || marker2 !== 'W4s' || part3.length !== aLen) throw new Error('未知的章节数据格式');
    var reordered = part3 + part1 + part2;
    var unzig = '';
    for (var j = 0, block = 0; j < reordered.length; j += 7, block++) {
      var chunk = reordered.substring(j, Math.min(j + 7, reordered.length));
      unzig += (block % 2 === 1) ? chunk.split('').reverse().join('') : chunk;
    }
    var standard = '';
    for (var k = 0; k < unzig.length; k++) {
      var code = unzig.charCodeAt(k);
      var mapped = code < TABLE.length ? TABLE[code] : -1;
      if (mapped < 0) throw new Error('无效的章节数据字符');
      standard += String.fromCharCode(mapped);
    }
    var b64 = standard.replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var n = 0; n < bin.length; n++) bytes[n] = bin.charCodeAt(n);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  var HEADERS = function (base) {
    return { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0', 'Referer': base };
  };
  function apiBase(src) { return src.apiBase || 'https://v2.apikk.top/api/v2'; }
  function imgBase(src) { return src.imageBase || 'https://c-nd3-1.6wm.top'; }
  function chapterImageUrl(url, base) {
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('//')) return 'https:' + url;
    return absUrl(url, base.replace(/\/?$/, '/'));
  }
  function parseComics(doc, base) {
    var out = [];
    doc.querySelectorAll('.pb-2').forEach(function (el) {
      var a = el.querySelector('a[href]');
      var h3 = el.querySelector('h3');
      var img = el.querySelector('img[src]');
      if (!a || !h3) return;
      out.push({
        id: a.getAttribute('href') || '', title: h3.textContent.trim(),
        cover: img ? absUrl(img.getAttribute('src') || '', base) : '',
        coverKind: 'goda', coverBase: base, coverReferer: base, author: '', tags: []
      });
    });
    return out;
  }
  var GENRE = { all: '/manga', jp: '/manga-genre/jp', kr: '/manga-genre/kr', cn: '/manga-genre/cn' };
  registerVeneraAdapter('goda', {
    supportsCategory: function (_config, category) { return Object.prototype.hasOwnProperty.call(GENRE, category); },
    supportsHot: function (_config, category) { return category === 'all'; },
    supportsSearchPagination: true,
    supportsListPagination: true,
    async getCategoryList(config, category, sort, page) {
      var base = srcBase(config);
      // v2.0.2 round 4: the site moved 最近更新/热门 to /dayup and /hots
      // (/manga-genre/dayup now renders an empty "null" genre page → 0 parsed).
      var path = category === 'all' && sort === 'hot' ? '/hots'
        : category === 'all' && sort === 'latest' ? '/dayup'
        : GENRE[category] || GENRE.all;
      var html = await httpText(base + path + '/page/' + (page || 1), HEADERS(base));
      return parseComics(parseHtml(html), base);
    },
    async search(config, keyword, page) {
      var base = srcBase(config);
      var html = await httpText(base + '/s/' + encodeURIComponent(keyword) + '?page=' + (page || 1), HEADERS(base));
      return parseComics(parseHtml(html), base);
    },
    async getComicDetail(config, comicId) {
      var base = srcBase(config);
      var html = await httpText(base + comicId, HEADERS(base));
      var doc = parseHtml(html);
      var titleEl = doc.querySelector('.text-xl');
      var coverEl = doc.querySelector('.object-cover');
      var descEl = doc.querySelector('p.text-medium');
      var meta = [];
      doc.querySelectorAll('div.py-1').forEach(function (d) { meta.push(d.textContent.trim()); });
      // v2.0.2 round 4: some pages no longer render #mangachapters; the manga id is
      // still on #bookmarkData[data-mid] (e.g. 我独自升级) → use that as a fallback.
      var midEl = doc.querySelector('#mangachapters[data-mid]') || doc.querySelector('#bookmarkData[data-mid]') || doc.querySelector('[data-mid]');
      if (!midEl) throw new Error('这部作品没有拿到章节');
      var mid = midEl.getAttribute('data-mid');
      var j = await httpJson(apiBase(config) + '/manga/get?mid=' + encodeURIComponent(mid) + '&mode=all&t=' + Date.now(), HEADERS(base));
      var chapters = ((j.data && j.data.chapters) || []).map(function (c) {
        return { id: mid + '@' + (c.id || c.chapter_id), title: (c.attributes && c.attributes.title) || c.title || '' };
      });
      if (!chapters.length) throw new Error('这部作品没有拿到章节');
      return {
        title: titleEl ? titleEl.textContent.trim() : '', author: meta.join(' · '),
        cover: coverEl ? absUrl(coverEl.getAttribute('src') || '', base) : '',
        tags: meta, desc: descEl ? descEl.textContent.trim() : '', chapters: chapters
      };
    },
    async getChapterPages(config, comicId, chapterId) {
      var base = srcBase(config);
      var at = String(chapterId).split('@');
      var mid = at[0], cid = at[1] || at[0];
      var j = await httpJson(apiBase(config) + '/chapter/getinfo?m=' + encodeURIComponent(mid) + '&c=' + encodeURIComponent(cid), HEADERS(base));
      var images = j.data && j.data.info && j.data.info.images;
      // v2.0.2 round 4: the API now wraps the encoded string as {images: "<encoded>"}.
      if (images && !Array.isArray(images) && typeof images === 'object' && images.images != null) images = images.images;
      if (typeof images === 'string') images = decodeChapterImages(images);
      if (images && !Array.isArray(images) && Array.isArray(images.images)) images = images.images;
      if (!images) images = (j.data && j.data.images) || [];
      var list = Array.isArray(images) ? images : [];
      if (!list.length) throw new Error('这一话没有拿到图片');
      var ib = imgBase(config);
      return list.map(function (it) {
        var u = typeof it === 'string' ? it : (it.url || '');
        return { url: chapterImageUrl(u, ib), kind: 'goda', referer: base };
      });
    },
    getProbeConfig(config) {
      return { testUrls: [srcBase(config) + '/s/' + encodeURIComponent('海贼王')], sampleCoverUrl: '' };
    }
  });
  // Exposed for the node unit test only.
  if (typeof window !== 'undefined') window.__godaDecode = decodeChapterImages;
})();
