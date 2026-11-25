/* adapters/dm5.js — 动漫屋 DM5 (normal, backup).
 * Written for this app (2026-11-25) from the live site:
 * search GET {base}/search?title={kw}&language=1&page={n}
 * (.banner_detail_form = best match, ul.mh-list .mh-item = the rest);
 * lists GET {base}/manhua-list[-area36|-area37]-pay0[-s2][-p{n}]/
 * (pay0 = the site's own "free" filter; area36 日韩, area37 大陆; s2 =
 * latest update, default = popularity); detail GET {base}/{id}/ with
 * ul.detail-list-select groups. Chapters showing .detail-lock are paid
 * and are dropped (paywallModel free_only). Chapter images come from
 * GET {base}/m{cid}/chapterfun.ashx?cid=&page=&key=&language=1&gtk=6
 * &_cid=&_mid=&_dt=&_sign= (values from the chapter page's DM5_* vars),
 * which answers a p.a.c.k.e.r script with ~2 image URLs per call; it is
 * unpacked here without eval. Image CDN (*.cdndm5.com) only serves with
 * the chapter page as Referer (box test 2026-11-25: 403 without or with
 * the site root, 200 with https://www.dm5.com/m{cid}/). Calls are made
 * one after another (no parallel burst). 5-method interface. */
'use strict';

