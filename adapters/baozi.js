/* adapters/baozi.js — 包子漫画 (normal, primary).
 * Protocol: venera-app/venera-configs baozi.js (GPL-3.0).
 * Search GET {base}/search?q={kw}; category JSON API
 * /api/bzmhq/amp_comic_list?type=all&region=cn|jp|kr|en&state=all;
 * detail GET {base}/comic/{id} (chapter ids are 0-based indexes);
 * chapter images GET https://appcn.baozimh.com/baozimhapp/comic/
 * chapter/{comicId}/0_{epId}.html, .comic-contain__item[data-src].
 * 5-method interface (v2.2 §4.4). No login needed for reading. */
'use strict';

(function () {
  var UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  var APP_BASE = 'https://appcn.baozimh.com';
  function liveBase(src) { return src._liveBase || srcBase(src); }
  async function tryBases(src, fn, extraBases, stage) {
    var bases = [];
    if (src._liveBase) bases.push(src._liveBase);
    (src.baseUrls || [srcBase(src)]).forEach(function (b) { if (bases.indexOf(b) < 0) bases.push(b); });
    (extraBases || []).forEach(function (b) { if (bases.indexOf(b) < 0) bases.push(b); });
    var last = null;
    for (var i = 0; i < bases.length; i++) {
      try { var r = await fn(bases[i]); src._liveBase = bases[i]; return r; }
      catch (e) { last = withStage(e, stage || '目录请求'); }
    }
    throw last || new Error('包子漫画打不开');
  }
  function withStage(error, stage) {
    var e = error instanceof Error ? error : new Error(String(error || '请求失败'));
    if (e.status !== undefined || /HTTP\s+\d+/i.test(e.message || '')) e.stage = stage;
    else if (!e.stage) e.stage = 'network';
    return e;
  }
  async function fetchTextWithUrl(url, headers, timeoutMs, signal) {
    if (signal && signal.aborted) {
      var aborted = new Error('章节请求已取消'); aborted.name = 'AbortError'; aborted.stage = 'network'; aborted.url = url; throw aborted;
    }
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var requestSignal = controller ? controller.signal : signal;
    var externalAbort = null;
    var timer = null;
    return await new Promise(function (resolve, reject) {
      var settled = false;
      function finish(fn, value) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (signal && externalAbort) signal.removeEventListener('abort', externalAbort);
        fn(value);
      }
      function cancelRequest() { if (controller) controller.abort(); }
      if (signal) {
        externalAbort = function () {
          cancelRequest();
          var error = new Error('章节请求已取消'); error.name = 'AbortError'; error.stage = 'network'; error.url = url;
          finish(reject, error);
        };
        signal.addEventListener('abort', externalAbort, { once: true });
      }
      timer = setTimeout(function () {
        cancelRequest();
        var error = new Error('章节请求超时'); error.stage = 'network'; error.url = url; error.timeoutMs = timeoutMs;
        finish(reject, error);
      }, timeoutMs);
      var request;
      try {
        request = typeof httpTextResponse === 'function'
          ? httpTextResponse(url, headers, timeoutMs, requestSignal)
          : httpText(url, headers);
      } catch (error) { request = Promise.reject(error); }
      Promise.resolve(request).then(function (response) {
        finish(resolve, response && typeof response === 'object'
          ? { text: response.text || '', finalUrl: response.finalUrl || response.url || url }
          : { text: String(response || ''), finalUrl: url });
      }, function (error) {
        var e = error instanceof Error ? error : new Error(String(error || '章节请求失败'));
        if (e.url === undefined) e.url = url;
        if (!e.stage) e.stage = e.status !== undefined ? '章节请求' : 'network';
        finish(reject, e);
      });
    });
  }
  function catalogPath(chapterUrl) {
    if (!chapterUrl) return '';
    try {
      var u = new URL(chapterUrl, 'https://cn.baozimh.com');
      return u.pathname + u.search;
    } catch (e) { return ''; }
  }
  function slotValue(url, key) {
    try { return new URL(url, 'https://cn.baozimh.com').searchParams.get(key); }
    catch (e) { return null; }
  }
  function getSlots(href) {
    var section = slotValue(href, 'section_slot');
    var chapter = slotValue(href, 'chapter_slot');
    if ((section === null || chapter === null) && href) {
      var m = href.match(/\/comic\/chapter\/[^/]+\/(\d+)_(\d+)(?:_\d+)?\.html/i);
      if (m) { section = section === null ? m[1] : section; chapter = chapter === null ? m[2] : chapter; }
    }
    return section !== null && chapter !== null ? { section: String(section), chapter: String(chapter) } : null;
  }
  function normalizeRegion(value) {
    var v = String(value || '').trim().toLowerCase();
    if (/^(cn|china|国漫|中国|内地)$/.test(v)) return 'cn';
    if (/^(jp|japan|日漫|日本)$/.test(v)) return 'jp';
    if (/^(kr|korea|韩漫|韓漫|韩国|韓國)$/.test(v)) return 'kr';
    return '';
  }
  function cardRegion(tags) {
    for (var i = 0; i < tags.length; i++) { var region = normalizeRegion(tags[i]); if (region) return region; }
    return '';
  }
  function parseComicDetail(html, base) {
    var doc = parseHtml(html);
    var titleEl = doc.querySelector('h1.comics-detail__title');
    var coverEl = doc.querySelector('div.l-content amp-img, div.l-content img');
    var authorEl = doc.querySelector('h2.comics-detail__author');
    var descEl = doc.querySelector('p.comics-detail__desc');
    var tags = [];
    doc.querySelectorAll('div.tag-list > span').forEach(function (s) { tags.push(s.textContent.trim()); });
    var allLinks = [];
    doc.querySelectorAll('#chapter-items .comics-chapters > a, #chapters_other_list .comics-chapters > a').forEach(function (a) { allLinks.push(a); });
    if (!allLinks.length) doc.querySelectorAll('div.comics-chapters > a').forEach(function (a) { allLinks.push(a); });
    var chapters = [], seen = {};
    allLinks.forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var slots = getSlots(href);
      if (!slots) return;
      var key = slots.section + '_' + slots.chapter;
      if (seen[key]) return;
      seen[key] = true;
      var span = a.querySelector('span');
      var legacyId = slots.section === '0' && slots.chapter === String(chapters.length) ? String(chapters.length) : undefined;
      chapters.push({
        id: key, chapterKey: key, legacyId: legacyId,
        title: (span ? span.textContent : a.textContent || '').trim() || ('第' + (chapters.length + 1) + '话'),
        chapterUrl: absUrl(href, base), sectionSlot: slots.section, chapterSlot: slots.chapter
      });
    });
    if (!chapters.length) {
      var error = new Error('这部作品没有拿到章节'); error.stage = '章节解析'; throw error;
    }
    return {
      title: titleEl ? titleEl.textContent.trim() : '', author: authorEl ? authorEl.textContent.trim() : '',
      cover: coverEl ? absUrl(coverEl.getAttribute('src') || '', base) : '', tags: tags,
      desc: descEl ? descEl.textContent.trim() : '', chapters: chapters
    };
  }
  function appendUnique(list, value) { if (value && list.indexOf(value) < 0) list.push(value); }
  function appChapterPath(path, fallbackPath) {
    if (!path) return fallbackPath;
    try {
      var u = new URL(path, 'https://cn.baozimh.com');
      if (u.pathname.indexOf('/baozimhapp/comic/chapter/') === 0) return u.pathname + u.search;
      if (u.pathname.indexOf('/comic/chapter/') === 0) return '/baozimhapp' + u.pathname + u.search;
    } catch (e) { }
    return fallbackPath;
  }
  function readerPageCandidates(src, exactUrl, readerPath) {
    var urls = [], pathname = catalogPath(exactUrl), base = src._readerBase || liveBase(src);
    if (src._readerPrefix === '/baozimhapp' && pathname.indexOf('/comic/chapter/') === 0) pathname = src._readerPrefix + pathname;
    appendUnique(urls, exactUrl);
    if (pathname && base) appendUnique(urls, base.replace(/\/$/, '') + pathname);
    appendUnique(urls, APP_BASE + appChapterPath(pathname, readerPath));
    return urls.slice(0, 3);
  }
  function trustedImageHost(url) {
    try { return /(^|\.)(?:bzcdn\.net|baozicdn\.com)$/i.test(new URL(url).hostname); } catch (e) { return false; }
  }
  function validImageUrl(raw, pageUrl) {
    if (!raw || /^(?:data:|blob:|javascript:)/i.test(raw)) return '';
    var url = absUrl(raw, pageUrl);
    if (!url || /(?:placeholder|transparent|spacer|no[-_]?image|loading|default|(?:^|[\/_-])(?:logo|avatar|banner|thumb|thumbnail|cover|icon|qrcode|qr-code)(?:[\/_\-.]|$))/i.test(url)) return '';
    try {
      var parsed = new URL(url), ext = /\.(?:jpe?g|png|webp|avif)$/i.test(parsed.pathname);
      var trusted = trustedImageHost(url);
      var comicPath = /(?:^|\/)(?:scomic|comic|comics)(?:\/|$)/i.test(parsed.pathname);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      if (!trusted && !comicPath) return '';
      if (!ext && !trusted) return '';
      return url;
    } catch (e) { return ''; }
  }
  function excludedReaderImage(el) {
    var node = el;
    while (node && node.nodeType === 1) {
      if (node.hasAttribute('placeholder')) return true;
      var marker = ((node.getAttribute('class') || '') + ' ' + (node.getAttribute('id') || '') + ' ' + (node.getAttribute('role') || '') + ' ' + (node.getAttribute('alt') || '')).toLowerCase();
      if (/(^|[\s_-])(logo|avatar|profile|placeholder|ad|ads|advert|adhost|mobadsq|banner|icon|qrcode|qr-code|recommend|thumbnail|thumb)([\s_-]|$)/i.test(marker)) return true;
      node = node.parentElement;
    }
    return false;
  }
  function imageUrlForElement(el, pageUrl) {
    if (excludedReaderImage(el)) return '';
    var dataSrc = (el.getAttribute('data-src') || '').trim();
    var src = (el.getAttribute('src') || '').trim();
    return validImageUrl(dataSrc, pageUrl) || validImageUrl(src, pageUrl);
  }
  function isSmallFallbackImage(el) {
    var width = Number(el.getAttribute('width')) || 0;
    var height = Number(el.getAttribute('height')) || 0;
    if (width > 0 && height > 0) return width * height < 160000;
    return (width > 0 && width < 220) || (height > 0 && height < 220);
  }
  function chapterImageUrls(doc, pageUrl) {
    var seen = {}, urls = [];
    var primary = '.comic-contain .comic-contain__item, .comic-contain__item, .chapter-img amp-img, .chapter-img img, amp-img.chapter-img, img.chapter-img, amp-img.comic-contain__item, img.comic-contain__item, amp-img[id^="chapter-img"], img[id^="chapter-img"]';
    doc.querySelectorAll(primary).forEach(function (el) {
      var url = imageUrlForElement(el, pageUrl);
      if (url && !seen[url]) { seen[url] = true; urls.push(url); }
    });
    if (!urls.length && doc.body) doc.body.querySelectorAll('amp-img, img').forEach(function (el) {
      if (isSmallFallbackImage(el)) return;
      var url = imageUrlForElement(el, pageUrl);
      if (url && !seen[url]) { seen[url] = true; urls.push(url); }
    });
    return urls;
  }
  function chapterPage(url) {
    try {
      var u = new URL(url), m = u.pathname.match(/\/comic\/chapter\/([^/]+)\/(\d+)_(\d+)(?:_(\d+))?\.html$/i);
      return m ? { origin: u.origin, comic: m[1], section: m[2], chapter: m[3], page: m[4] ? Number(m[4]) : 1 } : null;
    } catch (e) { return null; }
  }
  function fetchReaderPage(url, referer, timeoutMs, signal, expected) {
    return fetchTextWithUrl(url, { 'User-Agent': UA, 'Referer': referer || APP_BASE + '/' }, timeoutMs, signal).then(function (response) {
      var finalUrl = response.finalUrl || url;
      var identity = chapterPage(finalUrl);
      if (expected && (!identity || identity.origin !== expected.origin || identity.comic !== expected.comic || identity.section !== expected.section || identity.chapter !== expected.chapter || identity.page <= expected.page)) {
        var changed = new Error('章节分页链接未通过校验'); changed.stage = '章节分页'; changed.url = finalUrl; throw changed;
      }
      var doc = parseHtml(response.text);
      var images = chapterImageUrls(doc, finalUrl);
      if (!images.length) { var empty = new Error('这一话没有拿到图片'); empty.stage = 'images'; empty.url = finalUrl; throw empty; }
      return { doc: doc, url: finalUrl, images: images, identity: identity };
    });
  }
  function linkedController(signal) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var relay = null;
    if (controller && signal) {
      if (signal.aborted) controller.abort();
      else { relay = function () { controller.abort(); }; signal.addEventListener('abort', relay, { once: true }); }
    }
    return {
      signal: controller ? controller.signal : signal,
      abort: function () { if (controller) controller.abort(); },
      dispose: function () { if (signal && relay) signal.removeEventListener('abort', relay); }
    };
  }
  function fetchFirstReaderPage(candidates, referer, signal, firstDeadline, totalDeadline) {
    return new Promise(function (resolve, reject) {
      if (!candidates.length) { var missing = new Error('章节页面打不开'); missing.stage = '章节请求'; reject(missing); return; }
      var controllers = [], remaining = candidates.length, finished = false, sawEmpty = false, lastError = null;
      function finishError() {
        if (finished) return;
        finished = true;
        if (sawEmpty) { var empty = new Error('这一话没有拿到图片'); empty.stage = 'images'; reject(empty); }
        else reject(withStage(lastError || new Error('章节页面打不开'), '章节请求'));
      }
      candidates.forEach(function (url, index) {
        var linked = linkedController(signal); controllers[index] = linked;
        var timeoutMs = Math.max(1, Math.min(5000, firstDeadline - Date.now(), totalDeadline - Date.now()));
        fetchReaderPage(url, referer, timeoutMs, linked.signal).then(function (page) {
          linked.dispose();
          if (finished) return;
          finished = true;
          controllers.forEach(function (other, otherIndex) { if (other && otherIndex !== index) { other.abort(); other.dispose(); } });
          resolve(page);
        }, function (error) {
          linked.dispose();
          if (finished) return;
          if (error && error.stage === 'images') sawEmpty = true;
          else lastError = error;
          remaining -= 1;
          if (!remaining) finishError();
        });
      });
    });
  }
  function nextReaderPage(doc, currentUrl, seen) {
    var current = chapterPage(currentUrl);
    if (!current) return '';
    var next = '', nextPage = Infinity;
    doc.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var targetUrl = absUrl(href, currentUrl);
      if (!targetUrl || seen[targetUrl]) return;
      if (a.getAttribute('id') === 'next-chapter' || (a.closest && a.closest('.next_chapter'))) return;
      var target = chapterPage(targetUrl);
      if (!target || target.origin !== current.origin || target.comic !== current.comic || target.section !== current.section || target.chapter !== current.chapter || target.page <= current.page) return;
      if (target.page < nextPage) { nextPage = target.page; next = targetUrl; }
    });
    return next;
  }
  function cards(doc, base) {
    var seen = {}, out = [];
    doc.querySelectorAll('div.comics-card').forEach(function (card) {
      var a = card.querySelector('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      var m = href.match(/\/comic\/([^/?#]+)/);
      if (!m) return;
      var slug = m[1];
      if (seen[slug]) return; seen[slug] = 1;
      var img = card.querySelector('amp-img, img');
      var cover = img ? absUrl(img.getAttribute('src') || img.getAttribute('data-src') || '', base) : '';
      var h3 = card.querySelector('h3');
      var title = (h3 ? h3.textContent : (a.getAttribute('title') || a.textContent || '')).trim();
      var tags = [];
      card.querySelectorAll('div.tabs > span').forEach(function (s) { tags.push(s.textContent.trim()); });
      var small = card.querySelector('small');
      if (title) out.push({ id: slug, title: title, cover: cover, coverKind: 'baozi', coverBase: base, coverReferer: base + '/', author: '', tags: tags, region: cardRegion(tags), desc: small ? small.textContent.trim() : '' });
    });
    if (!out.length) {
      // Fallback: generic /comic/ links (older markup).
      doc.querySelectorAll('a[href*="/comic/"]').forEach(function (a) {
        var href = a.getAttribute('href') || '';
        var m = href.match(/\/comic\/([^/?#]+)/);
        if (!m || /chapter/.test(href)) return;
        var slug = m[1];
        if (seen[slug]) return; seen[slug] = 1;
        var img = a.querySelector('img');
        var cover = img ? absUrl(img.getAttribute('data-src') || img.getAttribute('src') || '', base) : '';
        var title = (a.getAttribute('title') || a.textContent || '').trim().replace(/\s+/g, ' ');
        if (title) out.push({ id: slug, title: title, cover: cover, coverKind: 'baozi', coverBase: base, coverReferer: base + '/', author: '', tags: [], region: '' });
      });
    }
    return out;
  }
  function jsonComic(e, base) {
    return {
      id: String(e.comic_id), title: e.name || '', author: e.author || '',
      cover: e.topic_img ? ('https://static-tw.baozimh.com/cover/' + e.topic_img + '?w=285&h=375&q=100') : '',
      coverKind: 'baozi', coverBase: base, coverReferer: base + '/',
      tags: e.type_names || [], region: normalizeRegion(e.region)
    };
  }
  var REGION = { all: 'all', jp: 'jp', kr: 'kr', cn: 'cn' };
  registerVeneraAdapter('baozi', {
    handlesMirrors: true, // iterates its own baseUrls
    supportsCategory: true,
    supportsSearchPagination: false,
    async getCategoryList(config, category, sort, page) {
      var region = REGION[category] || 'all';
      try {
        return await tryBases(config, async function (b) {
          var j = await httpJson(b + '/api/bzmhq/amp_comic_list?type=all&region=' + region + '&state=all&filter=%2a&page=' + (page || 1) + '&limit=36&language=cn&__amp_source_origin=' + encodeURIComponent(b), { 'User-Agent': UA });
          return { items: (j.items || []).map(function (e) { return jsonComic(e, b); }), hasMore: !!j.next };
        });
      } catch (e) {
        var fallback = await tryBases(config, async function (b) {
          var html = await httpText(b + '/', { 'User-Agent': UA });
          return cards(parseHtml(html), b);
        });
        var items = [];
        if ((page || 1) === 1) {
          items = category === 'all' ? fallback : fallback.filter(function (item) { return item.region === region; });
        }
        return { items: items, hasMore: false };
      }
    },
    async search(config, keyword, page, options) {
      options = options || {};
      var items = await tryBases(config, async function (b) {
        var response = await fetchTextWithUrl(b + '/search?q=' + encodeURIComponent(keyword), { 'User-Agent': UA }, options.timeoutMs || 8000, options.signal);
        return cards(parseHtml(response.text), b);
      });
      return { items: items, hasMore: false };
    },
    async getComicDetail(config, comicId) {
      return await tryBases(config, async function (b) {
        var html = await httpText(b + '/comic/' + comicId, { 'User-Agent': UA });
        return parseComicDetail(html, b);
      });
    },
    async getChapterPages(config, comicId, chapterId, ref, options) {
      ref = ref || {};
      options = options || {};
      var slots = getSlots(ref.chapterUrl || '');
      var sectionSlot = ref.sectionSlot !== undefined ? String(ref.sectionSlot) : (slots && slots.section);
      var chapterSlot = ref.chapterSlot !== undefined ? String(ref.chapterSlot) : (slots && slots.chapter);
      if (chapterSlot === undefined) {
        var key = String(chapterId || '').match(/^(\d+)_(\d+)$/);
        if (key) { sectionSlot = sectionSlot === undefined ? key[1] : sectionSlot; chapterSlot = key[2]; }
      }
      if (sectionSlot === undefined || chapterSlot === undefined) {
        var missingRef = new Error('需要真实章节目录链接或 section_slot / chapter_slot'); missingRef.stage = '章节解析'; throw missingRef;
      }
      if (!/^\d+$/.test(sectionSlot) || !/^\d+$/.test(chapterSlot)) {
        var badRef = new Error('章节目录没有提供有效的 section_slot / chapter_slot'); badRef.stage = '章节解析'; throw badRef;
      }
      var relativePath = '/baozimhapp/comic/chapter/' + encodeURIComponent(comicId) + '/' + sectionSlot + '_' + chapterSlot + '.html';
      var knownBase = liveBase(config).replace(/\/$/, '');
      var chapterUrl = ref.chapterUrl ? absUrl(ref.chapterUrl, knownBase) : '';
      var initialPath = catalogPath(chapterUrl) || relativePath;
      var initialUrl = chapterUrl || (knownBase + initialPath);
      var initialCandidates = readerPageCandidates(config, initialUrl, relativePath);
      var startedAt = Date.now(), firstDeadline = startedAt + 5000, totalDeadline = startedAt + 12000;
      if (typeof options.onProgress === 'function') {
        var initialHost = '';
        try { initialHost = new URL(initialCandidates[0]).host; } catch (e) { }
        options.onProgress({ stage: 'chapter-request', host: initialHost });
      }
      var current = await fetchFirstReaderPage(initialCandidates, knownBase + '/', options.signal, firstDeadline, totalDeadline);
      try {
        var readerUrl = new URL(current.url);
        config._readerBase = readerUrl.origin;
        config._readerPrefix = readerUrl.pathname.indexOf('/baozimhapp/comic/chapter/') === 0 ? '/baozimhapp' : '';
      } catch (e) { }
      var wanted = chapterPage(initialUrl);
      if (wanted && current.identity && (current.identity.comic !== wanted.comic || current.identity.section !== sectionSlot || current.identity.chapter !== chapterSlot)) {
        var wrongChapter = new Error('章节页面与目录章节不匹配'); wrongChapter.stage = '章节解析'; wrongChapter.url = current.url; throw wrongChapter;
      }
      var seenPages = {}, seenImages = {}, urls = [], pageCount = 0;
      while (current && !seenPages[current.url]) {
        seenPages[current.url] = true;
        pageCount += 1;
        current.images.forEach(function (url) {
          if (!seenImages[url]) { seenImages[url] = true; urls.push({ url: url, referer: current.url }); }
        });
        var next = nextReaderPage(current.doc, current.url, seenPages);
        if (!next) break;
        var host = '';
        try { host = new URL(current.url).host; } catch (e) { }
        if (typeof options.onProgress === 'function') {
          var progress = { stage: pageCount === 1 ? 'first-page' : 'pagination', host: host };
          if (progress.stage === 'first-page') progress.firstPages = urls.map(function (item) { return { url: item.url, kind: 'baozi', referer: item.referer }; });
          options.onProgress(progress);
        }
        var remainingMs = totalDeadline - Date.now();
        if (remainingMs <= 0) { var totalTimeout = new Error('章节分页总耗时超限'); totalTimeout.stage = 'network'; totalTimeout.url = next; totalTimeout.timeoutMs = 12000; throw totalTimeout; }
        current = await fetchReaderPage(next, current.url, Math.min(5000, remainingMs), options.signal, current.identity);
      }
      if (!urls.length) {
        var empty = new Error('这一话没有拿到图片'); empty.stage = 'images'; throw empty;
      }
      return urls.map(function (item) { return { url: item.url, kind: 'baozi', referer: item.referer }; });
    },
    getProbeConfig(config) {
      return { testUrls: [liveBase(config) + '/search?q=' + encodeURIComponent('海贼王')], sampleCoverUrl: '' };
    }
  });
})();
