/* adapters/mycomic.js — MYCOMIC (normal, backup).
 * Protocol: venera-app/venera-configs mycomic.js (GPL-3.0).
 * Base https://mycomic.com/cn, images https://biccam.com, Referer
 * https://mycomic.com/. ANTI-BOT WARNING: the site sits behind
 * Cloudflare; a 403/503 challenge page surfaces as proxy error 521
 * and the frontend offers the WebView challenge dialog (cf_clearance
 * Cookie). Search GET {base}/comics?q={kw}&sort=-update; detail
 * GET {base}/comics/{id} (chapters from the page's Alpine.js x-data
 * JSON, fallback: a[href*='/cn/chapters/']); pages
 * GET {base}/chapters/{epId}, only img.page with biccam.com/chapters/.
 * 5-method interface (v2.2 §4.4). */
'use strict';

(function () {
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  var HEADERS = { 'User-Agent': UA, 'Referer': 'https://mycomic.com/' };
  var COUNTRY = { all: '', jp: 'japan', kr: 'korea', cn: 'china' };
  function parseList(doc, base) {
    var out = [], seen = Object.create(null);
    doc.querySelectorAll("a[href*='/cn/comics/']").forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var m = href.match(/\/cn\/comics\/(\d+)/);
      if (!m) return;
      if (seen[m[1]]) return;
      var img = a.querySelector('img[data-src], img[src]');
      var cover = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
      if (cover && cover.indexOf('biccam.com/comics/') < 0) cover = '';
      if (!cover) return;
      seen[m[1]] = true;
      var descEl = a.querySelector('div.truncate');
      out.push({
        id: m[1], title: img ? (img.getAttribute('alt') || '') : '',
        cover: cover ? absUrl(cover, base) : '', coverKind: 'mycomic',
        coverReferer: 'https://mycomic.com/', author: '',
        tags: [], desc: descEl ? descEl.textContent.trim() : ''
      });
    });
    return out;
  }
  function maxPage(html) {
    var matches = String(html || '').match(/(?:href="[^"]*page=)(\d+)/g) || [];
    var max = 1;
    matches.forEach(function (match) {
      var page = Number(match.replace(/^.*page=/, ''));
      if (page > max) max = page;
    });
    return max;
  }
  registerVeneraAdapter('mycomic', {
    async getCategoryList(config, category, sort, page) {
      var base = srcBase(config);
      page = page || 1;
      var order = sort === 'hot' ? '-views' : '-update';
      var url = base + '/comics?sort=' + order + '&page=' + page;
      var c = COUNTRY[category];
      if (c) url += '&filter%5Bcountry%5D=' + c;
      var html = await httpText(url, HEADERS);
      return { items: parseList(parseHtml(html), base), hasMore: page < maxPage(html) };
    },
    async search(config, keyword, page) {
      var base = srcBase(config);
      keyword = String(keyword || '').trim();
      if (!keyword) return { items: [], hasMore: false };
      page = page || 1;
      var url = base + '/comics?q=' + encodeURIComponent(keyword) + '&sort=-update';
      if (page > 1) url += '&page=' + page;
      var html = await httpText(url, HEADERS);
      return { items: parseList(parseHtml(html), base), hasMore: page < maxPage(html) };
    },
    async getComicDetail(config, comicId) {
      var base = srcBase(config);
      var html = await httpText(base + '/comics/' + comicId, HEADERS);
      var doc = parseHtml(html);
      function meta(name) {
        var el = doc.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
        return el ? (el.getAttribute('content') || '') : '';
      }
      var title = (meta('og:title') || '').replace(/ - MYCOMIC$/, '');
      var cover = meta('og:image') || ('https://biccam.com/comics/' + comicId + '.jpg');
      var tags = [];
      doc.querySelectorAll("a[href*='filter%5Btag%5D']").forEach(function (a) { tags.push(a.textContent.trim()); });
      var chapters = [];
      var m = html.match(/chapters:\s*(\[[\s\S]*?\])/);
      if (m) {
        try {
          JSON.parse(m[1]).forEach(function (c) { chapters.push({ id: String(c.id), title: c.title || '' }); });
        } catch (e) { /* fall through */ }
      }
      if (!chapters.length) {
        doc.querySelectorAll("a[href*='/cn/chapters/']").forEach(function (a) {
          var hm = (a.getAttribute('href') || '').match(/\/cn\/chapters\/(\d+)/);
          if (hm) chapters.push({ id: hm[1], title: (a.textContent || '').trim() });
        });
      }
      if (!chapters.length) throw new Error('这部作品没有拿到章节');
      return {
        title: title, author: meta('author') || '', cover: cover, coverKind: 'mycomic',
        coverReferer: 'https://mycomic.com/', tags: tags,
        desc: meta('description') || '', chapters: chapters
      };
    },
    async getChapterPages(config, comicId, chapterId) {
      var base = srcBase(config);
      var html = await httpText(base + '/chapters/' + chapterId, HEADERS);
      var doc = parseHtml(html);
      var urls = [];
      doc.querySelectorAll('img.page').forEach(function (im) {
        var u = im.getAttribute('data-src') || im.getAttribute('src') || '';
        if (u.indexOf('biccam.com/chapters/') >= 0) urls.push(absUrl(u, base));
      });
      if (!urls.length) {
        doc.querySelectorAll('img').forEach(function (im) {
          var u = im.getAttribute('data-src') || im.getAttribute('src') || '';
          if (u.indexOf('biccam.com/chapters/') >= 0) urls.push(absUrl(u, base));
        });
      }
      if (!urls.length) throw new Error('这一话没有拿到图片');
      return urls.map(function (u) { return { url: u, kind: 'mycomic', referer: 'https://mycomic.com/' }; });
    },
    getProbeConfig(config) {
      return { testUrls: [srcBase(config) + '/comics?q=' + encodeURIComponent('海贼王') + '&sort=-update'], sampleCoverUrl: '' };
    },
    supportsCategory: function (_config, category) { return Object.prototype.hasOwnProperty.call(COUNTRY, category); },
    supportsHot: true,
    supportsSearchPagination: true,
    supportsListPagination: true
  });
})();
