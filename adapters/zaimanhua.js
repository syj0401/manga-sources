/* adapters/zaimanhua.js — 再漫画 (normal, backup).
 * Protocol: venera-app/venera-configs zaimanhua.js (GPL-3.0).
 * API https://v4api.zaimanhua.com/app/v1/. Headers: UA
 * "Mozilla/5.0 (Linux; Android) Mobile", Authorization "Bearer "
 * (empty token is fine — login is optional, only for favourites).
 * Search GET {api}search/index?keyword=&page=&sort=0&size=20;
 * detail GET {api}comic/detail/{id}?channel=android (chapters are
 * grouped: data.chapters[] {title, data:[{chapter_id, chapter_title}]});
 * pages GET {api}comic/chapter/{comicId}/{epId} -> page_url_hd ||
 * page_url (plain URL arrays, no splice, no Referer requirement).
 * 5-method interface (v2.2 §4.4). */
'use strict';

(function () {
  var HEADERS = { 'User-Agent': 'Mozilla/5.0 (Linux; Android) Mobile', 'Authorization': 'Bearer ' };
  function api(src) {
    var b = srcBase(src);
    return b.endsWith('/') ? b : b + '/';
  }
  var ZONE = { all: '0', jp: '2304', kr: '2305', cn: '2308' };
  function mapComic(e) {
    return {
      id: String(e.comic_id || e.id), title: e.title || e.name || '',
      author: e.authors || '', cover: e.cover || '', coverKind: 'zaimanhua',
      tags: [e.status].concat((e.types || '').split('/')).filter(Boolean),
      desc: e.description || e.last_update_chapter_name || e.last_name || ''
    };
  }
  registerVeneraAdapter('zaimanhua', {
    async getCategoryList(config, category, sort, page) {
      page = page || 1;
      var sortType = sort === 'hot' ? '2' : '1';
      var zone = ZONE[category] || ZONE.all;
      var j = await httpJson(api(config) + 'comic/filter/list?status=0&theme=0&zone=' + zone + '&cate=0&sortType=' + sortType + '&page=' + page + '&size=20', HEADERS);
      var data = (j.data && j.data.data) || j.data || {};
      var list = data.comicList || data.list || (Array.isArray(data.data) ? data.data : []);
      var total = data.totalNum != null ? Number(data.totalNum) : Number(data.total);
      return {
        items: list.map(mapComic),
        hasMore: Number.isFinite(total) && page < Math.ceil(total / 20)
      };
    },
    async search(config, keyword, page) {
      page = page || 1;
      var j = await httpJson(api(config) + 'search/index?keyword=' + encodeURIComponent(keyword) + '&page=' + (page || 1) + '&sort=0&size=20', HEADERS);
      var data = (j.data && j.data.data) || j.data || {};
      return ((data.list || [])).map(mapComic);
    },
    async getComicDetail(config, comicId) {
      var j = await httpJson(api(config) + 'comic/detail/' + comicId + '?channel=android', HEADERS);
      var d = (j.data && j.data.data) || j.data || {};
      var chapters = [];
      (d.chapters || []).forEach(function (g) {
        (g.data || []).forEach(function (c) {
          chapters.push({ id: String(c.chapter_id), title: c.chapter_title || '' });
        });
      });
      // v2.0.2 sources round: the API answers chapters:[] + is_need_login:1 for some titles
      // (box test 2026-11-25). No account is built in, so say so instead of a generic error.
      if (!chapters.length && j.errno) throw new Error('再漫画：' + (j.errmsg || ('errno ' + j.errno)) + '（App 接口不给这部作品的章节，可能要登录，应用不内置账号），请换源');
      if (!chapters.length && Number(d.is_need_login) === 1) throw new Error('再漫画要求登录后才给这部作品的章节（应用不内置账号），请换源');
      if (!chapters.length) throw new Error('这部作品没有拿到章节');
      var names = function (v) { return Array.isArray(v) ? v.map(function (t) { return t && (t.tag_name || t.name) || ''; }).filter(Boolean) : String(v || '').split('/').filter(Boolean); };
      return {
        title: d.title || d.name || '', author: names(d.authors).join(' / '),
        cover: d.cover || '', coverKind: 'zaimanhua',
        tags: names(d.types).length ? names(d.types) : names(d.tag_name),
        desc: d.description || '', chapters: chapters
      };
    },
    async getChapterPages(config, comicId, chapterId) {
      var j = await httpJson(api(config) + 'comic/chapter/' + comicId + '/' + chapterId, HEADERS);
      var d = (j.data && j.data.data) || j.data || {};
      var urls = d.page_url_hd || d.page_url || [];
      if (!urls.length) throw new Error('这一话没有拿到图片');
      return urls.map(function (u) { return { url: u, kind: 'zaimanhua' }; });
    },
    getProbeConfig(config) {
      return { testUrls: [api(config) + 'search/index?keyword=' + encodeURIComponent('海贼王') + '&page=1&sort=0&size=1'], sampleCoverUrl: '' };
    },
    supportsCategory: function (_config, category) { return Object.prototype.hasOwnProperty.call(ZONE, category); },
    supportsHot: true,
    supportsSearchPagination: true,
    supportsListPagination: true
  });
})();
