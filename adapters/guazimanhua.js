/* adapters/guazimanhua.js — 瓜子漫画 (normal, backup).
 * Written for this app (2026-11-25) from the live site, plain HTML:
 * search GET {base}/category.php?keyword={kw}&page={n} (article.card);
 * lists GET {base}/category.php?sort=update|hits[&city=338|78]&page={n}
 * (city 338 国漫, 78 日韩 — the site has no separate jp / kr filter);
 * detail GET {base}/comic.php?id={id} ([data-chapter-list] a, newest
 * first; the JSON-LD list is capped at 50 so it is not used); chapter
 * GET {base}/chapter.php?id={cid} (img.reading-image). Images on
 * img.guazicdn.com load without Referer (box test 2026-11-25), the
 * site Referer is still sent. No paid chapters, but the newest chapter
 * can be an "APP 专享" gate page: reported as an error, not bypassed.
 * 5-method interface. */
'use strict';

(function () {
  var UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  var CITY = { cn: '338', jp: '78', kr: '78' };
  function headers(base) { return { 'User-Agent': UA, 'Referer': base.replace(/\/?$/, '/'), 'Accept-Language': 'zh-CN,zh;q=0.9' }; }
  function absCover(u, base) {
    if (!u) return '';
    try { return new URL(u, base.replace(/\/?$/, '/')).href; } catch (e) { return u; }
  }
  function idOf(href) {
    var m = String(href || '').match(/comic\.php\?id=(\d+)/);
    return m ? m[1] : '';
  }
  function parseCards(doc, base) {
    var out = [], seen = {};
    doc.querySelectorAll('article.card').forEach(function (card) {
      var a = card.querySelector('h3 a') || card.querySelector('a.cover-wrap');
      var id = a && idOf(a.getAttribute('href'));
      if (!id || seen[id]) return;
      seen[id] = true;
      var img = card.querySelector('img');
      var meta = card.querySelector('.meta');
      var parts = meta ? meta.textContent.split('·').map(function (s) { return s.trim(); }).filter(Boolean) : [];
      var state = card.querySelector('.genre');
      out.push({ id: id, title: a.textContent.trim() || (img && (img.getAttribute('alt') || '').replace(/漫画封面$/, '')) || '',
        author: parts[0] || '', cover: img ? absCover(img.getAttribute('data-src') || img.getAttribute('src') || '', base) : '',
        coverKind: 'guazimanhua', coverReferer: base.replace(/\/?$/, '/'), coverUa: UA,
        tags: parts.slice(1).concat(state ? [state.textContent.trim()] : []) });
    });
    return out;
  }
  function hasNext(doc, page) {
    return Array.prototype.some.call(doc.querySelectorAll('nav.pager a'), function (a) {
      return new RegExp('[?&]page=' + (page + 1) + '(?:&|$)').test(a.getAttribute('href') || '');
    });
  }
  registerVeneraAdapter('guazimanhua', {
    supportsCategory: function (config, category) { return category === 'all' || Boolean(CITY[category]); },
    supportsHot: true,
    supportsSearchPagination: true,
    chapterOrder: 'asc',
    async getCategoryList(config, category, sort, page) {
      var base = srcBase(config);
      page = page || 1;
      var url = base + '/category.php?sort=' + (sort === 'hot' ? 'hits' : 'update') + (CITY[category] ? '&city=' + CITY[category] : '') + '&page=' + page;
      var doc = parseHtml(await httpText(url, headers(base)));
      return { items: parseCards(doc, base), hasMore: hasNext(doc, page) };
    },
    async search(config, keyword, page) {
      var base = srcBase(config);
      page = page || 1;
      var doc = parseHtml(await httpText(base + '/category.php?keyword=' + encodeURIComponent(keyword) + '&page=' + page, headers(base)));
      return { items: parseCards(doc, base), hasMore: hasNext(doc, page) };
    },
    async getComicDetail(config, comicId) {
      var base = srcBase(config);
      var html = await httpText(base + '/comic.php?id=' + encodeURIComponent(comicId), headers(base));
      var doc = parseHtml(html);
      var story = null;
      doc.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
        try {
          var j = JSON.parse(s.textContent);
          (j['@graph'] || [j]).forEach(function (g) { if (g && g['@type'] === 'ComicStory') story = g; });
        } catch (e) { /* ignore broken JSON-LD */ }
      });
      var chapters = [], seen = {};
      var grid = doc.querySelector('[data-chapter-list]') || doc.querySelector('[data-mobile-chapter-list]');
      (grid ? grid.querySelectorAll('a[href]') : []).forEach(function (a) {
        var m = (a.getAttribute('href') || '').match(/chapter\.php\?id=(\d+)/);
        if (!m || seen[m[1]]) return;
        seen[m[1]] = true;
        chapters.push({ id: m[1], title: a.textContent.replace(/\s+/g, ' ').replace(/阅读$/, '').trim() });
      });
      chapters.reverse();
      if (!chapters.length) throw new Error('这部作品没有拿到章节');
      var title = doc.querySelector('.mobile-comic-title') || doc.querySelector('h1');
      var author = story && story.author ? (Array.isArray(story.author) ? story.author : [story.author]).map(function (a) { return a.name; }).join(' / ') : '';
      var meta = doc.querySelector('.mobile-comic-meta');
      return {
        title: story ? story.name : (title ? title.textContent.trim() : ''),
        author: author,
        meta: (author ? '作者：' + author : '') + (meta ? '　' + meta.textContent.replace(/\s+/g, '').trim() : ''),
        tags: story && Array.isArray(story.genre) ? story.genre : [],
        desc: story ? story.description || '' : '',
        chapters: chapters
      };
    },
    async getChapterPages(config, comicId, chapterId) {
      var base = srcBase(config);
      var chapterUrl = base + '/chapter.php?id=' + encodeURIComponent(chapterId);
      var html = await httpText(chapterUrl, headers(base + '/comic.php?id=' + comicId));
      // The newest chapter is often an "APP 专享" gate page (box test 2026-11-25: 第67话 gated,
      // 第66话 readable). That is the site's own paywall-like gate; it is reported, not bypassed.
      if (/class="gate-status"|APP\s*专享章节/.test(html)) throw new Error('这一话是瓜子漫画 APP 专享，网页版不给图片（按免费策略不绕过），请换源或看上一话');
      var doc = parseHtml(html);
      var urls = [];
      doc.querySelectorAll('img.reading-image').forEach(function (img) {
        var u = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('src') || '';
        // gemini-fix 8: resolve relative / protocol-relative image paths against the chapter page
        if (u && !/placeholder|loading/.test(u)) { try { u = new URL(u, chapterUrl).href; } catch (e) {} }
        if (u && urls.indexOf(u) < 0 && !/placeholder|loading/.test(u)) urls.push(u);
      });
      if (!urls.length) throw new Error('这一话没有拿到图片');
      return urls.map(function (u) { return { url: u, kind: 'guazimanhua', referer: base + '/', ua: UA }; });
    },
    getProbeConfig(config) {
      return { testUrls: [srcBase(config) + '/category.php?sort=update'], sampleCoverUrl: '' };
    }
  });
})();
