/* adapters/hot.js — 热辣漫画 HotManga (adult, primary).
 * Protocol: venera-app/venera-configs hot_manga.js (GPL-3.0), forked
 * from copy_manga.js. KEY DIFFERENCES from CopyManga: NO HMAC signature,
 * NO getReqID/request_id, NO region/deviceinfo, NO API refresh; chapter
 * endpoint is /chapter/ (not /chapter2); NO words[] reorder; quality
 * rewrite is .jpg.h{quality}x.jpg. Search is hard-limited to
 * free_type=1 (free comics only). HTTP 210 = rate limited: wait and
 * retry twice, then fail loudly. 5-method interface (v2.2 §4.4). */
'use strict';

(function () {
  var HEADERS = {
    'Authorization': 'Token', 'Accept': 'application/json', 'webp': '1',
    'platform': '3', 'version': '2024.04.28', 'X-Requested-With': 'com.manga2020.app'
  };
  function mapList(list) {
    return (list || []).map(function (x) {
      return {
        id: x.path_word, title: x.name, author: (x.author || []).map(function (a) { return a.name; }).join(' / '),
        cover: x.cover || '', coverKind: 'hot', tags: [x.status === '0' ? '连载中' : x.status === '1' ? '完结' : ''],
        badge: x.status === '1' ? '完结' : ''
      };
    });
  }
  async function hotGet(src, path) {
    var bases = src.baseUrls || [srcBase(src)];
    var last = null;
    for (var i = 0; i < bases.length; i++) {
      try { var j = await httpJson(bases[i] + path, HEADERS); src._liveBase = bases[i]; return j; }
      catch (e) { last = e; }
    }
    throw last || new Error('热辣漫画打不开');
  }
  function quality(u) {
    return String(u).replace(/\.jpg\.h\d+x\.jpg$/, '.jpg.h1500x.jpg');
  }
  function groupEntries(groups) {
    var entries = [];
    if (Array.isArray(groups)) {
      groups.forEach(function (g, i) { if (g) entries.push({ path: g.path_word || String(i), name: g.name || '' }); });
    } else if (groups && typeof groups === 'object') {
      Object.keys(groups).forEach(function (key) {
        var g = groups[key];
        entries.push({ path: g && g.path_word || key, name: g && g.name || '' });
      });
    }
    return entries.length ? entries : [{ path: 'default', name: '' }];
  }
  function pageResult(results, limit, offset) {
    var list = (results && results.list) || [];
    var total = Number(results && results.total);
    return { items: list, hasMore: Number.isFinite(total) ? offset + list.length < total : list.length === limit };
  }
  registerVeneraAdapter('hot', {
    handlesMirrors: true, // iterates its own baseUrls
    supportsCategory: function (config, category) { return ['all', 'kr'].indexOf(category) >= 0; },
    supportsHot: true,
    supportsSearchPagination: true,
    async getCategoryList(config, category, sort, page) {
      var off = ((page || 1) - 1) * 30;
      var ordering = sort === 'hot' ? '-popular' : '-datetime_updated';
      var path = category === 'kr'
        ? '/api/v3/h5/homeIndex/comics?limit=30&offset=' + off + '&top=korea&ordering=' + ordering + '&free_type=1'
        : '/api/v3/comics?limit=30&offset=' + off + '&ordering=' + ordering + '&free_type=1';
      var j = await hotGet(config, path);
      var result = pageResult(j.results, 30, off);
      result.items = mapList(result.items);
      return result;
    },
    async search(config, keyword, page) {
      var off = ((page || 1) - 1) * 20;
      var j = await hotGet(config, '/api/v3/search/comic?platform=3&q=' + encodeURIComponent(keyword) + '&limit=20&offset=' + off + '&free_type=1&_update=true');
      var result = pageResult(j.results, 20, off);
      result.items = mapList(result.items);
      return result;
    },
    async getComicDetail(config, comicId) {
      var j = await hotGet(config, '/api/v3/comic2/' + comicId + '?in_mainland=true&platform=3');
      var res = j.results || {};
      var groups = groupEntries(res.groups), list = [], seen = {};
      for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        var group = groups[groupIndex], offset = 0, limit = 100, total = Infinity;
        while (offset < total) {
          var cj = await hotGet(config, '/api/v3/comic/' + comicId + '/group/' + group.path + '/chapters?limit=' + limit + '&offset=' + offset);
          var chapterResult = cj.results || {};
          var batch = chapterResult.list || [];
          if (!batch.length) break;
          batch.forEach(function (chapter) {
            if (seen[chapter.uuid]) return;
            seen[chapter.uuid] = true;
            list.push(Object.assign({}, chapter, { _groupName: group.name }));
          });
          total = Number(chapterResult.total);
          if (!Number.isFinite(total)) total = offset + batch.length;
          offset += batch.length;
        }
      }
      if (!list.length) throw new Error('这部作品没有拿到章节');
      return {
        title: res.comic ? res.comic.name : '', author: '',
        meta: res.comic && res.comic.author ? ('作者：' + res.comic.author.map(function (a) { return a.name; }).join(' / ')) : '',
        tags: res.comic ? (res.comic.theme || []).map(function (t) { return t.name; }) : [],
        desc: res.comic ? (res.comic.brief || '') : '',
        chapters: list.map(function (c) { return { id: c.uuid, title: c._groupName ? c._groupName + ' · ' + (c.name || '') : (c.name || ''), group: c._groupName || '' }; })
      };
    },
    async getChapterPages(config, comicId, chapterId) {
      var last = null;
      for (var attempt = 0; attempt < 3; attempt++) {
        try {
          var j = await hotGet(config, '/api/v3/comic/' + comicId + '/chapter/' + chapterId + '?platform=3&_update=true');
          var contents = (j.results && j.results.chapter && j.results.chapter.contents) || [];
          var urls = contents.map(function (c) { return c.url; }).filter(Boolean);
          if (!urls.length) throw new Error('这一话没有拿到图片');
          return urls.map(function (u) { return { url: quality(u), kind: 'hot' }; });
        } catch (e) {
          last = e;
          if (/HTTP 210/.test(e.message || '')) {
            await new Promise(function (r) { setTimeout(r, 5000); });
            continue;
          }
          throw e;
        }
      }
      throw last || new Error('这一话没有拿到图片（访问过频，稍后再试）');
    },
    getProbeConfig(config) {
      return { testUrls: [(config.baseUrls && config.baseUrls[0] || srcBase(config)) + '/api/v3/comics?limit=1&offset=0&free_type=1'], sampleCoverUrl: '' };
    }
  });
})();
