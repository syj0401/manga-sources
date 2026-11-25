/* SPDX-License-Identifier: GPL-3.0-or-later
 * Komiic adapter, adapted from venera-app/venera-configs/komiic.js.
 * Public GraphQL routes only; no account token or login flow is used.
 */
'use strict';

(function () {
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  var FIELDS = 'id title status year imageUrl authors { id name } categories { id name } dateUpdated monthViews views favoriteCount lastBookUpdate lastChapterUpdate';

  function bases(src) {
    return src.baseUrls && src.baseUrls.length ? src.baseUrls : [srcBase(src)];
  }
  function baseUrl(src) { return (src._liveBase || bases(src)[0] || '').replace(/\/$/, ''); }
  function requestBody(operationName, variables, query) {
    return { operationName: operationName, variables: variables, query: query };
  }
  async function query(src, payload) {
    var list = bases(src), last = null;
    for (var i = 0; i < list.length; i++) {
      var base = String(list[i]).replace(/\/$/, '');
      try {
        var json = await httpPostJson(base + '/api/query', payload, {
          'Content-Type': 'application/json', 'Referer': base + '/', 'User-Agent': UA
        });
        if (json.errors && json.errors.length) throw new Error(json.errors[0].message || 'Komiic GraphQL 请求失败');
        src._liveBase = base;
        return json.data || {};
      } catch (e) { last = e; }
    }
    throw last || new Error('Komiic 暂时无法连接');
  }
  function region(value) {
    var v = String(value || '').toLowerCase();
    if (/^(jp|ja|japan|日本|日漫)$/.test(v)) return 'jp';
    if (/^(cn|zh|china|中国|中國|国漫|國漫|台湾|台灣)$/.test(v)) return 'cn';
    if (/^(kr|ko|korea|韩国|韓國|韩漫|韓漫)$/.test(v)) return 'kr';
    return '';
  }
  function adultFlag(item, tags) {
    var rating = String((item && (item.contentRating || item.content_rating || item.rating)) || '').toLowerCase();
    return item && (item.isAdult === true || item.is_adult === true || item.adult === true) ||
      /^(adult|mature|erotica|pornographic|explicit|r18|18\+|18禁)$/.test(rating) ||
      (tags || []).some(function (tag) { return /^(hentai|r18|18\+|18禁|成人|成人向|情色|色情|里番)$/i.test(String(tag).trim()); });
  }
  function mapComic(item) {
    item = item || {};
    var authors = item.authors || [], tags = (item.categories || []).map(function (x) { return x.name || ''; }).filter(Boolean);
    return {
      id: String(item.id || ''), title: item.title || '', author: authors.map(function (x) { return x.name; }).filter(Boolean).join(' / '),
      cover: item.imageUrl || '', tags: tags, desc: item.lastChapterUpdate || '',
      region: region(item.originalLanguage || item.original_language || item.language || item.country || item.region),
      contentRating: item.contentRating || item.content_rating || item.rating || '', isAdult: adultFlag(item, tags)
    };
  }
  function listQuery(operationName, field, orderBy, offset, limit) {
    return requestBody(operationName, { pagination: { limit: limit, offset: offset, orderBy: orderBy, status: '', asc: false } },
      'query ' + operationName + '($pagination: Pagination!) { ' + field + '(pagination: $pagination) { ' + FIELDS + ' } }');
  }

  registerVeneraAdapter('komiic', {
    handlesMirrors: true, // iterates its own baseUrls
    supportsCategory: function (_config, category) { return category === 'all'; },
    supportsHot: true,
    supportsSearchPagination: false,
    supportsListPagination: true,
    async getCategoryList(config, category, sort, page) {
      var limit = 30, offset = ((page || 1) - 1) * limit;
      var hot = sort === 'hot';
      var operation = hot ? 'hotComics' : 'recentUpdate';
      var field = hot ? 'hotComics' : 'recentUpdate';
      var order = hot ? 'MONTH_VIEWS' : 'DATE_UPDATED';
      var data = await query(config, listQuery(operation, field, order, offset, limit));
      var items = data[field] || [];
      return { items: items.map(mapComic), hasMore: items.length === limit };
    },
    async search(config, keyword) {
      var payload = requestBody('searchComicAndAuthorQuery', { keyword: keyword },
        'query searchComicAndAuthorQuery($keyword: String!) { searchComicsAndAuthors(keyword: $keyword) { comics { ' + FIELDS + ' } } }');
      var result = (await query(config, payload)).searchComicsAndAuthors;
      return { items: result && result.comics ? result.comics.map(mapComic) : [], hasMore: false };
    },
    async getComicDetail(config, comicId) {
      var comicPromise = query(config, requestBody('comicByIds', { comicIds: [comicId] },
        'query comicByIds($comicIds: [ID]!) { comicByIds(comicIds: $comicIds) { ' + FIELDS + ' } }'));
      var chapterPromise = query(config, requestBody('chapterByComicId', { comicId: comicId },
        'query chapterByComicId($comicId: ID!) { chaptersByComicId(comicId: $comicId) { id serial type dateCreated dateUpdated size } }'));
      var results = await Promise.all([comicPromise, chapterPromise]);
      var comic = (results[0].comicByIds || [])[0];
      if (!comic) throw new Error('Komiic 没有返回作品详情');
      var chapters = (results[1].chaptersByComicId || []).map(function (item) {
        // v2.0.2 round 4: the query above was missing its (comicIds: $comicIds) argument → GraphQL error, 0 chapters.
        return { id: String(item.id), title: item.type === 'book' ? '卷' + item.serial : (item.serial ? '第' + item.serial + '话' : '未命名章节') };
      });
      if (!chapters.length) throw new Error('这部作品没有拿到章节');
      var mapped = mapComic(comic);
      return {
        title: mapped.title, author: mapped.author, tags: mapped.tags, desc: '', cover: mapped.cover,
        region: mapped.region, contentRating: mapped.contentRating, isAdult: mapped.isAdult, chapters: chapters
      };
    },
    async getChapterPages(config, comicId, chapterId) {
      var data = await query(config, requestBody('imagesByChapterId', { chapterId: chapterId },
        'query imagesByChapterId($chapterId: ID!) { imagesByChapterId(chapterId: $chapterId) { id kid height width } }'));
      var images = data.imagesByChapterId || [];
      if (!images.length) throw new Error('这一话没有拿到图片');
      var base = baseUrl(config);
      var referer = base + '/comic/' + encodeURIComponent(comicId) + '/chapter/' + encodeURIComponent(chapterId) + '/images/all';
      return images.map(function (item) { return { url: base + '/api/image/' + encodeURIComponent(item.kid), kind: 'komiic', referer: referer }; });
    },
    getProbeConfig(config) { return { testUrls: [baseUrl(config) + '/'], sampleCoverUrl: '' }; }
  });
})();
