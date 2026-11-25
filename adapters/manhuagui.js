/* adapters/manhuagui.js — 漫画柜 ManHuaGui (normal, backup).
 * Protocol notes follow venera-app/venera-configs manhuagui.js (GPL-3.0):
 * search GET {base}/s/{kw}_p{page}.html (li.cf), list GET
 * {base}/list/{region/}{update|view}_p{page}.html (#contList li), detail
 * GET {base}/comic/{id}/ (.chapter-list li a), chapter GET
 * {base}/comic/{id}/{cid}.html. The chapter's image list is a
 * p.a.c.k.e.r script whose word table is LZString base64; it is decoded
 * here WITHOUT eval (lzDecompressFromBase64 + unpack). Images live on
 * {i,us,eu}.hamreus.com and are only served with the Referer
 * https://www.manhuagui.com/ (box test 2026-11-25: 403 without, 200 with).
 * Comics carrying the site's #checkAdult warning are marked isAdult, so
 * the engine's normal-zone filter refuses them (no adult zone entry).
 * The site is known to ban IPs that request too fast: no parallel page
 * fetches here, one HTML request per chapter. 5-method interface. */
'use strict';

(function () {
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  var REFERER = 'https://www.manhuagui.com/';
  var IMG_HOSTS = ['https://i.hamreus.com', 'https://us.hamreus.com', 'https://eu.hamreus.com'];
  var REGION = { jp: 'japan', kr: 'korea', cn: 'china' };
  function lzDecompressFromBase64(input) {
    if (input == null || input === '') return '';
    var KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    var rev = {};
    for (var q = 0; q < KEY.length; q++) rev[KEY.charAt(q)] = q;
    var length = input.length, resetValue = 32;
    var getNext = function (i) { return rev[input.charAt(i)]; };
    var dictionary = [], enlargeIn = 4, dictSize = 4, numBits = 3, entry = '', result = [], w, c, bits, resb, maxpower, power;
    var data = { val: getNext(0), position: resetValue, index: 1 };
    function readBits(n) {
      var b = 0, mp = Math.pow(2, n), p = 1;
      while (p != mp) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position == 0) { data.position = resetValue; data.val = getNext(data.index++); }
        b |= (resb > 0 ? 1 : 0) * p;
        p <<= 1;
      }
      return b;
    }
    for (var i = 0; i < 3; i++) dictionary[i] = i;
    var next = readBits(2);
    switch (next) {
      case 0: c = String.fromCharCode(readBits(8)); break;
      case 1: c = String.fromCharCode(readBits(16)); break;
      case 2: return '';
    }
    dictionary[3] = c; w = c; result.push(c);
    while (true) {
      if (data.index > length) return '';
      c = readBits(numBits);
      switch (c) {
        case 0: dictionary[dictSize++] = String.fromCharCode(readBits(8)); c = dictSize - 1; enlargeIn--; break;
        case 1: dictionary[dictSize++] = String.fromCharCode(readBits(16)); c = dictSize - 1; enlargeIn--; break;
        case 2: return result.join('');
      }
      if (enlargeIn == 0) { enlargeIn = Math.pow(2, numBits); numBits++; }
      if (dictionary[c]) entry = dictionary[c];
      else if (c === dictSize) entry = w + w.charAt(0);
      else return null;
      result.push(entry);
      dictionary[dictSize++] = w + entry.charAt(0);
      enlargeIn--;
      w = entry;
      if (enlargeIn == 0) { enlargeIn = Math.pow(2, numBits); numBits++; }
    }
  }
  function unpack(p, a, c, k) {
    function e(n) { return (n < a ? '' : e(parseInt(n / a, 10))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36)); }
    var d = {};
    while (c--) d[e(c)] = k[c] || e(c);
    return p.replace(/\b\w+\b/g, function (w) { return Object.prototype.hasOwnProperty.call(d, w) ? d[w] : w; });
  }
  function headers(base) { return { 'User-Agent': UA, 'Referer': (base || REFERER).replace(/\/?$/, '/'), 'Accept-Language': 'zh-CN,zh;q=0.9' }; }
  function cover(src) {
    if (!src) return '';
    return src.indexOf('//') === 0 ? 'https:' + src : src;
  }
  function item(a, img, extra) {
    var href = a.getAttribute('href') || '';
    var m = href.match(/\/comic\/(\d+)\//);
    if (!m) return null;
    return Object.assign({
      id: m[1], title: (a.getAttribute('title') || a.textContent || '').trim(), author: '',
      cover: cover(img && (img.getAttribute('src') || img.getAttribute('data-src'))),
      coverKind: 'manhuagui', coverReferer: REFERER, coverUa: UA, tags: []
    }, extra || {});
  }
  function parseList(doc) {
    var out = [];
    doc.querySelectorAll('#contList > li').forEach(function (li) {
      var a = li.querySelector('a.bcover');
      if (!a) return;
      var tt = li.querySelector('.tt');
      var it = item(a, a.querySelector('img'), { badge: tt ? tt.textContent.trim() : '' });
      if (it) out.push(it);
    });
    return out;
  }
  function parseSearch(doc) {
    var out = [];
    doc.querySelectorAll('.book-result li.cf').forEach(function (li) {
      var a = li.querySelector('a.bcover');
      if (!a) return;
      var tags = [];
      li.querySelectorAll('dd.tags a[href^="/list/"]').forEach(function (t) { tags.push(t.textContent.trim()); });
      var author = [];
      li.querySelectorAll('dd.tags a[href^="/author/"]').forEach(function (t) { author.push(t.textContent.trim()); });
      var tt = li.querySelector('.tt');
      var intro = li.querySelector('dd.intro');
      var it = item(a, a.querySelector('img'), {
        author: author.join(' / '), tags: tags, badge: tt ? tt.textContent.trim() : '',
        desc: intro ? intro.textContent.replace(/^\s*简介：|^\s*簡介：/, '').trim() : ''
      });
      if (it) out.push(it);
    });
    return out;
  }
  function decodeImages(html) {
    var m = html.match(/\}\('((?:\\.|[^'\\])*)',(\d+),(\d+),'([^']*)'\[/);
    if (!m) throw new Error('漫画柜章节页没有找到图片数据');
    var payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    var words = lzDecompressFromBase64(m[4]);
    if (!words) throw new Error('漫画柜图片数据解码失败');
    var text = unpack(payload, Number(m[2]), Number(m[3]), words.split('|'));
    var start = text.indexOf('imgData(');
    var end = text.lastIndexOf(').preInit');
    if (start < 0 || end < 0) throw new Error('漫画柜图片数据格式变了');
    return JSON.parse(text.slice(start + 8, end));
  }
  registerVeneraAdapter('manhuagui', {
    supportsCategory: function (config, category) { return category === 'all' || Boolean(REGION[category]); },
    supportsHot: true,
    supportsSearchPagination: true,
    chapterOrder: 'asc',
    async getCategoryList(config, category, sort, page) {
      var base = srcBase(config);
      var region = REGION[category] ? REGION[category] + '/' : '';
      var url = base + '/list/' + region + (sort === 'hot' ? 'view' : 'update') + '_p' + (page || 1) + '.html';
      var doc = parseHtml(await httpText(url, headers(base)));
      var items = parseList(doc);
      return { items: items, hasMore: items.length > 0 && Boolean(doc.querySelector('#AspNetPager1 a.prev, .pager a.next, .pager a.prev')) };
    },
    async search(config, keyword, page) {
      var base = srcBase(config);
      var doc = parseHtml(await httpText(base + '/s/' + encodeURIComponent(keyword) + '_p' + (page || 1) + '.html', headers(base)));
      var items = parseSearch(doc);
      var count = doc.querySelectorAll('.result-count strong');
      var total = count.length > 1 ? Number(count[1].textContent) : items.length;
      return { items: items, hasMore: (page || 1) * 10 < total };
    },
    async getComicDetail(config, comicId) {
      var base = srcBase(config);
      var doc = parseHtml(await httpText(base + '/comic/' + comicId + '/', headers(base)));
      var title = doc.querySelector('.book-title h1');
      var intro = doc.querySelector('#intro-all') || doc.querySelector('#intro-cut');
      var tags = [], author = [];
      doc.querySelectorAll('.detail-list a[href^="/list/"]').forEach(function (a) { tags.push(a.textContent.trim()); });
      doc.querySelectorAll('.detail-list a[href^="/author/"]').forEach(function (a) { author.push(a.textContent.trim()); });
      var status = doc.querySelector('.detail-list .status');
      var adult = Boolean(doc.querySelector('#checkAdult'));
      var chapters = [], seen = {};
      var groups = doc.querySelectorAll('.chapter h4');
      doc.querySelectorAll('.chapter-list').forEach(function (list, gi) {
        var group = groups[gi] ? groups[gi].textContent.trim() : '';
        var part = [];
        list.querySelectorAll('li a[href]').forEach(function (a) {
          var m = (a.getAttribute('href') || '').match(/\/comic\/\d+\/(\d+)\.html/);
          if (!m || seen[m[1]]) return;
          seen[m[1]] = true;
          var span = a.querySelector('span');
          var name = (a.getAttribute('title') || (span ? span.firstChild && span.firstChild.textContent : a.textContent) || '').trim();
          part.push({ id: m[1], title: group && groups.length > 1 ? group + ' · ' + name : name, group: group });
        });
        part.sort(function (x, y) { return Number(x.id) - Number(y.id); });
        chapters = chapters.concat(part);
      });
      if (!chapters.length && !adult) throw new Error('这部作品没有拿到章节');
      if (!chapters.length) chapters = [{ id: '0', title: '' }];
      return {
        title: title ? title.textContent.trim() : '', author: author.join(' / '),
        meta: (author.length ? '作者：' + author.join(' / ') : '') + (status ? '　' + status.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : ''),
        tags: tags, desc: intro ? intro.textContent.trim() : '', isAdult: adult,
        chapters: chapters
      };
    },
    async getChapterPages(config, comicId, chapterId) {
      var base = srcBase(config);
      var html = await httpText(base + '/comic/' + comicId + '/' + chapterId + '.html', headers(base + '/comic/' + comicId + '/'));
      var info = decodeImages(html);
      var files = info.files || [];
      if (!files.length) throw new Error('这一话没有拿到图片');
      var host = config.imageHost || IMG_HOSTS[0];
      var sl = info.sl || {};
      var query = sl.e ? '?e=' + encodeURIComponent(sl.e) + '&m=' + encodeURIComponent(sl.m || '') : '';
      var path = encodeURI(info.path || '');
      return files.map(function (f) { return { url: host + path + f + query, kind: 'manhuagui', referer: REFERER, ua: UA }; });
    },
    getProbeConfig(config) {
      return { testUrls: [srcBase(config) + '/list/update_p1.html'], sampleCoverUrl: '' };
    }
  });
})();
