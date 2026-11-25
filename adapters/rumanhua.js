/* adapters/rumanhua.js — 如漫画 RuManHua (normal, backup, OFF by default).
 * NOT LIVE-TESTED: from the box (outside mainland China) www.rumanhua.com
 * answers 301 -> http://www.rumanhua2.com/, which answers HTTP 500 with
 * an empty body (2026-11-25). Page structure and the image decoding are
 * taken from deretame/Breeze-plugin-RuManHua (src/common.ts, targets
 * rumanhua2.com) and cross-checked only against the public page text
 * of www.rumanhua.com/rank/5 (same 6 ranking boards). Protocol:
 * search POST {base}/s  k={kw}  (.col-auto cards); lists GET
 * {base}/rank/{1..6} (.likedata; 5 = 最近更新, 2 = 人气榜, no paging);
 * detail GET {base}/{id}/ (h1.name_mh, .chapterlistload a) + older
 * chapters POST {base}/morechapter id={id} (JSON {code:"200",data:[{chapterid,chaptername}]});
 * chapter GET {base}/{id}/{cid}.html: a p.a.c.k.e.r script defines
 * var __c0rst96="..." (base64); XOR with the key picked by
 * .readerContainer[data-id], then base64 again -> JSON array of image
 * URLs. This is the site's own client-side obfuscation (not AES in the
 * current Breeze code), unpacked here without eval. 5-method interface. */
'use strict';

