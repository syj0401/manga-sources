/* adapters/mangadex.js — MangaDex official REST API (normal zone).
 * v2.0.2 round 4: replaces the old hidden debug adapter. Only works that
 * have zh / zh-hk translations are listed (availableTranslatedLanguage),
 * contentRating=safe only, chapters = zh / zh-hk feed fetched page by page
 * until `total` (500 per page), images via /at-home/server. Real paging:
 * list/search use offset = (page-1)*30 and stop at `total`.
 * Mainland reachability of api.mangadex.org / *.mangadex.network is NOT
 * verified (box network only). */
'use strict';

(function () {
  var UA = { 'User-Agent': 'MangaReader/1.0' };
  var LANGS = 'availableTranslatedLanguage[]=zh&availableTranslatedLanguage[]=zh-hk';
  var LIMIT = 30;
  var ORIGINAL = { jp: 'ja', kr: 'ko', cn: 'zh' };
  function api(config) { return srcBase(config).replace(/\/$/, ''); }
  function zhTitle(a) {
    var t = a.title || {};
    if (t.zh || t['zh-hk']) return t.zh || t['zh-hk'];
    var alt = (a.altTitles || []).find(function (x) { return x.zh || x['zh-hk']; });
    if (alt) return alt.zh || alt['zh-hk'];
    return t.en || t['ja-ro'] || t['ko-ro'] || Object.values(t)[0] || '未知';
  }
  function mapManga(m) {
    var a = m.attributes || {};
    var author = (m.relationships || []).find(function (r) { return r.type === 'author'; });
    var cover = (m.relationships || []).find(function (r) { return r.type === 'cover_art'; });
    var region = { ja: 'jp', ko: 'kr', zh: 'cn', 'zh-hk': 'cn' }[a.originalLanguage] || '';
    return {
      id: m.id, title: zhTitle(a),
      author: author && author.attributes ? author.attributes.name || '' : '',
      cover: cover && cover.attributes && cover.attributes.fileName ? 'https://uploads.mangadex.org/covers/' + m.id + '/' + cover.attributes.fileName + '.256.jpg' : '',
      coverKind: 'mangadex', region: region,
      tags: [a.status === 'completed' ? '完结' : a.status === 'ongoing' ? '连载中' : '', { jp: '日漫', kr: '韩漫', cn: '国漫' }[region] || ''].filter(Boolean),
      badge: a.status === 'completed' ? '完结' : '',
      desc: (a.description || {}).zh || (a.description || {})['zh-hk'] || (a.description || {}).en || '',
      latestChapter: a.lastChapter ? '第' + a.lastChapter + '话' : ''
    };
  }
  async function mangaPage(config, params, page) {
    var offset = ((page || 1) - 1) * LIMIT;
    var j = await httpJson(api(config) + '/manga?limit=' + LIMIT + '&offset=' + offset + '&includes[]=cover_art&includes[]=author&contentRating[]=safe&' + LANGS + '&' + params, UA);
    var list = (j.data || []).map(mapManga);
    var total = Number(j.total);
    return { items: list, hasMore: Number.isFinite(total) ? offset + list.length < total && offset + LIMIT < 10000 : list.length === LIMIT };
  }
  registerVeneraAdapter('mangadex', {
    supportsCategory: function (_config, category) { return category === 'all' || Object.prototype.hasOwnProperty.call(ORIGINAL, category); },
    supportsHot: true,
    supportsSearchPagination: true,
    supportsListPagination: true,
    async getCategoryList(config, category, sort, page) {
      var params = (sort === 'hot' ? 'order[followedCount]=desc' : 'order[latestUploadedChapter]=desc')
        + (ORIGINAL[category] ? '&originalLanguage[]=' + ORIGINAL[category] : '');
      return mangaPage(config, params, page);
    },
    async search(config, keyword, page) {
      return mangaPage(config, 'title=' + encodeURIComponent(keyword) + '&order[relevance]=desc', page);
    },
    async getComicDetail(config, comicId) {
      var mj = await httpJson(api(config) + '/manga/' + comicId + '?includes[]=cover_art&includes[]=author', UA);
      var manga = mapManga(mj.data || { id: comicId, attributes: {} });
      var feed = [], offset = 0, total = Infinity;
      while (offset < total && offset < 10000) {
        var j = await httpJson(api(config) + '/manga/' + comicId + '/feed?limit=500&offset=' + offset
          + '&translatedLanguage[]=zh&translatedLanguage[]=zh-hk&order[volume]=asc&order[chapter]=asc&includeExternalUrl=0', UA);
        var data = j.data || [];
        feed = feed.concat(data);
        total = Number(j.total) || 0;
        offset += 500;
        if (!data.length) break;
      }
      var byNum = Object.create(null), order = [];
      feed.forEach(function (c) {
        var a = c.attributes || {};
        if (!(a.pages > 0) || a.externalUrl) return;
        var key = a.chapter != null ? 'c' + a.chapter : 'id' + c.id;
        if (!byNum[key]) order.push(key);
        if (!byNum[key] || (a.translatedLanguage === 'zh' && byNum[key].lang !== 'zh')) {
          byNum[key] = { id: c.id, lang: a.translatedLanguage,
            title: (a.chapter != null ? '第' + a.chapter + '话' : '单话') + (a.title ? ' ' + a.title : '') + (a.translatedLanguage === 'zh-hk' ? '（繁）' : '') };
        }
      });
      var chapters = order.map(function (k) { return byNum[k]; });
      if (!chapters.length) throw new Error('这部作品在 MangaDex 上没有可直接阅读的中文章节');
      return { title: manga.title, author: manga.author, tags: manga.tags, desc: manga.desc, cover: manga.cover, chapters: chapters };
    },
    async getChapterPages(config, comicId, chapterId) {
      var j = await httpJson(api(config) + '/at-home/server/' + chapterId, UA);
      var files = (j.chapter && j.chapter.data) || [];
      if (!files.length) throw new Error('这一话没有拿到图片');
      return files.map(function (f) { return { url: j.baseUrl + '/data/' + j.chapter.hash + '/' + f, kind: 'mangadex' }; });
    },
    chapterOrder: 'asc',
    getProbeConfig(config) { return { testUrls: [api(config) + '/manga?limit=1&' + LANGS], sampleCoverUrl: '' }; }
  });
})();