(function () {
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  var AREA = { jp: '-area36', kr: '-area36', cn: '-area37' };
  function unpack(p, a, c, k) {
    function e(n) { return (n < a ? '' : e(parseInt(n / a, 10))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36)); }
    var d = {};
    while (c--) d[e(c)] = k[c] || e(c);
    return p.replace(/\b\w+\b/g, function (w) { return Object.prototype.hasOwnProperty.call(d, w) ? d[w] : w; });
  }
  function unpackScript(js) {
    var m = String(js).match(/\}\('((?:\\.|[^'\\])*)',(\d+),(\d+),'((?:\\.|[^'\\])*)'\.split\('\|'\)/);
    if (!m) return '';
    var p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    return unpack(p, Number(m[2]), Number(m[3]), m[4].split('|'));
  }
  function headers(referer) { return { 'User-Agent': UA, 'Referer': referer, 'Accept-Language': 'zh-CN,zh;q=0.9' }; }
  function idOf(href) {
    var m = String(href || '').match(/^\/?(manhua-[^/?#]+)\/?$/);
    return m ? m[1] : '';
  }
  function bgUrl(el) {
    var m = el && (el.getAttribute('style') || '').match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
    return m ? m[1] : '';
  }
  function parseCards(doc) {
    var out = [], seen = {};
    var best = doc.querySelector('.banner_detail_form');
    if (best) {
      var a0 = best.querySelector('.info .title a');
      var id0 = a0 && idOf(a0.getAttribute('href'));
      if (id0) {
        var authors = [];
        best.querySelectorAll('.subtitle a').forEach(function (a) { authors.push(a.textContent.trim()); });
        var tags0 = [];
        best.querySelectorAll('.tip a').forEach(function (a) { tags0.push(a.textContent.trim()); });
        var img0 = best.querySelector('.cover img');
        seen[id0] = true;
        out.push({ id: id0, title: (a0.getAttribute('title') || a0.textContent).trim(), author: authors.join(' / '),
          cover: img0 ? img0.getAttribute('src') || '' : '', coverKind: 'dm5', coverReferer: 'https://www.dm5.com/', coverUa: UA,
          tags: tags0, desc: ((best.querySelector('.content') || {}).textContent || '').trim() });
      }
    }
    doc.querySelectorAll('.mh-item').forEach(function (card) {
      var a = card.querySelector('.title a');
      var id = a && idOf(a.getAttribute('href'));
      if (!id || seen[id]) return;
      seen[id] = true;
      var img = card.querySelector('img');
      var state = card.querySelector('.chapter span');
      out.push({ id: id, title: (a.getAttribute('title') || a.textContent).trim(), author: '',
        cover: bgUrl(card.querySelector('.mh-cover')) || (img && img.getAttribute('src')) || '',
        coverKind: 'dm5', coverReferer: 'https://www.dm5.com/', coverUa: UA,
        tags: state ? [state.textContent.trim()] : [] });
    });
    return out;
  }
  function chapterName(a) {
    var holder = a.querySelector('p.title') || a;
    var text = '';
    holder.childNodes.forEach(function (n) { if (n.nodeType === 3) text += n.textContent; });
    return (text.trim() || a.getAttribute('title') || holder.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function pageVar(html, name) {
    var m = html.match(new RegExp('var\\s+' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^;\\s]+))'));
    return m ? (m[2] ?? m[3] ?? m[4]) : '';
  }
  registerVeneraAdapter('dm5', {
    supportsCategory: function (config, category) { return category === 'all' || Boolean(AREA[category]); },
    supportsHot: true,
    supportsSearchPagination: true,
    chapterOrder: 'asc',
    async getCategoryList(config, category, sort, page) {
      var base = srcBase(config);
      var path = '/manhua-list' + (AREA[category] || '') + '-pay0' + (sort === 'hot' ? '' : '-s2') + ((page || 1) > 1 ? '-p' + page : '') + '/';
      var doc = parseHtml(await httpText(base + path, headers(base + '/')));
      var items = parseCards(doc);
      return { items: items, hasMore: items.length >= 20 };
    },
    async search(config, keyword, page) {
      var base = srcBase(config);
      var doc = parseHtml(await httpText(base + '/search?title=' + encodeURIComponent(keyword) + '&language=1&page=' + (page || 1), headers(base + '/')));
      var items = parseCards(doc);
      var next = Array.prototype.some.call(doc.querySelectorAll('.page-pagination a, .page a'), function (a) {
        return new RegExp('[?&]page=' + ((page || 1) + 1) + '(?:&|$)').test(a.getAttribute('href') || '');
      });
      return { items: items, hasMore: next };
    },
    async getComicDetail(config, comicId) {
      var base = srcBase(config);
      var doc = parseHtml(await httpText(base + '/' + comicId + '/', headers(base + '/')));
      var info = doc.querySelector('.banner_detail_form');
      var title = info && info.querySelector('.info .title');
      var authors = [], tags = [];
      if (info) {
        info.querySelectorAll('.subtitle a').forEach(function (a) { authors.push(a.textContent.trim()); });
        info.querySelectorAll('.tip a').forEach(function (a) { tags.push(a.textContent.trim()); });
      }
      var titles = {};
      doc.querySelectorAll('.detail-list-title a.block').forEach(function (a) {
        var m = (a.getAttribute('onclick') || '').match(/'(detail-list-select-\d+)'/);
        if (m) titles[m[1]] = a.childNodes[0] ? a.childNodes[0].textContent.trim() : '';
      });
      var lists = doc.querySelectorAll('ul.detail-list-select');
      var chapters = [], seen = {}, paid = 0;
      lists.forEach(function (ul) {
        var group = titles[ul.id] || '';
        var part = [];
        ul.querySelectorAll('li').forEach(function (li) {
          var a = li.querySelector('a[href]');
          var m = a && (a.getAttribute('href') || '').match(/^\/m(\d+)\/?$/);
          if (!m || seen[m[1]]) return;
          seen[m[1]] = true;
          if (li.querySelector('.detail-lock')) { paid++; return; }
          var name = chapterName(a);
          part.push({ id: m[1], title: lists.length > 1 && group ? group + ' · ' + name : name, group: group });
        });
        chapters = chapters.concat(part.reverse());
      });
      if (!chapters.length) throw new Error(paid ? '这部作品的章节都需要付费，已按免费策略跳过' : '这部作品没有拿到章节');
      var desc = info && info.querySelector('.content');
      return {
        title: title ? (title.childNodes[0] ? title.childNodes[0].textContent : title.textContent).trim() : '',
        author: authors.join(' / '),
        meta: (authors.length ? '作者：' + authors.join(' / ') : '') + (paid ? '　已隐藏 ' + paid + ' 话付费章节' : ''),
        tags: tags, desc: desc ? desc.textContent.replace(/\s+/g, ' ').replace(/\[-折叠\]|\[\+展开\]/g, '').trim() : '',
        chapters: chapters
      };
    },
    async getChapterPages(config, comicId, chapterId) {
      var base = srcBase(config);
      var chapterUrl = base + '/m' + chapterId + '/';
      var html = await httpText(chapterUrl, headers(base + '/' + comicId + '/'));
      var count = Number(pageVar(html, 'DM5_IMAGE_COUNT')) || 0;
      var mid = pageVar(html, 'DM5_MID'), cid = pageVar(html, 'DM5_CID') || chapterId;
      var sign = pageVar(html, 'DM5_VIEWSIGN'), dt = pageVar(html, 'DM5_VIEWSIGN_DT');
      if (!count || !mid) throw new Error('动漫屋章节页格式变了');
      var urls = [], seen = {}, page = 1, guard = 0;
      while (urls.length < count && guard++ < count + 5) {
        var api = chapterUrl + 'chapterfun.ashx?cid=' + cid + '&page=' + page + '&key=&language=1&gtk=6&_cid=' + cid
          + '&_mid=' + mid + '&_dt=' + encodeURIComponent(dt) + '&_sign=' + sign;
        var text = unpackScript(await httpText(api, Object.assign(headers(chapterUrl), { 'X-Requested-With': 'XMLHttpRequest' })));
        var pix = (text.match(/var\s+pix\s*=\s*"([^"]*)"/) || [])[1] || '';
        var list = (text.match(/var\s+pvalue\s*=\s*\[([^\]]*)\]/) || [])[1];
        var key = (text.match(/var\s+key\s*=\s*'([^']*)'/) || [])[1] || '';
        if (!list) break;
        var batch = list.split(',').map(function (s) { return s.trim().replace(/^"|"$/g, ''); }).filter(Boolean);
        if (!batch.length) break;
        var added = 0;
        batch.forEach(function (p) {
          var u = /^(https?:)?\/\//i.test(p) ? p : pix + p + '?cid=' + cid + '&key=' + key;
          var name = p.split('?')[0];
          if (seen[name]) return;
          seen[name] = true;
          urls.push(u);
          added++;
        });
        if (!added) break;
        page += added;
      }
      if (!urls.length) throw new Error('这一话没有拿到图片（可能是付费章节）');
      return urls.slice(0, count).map(function (u) { return { url: u, kind: 'dm5', referer: chapterUrl, ua: UA }; });
    },
    getProbeConfig(config) {
      return { testUrls: [srcBase(config) + '/manhua-list-pay0/'], sampleCoverUrl: '' };
    }
  });
})();