(function () {
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  var IMAGE_KEYS = ['smkhy258', 'smkd95fv', 'md496952', 'cdcsdwq', 'vbfsa256', 'cawf151c', 'cd56cvda', '8kihnt9', 'dso15tlo', '5ko6plhy'];
  function unpack(p, a, c, k) {
    function e(n) { return (n < a ? '' : e(parseInt(n / a, 10))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36)); }
    var d = {};
    while (c--) d[e(c)] = k[c] || e(c);
    return p.replace(/\b\w+\b/g, function (w) { return Object.prototype.hasOwnProperty.call(d, w) ? d[w] : w; });
  }
  function unpackScript(js) {
    var m = String(js).match(/\}\('((?:\\.|[^'\\])*)',\s*(\d+),\s*(\d+),\s*'((?:\\.|[^'\\])*)'\.split\('\|'\)/);
    if (!m) return '';
    var p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    return unpack(p, Number(m[2]), Number(m[3]), m[4].split('|'));
  }
  function decryptImages(cipher, readerId) {
    var key = IMAGE_KEYS[readerId];
    if (!key) throw new Error('如漫画图片密钥表不认识 data-id ' + readerId);
    var raw = atob(cipher), x = '';
    for (var i = 0; i < raw.length; i++) x += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    var bin = atob(x), bytes = new Uint8Array(bin.length);
    for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function headers(referer) { return { 'User-Agent': UA, 'Referer': referer, 'Accept-Language': 'zh-CN,zh;q=0.9' }; }
  function idOf(href) { return String(href || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '').replace(/\/$/, ''); }
  function card(id, title, cover, author, base) {
    return { id: id, title: title, author: author || '', cover: cover ? absUrl(cover, base + '/') : '',
      coverKind: 'rumanhua', coverReferer: base + '/', coverUa: UA, tags: [] };
  }
  function parseSearch(doc, base) {
    var out = [];
    doc.querySelectorAll('.col-auto').forEach(function (el) {
      var a = el.querySelector('a[href]');
      var id = a && idOf(a.getAttribute('href'));
      if (!id || /[/?]/.test(id)) return;
      var img = el.querySelector('img');
      var title = (el.querySelector('.e-title') || {}).textContent || (img && img.getAttribute('alt')) || '';
      out.push(card(id, title.trim(), img && (img.getAttribute('data-src') || img.getAttribute('src')), ((el.querySelector('.tip') || {}).textContent || '').trim(), base));
    });
    return out;
  }
  function parseRank(doc, base) {
    var out = [];
    doc.querySelectorAll('.likedata').forEach(function (el) {
      var a = el.querySelector('.likeimg a[href]');
      var id = a && idOf(a.getAttribute('href'));
      if (!id || /[/?]/.test(id)) return;
      var img = el.querySelector('.likeimg img');
      var title = ((el.querySelector('.le-t') || {}).textContent || (img && (img.getAttribute('alt') || img.getAttribute('title'))) || '').trim();
      var author = '';
      el.querySelectorAll('.likeinfo p').forEach(function (p) { var t = p.textContent.trim(); if (!author && t.indexOf('作者：') === 0) author = t.slice(3).trim(); });
      out.push(card(id, title, img && (img.getAttribute('data-src') || img.getAttribute('src')), author, base));
    });
    return out;
  }
  function spanAfter(doc, label) {
    var re = new RegExp(label.split('').join('\\s*') + '\\s*[：:]\\s*(.+?)\\s*$');
    var hit = '';
    doc.querySelectorAll('span').forEach(function (s) { if (!hit) { var m = s.textContent.trim().match(re); if (m) hit = m[1].trim(); } });
    return hit;
  }
  registerVeneraAdapter('rumanhua', {
    supportsCategory: function (config, category) { return category === 'all'; },
    supportsHot: true,
    supportsSearchPagination: false,
    supportsListPagination: false,
    chapterOrder: 'asc',
    async getCategoryList(config, category, sort, page) {
      var base = srcBase(config);
      if ((page || 1) > 1) return { items: [], hasMore: false };
      var doc = parseHtml(await httpText(base + '/rank/' + (sort === 'hot' ? '2' : '5'), headers(base + '/')));
      return { items: parseRank(doc, base), hasMore: false };
    },
    async search(config, keyword, page) {
      var base = srcBase(config);
      if ((page || 1) > 1) return { items: [], hasMore: false };
      var html = await httpPostForm(base + '/s', 'k=' + encodeURIComponent(keyword), headers(base + '/'));
      return { items: parseSearch(parseHtml(html), base), hasMore: false };
    },
    async getComicDetail(config, comicId) {
      var base = srcBase(config);
      var doc = parseHtml(await httpText(base + '/' + comicId + '/', headers(base + '/')));
      var list = [], seen = {};
      function add(id, name) {
        id = String(id || '').trim(); name = String(name || '').trim();
        if (!id || !name || seen[id]) return;
        seen[id] = true;
        list.push({ id: id, title: name });
      }
      doc.querySelectorAll('.chapterlistload a[href]').forEach(function (a) {
        var m = (a.getAttribute('href') || '').match(/\/([^/]+)\.html(?:\?.*)?$/);
        if (m) add(m[1], ((a.querySelector('li') || a).textContent || '').replace(/\s+/g, ' '));
      });
      try {
        var more = JSON.parse(await httpPostForm(base + '/morechapter', 'id=' + encodeURIComponent(comicId), headers(base + '/' + comicId + '/')));
        if (String(more.code) === '200') (more.data || []).forEach(function (c) { add(c.chapterid, c.chaptername); });
      } catch (e) { /* older chapters are optional */ }
      if (!list.length) throw new Error('这部作品没有拿到章节');
      var tagsText = spanAfter(doc, '标签');
      var author = spanAfter(doc, '作者');
      var title = doc.querySelector('h1.name_mh');
      var desc = doc.querySelector('p.content');
      return {
        title: title ? title.textContent.trim() : '', author: author,
        meta: (author ? '作者：' + author : '') + (spanAfter(doc, '状态') ? '　' + spanAfter(doc, '状态') : ''),
        tags: tagsText ? tagsText.split(/\s+/).filter(Boolean) : [],
        desc: desc ? desc.textContent.replace(/\s+/g, ' ').trim() : '',
        chapters: list.reverse()
      };
    },
    async getChapterPages(config, comicId, chapterId) {
      var base = srcBase(config);
      var html = await httpText(base + '/' + comicId + '/' + chapterId + '.html', headers(base + '/' + comicId + '/'));
      var reader = html.match(/class="readerContainer"[^>]*data-id="(\d+)"/);
      if (!reader) throw new Error('如漫画章节页格式变了（没有 readerContainer）');
      var start = html.indexOf('eval(function(p,a,c,k,e,d)');
      var text = start >= 0 ? unpackScript(html.slice(start)) : '';
      var cipher = (text.match(/var\s+__c0rst96\s*=\s*"([^"]*)"/) || [])[1];
      if (!cipher) throw new Error('如漫画章节页没有找到图片数据');
      var urls = decryptImages(cipher, Number(reader[1]));
      if (!Array.isArray(urls) || !urls.length) throw new Error('这一话没有拿到图片');
      return urls.map(function (u) { return { url: absUrl(u, base + '/'), kind: 'rumanhua', referer: base + '/', ua: UA }; });
    },
    getProbeConfig(config) {
      return { testUrls: [srcBase(config) + '/rank/5'], sampleCoverUrl: '' };
    }
  });
})();
